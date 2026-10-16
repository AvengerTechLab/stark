// Rule evaluation (EVENTS.md §3). Pure and deterministic: no I/O, no clock, no randomness
// (CLAUDE.md §4). The caller supplies the reference price for percentage rules and assigns the
// decision's ID and time.

import type { ChannelName } from "../ports/channel.js";
import { changePercentAtLeast, changePercentAtMost, changePercentDisplay, compareDecimal } from "./decimal.js";

export type RuleState = "armed" | "fired";

interface RuleBase {
  readonly id: string;
  /** Normalised pair, e.g. "BTC/THB"; its quote decides the exchange (D-08). */
  readonly pair: string;
  readonly channels: readonly ChannelName[];
  readonly enabled: boolean;
  readonly state: RuleState;
}

export interface LevelRule extends RuleBase {
  readonly kind: "above" | "below";
  readonly level: string;
}

export interface ChangeRule extends RuleBase {
  readonly kind: "change";
  readonly percent: string;
  readonly windowMinutes: number;
  readonly direction: "up" | "down" | "either";
}

export type Rule = LevelRule | ChangeRule;

export interface RuleTick {
  readonly id: string;
  readonly pair: string;
  readonly price: string;
  readonly exchangeTime: Date;
}

/** The part of an AlertDecision the engine decides (EVENTS.md §2.2); the caller adds id, time and channels. */
export interface RuleDecision {
  readonly ruleId: string;
  readonly tickId: string;
  readonly price: string;
  readonly referencePrice: string | null;
  readonly changePercent: string | null;
}

export interface RuleResult {
  readonly state: RuleState;
  readonly decision: RuleDecision | null;
}

/** The latest exchange time a reference tick may have for a percentage rule (EVENTS.md §3.3 step 1). */
export function referenceCutoff(exchangeTime: Date, windowMinutes: number): Date {
  return new Date(exchangeTime.getTime() - windowMinutes * 60_000);
}

function conditionHolds(rule: Rule, price: string, reference: string | undefined): boolean {
  switch (rule.kind) {
    case "above":
      return compareDecimal(price, rule.level) >= 0;
    case "below":
      return compareDecimal(price, rule.level) <= 0;
    case "change": {
      // No reference, or a zero one, means no valid change to measure (EVENTS.md §3.3 step 2).
      if (reference === undefined || compareDecimal(reference, "0") === 0) return false;
      const up = changePercentAtLeast(price, reference, rule.percent);
      const down = changePercentAtMost(price, reference, `-${rule.percent}`);
      return rule.direction === "up" ? up : rule.direction === "down" ? down : up || down;
    }
  }
}

/**
 * Applies one tick to one rule: fire once when the condition becomes true, re-arm when it becomes
 * false again (EVENTS.md §3.4, D-20). A new rule is armed, so one already true fires at once (D-32).
 */
export function evaluateRule(rule: Rule, tick: RuleTick, reference: string | undefined): RuleResult {
  if (tick.pair !== rule.pair) throw new Error(`tick pair ${tick.pair} does not match rule pair ${rule.pair}`);
  if (!rule.enabled) return { state: rule.state, decision: null };

  const holds = conditionHolds(rule, tick.price, reference);

  if (rule.state === "armed" && holds) {
    const isChange = rule.kind === "change" && reference !== undefined;
    return {
      state: "fired",
      decision: {
        ruleId: rule.id,
        tickId: tick.id,
        price: tick.price,
        referencePrice: isChange ? reference : null,
        changePercent: isChange ? changePercentDisplay(tick.price, reference) : null,
      },
    };
  }
  if (rule.state === "fired" && !holds) return { state: "armed", decision: null };
  return { state: rule.state, decision: null };
}
