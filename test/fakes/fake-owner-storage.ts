// In-memory stand-ins for the owner interface's PostgreSQL stores (CLAUDE.md §5).

import type { ChannelName } from "../../src/ports/channel.js";
import type {
  AlertQuery,
  ChannelAdmin,
  ChannelState,
  DecisionWithAttempts,
  OwnerAction,
  RuleAdmin,
  SessionStore,
} from "../../src/ports/owner.js";
import type { Rule } from "../../src/domain/rules.js";
import type { FakeChannelSettings, FakeDeliveryLog, FakeRuleStore } from "./fake-storage.js";

/** Rule administration on top of FakeRuleStore, so the pipeline and the owner see the same rules. */
export class FakeRuleAdmin implements RuleAdmin {
  readonly actions: OwnerAction[] = [];

  constructor(private readonly store: FakeRuleStore) {}

  async list(): Promise<readonly Rule[]> {
    return [...this.store.rules.values()];
  }

  async get(id: string): Promise<Rule | undefined> {
    return this.store.rules.get(id);
  }

  async create(rule: Rule, action?: OwnerAction): Promise<void> {
    if (this.store.rules.has(rule.id)) throw new Error("fake rule admin: duplicate id");
    this.store.rules.set(rule.id, rule);
    if (action !== undefined) this.actions.push(action);
  }

  async update(rule: Rule, action: OwnerAction): Promise<boolean> {
    if (!this.store.rules.has(rule.id)) return false;
    this.store.rules.set(rule.id, rule);
    this.actions.push(action);
    return true;
  }

  async remove(id: string, action: OwnerAction): Promise<boolean> {
    if (!this.store.rules.delete(id)) return false;
    this.actions.push(action);
    return true;
  }
}

export class FakeChannelAdmin implements ChannelAdmin {
  readonly actions: OwnerAction[] = [];

  constructor(private readonly settings: FakeChannelSettings) {}

  async list(): Promise<readonly ChannelState[]> {
    return (["telegram", "line", "discord", "email"] as const).map((channel) => ({
      channel,
      enabled: this.settings.on.has(channel),
      deadSince: this.settings.dead.get(channel) ?? null,
    }));
  }

  async setEnabled(channel: ChannelName, enabled: boolean, action: OwnerAction): Promise<void> {
    if (enabled) this.settings.on.add(channel);
    else this.settings.on.delete(channel);
    this.actions.push(action);
  }
}

export class FakeSessionStore implements SessionStore {
  readonly sessions = new Map<string, { createdAt: Date; expiresAt: Date }>();
  readonly failures: Date[] = [];

  async create(idHash: string, createdAt: Date, expiresAt: Date): Promise<void> {
    this.sessions.set(idHash, { createdAt, expiresAt });
  }

  async isValid(idHash: string, now: Date): Promise<boolean> {
    const session = this.sessions.get(idHash);
    return session !== undefined && session.expiresAt > now;
  }

  async remove(idHash: string): Promise<void> {
    this.sessions.delete(idHash);
  }

  async recordFailedLogin(at: Date): Promise<void> {
    this.failures.push(at);
  }

  async failedLoginsSince(since: Date): Promise<readonly Date[]> {
    return this.failures.filter((t) => t >= since).sort((a, b) => a.getTime() - b.getTime());
  }
}

export class FakeAlertQuery implements AlertQuery {
  constructor(
    private readonly rules: FakeRuleStore,
    private readonly deliveries: FakeDeliveryLog,
  ) {}

  async decisions(from: Date, to: Date, limit: number): Promise<readonly DecisionWithAttempts[]> {
    return this.rules.decisions
      .filter((d) => d.decidedAt >= from && d.decidedAt < to)
      .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime())
      .slice(0, limit)
      .map((decision) => ({
        decision,
        attempts: this.deliveries.recorded
          .filter((a) => a.alertId === decision.id)
          .map((a) => ({ alertId: a.alertId, channel: a.channel, attempt: a.attempt, status: a.status, reason: a.reason, at: a.at })),
      }));
  }
}
