// What the decision pipeline needs from storage (ARCHITECTURE.md §4–5, DATABASE.md). PostgreSQL
// implements these in S6-6; tests use the in-memory fakes in test/fakes/.

import type { ChannelName } from "./channel.js";
import type { Exchange, FeedTick } from "./feed.js";
import type { Rule, RuleDecision, RuleState } from "../domain/rules.js";

/** A kept tick as stored in the price log (EVENTS.md §2.1). */
export interface PriceTick extends FeedTick {
  readonly id: string;
  readonly receivedTime: Date;
}

/** A decision as stored before any send (EVENTS.md §2.2). */
export interface AlertDecision extends RuleDecision {
  readonly id: string;
  readonly decidedAt: Date;
  /** The rule's channels that were switched on system-wide at decidedAt (D-09). */
  readonly channels: readonly ChannelName[];
  /** The alert text (EVENTS.md §4), fixed when the decision is made so every send and resend is the same. */
  readonly message: string;
}

export interface PriceLog {
  append(tick: PriceTick): Promise<void>;
  /** Price of the last stored tick for this exchange and pair at or before `time` (EVENTS.md §3.3 step 1). */
  priceAtOrBefore(exchange: Exchange, pair: string, time: Date): Promise<string | undefined>;
}

export interface RuleStore {
  /** Every rule on this pair, enabled or not. */
  rulesFor(pair: string): Promise<readonly Rule[]>;
  /**
   * Saves a rule's new state and, when it fired, its decision, in one transaction: a restart can
   * neither lose a decision nor repeat one (ARCHITECTURE.md §7).
   */
  saveResult(ruleId: string, state: RuleState, decision: AlertDecision | null): Promise<void>;
}

export interface ChannelSettings {
  /** Channels switched on system-wide right now (D-09). */
  switchedOn(): Promise<ReadonlySet<ChannelName>>;
  /** True once a channel has answered that it will never accept sends again, e.g. a Discord 404. */
  isDead(channel: ChannelName): Promise<boolean>;
  markDead(channel: ChannelName, at: Date): Promise<void>;
}

/** One send attempt, or one skip, of one alert on one channel (EVENTS.md §2.3). */
export interface DeliveryAttempt {
  readonly alertId: string;
  readonly channel: ChannelName;
  /** From 1; (alertId, channel, attempt) is unique. */
  readonly attempt: number;
  readonly status: "delivered" | "failed" | "skipped";
  readonly reason: string | null;
  readonly at: Date;
}

export interface DeliveryLog {
  /** Attempts already recorded for this alert on this channel, oldest first. */
  attempts(alertId: string, channel: ChannelName): Promise<readonly DeliveryAttempt[]>;
  /** Time of this rule's last delivered attempt on this channel, for the cooldown (D-42). */
  lastDelivered(ruleId: string, channel: ChannelName): Promise<Date | undefined>;
  /** Sends counted for a channel in a usage period (DATABASE.md `channel_usage`). */
  usage(channel: ChannelName, period: string): Promise<number>;
  /**
   * Records an attempt for a decision of `ruleId`. A delivered attempt with a usage period also
   * adds one to that period's count, in the same transaction.
   */
  record(attempt: DeliveryAttempt, ruleId: string, usagePeriod: string | null): Promise<void>;
}

export type HealthKind =
  | "feed_stale"
  | "feed_recovered"
  | "channel_failing"
  | "channel_recovered"
  | "quota_reached"
  | "disk_low"
  | "disk_recovered";

/** A health event the PO has been told about (EVENTS.md §2.4, DATABASE.md `health_events`). */
export interface HealthRecord {
  readonly id: string;
  readonly kind: HealthKind;
  /** Exchange, channel or "disk". */
  readonly subject: string;
  /** When the condition started. */
  readonly since: Date;
  readonly reportedAt: Date;
}

export interface HealthLog {
  record(event: HealthRecord): Promise<void>;
}
