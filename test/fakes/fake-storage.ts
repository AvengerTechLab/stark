// In-memory stand-ins for the PostgreSQL stores (CLAUDE.md §5). Each keeps its data in plain
// arrays so tests can inspect it, and can be told to fail its next call.

import type { ChannelName } from "../../src/ports/channel.js";
import type { Exchange } from "../../src/ports/feed.js";
import type { AlertDecision, ChannelSettings, PriceLog, PriceTick, RuleStore } from "../../src/ports/storage.js";
import type { Rule, RuleState } from "../../src/domain/rules.js";

export class FakePriceLog implements PriceLog {
  readonly ticks: PriceTick[] = [];
  failNextAppend = false;

  async append(tick: PriceTick): Promise<void> {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error("fake price log: append failed");
    }
    this.ticks.push(tick);
  }

  async priceAtOrBefore(exchange: Exchange, pair: string, time: Date): Promise<string | undefined> {
    let best: PriceTick | undefined;
    for (const t of this.ticks) {
      if (t.exchange !== exchange || t.pair !== pair || t.exchangeTime > time) continue;
      if (best === undefined || t.exchangeTime >= best.exchangeTime) best = t;
    }
    return best?.price;
  }

  /** Seeds a stored tick directly, e.g. the reference price an hour earlier. */
  seed(tick: PriceTick): void {
    this.ticks.push(tick);
  }
}

export class FakeRuleStore implements RuleStore {
  readonly rules = new Map<string, Rule>();
  readonly decisions: AlertDecision[] = [];
  failNextSave = false;

  constructor(...rules: Rule[]) {
    for (const rule of rules) this.rules.set(rule.id, rule);
  }

  async rulesFor(pair: string): Promise<readonly Rule[]> {
    return [...this.rules.values()].filter((r) => r.pair === pair);
  }

  async saveResult(ruleId: string, state: RuleState, decision: AlertDecision | null): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("fake rule store: save failed");
    }
    const rule = this.rules.get(ruleId);
    if (rule === undefined) throw new Error("fake rule store: unknown rule");
    this.rules.set(ruleId, { ...rule, state });
    if (decision !== null) this.decisions.push(decision);
  }
}

export class FakeChannelSettings implements ChannelSettings {
  readonly on: Set<ChannelName>;

  constructor(...on: ChannelName[]) {
    this.on = new Set(on);
  }

  async switchedOn(): Promise<ReadonlySet<ChannelName>> {
    return new Set(this.on);
  }
}
