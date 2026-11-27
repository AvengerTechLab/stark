/* eslint-disable -- audit record of MSAP-2026-11-09-01, kept as it was run; not part of the build or tests */
// P-07 (audit MSAP-2026-11-09-01): a provider that accepts every connection but never publishes. Each new socket
// opens at once and stays silent. Count prices delivered and how long the feed goes without one. Fakes only.
import { describe, expect, it } from "vitest";
import { StreamFeed } from "../../src/feeds/stream-feed.js";
import { bitkubProvider } from "../../src/feeds/bitkub.js";
import { createLogger } from "../../src/logger.js";
import { FakeClock, FakeSockets } from "../fakes/fake-network.js";
import { BITKUB_REST_TICKER } from "../feeds/fixtures.js";
import type { FeedTick } from "../../src/ports/feed.js";

describe("P-07 open-then-silent cycle (R-1 re-check)", () => {
  it("measures ticks per hour and the longest gap", async () => {
    const clock = new FakeClock(new Date("2026-11-09T00:00:00Z"));
    const sockets = new FakeSockets();
    let polls = 0;
    const times: number[] = [];
    const feed = new StreamFeed(bitkubProvider(["BTC/THB"]), {
      connect: sockets.connect,
      httpGet: async () => (polls++, { status: 200, retryAfter: null, body: BITKUB_REST_TICKER }),
      timers: clock,
      now: clock.now,
      logger: createLogger({ level: "error", write: () => undefined }),
    });
    await feed.start((t: FeedTick) => times.push(clock.now().getTime()));
    let opened = 0;
    for (let s = 0; s < 3600; s++) {
      while (opened < sockets.sockets.length) { sockets.sockets[opened]?.open(); opened++; }
      await clock.advance(1000);
    }
    let gap = 0;
    for (let i = 1; i < times.length; i++) gap = Math.max(gap, times[i]! - times[i - 1]!);
    console.log(`P-07 one hour: sockets ${sockets.sockets.length}, polls ${polls}, ticks ${times.length}, longest gap ${gap / 1000}s`);
    feed.stop();
    expect(true).toBe(true);
  }, 60_000);
});
