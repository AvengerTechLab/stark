// The latest price per watched pair, for GET /api/v1/prices and the /prices command (API.md).
// Kept in memory from the feeds; it is a view for the PO, not a record (the price log is the record).

import type { Exchange, FeedTick } from "../ports/feed.js";

export interface BoardEntry {
  readonly exchange: Exchange;
  readonly pair: string;
  readonly price: string;
  readonly exchangeTime: Date;
  readonly receivedTime: Date;
  readonly ageSeconds: number;
}

export class PriceBoard {
  private readonly latest = new Map<string, Omit<BoardEntry, "ageSeconds">>();

  update(tick: FeedTick, receivedTime: Date): void {
    this.latest.set(`${tick.exchange}|${tick.pair}`, {
      exchange: tick.exchange,
      pair: tick.pair,
      price: tick.price,
      exchangeTime: tick.exchangeTime,
      receivedTime,
    });
  }

  /** Every pair's latest price, sorted by exchange then pair, with seconds since it arrived. */
  list(now: Date): BoardEntry[] {
    return [...this.latest.values()]
      .sort((a, b) => a.exchange.localeCompare(b.exchange) || a.pair.localeCompare(b.pair))
      .map((e) => ({ ...e, ageSeconds: Math.floor((now.getTime() - e.receivedTime.getTime()) / 1000) }));
  }
}
