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
}
