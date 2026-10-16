import { describe, expect, it } from "vitest";
import { binanceProvider } from "../../src/feeds/binance.js";
import { bitkubProvider } from "../../src/feeds/bitkub.js";
import { StreamFeed, type HttpResponse } from "../../src/feeds/stream-feed.js";
import { createLogger } from "../../src/logger.js";
import type { FeedTick } from "../../src/ports/feed.js";
import { FakeClock, FakeHttp, FakeSockets } from "../fakes/fake-network.js";
import { BINANCE_SHUTDOWN, BINANCE_TRADE, BITKUB_REST_TICKER, BITKUB_TICKER } from "./fixtures.js";

const SECOND = 1000;
const HOUR = 3_600_000;
const ok = (body: string): HttpResponse => ({ status: 200, retryAfter: null, body });

function setup(provider = bitkubProvider(["BTC/THB"]), poll = ok(BITKUB_REST_TICKER)) {
  const clock = new FakeClock(new Date("2026-10-16T07:00:00.000Z"));
  const sockets = new FakeSockets();
  const http = new FakeHttp(poll);
  const lines: Record<string, unknown>[] = [];
  const feed = new StreamFeed(provider, {
    connect: sockets.connect,
    httpGet: http.get,
    timers: clock,
    now: clock.now,
    logger: createLogger({ level: "debug", write: (line) => lines.push(JSON.parse(line)) }),
  });
  const ticks: FeedTick[] = [];
  const events = () => lines.map((l) => l["event"]);
  const last = (event: string) => lines.filter((l) => l["event"] === event).at(-1);
  return { feed, clock, sockets, http, ticks, events, last, start: () => feed.start((t) => ticks.push(t)) };
}

describe("StreamFeed: streaming", () => {
  it("connects to the provider's stream and passes on each price", async () => {
    const { sockets, ticks, events, start } = setup();
    await start();
    expect(sockets.last.url).toBe("wss://api.bitkub.com/websocket-api/market.ticker.thb_btc");
    sockets.last.open();
    sockets.last.message(BITKUB_TICKER);
    expect(ticks.map((t) => [t.price, t.source])).toEqual([["2883194.85", "stream"]]);
    expect(events()).toContain("feed.connected");
  });

  it("logs a message it cannot read and carries on", async () => {
    const { sockets, ticks, events, start } = setup();
    await start();
    sockets.last.open();
    sockets.last.message("garbage");
    sockets.last.message(BITKUB_TICKER);
    expect(events()).toContain("feed.message_invalid");
    expect(ticks).toHaveLength(1);
  });
});

describe("StreamFeed: reconnect and polling fallback (ARCHITECTURE.md §7)", () => {
  it("polls once a second while the stream is down, and stops when it is back", async () => {
    const { sockets, http, ticks, clock, start } = setup();
    await start();
    sockets.last.open();
    sockets.last.drop();
    await clock.advance(0);
    expect(http.requests).toEqual(["https://api.bitkub.com/api/v3/market/ticker"]);
    expect(ticks.map((t) => t.source)).toEqual(["poll"]);

    await clock.advance(SECOND); // the reconnect after 1 s opens a new socket
    expect(sockets.sockets).toHaveLength(2);
    expect(http.requests).toHaveLength(2);
    sockets.last.open();
    await clock.advance(10 * SECOND);
    expect(http.requests).toHaveLength(2);
  });

  it("waits longer after each failed reconnect, up to 60 s, and starts over once connected", async () => {
    const { sockets, clock, start } = setup();
    await start();
    const openedAt: number[] = [];
    const watch = () => openedAt.push(clock.now().getTime());
    sockets.last.drop();
    for (let i = 0; i < 8; i++) {
      const before = sockets.sockets.length;
      while (sockets.sockets.length === before) await clock.advance(SECOND / 2);
      watch();
      sockets.last.drop();
    }
    const gaps = openedAt.slice(1).map((t, i) => (t - (openedAt[i] ?? 0)) / SECOND);
    expect(gaps).toEqual([2, 4, 8, 16, 32, 60, 60]);

    const before = sockets.sockets.length;
    while (sockets.sockets.length === before) await clock.advance(SECOND / 2);
    sockets.last.open();
    sockets.last.drop();
    const reopened = sockets.sockets.length;
    await clock.advance(SECOND);
    expect(sockets.sockets.length).toBe(reopened + 1);
  });

  it("reconnects at once when Binance announces a shutdown, without polling", async () => {
    const { sockets, http, clock, start, events } = setup(binanceProvider(["BTC/USDT"]), ok("[]"));
    await start();
    sockets.last.open();
    sockets.last.message(BINANCE_SHUTDOWN);
    expect(sockets.sockets).toHaveLength(2);
    expect(sockets.sockets[0]?.closed).toBe(true);
    sockets.last.open();
    await clock.advance(5 * SECOND);
    expect(http.requests).toEqual([]);
    expect(events()).toContain("feed.server_shutdown");
  });

  it("renews a Binance connection after 23 hours, before Binance closes it at 24", async () => {
    const { sockets, clock, start } = setup(binanceProvider(["BTC/USDT"]), ok("[]"));
    await start();
    sockets.last.open();
    await clock.advance(23 * HOUR - SECOND);
    expect(sockets.sockets).toHaveLength(1);
    await clock.advance(SECOND);
    expect(sockets.sockets).toHaveLength(2);
    expect(sockets.sockets[0]?.closed).toBe(true);
  });

  it("passes on Binance trades with their trade time", async () => {
    const { sockets, ticks, start } = setup(binanceProvider(["BTC/USDT"]), ok("[]"));
    await start();
    sockets.last.open();
    sockets.last.message(BINANCE_TRADE);
    expect(ticks[0]?.exchangeTime).toEqual(new Date(1672515782136));
  });

  it("never starts a poll while the last one is still waiting for an answer", async () => {
    let answer: (r: HttpResponse) => void = () => undefined;
    const { sockets, http, clock, start } = setup();
    http.willReturn(new Promise<HttpResponse>((resolve) => (answer = resolve)));
    await start();
    sockets.last.drop();
    await clock.advance(5 * SECOND);
    expect(http.requests).toHaveLength(1);
    answer(ok(BITKUB_REST_TICKER));
    await clock.advance(SECOND);
    expect(http.requests).toHaveLength(2);
  });
});

describe("StreamFeed: rate limits (ARCHITECTURE.md §2.1, SECURITY.md T-08)", () => {
  it("sends nothing until Retry-After has passed after a 429", async () => {
    const { sockets, http, clock, start, last } = setup();
    http.willReturn({ status: 429, retryAfter: "30", body: "" });
    await start();
    sockets.last.drop();
    // Keep the stream down so polling continues.
    const keepDown = () => {
      if (!sockets.last.closed) sockets.last.drop();
    };
    for (let s = 0; s < 29; s++) {
      await clock.advance(SECOND);
      keepDown();
    }
    expect(http.requests).toHaveLength(1);
    await clock.advance(SECOND);
    keepDown();
    expect(http.requests).toHaveLength(2);
    expect(last("feed.rate_limited")).toMatchObject({ status: 429, waitSeconds: 30 });
  });

  it("waits Bitkub's documented 30 s when a 429 has no Retry-After", async () => {
    const { sockets, http, clock, start } = setup();
    http.willReturn({ status: 429, retryAfter: null, body: "" });
    await start();
    sockets.last.drop();
    await clock.advance(29 * SECOND);
    for (const s of sockets.sockets) if (!s.closed) s.drop();
    await clock.advance(0);
    expect(http.requests).toHaveLength(1);
  });

  it("obeys a Binance 418 ban for as long as it says", async () => {
    const { sockets, http, clock, start, last } = setup(binanceProvider(["BTC/USDT"]), ok("[]"));
    http.willReturn({ status: 418, retryAfter: "120", body: "" });
    await start();
    sockets.last.drop();
    for (let s = 0; s < 119; s++) {
      await clock.advance(SECOND);
      for (const socket of sockets.sockets) if (!socket.closed) socket.drop();
    }
    expect(http.requests).toHaveLength(1);
    expect(last("feed.rate_limited")).toMatchObject({ status: 418, waitSeconds: 120 });
  });

  it("stops polling for a minute and logs an error on a 403 or 451 (blocked or refused region)", async () => {
    const { sockets, http, clock, start, events } = setup(binanceProvider(["BTC/USDT"]), ok("[]"));
    http.willReturn({ status: 451, retryAfter: null, body: "" });
    await start();
    sockets.last.drop();
    for (let s = 0; s < 59; s++) {
      await clock.advance(SECOND);
      for (const socket of sockets.sockets) if (!socket.closed) socket.drop();
    }
    expect(http.requests).toHaveLength(1);
    expect(events()).toContain("feed.blocked");
  });
});

describe("StreamFeed: stop", () => {
  it("closes the stream and neither reconnects nor polls afterwards", async () => {
    const { feed, sockets, http, clock, start } = setup();
    await start();
    sockets.last.open();
    await feed.stop();
    expect(sockets.last.closed).toBe(true);
    await clock.advance(5 * 60 * SECOND);
    expect(sockets.sockets).toHaveLength(1);
    expect(http.requests).toEqual([]);
  });
});
