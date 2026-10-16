// Decision pipeline (EVENTS.md §2.1–2.2, ARCHITECTURE.md §5): feed tick → one tick per pair per
// second → price log → reference lookup → rule engine → decision stored → dispatcher.
// Ticks are processed one at a time in the order they are released, so rule states change in
// tick order however long storage takes.

import type { Logger } from "../logger.js";
import type { FeedTick } from "../ports/feed.js";
import type { AlertDecision, ChannelSettings, PriceLog, PriceTick, RuleStore } from "../ports/storage.js";
import { formatAlertMessage } from "../domain/message.js";
import { evaluateRule, referenceCutoff, type Rule } from "../domain/rules.js";

/** A tick received later than this after its exchange time is stored but not evaluated (EVENTS.md §2.1). */
export const LATE_TICK_MS = 10_000;

export interface PipelineOptions {
  readonly priceLog: PriceLog;
  readonly rules: RuleStore;
  readonly channels: ChannelSettings;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly newId: () => string;
  /** Called once per decision, after it is stored. Not awaited: sends must not hold up the next tick. */
  readonly onDecision: (decision: AlertDecision) => void | Promise<void>;
}

interface Held {
  readonly second: number;
  readonly tick: FeedTick;
  readonly receivedTime: Date;
}

const secondOf = (time: Date): number => Math.floor(time.getTime() / 1000);

export class DecisionPipeline {
  onDecision: PipelineOptions["onDecision"];
  private readonly held = new Map<string, Held>();
  private readonly released = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: PipelineOptions) {
    this.onDecision = options.onDecision;
  }

  /** Takes a tick from a feed. Holds it until its second has ended; the last tick of a second wins. */
  receive(tick: FeedTick): void {
    const key = `${tick.exchange}|${tick.pair}`;
    const second = secondOf(tick.exchangeTime);
    const held = this.held.get(key);
    const newest = Math.max(this.released.get(key) ?? -Infinity, held?.second ?? -Infinity);
    if (second < newest || (second === newest && held === undefined)) {
      this.options.logger.warn("pipeline.tick_out_of_order", { exchange: tick.exchange, pair: tick.pair });
      return;
    }
    if (held !== undefined && second > held.second) this.release(key, held);
    this.held.set(key, { second, tick, receivedTime: this.options.now() });
  }

  /** Releases every held tick whose second has ended, then waits until all released ticks are processed. */
  flush(): Promise<void> {
    const now = this.options.now().getTime();
    for (const [key, held] of this.held) {
      if (now >= (held.second + 1) * 1000) this.release(key, held);
    }
    return this.idle();
  }

  /** Resolves when every released tick has been processed. */
  idle(): Promise<void> {
    return this.queue;
  }

  private release(key: string, held: Held): void {
    this.held.delete(key);
    this.released.set(key, held.second);
    const tick: PriceTick = { ...held.tick, id: this.options.newId(), receivedTime: held.receivedTime };
    this.queue = this.queue.then(() => this.process(tick));
  }

  private async process(tick: PriceTick): Promise<void> {
    const { logger } = this.options;
    const where = { exchange: tick.exchange, pair: tick.pair, tickId: tick.id };
    try {
      await this.options.priceLog.append(tick);
    } catch (error) {
      // Not stored means not evaluated: a replay (SC-2) must see the same ticks the engine saw.
      logger.error("pipeline.tick_failed", { ...where, step: "store_tick", error });
      return;
    }
    if (tick.receivedTime.getTime() - tick.exchangeTime.getTime() > LATE_TICK_MS) {
      logger.warn("pipeline.tick_late", where);
      return;
    }

    let rules: readonly Rule[];
    try {
      rules = await this.options.rules.rulesFor(tick.pair);
    } catch (error) {
      logger.error("pipeline.tick_failed", { ...where, step: "load_rules", error });
      return;
    }
    for (const rule of rules) {
      try {
        await this.evaluate(rule, tick);
      } catch (error) {
        // The rule's stored state is unchanged, so a condition still true fires on the next tick.
        logger.error("pipeline.tick_failed", { ...where, step: "evaluate", ruleId: rule.id, error });
      }
    }
  }

  private async evaluate(rule: Rule, tick: PriceTick): Promise<void> {
    const reference =
      rule.kind === "change" && rule.enabled
        ? await this.options.priceLog.priceAtOrBefore(
            tick.exchange,
            tick.pair,
            referenceCutoff(tick.exchangeTime, rule.windowMinutes),
          )
        : undefined;
    const result = evaluateRule(rule, tick, reference);
    if (result.decision === null && result.state === rule.state) return;

    let decision: AlertDecision | null = null;
    if (result.decision !== null) {
      const on = await this.options.channels.switchedOn();
      decision = {
        ...result.decision,
        id: this.options.newId(),
        decidedAt: this.options.now(),
        channels: rule.channels.filter((c) => on.has(c)),
        message: formatAlertMessage({
          rule,
          exchange: tick.exchange,
          price: tick.price,
          exchangeTime: tick.exchangeTime,
          referencePrice: result.decision.referencePrice,
          changePercent: result.decision.changePercent,
        }),
      };
    }
    await this.options.rules.saveResult(rule.id, result.state, decision);
    if (decision !== null) this.dispatch(decision);
  }

  private dispatch(decision: AlertDecision): void {
    const failed = (error: unknown) =>
      this.options.logger.error("pipeline.dispatch_failed", { alertId: decision.id, error });
    try {
      const pending = this.onDecision(decision);
      if (pending instanceof Promise) pending.catch(failed);
    } catch (error) {
      failed(error);
    }
  }
}
