// The interface every price feed implements (EVENTS.md §2.1, ARCHITECTURE.md §4).

export type Exchange = "bitkub" | "binance";

export interface FeedTick {
  readonly exchange: Exchange;
  /** Normalised pair, e.g. "BTC/THB"; provider symbols never leave the adapter. */
  readonly pair: string;
  /** Decimal string, never a binary float (EVENTS.md §1). */
  readonly price: string;
  readonly exchangeTime: Date;
  readonly source: "stream" | "poll";
}

export interface PriceFeed {
  readonly exchange: Exchange;
  start(onTick: (tick: FeedTick) => void): Promise<void>;
  stop(): Promise<void>;
}
