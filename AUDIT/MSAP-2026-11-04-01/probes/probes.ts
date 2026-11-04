// MSAP-2026-11-04-01 audit probes. Run on fakes only; they observe behaviour, they change nothing.
// Kept as the record of probes P-01 and P-02 (04_EVIDENCE_INDEX.md E-021, E-022). Not part of the test run
// (vitest includes test/** only). To repeat: copy into test/audit-probes/, change "../../../" to "../../", run vitest.
import { describe, expect, it } from "vitest";
import { StreamFeed } from "../../../src/feeds/stream-feed.js";
import { bitkubProvider } from "../../../src/feeds/bitkub.js";
import { binanceProvider } from "../../../src/feeds/binance.js";
import { DecisionPipeline } from "../../../src/app/pipeline.js";
import { createLogger } from "../../../src/logger.js";
import { FakeClock, FakeSockets } from "../../../test/fakes/fake-network.js";
import type { FeedTick } from "../../../src/ports/feed.js";

const T0 = new Date("2026-11-04T03:00:00.000Z");
const quiet = (lines: string[]) => createLogger({ level: "debug", write: (l) => lines.push(l) });

describe("P-01 stream open but silent (Bitkub, no rotation)", () => {
  it("never polls and never reconnects while the socket stays open without messages", async () => {
    const clock = new FakeClock(T0);
    const sockets = new FakeSockets();
    const gets: string[] = [];
    const ticks: FeedTick[] = [];
    const feed = new StreamFeed(bitkubProvider(["BTC/THB"]), {
      connect: sockets.connect,
      httpGet: async (url) => (gets.push(url), { status: 200, retryAfter: null, body: "[]" }),
      timers: clock,
      now: clock.now,
      logger: quiet([]),
    });
    await feed.start((t) => ticks.push(t));
    sockets.last.open();
    await clock.advance(6 * 60 * 60_000); // six hours
    expect({ sockets: sockets.sockets.length, polls: gets.length, ticks: ticks.length }).toEqual({ sockets: 1, polls: 0, ticks: 0 });
    await feed.stop();
  });
});

describe("P-02 one future-dated tick blocks a pair in the pipeline", () => {
  it("rejects every later normal tick of that pair as out of order", async () => {
    const clock = new FakeClock(T0);
    const lines: string[] = [];
    const stored: string[] = [];
    const pipeline = new DecisionPipeline({
      priceLog: { append: async (t) => void stored.push(t.price), priceAtOrBefore: async () => undefined },
      rules: { rulesFor: async () => [], saveResult: async () => undefined },
      channels: { switchedOn: async () => new Set(), isDead: async () => false, markDead: async () => undefined },
      logger: quiet(lines),
      now: clock.now,
      newId: () => "00000000-0000-4000-8000-000000000000",
      onDecision: () => undefined,
    });
    const tick = (price: string, at: Date): FeedTick => ({ exchange: "binance", pair: "BTC/USDT", price, exchangeTime: at, source: "stream" });
    const provider = binanceProvider(["BTC/USDT"]);
    const parsed = provider.parseStream(JSON.stringify({ stream: "btcusdt@trade", data: { e: "trade", s: "BTCUSDT", p: "1", T: "4102444800000" } }), clock.now());
    expect(parsed.kind).toBe("ticks"); // a trade time in 2100 passes the parser
    pipeline.receive(tick("1", new Date("2100-01-01T00:00:00Z")));
    for (let s = 1; s <= 5; s++) {
      await clock.advance(1000);
      pipeline.receive(tick(String(100 + s), clock.now()));
      await pipeline.flush();
    }
    expect(stored).toEqual([]);
    expect(lines.filter((l) => l.includes("pipeline.tick_out_of_order")).length).toBe(5);
  });
});
