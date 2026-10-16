// Binance adapter (USDT, SPEC.md D-08), on the market-data-only hosts (ARCHITECTURE.md §2.1).
// Stream: <symbol>@trade, whose price is the last traded price (D-30) at its trade time `T`;
// fallback: REST ticker/price, which carries no time, so a polled tick is timed on arrival.
// Sources: binance-spot-api-docs web-socket-streams.md and rest-api.md (f0ee79c).

import type { FeedTick } from "../ports/feed.js";
import { isRecord, parseExactJson } from "./exact-json.js";
import { invalid, isPrice, type FeedProvider, type ParseResult } from "./provider.js";

const PAIR = /^([A-Z0-9]+)\/USDT$/;
/** Binance closes a connection at 24 h; renew it an hour before (web-socket-streams.md). */
const ROTATE_MS = 23 * 3_600_000;
/** Binance always sends Retry-After with 429 and 418; this is only a fallback. */
const BLOCK_MS = 60_000;

export function binanceProvider(pairs: readonly string[]): FeedProvider {
  const bySymbol = new Map<string, string>();
  for (const pair of pairs) {
    const base = PAIR.exec(pair)?.[1];
    if (base === undefined) throw new Error("Binance serves USDT pairs only in Stark");
    bySymbol.set(`${base}USDT`, pair);
  }
  const symbols = [...bySymbol.keys()];

  return {
    exchange: "binance",
    streamUrl: `wss://data-stream.binance.vision/stream?streams=${symbols.map((s) => `${s.toLowerCase()}@trade`).join("/")}`,
    pollUrl: `https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
    rotateAfterMs: ROTATE_MS,
    defaultBlockMs: BLOCK_MS,

    parseStream(text: string): ParseResult {
      const message = parseExactJson(text);
      if (!isRecord(message)) return invalid("not a JSON object");
      if ("result" in message && "id" in message) return { kind: "ignored" };
      const data = message["data"];
      if (!isRecord(data)) return invalid("no data");
      if (data["e"] === "serverShutdown") return { kind: "shutdown" };
      if (data["e"] !== "trade") return { kind: "ignored" };
      const pair = bySymbol.get(String(data["s"]));
      if (pair === undefined) return invalid("unexpected symbol");
      if (!isPrice(data["p"])) return invalid("price is not a positive decimal");
      const time = data["T"];
      if (typeof time !== "string" || !/^[1-9][0-9]{0,15}$/.test(time)) return invalid("no trade time");
      const tick: FeedTick = { exchange: "binance", pair, price: data["p"], exchangeTime: new Date(Number(time)), source: "stream" };
      return { kind: "ticks", ticks: [tick] };
    },

    parsePoll(text: string, receivedTime: Date): ParseResult {
      const list = parseExactJson(text);
      if (!Array.isArray(list)) return invalid("not a JSON array");
      const ticks: FeedTick[] = [];
      for (const entry of list) {
        if (!isRecord(entry)) continue;
        const pair = bySymbol.get(String(entry["symbol"]));
        if (pair !== undefined && isPrice(entry["price"])) {
          ticks.push({ exchange: "binance", pair, price: entry["price"], exchangeTime: receivedTime, source: "poll" });
        }
      }
      return { kind: "ticks", ticks };
    },
  };
}
