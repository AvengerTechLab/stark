// Provider messages for the feed tests. Each is copied from the provider's own API documentation,
// whose values are the documentation's examples, not market data. Where a message had to be changed
// to fit Stark (a symbol Stark watches instead of the example's), the change is noted. Messages
// marked "demo" are made up for one edge case.
//
// Sources:
//   Bitkub  github.com/bitkub/bitkub-official-api-docs        commit d65eafa  websocket-public.md, rest-v3.md
//   Binance github.com/binance/binance-spot-api-docs          commit f0ee79c  web-socket-streams.md, rest-api.md

/** Bitkub websocket-public.md, "Ticker Stream" response, verbatim. */
export const BITKUB_TICKER = `{
  "stream": "market.ticker.thb_btc",
  "id": 1,
  "last": 2883194.85,
  "lowestAsk": 2883194.9,
  "lowestAskSize": 0.0070947,
  "highestBid": 2881000.31,
  "highestBidSize": 0.00470253,
  "change": 60622.33,
  "percentChange": 2.15,
  "baseVolume": 89.25334259,
  "quoteVolume": 256768588.16,
  "isFrozen": 0,
  "high24hr": 2916959.99,
  "low24hr": 2819009.05,
  "open": 2822572.52,
  "close": 2883194.85
}`;

/** Bitkub rest-v3.md, "GET /api/v3/market/ticker" response, verbatim. */
export const BITKUB_REST_TICKER = `[
  {
    "symbol": "BTC_THB",
    "base_volume": "1875227.0489781",
    "high_24_hr": "3400000",
    "highest_bid": "3380000",
    "last": "3385000",
    "low_24_hr": "3300000",
    "lowest_ask": "3390000",
    "percent_change": "2.69",
    "quote_volume": "69080877.73"
  }
]`;

/** Binance web-socket-streams.md, "Trade Streams" payload, in the combined-stream wrapper; symbol changed from BNBBTC to BTCUSDT. */
export const BINANCE_TRADE = `{
  "stream": "btcusdt@trade",
  "data": {
    "e": "trade",
    "E": 1672515782136,
    "s": "BTCUSDT",
    "t": 12345,
    "p": "0.001",
    "q": "100",
    "T": 1672515782136,
    "m": true,
    "M": true
  }
}`;

/** Binance web-socket-streams.md, "Server Shutdown", combined stream, verbatim. */
export const BINANCE_SHUTDOWN = `{
  "stream": "!serverShutdown",
  "data": {
    "e": "serverShutdown",
    "E": 1770123456789
  }
}`;

/** Binance rest-api.md, "Symbol price ticker", multiple symbols; symbols changed from LTCBTC, ETHBTC to BTCUSDT, ETHUSDT. */
export const BINANCE_REST_PRICES = `[
  { "symbol": "BTCUSDT", "price": "4.00000200" },
  { "symbol": "ETHUSDT", "price": "0.07946600" }
]`;

/** Demo: a price with more digits than a binary float can hold. */
export const BITKUB_TICKER_LONG_PRICE = `{"stream":"market.ticker.thb_shib","id":9,"last":0.000012345678901234567}`;

/** Bitkub rest-v3.md, "GET /api/v3/market/symbols" response, verbatim (one symbol). */
export const BITKUB_SYMBOLS = `{
  "error": 0,
  "result": [
    {
      "base_asset": "BTC",
      "base_asset_scale": 8,
      "buy_price_gap_as_percent": 20,
      "created_at": "2017-10-30T22:16:10+07:00",
      "description": "Thai Baht to Bitcoin",
      "freeze_buy": false,
      "freeze_cancel": false,
      "freeze_sell": false,
      "market_segment": "SPOT",
      "min_quote_size": 10,
      "modified_at": "2025-05-20T16:48:04.599+07:00",
      "name": "Bitcoin",
      "pairing_id": 1,
      "price_scale": 2,
      "price_step": "0.01",
      "quantity_scale": 0,
      "quantity_step": "1",
      "quote_asset": "THB",
      "quote_asset_scale": 2,
      "sell_price_gap_as_percent": 20,
      "status": "active",
      "symbol": "BTC_THB",
      "source": "exchange"
    }
  ]
}`;

/** Binance rest-api.md, "Exchange information" response, trimmed to its symbols; ETHBTC changed to ETHUSDT (quote USDT). */
export const BINANCE_EXCHANGE_INFO = `{
  "timezone": "UTC",
  "serverTime": 1565246363776,
  "symbols": [
    { "symbol": "ETHUSDT", "status": "TRADING", "baseAsset": "ETH", "quoteAsset": "USDT" }
  ]
}`;
