// Alert dispatcher (EVENTS.md §2.3, ARCHITECTURE.md §4, §7): sends each stored decision to its
// channels and records every attempt. Channels run in parallel, so a slow one never delays the
// others; within a channel, sends run one at a time, so the cooldown and the usage counters are
// checked against everything sent before.

import type { Logger } from "../logger.js";
import type { AlertChannel, ChannelName, SendResult } from "../ports/channel.js";
import type { AlertDecision, ChannelSettings, DeliveryAttempt, DeliveryLog } from "../ports/storage.js";
import { thaiDate } from "../domain/thai-time.js";

export const MAX_ATTEMPTS = 3;
/** Wait before attempt 2 and attempt 3 (EVENTS.md §2.3). */
export const RETRY_WAITS_MS: readonly number[] = [1000, 2000];
/** Each rule sends at most once per channel in this time (D-42). */
export const COOLDOWN_MS = 5 * 60_000;

export interface Quota {
  readonly per: "day" | "month";
  readonly limit: number;
}

/**
 * Sends Stark may make per period before it stops a channel (D-17). LINE: Thailand's free tier of 300
 * messages a month. Gmail: 400 a day, leaving 100 of Gmail's 500 for the PO's own mail. Both are
 * counted on the Thai calendar (UTC+7). The Gmail figure and the time zone are PO to confirm (Q-32).
 */
export const DEFAULT_QUOTAS: Readonly<Partial<Record<ChannelName, Quota>>> = {
  line: { per: "month", limit: 300 },
  email: { per: "day", limit: 400 },
};

/** The usage period containing `at` on the Thai calendar: "YYYY-MM-DD", the first day for a month. */
export function usagePeriod(per: Quota["per"], at: Date): string {
  const day = thaiDate(at);
  return per === "month" ? `${day.slice(0, 7)}-01` : day;
}

export interface DispatcherOptions {
  readonly channels: readonly AlertChannel[];
  readonly settings: ChannelSettings;
  readonly deliveries: DeliveryLog;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly quotas?: Readonly<Partial<Record<ChannelName, Quota>>>;
}

type Skip = "channel_off" | "channel_dead" | "cooldown" | "quota_reached";

export class Dispatcher {
  private readonly adapters = new Map<ChannelName, AlertChannel>();
  private readonly queues = new Map<ChannelName, Promise<void>>();
  private readonly quotas: Readonly<Partial<Record<ChannelName, Quota>>>;

  constructor(private readonly options: DispatcherOptions) {
    for (const channel of options.channels) this.adapters.set(channel.name, channel);
    this.quotas = options.quotas ?? DEFAULT_QUOTAS;
  }

  /** Sends one decision to each of its channels; resolves when every channel has finished with it. */
  async dispatch(decision: AlertDecision): Promise<void> {
    await Promise.all(decision.channels.map((channel) => this.enqueue(channel, () => this.deliver(decision, channel))));
  }

  private enqueue(channel: ChannelName, work: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(channel) ?? Promise.resolve()).then(work);
    this.queues.set(channel, next);
    return next;
  }

  private async deliver(decision: AlertDecision, channel: ChannelName): Promise<void> {
    const where = { alertId: decision.id, ruleId: decision.ruleId, channel };
    try {
      const done = await this.options.deliveries.attempts(decision.id, channel);
      // Idempotency by alert ID: a channel finished with this alert is never sent it again.
      if (done.some((a) => a.status !== "failed") || done.length >= MAX_ATTEMPTS) return;

      const skip = await this.skipReason(decision, channel);
      if (skip !== null) {
        await this.record(decision, channel, done.length + 1, "skipped", skip, null);
        if (skip === "quota_reached") this.options.logger.warn("dispatch.quota_reached", where);
        return;
      }
      await this.send(decision, channel, done.length + 1);
    } catch (error) {
      this.options.logger.error("dispatch.failed", { ...where, error });
    }
  }

  private async skipReason(decision: AlertDecision, channel: ChannelName): Promise<Skip | null> {
    const { settings, deliveries, now } = this.options;
    if (!this.adapters.has(channel) || !(await settings.switchedOn()).has(channel)) return "channel_off";
    if (await settings.isDead(channel)) return "channel_dead";
    const last = await deliveries.lastDelivered(decision.ruleId, channel);
    if (last !== undefined && now().getTime() - last.getTime() < COOLDOWN_MS) return "cooldown";
    const quota = this.quotas[channel];
    if (quota !== undefined && (await deliveries.usage(channel, usagePeriod(quota.per, now()))) >= quota.limit) {
      return "quota_reached";
    }
    return null;
  }

  private async send(decision: AlertDecision, channel: ChannelName, first: number): Promise<void> {
    const { logger, now, settings } = this.options;
    const adapter = this.adapters.get(channel);
    if (adapter === undefined) return;
    const alert = { alertId: decision.id, text: decision.message };
    const where = { alertId: decision.id, ruleId: decision.ruleId, channel };

    for (let attempt = first; attempt <= MAX_ATTEMPTS; attempt++) {
      let result: SendResult;
      try {
        result = await adapter.send(alert);
      } catch (error) {
        logger.warn("dispatch.send_error", { ...where, attempt, error });
        result = { status: "failed", reason: "send_error" };
      }

      if (result.status === "delivered") {
        const quota = this.quotas[channel];
        await this.record(decision, channel, attempt, "delivered", null, quota && usagePeriod(quota.per, now()));
        return;
      }
      await this.record(decision, channel, attempt, "failed", result.reason, null);
      if (result.status === "dead") {
        await settings.markDead(channel, now());
        logger.error("dispatch.channel_dead", { ...where, reason: result.reason });
        return;
      }
      if (attempt === MAX_ATTEMPTS) {
        logger.error("dispatch.channel_failed", { ...where, reason: result.reason });
        return;
      }
      // Never retry earlier than the channel asks (ARCHITECTURE.md §2.1–2.2).
      const wait = RETRY_WAITS_MS[attempt - 1] ?? 0;
      const asked = result.retryAfterSeconds === undefined ? 0 : result.retryAfterSeconds * 1000;
      await this.options.sleep(Math.max(wait, asked));
    }
  }

  private record(
    decision: AlertDecision,
    channel: ChannelName,
    attempt: number,
    status: DeliveryAttempt["status"],
    reason: string | null,
    usage: string | null | undefined,
  ): Promise<void> {
    const entry: DeliveryAttempt = { alertId: decision.id, channel, attempt, status, reason, at: this.options.now() };
    return this.options.deliveries.record(entry, decision.ruleId, usage ?? null);
  }
}
