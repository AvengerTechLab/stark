// What the PO can do to rules and channels, shared by the web page and the Telegram commands so both
// validate the same way and record the same actions (API.md §1.2–1.3, §2; SECURITY.md T-22).

import type { ChannelName } from "../ports/channel.js";
import type { DeliveryLog } from "../ports/storage.js";
import { DEFAULT_QUOTAS, usagePeriod } from "./dispatcher.js";
import type { ChannelAdmin, OwnerAction, RuleAdmin } from "../ports/owner.js";
import type { Rule } from "../domain/rules.js";
import { validateRuleInput, type RuleInputError, type RuleSpec } from "../domain/rule-input.js";

export type Source = OwnerAction["source"];

export interface OwnerServiceOptions {
  readonly rules: RuleAdmin;
  readonly channels: ChannelAdmin;
  readonly isListed: (pair: string) => boolean;
  readonly newId: () => string;
  readonly now: () => Date;
  /** Called after any rule is created, changed or deleted, e.g. to resubscribe the feeds (S6-11). */
  readonly onRulesChanged?: () => void;
}

export type RuleResult =
  | { readonly ok: true; readonly rule: Rule }
  | { readonly ok: false; readonly errors: readonly RuleInputError[] }
  | { readonly ok: false; readonly notFound: true };

const CHANNELS: readonly ChannelName[] = ["telegram", "line", "discord", "email"];
const SPEC_KEYS = ["kind", "pair", "level", "percent", "windowMinutes", "direction", "channels"] as const;
const MIN_SHORT_ID = 4;

/** A rule's own fields, without its ID, enabled flag and state. */
function specOf(rule: Rule): Record<string, unknown> {
  return Object.fromEntries(Object.entries(rule).filter(([key]) => !["id", "enabled", "state"].includes(key)));
}

function toRule(spec: RuleSpec, id: string, enabled: boolean, state: Rule["state"]): Rule {
  return { ...spec, id, enabled, state } as Rule;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class OwnerService {
  constructor(private readonly options: OwnerServiceOptions) {}

  private action(source: Source, action: string, subject: string, detail: Record<string, unknown>): OwnerAction {
    return { id: this.options.newId(), at: this.options.now(), source, action, subject, detail };
  }

  listRules(): Promise<readonly Rule[]> {
    return this.options.rules.list();
  }

  async createRule(input: unknown, source: Source): Promise<RuleResult> {
    const result = validateRuleInput(input, this.options.isListed);
    if (!result.ok) return { ok: false, errors: result.errors };
    const rule = toRule(result.value, this.options.newId(), true, "armed");
    await this.options.rules.create(rule, this.action(source, "rule.created", rule.id, { ...result.value }));
    this.options.onRulesChanged?.();
    return { ok: true, rule };
  }

  /**
   * Changes a rule. `enabled` switches it on or off; any other field is merged into the rule and the
   * whole rule is validated again. A changed or re-enabled rule starts armed (EVENTS.md §3.4).
   */
  async updateRule(id: string, patch: unknown, source: Source): Promise<RuleResult> {
    if (!isRecord(patch)) return { ok: false, errors: [{ field: "body", code: "BODY_INVALID", message: "body must be an object" }] };
    const existing = await this.options.rules.get(id);
    if (existing === undefined) return { ok: false, notFound: true };
    if ("enabled" in patch && typeof patch["enabled"] !== "boolean") {
      return { ok: false, errors: [{ field: "enabled", code: "BODY_INVALID", message: "enabled must be true or false" }] };
    }
    const enabled = typeof patch["enabled"] === "boolean" ? patch["enabled"] : existing.enabled;
    const specPatch = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "enabled"));
    const specChanged = Object.keys(specPatch).length > 0;

    let spec = specOf(existing);
    if (specChanged) {
      const kindChanges = "kind" in specPatch && specPatch["kind"] !== existing.kind;
      const base = kindChanges ? { pair: existing.pair, channels: existing.channels } : spec;
      const result = validateRuleInput({ ...base, ...specPatch }, this.options.isListed);
      if (!result.ok) return { ok: false, errors: result.errors };
      spec = { ...result.value };
    }
    const state = specChanged || (enabled && !existing.enabled) ? "armed" : existing.state;
    const rule = toRule(spec as RuleSpec, id, enabled, state);
    const name = specChanged ? "rule.updated" : enabled === existing.enabled ? "rule.updated" : enabled ? "rule.enabled" : "rule.disabled";
    const detail = Object.fromEntries(SPEC_KEYS.filter((k) => k in specPatch).map((k) => [k, specPatch[k]]));
    if ("enabled" in patch) detail["enabled"] = enabled;
    if (!(await this.options.rules.update(rule, this.action(source, name, id, detail)))) return { ok: false, notFound: true };
    this.options.onRulesChanged?.();
    return { ok: true, rule };
  }

  async deleteRule(id: string, source: Source): Promise<boolean> {
    const removed = await this.options.rules.remove(id, this.action(source, "rule.deleted", id, {}));
    if (removed) this.options.onRulesChanged?.();
    return removed;
  }

  /** A rule by a prefix of its ID of at least 4 characters, as the Telegram commands use (API.md §2). */
  async findByShortId(prefix: string): Promise<{ rule: Rule } | { notFound: true } | { ambiguous: true }> {
    const wanted = prefix.toLowerCase();
    if (wanted.length < MIN_SHORT_ID) return { notFound: true };
    const matches = (await this.options.rules.list()).filter((r) => r.id.toLowerCase().startsWith(wanted));
    if (matches.length > 1) return { ambiguous: true };
    return matches[0] === undefined ? { notFound: true } : { rule: matches[0] };
  }

  listChannels() {
    return this.options.channels.list();
  }

  /** Switches a channel system-wide; false for a name that is not a channel. */
  async setChannel(name: string, enabled: boolean, source: Source): Promise<boolean> {
    const channel = CHANNELS.find((c) => c === name);
    if (channel === undefined) return false;
    const action = this.action(source, enabled ? "channel.switched_on" : "channel.switched_off", channel, { enabled });
    await this.options.channels.setEnabled(channel, enabled, action);
    return true;
  }
}

export interface ChannelOverview {
  readonly name: ChannelName;
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly deadSince: Date | null;
  /** This period's sends against the limit, for LINE (month) and Gmail (day); null for the others. */
  readonly usage: { readonly period: string; readonly sent: number; readonly limit: number } | null;
}

/** Each channel's switch, dead state and usage, for GET /channels and the /status command. */
export async function channelOverview(
  service: OwnerService,
  deliveries: Pick<DeliveryLog, "usage">,
  configured: readonly ChannelName[],
  now: Date,
): Promise<ChannelOverview[]> {
  const list = await service.listChannels();
  return Promise.all(
    list.map(async (c) => {
      const quota = DEFAULT_QUOTAS[c.channel];
      const period = quota === undefined ? undefined : usagePeriod(quota.per, now);
      return {
        name: c.channel,
        configured: configured.includes(c.channel),
        enabled: c.enabled,
        deadSince: c.deadSince,
        usage: quota === undefined || period === undefined ? null : { period, sent: await deliveries.usage(c.channel, period), limit: quota.limit },
      };
    }),
  );
}
