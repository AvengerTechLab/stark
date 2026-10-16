import { describe, expect, it } from "vitest";
import { FakeChannel } from "./fakes/fake-channel.js";
import { FakePriceFeed } from "./fakes/fake-price-feed.js";

describe("FakeChannel", () => {
  it("records sends and returns scripted results, then delivered", async () => {
    const channel = new FakeChannel("discord").willReturn(
      { status: "failed", reason: "429", retryAfterSeconds: 2 },
      { status: "dead", reason: "404" },
    );
    const alert = { alertId: "a1", text: "demo" };
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "429", retryAfterSeconds: 2 });
    expect(await channel.send(alert)).toEqual({ status: "dead", reason: "404" });
    expect(await channel.send(alert)).toEqual({ status: "delivered" });
    expect(channel.sent).toHaveLength(3);
  });
});

describe("FakePriceFeed", () => {
  it("delivers emitted ticks only while running", async () => {
    const feed = new FakePriceFeed("bitkub");
    const ticks: unknown[] = [];
    // Demo price, not market data.
    const tick = { pair: "BTC/THB", price: "100.00", exchangeTime: new Date(0), source: "stream" as const };
    expect(() => feed.emit(tick)).toThrow(/not running/);
    await feed.start((t) => ticks.push(t));
    feed.emit(tick);
    await feed.stop();
    expect(ticks).toEqual([{ ...tick, exchange: "bitkub" }]);
    expect(() => feed.emit(tick)).toThrow();
  });
});
