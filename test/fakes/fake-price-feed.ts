// Fake price feed: tests push ticks by hand instead of connecting to Bitkub or Binance.

import type { Exchange, FeedTick, PriceFeed } from "../../src/ports/feed.js";

export class FakePriceFeed implements PriceFeed {
  private onTick: ((tick: FeedTick) => void) | undefined;
  running = false;

  constructor(readonly exchange: Exchange) {}

  async start(onTick: (tick: FeedTick) => void): Promise<void> {
    this.onTick = onTick;
    this.running = true;
  }

  async stop(): Promise<void> {
    this.onTick = undefined;
    this.running = false;
  }

  /** Delivers one tick, as the real stream would. Throws if the feed is not running. */
  emit(tick: Omit<FeedTick, "exchange">): void {
    if (!this.running || this.onTick === undefined) throw new Error("FakePriceFeed is not running");
    this.onTick({ ...tick, exchange: this.exchange });
  }
}
