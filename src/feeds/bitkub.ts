// Bitkub adapter (THB, SPEC.md D-08). Stream: the public ticker stream; fallback: the REST ticker.
// Neither carries a time for the price, so a Bitkub tick's exchange time is the time it arrived
// (EVENTS.md §2.1). Sources: bitkub-official-api-docs websocket-public.md and rest-v3.md (d65eafa).

import type { FeedTick } from "../ports/feed.js";
import { isRecord, parseExactJson } from "./exact-json.js";
import { invalid, isPrice, type FeedProvider, type ParseResult } from "./provider.js";

const PAIR = /^([A-Z0-9]+)\/THB$/;
/** Bitkub blocks for 30 s after a 429 (rest-v3.md, Rate Limits). */
const BLOCK_MS = 30_000;

export function bitkubProvider(pairs: readonly string[]): FeedProvider {
  const byStream = new Map<string, string>();
  const bySymbol = new Map<string, string>();
  for (const pair of pairs) {
    const base = PAIR.exec(pair)?.[1];
    if (base === undefined) throw new Error("Bitkub serves THB pairs only");
    byStream.set(`market.ticker.thb_${base.toLowerCase()}`, pair);
    bySymbol.set(`${base}_THB`, pair);
  }
  const tick = (pair: string, price: string, at: Date, source: FeedTick["source"]): FeedTick => ({
    exchange: "bitkub",
    pair,
    price,
    exchangeTime: at,
    source,
  });

  return {
    exchange: "bitkub",
    streamUrl: `wss://api.bitkub.com/websocket-api/${[...byStream.keys()].join(",")}`,
    pollUrl: "https://api.bitkub.com/api/v3/market/ticker",
    rotateAfterMs: null,
    defaultBlockMs: BLOCK_MS,

    parseStream(text: string, receivedTime: Date): ParseResult {
      const message = parseExactJson(text);
      if (!isRecord(message)) return invalid("not a JSON object");
      const pair = byStream.get(String(message["stream"]).toLowerCase());
      if (pair === undefined) return invalid("unexpected stream");
      if (!isPrice(message["last"])) return invalid("price is not a positive decimal");
      return { kind: "ticks", ticks: [tick(pair, message["last"], receivedTime, "stream")] };
    },

    parsePoll(text: string, receivedTime: Date): ParseResult {
      const list = parseExactJson(text);
      if (!Array.isArray(list)) return invalid("not a JSON array");
      const ticks: FeedTick[] = [];
      for (const entry of list) {
        if (!isRecord(entry)) continue;
        const pair = bySymbol.get(String(entry["symbol"]));
        if (pair !== undefined && isPrice(entry["last"])) ticks.push(tick(pair, entry["last"], receivedTime, "poll"));
      }
      return { kind: "ticks", ticks };
    },
  };
}
