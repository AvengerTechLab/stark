import { describe, expect, it } from "vitest";
import { HEARTBEAT_INTERVAL_MS, startHeartbeat } from "../../src/app/heartbeat.js";
import { diskFreeShare } from "../../src/app/disk.js";
import { createLogger } from "../../src/logger.js";
import { FakeClock, FakeHttp } from "../fakes/fake-network.js";

// The heartbeat URL here is made up; the fake HTTP client never sends it anywhere.
const URL = "https://uptime.example.com/ping/not-real";

function setup() {
  const clock = new FakeClock(new Date("2026-10-16T07:00:00.000Z"));
  const http = new FakeHttp({ status: 200, retryAfter: null, body: "OK" });
  const lines: string[] = [];
  const health = { withhold: false };
  const stop = startHeartbeat({
    url: URL,
    get: http.get,
    timers: clock,
    withhold: () => health.withhold,
    logger: createLogger({ level: "debug", secrets: [URL], write: (line) => lines.push(line) }),
  });
  return { clock, http, lines, stop, health };
}

describe("heartbeat (SPEC.md D-43)", () => {
  it("sends no ping while storage is failing, so the outside monitor notices (R-2, F-002)", async () => {
    const { clock, http, health, lines } = setup();
    await clock.advance(0);
    health.withhold = true;
    await clock.advance(3 * HEARTBEAT_INTERVAL_MS);
    expect(http.requests).toEqual([URL]);
    expect(lines.some((l) => l.includes('"event":"heartbeat.withheld"'))).toBe(true);
    health.withhold = false;
    await clock.advance(HEARTBEAT_INTERVAL_MS);
    expect(http.requests).toEqual([URL, URL]);
  });

  it("pings at start and then every 5 minutes", async () => {
    const { clock, http } = setup();
    await clock.advance(0);
    expect(http.requests).toEqual([URL]);
    await clock.advance(HEARTBEAT_INTERVAL_MS - 1);
    expect(http.requests).toHaveLength(1);
    await clock.advance(1);
    expect(http.requests).toHaveLength(2);
    expect(HEARTBEAT_INTERVAL_MS).toBe(5 * 60_000);
  });

  it("logs a failed ping without its URL, which is a secret, and keeps beating", async () => {
    const { clock, http, lines } = setup();
    const networkError = Promise.reject(new Error(`fetch failed ${URL}`));
    networkError.catch(() => undefined); // handled by the heartbeat; this only keeps the test runner quiet
    http.willReturn({ status: 500, retryAfter: null, body: "" }, networkError);
    await clock.advance(HEARTBEAT_INTERVAL_MS);
    await clock.advance(HEARTBEAT_INTERVAL_MS);
    expect(http.requests).toHaveLength(3);
    const failed = lines.filter((l) => l.includes("heartbeat.failed"));
    expect(failed).toHaveLength(2);
    expect(failed.join("\n")).not.toContain("uptime.example.com/ping/not-real");
  });

  it("stops when told to", async () => {
    const { clock, http, stop } = setup();
    await clock.advance(0);
    stop();
    await clock.advance(10 * HEARTBEAT_INTERVAL_MS);
    expect(http.requests).toHaveLength(1);
  });
});

describe("diskFreeShare", () => {
  it("reads the share of the disk that is free, between 0 and 1", async () => {
    const share = await diskFreeShare(".");
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThanOrEqual(1);
  });
});
