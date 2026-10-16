import { describe, expect, it } from "vitest";
import { binanceProvider } from "../../src/feeds/binance.js";
import { bitkubProvider } from "../../src/feeds/bitkub.js";
import { parseExactJson } from "../../src/feeds/exact-json.js";
import {
  BINANCE_REST_PRICES,
  BINANCE_SHUTDOWN,
  BINANCE_TRADE,
  BITKUB_REST_TICKER,
  BITKUB_TICKER,
  BITKUB_TICKER_LONG_PRICE,
} from "./fixtures.js";

const received = new Date("2026-10-16T07:00:00.000Z");

describe("parseExactJson", () => {
  it("keeps every number as the exact text the provider sent", () => {
    expect(parseExactJson(`{"a":1.50,"b":[2883194.85,7],"c":"x"}`)).toEqual({ a: "1.50", b: ["2883194.85", "7"], c: "x" });
  });

  it("returns undefined for text that is not JSON", () => {
    expect(parseExactJson("not json")).toBeUndefined();
  });
});

describe("Bitkub (ARCHITECTURE.md §2.1)", () => {
  const bitkub = bitkubProvider(["BTC/THB", "SHIB/THB"]);

  it("builds the public ticker stream URL and the REST ticker URL", () => {
    expect(bitkub.streamUrl).toBe("wss://api.bitkub.com/websocket-api/market.ticker.thb_btc,market.ticker.thb_shib");
    expect(bitkub.pollUrl).toBe("https://api.bitkub.com/api/v3/market/ticker");
  });

  it("reads the documented ticker message as the last price, timed on arrival because Bitkub sends no time", () => {
    expect(bitkub.parseStream(BITKUB_TICKER, received)).toEqual({
      kind: "ticks",
      ticks: [{ exchange: "bitkub", pair: "BTC/THB", price: "2883194.85", exchangeTime: received, source: "stream" }],
    });
  });

  it("keeps a long price digit for digit, though the JSON carries it as a number", () => {
    const result = bitkub.parseStream(BITKUB_TICKER_LONG_PRICE, received);
    expect(result.kind === "ticks" && result.ticks[0]?.price).toBe("0.000012345678901234567");
  });

  it("refuses a price in exponent form, a zero or negative price, and a pair Stark did not ask for", () => {
    for (const text of [
      `{"stream":"market.ticker.thb_btc","last":1e6}`,
      `{"stream":"market.ticker.thb_btc","last":0}`,
      `{"stream":"market.ticker.thb_btc","last":-5}`,
      `{"stream":"market.ticker.thb_btc"}`,
      `{"stream":"market.ticker.thb_eth","last":1}`,
      "<html>",
    ]) {
      expect(bitkub.parseStream(text, received).kind).toBe("invalid");
    }
  });

  it("reads the documented REST ticker, keeping only the pairs asked for", () => {
    expect(bitkub.parsePoll(BITKUB_REST_TICKER, received)).toEqual({
      kind: "ticks",
      ticks: [{ exchange: "bitkub", pair: "BTC/THB", price: "3385000", exchangeTime: received, source: "poll" }],
    });
  });

  it("only accepts THB pairs", () => {
    expect(() => bitkubProvider(["BTC/USDT"])).toThrow();
  });
});

describe("Binance (ARCHITECTURE.md §2.1)", () => {
  const binance = binanceProvider(["BTC/USDT", "ETH/USDT"]);

  it("builds the market-data-only stream and REST URLs", () => {
    expect(binance.streamUrl).toBe("wss://data-stream.binance.vision/stream?streams=btcusdt@trade/ethusdt@trade");
    expect(binance.pollUrl).toBe(
      "https://data-api.binance.vision/api/v3/ticker/price?symbols=%5B%22BTCUSDT%22%2C%22ETHUSDT%22%5D",
    );
  });

  it("reads a trade as its price at its trade time", () => {
    expect(binance.parseStream(BINANCE_TRADE, received)).toEqual({
      kind: "ticks",
      ticks: [
        {
          exchange: "binance",
          pair: "BTC/USDT",
          price: "0.001",
          exchangeTime: new Date(1672515782136),
          source: "stream",
        },
      ],
    });
  });

  it("recognises the server shutdown notice", () => {
    expect(binance.parseStream(BINANCE_SHUTDOWN, received)).toEqual({ kind: "shutdown" });
  });

  it("ignores the reply to a subscribe request", () => {
    expect(binance.parseStream(`{"result":null,"id":1}`, received)).toEqual({ kind: "ignored" });
  });

  it("refuses a malformed price, a missing trade time and a symbol Stark did not ask for", () => {
    const trade = (data: string) => `{"stream":"btcusdt@trade","data":{"e":"trade","s":"BTCUSDT",${data}}}`;
    for (const text of [
      trade(`"p":"1e3","T":1672515782136`),
      trade(`"p":"0","T":1672515782136`),
      trade(`"p":"5"`),
      trade(`"p":"5","T":-1`),
      `{"stream":"solusdt@trade","data":{"e":"trade","s":"SOLUSDT","p":"5","T":1}}`,
    ]) {
      expect(binance.parseStream(text, received).kind).toBe("invalid");
    }
  });

  it("reads the documented price list, timed on arrival because it carries no time", () => {
    expect(binance.parsePoll(BINANCE_REST_PRICES, received)).toEqual({
      kind: "ticks",
      ticks: [
        { exchange: "binance", pair: "BTC/USDT", price: "4.00000200", exchangeTime: received, source: "poll" },
        { exchange: "binance", pair: "ETH/USDT", price: "0.07946600", exchangeTime: received, source: "poll" },
      ],
    });
  });

  it("only accepts USDT pairs", () => {
    expect(() => binanceProvider(["BTC/THB"])).toThrow();
  });
});
