import { describe, expect, it } from "vitest";
import { PairCatalog, parseBinanceExchangeInfo, parseBitkubSymbols } from "../../src/feeds/pairs.js";
import { PriceBoard } from "../../src/app/price-board.js";
import { verifyPassword } from "../../src/interface/password.js";
import { createLogger } from "../../src/logger.js";
import { BINANCE_EXCHANGE_INFO, BITKUB_SYMBOLS } from "../feeds/fixtures.js";
import { FakeHttp } from "../fakes/fake-network.js";

// A made-up test password and its Argon2id hash (made with hash-wasm); not a real credential.
const PASSWORD = "demo-password";
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$jEXthTpqW6vxp4kg3B7YPo8aY3N5KSs0V54IVOSCfYk";

describe("verifyPassword (API.md §1.1)", () => {
  it("accepts the right password and refuses a wrong one", async () => {
    expect(await verifyPassword(HASH, PASSWORD)).toBe(true);
    expect(await verifyPassword(HASH, "Demo-password")).toBe(false);
    expect(await verifyPassword(HASH, "")).toBe(false);
  });

  it("refuses everything for a hash that is malformed or not Argon2id", async () => {
    expect(await verifyPassword("$argon2id$broken", PASSWORD)).toBe(false);
    // A real Argon2i hash of the same password: it verifies with hash-wasm, but Stark accepts Argon2id only.
    expect(await verifyPassword("$argon2i$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$kxqMVEQS7TbZZLAfLaOsfpJdUXS/qGfUWtoGMDdk82A", PASSWORD)).toBe(false);
  });
});

describe("pair lists (API.md §1.2 GET /pairs, §1.3 PAIR_UNKNOWN)", () => {
  it("reads Bitkub's active THB symbols", () => {
    expect(parseBitkubSymbols(BITKUB_SYMBOLS)).toEqual(["BTC/THB"]);
    const demo = `{"error":0,"result":[{"symbol":"ETH_THB","base_asset":"ETH","quote_asset":"THB","status":"active"},
      {"symbol":"OLD_THB","base_asset":"OLD","quote_asset":"THB","status":"inactive"},
      {"symbol":"BAD<>_THB","base_asset":"BAD<>","quote_asset":"THB","status":"active"}]}`;
    expect(parseBitkubSymbols(demo)).toEqual(["ETH/THB"]);
    expect(parseBitkubSymbols(`{"error":1}`)).toBeUndefined();
  });

  it("reads Binance's trading USDT symbols", () => {
    expect(parseBinanceExchangeInfo(BINANCE_EXCHANGE_INFO)).toEqual(["ETH/USDT"]);
    const demo = `{"symbols":[{"symbol":"ETHBTC","status":"TRADING","baseAsset":"ETH","quoteAsset":"BTC"},
      {"symbol":"XUSDT","status":"BREAK","baseAsset":"X","quoteAsset":"USDT"}]}`;
    expect(parseBinanceExchangeInfo(demo)).toEqual([]);
    expect(parseBinanceExchangeInfo("nope")).toBeUndefined();
  });

  it("loads both lists, answers isListed, and keeps the last good list when a refresh fails", async () => {
    const http = new FakeHttp({ status: 500, retryAfter: null, body: "" });
    http.willReturn({ status: 200, retryAfter: null, body: BITKUB_SYMBOLS }, { status: 200, retryAfter: null, body: BINANCE_EXCHANGE_INFO });
    const lines: string[] = [];
    const catalog = new PairCatalog(http.get, createLogger({ level: "debug", write: (l) => lines.push(l) }));
    await catalog.refresh();
    expect(http.requests).toEqual([
      "https://api.bitkub.com/api/v3/market/symbols",
      "https://data-api.binance.vision/api/v3/exchangeInfo?permissions=SPOT&symbolStatus=TRADING&showPermissionSets=false",
    ]);
    expect(catalog.isListed("BTC/THB")).toBe(true);
    expect(catalog.isListed("ETH/USDT")).toBe(true);
    expect(catalog.isListed("ETH/THB")).toBe(false);
    expect(catalog.list("THB")).toEqual(["BTC/THB"]);
    await catalog.refresh();
    expect(catalog.isListed("BTC/THB")).toBe(true);
    expect(lines.filter((l) => l.includes("pairs.refresh_failed"))).toHaveLength(2);
  });
});

describe("PriceBoard", () => {
  it("keeps the latest price per pair with its age", () => {
    const board = new PriceBoard();
    const t = (ms: number) => new Date(Date.parse("2026-10-16T07:00:00.000Z") + ms);
    board.update({ exchange: "bitkub", pair: "BTC/THB", price: "100", exchangeTime: t(0), source: "stream" }, t(0));
    board.update({ exchange: "bitkub", pair: "BTC/THB", price: "101", exchangeTime: t(1000), source: "stream" }, t(1000));
    board.update({ exchange: "binance", pair: "BTC/USDT", price: "5", exchangeTime: t(500), source: "poll" }, t(600));
    expect(board.list(t(3000))).toEqual([
      { exchange: "binance", pair: "BTC/USDT", price: "5", exchangeTime: t(500), receivedTime: t(600), ageSeconds: 2 },
      { exchange: "bitkub", pair: "BTC/THB", price: "101", exchangeTime: t(1000), receivedTime: t(1000), ageSeconds: 2 },
    ]);
  });
});
