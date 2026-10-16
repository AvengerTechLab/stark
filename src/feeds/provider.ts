// What each exchange adapter tells the generic stream feed (src/feeds/stream-feed.ts): where to
// connect, how to read its messages, and its limits (ARCHITECTURE.md §2.1).

import type { Exchange, FeedTick } from "../ports/feed.js";
import { compareDecimal, isDecimal } from "../domain/decimal.js";

export type ParseResult =
  | { readonly kind: "ticks"; readonly ticks: readonly FeedTick[] }
  /** The provider is about to close the connection; reconnect now. */
  | { readonly kind: "shutdown" }
  /** A message that carries no price, such as a subscribe reply. */
  | { readonly kind: "ignored" }
  | { readonly kind: "invalid"; readonly reason: string };

export interface FeedProvider {
  readonly exchange: Exchange;
  readonly streamUrl: string;
  /** REST endpoint polled once a second while the stream is down. */
  readonly pollUrl: string;
  /** Renew the connection after this long, before the provider closes it; null if it never does. */
  readonly rotateAfterMs: number | null;
  /** How long to wait after a 429 that carries no Retry-After. */
  readonly defaultBlockMs: number;
  parseStream(text: string, receivedTime: Date): ParseResult;
  parsePoll(text: string, receivedTime: Date): ParseResult;
}

/** A price Stark accepts from a provider: a contract Decimal greater than 0 (SECURITY.md T-07). */
export function isPrice(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && isDecimal(value) && compareDecimal(value, "0") > 0;
}

export function invalid(reason: string): ParseResult {
  return { kind: "invalid", reason };
}
