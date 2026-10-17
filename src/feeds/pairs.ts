// The pairs each provider lists, for choosing a rule's pair (API.md §1.2 GET /pairs) and for the
// PAIR_UNKNOWN check (§1.3). Sources: Bitkub GET /api/v3/market/symbols (rest-v3.md, d65eafa); Binance
// GET /api/v3/exchangeInfo on the market-data-only host (rest-api.md, f0ee79c; weight 20).

import type { Logger } from "../logger.js";
import type { HttpGet } from "./stream-feed.js";
import { isRecord } from "./exact-json.js";

export const BITKUB_SYMBOLS_URL = "https://api.bitkub.com/api/v3/market/symbols";
export const BINANCE_EXCHANGE_INFO_URL =
  "https://data-api.binance.vision/api/v3/exchangeInfo?permissions=SPOT&symbolStatus=TRADING&showPermissionSets=false";

const ASSET = /^[A-Z0-9]+$/;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Bitkub's active THB pairs as "BASE/THB"; undefined if the reply is not the documented shape. */
export function parseBitkubSymbols(text: string): string[] | undefined {
  const reply = parseJson(text);
  if (!isRecord(reply) || reply["error"] !== 0 || !Array.isArray(reply["result"])) return undefined;
  return reply["result"]
    .filter(isRecord)
    .filter((s) => s["quote_asset"] === "THB" && s["status"] === "active" && ASSET.test(String(s["base_asset"])))
    .map((s) => `${String(s["base_asset"])}/THB`)
    .sort();
}

/** Binance's trading USDT pairs as "BASE/USDT"; undefined if the reply is not the documented shape. */
export function parseBinanceExchangeInfo(text: string): string[] | undefined {
  const reply = parseJson(text);
  if (!isRecord(reply) || !Array.isArray(reply["symbols"])) return undefined;
  return reply["symbols"]
    .filter(isRecord)
    .filter((s) => s["quoteAsset"] === "USDT" && s["status"] === "TRADING" && ASSET.test(String(s["baseAsset"])))
    .map((s) => `${String(s["baseAsset"])}/USDT`)
    .sort();
}

export class PairCatalog {
  private bitkub: readonly string[] = [];
  private binance: readonly string[] = [];

  constructor(
    private readonly get: HttpGet,
    private readonly logger: Logger,
  ) {}

  /** Reloads both lists; a provider that fails keeps its last good list. */
  async refresh(): Promise<void> {
    this.bitkub = (await this.load("bitkub", BITKUB_SYMBOLS_URL, parseBitkubSymbols)) ?? this.bitkub;
    this.binance = (await this.load("binance", BINANCE_EXCHANGE_INFO_URL, parseBinanceExchangeInfo)) ?? this.binance;
  }

  isListed = (pair: string): boolean => this.bitkub.includes(pair) || this.binance.includes(pair);

  list(quote: "THB" | "USDT"): readonly string[] {
    return quote === "THB" ? this.bitkub : this.binance;
  }

  private async load(exchange: string, url: string, parse: (text: string) => string[] | undefined) {
    try {
      const response = await this.get(url);
      const pairs = response.status === 200 ? parse(response.body) : undefined;
      if (pairs !== undefined) return pairs;
      this.logger.warn("pairs.refresh_failed", { exchange, status: response.status });
    } catch (error) {
      this.logger.warn("pairs.refresh_failed", { exchange, error });
    }
    return undefined;
  }
}
