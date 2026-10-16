import { describe, expect, it } from "vitest";
import { DecisionPipeline } from "../../src/app/pipeline.js";
import { createLogger } from "../../src/logger.js";
import type { ChannelName } from "../../src/ports/channel.js";
import type { FeedTick } from "../../src/ports/feed.js";
import type { AlertDecision } from "../../src/ports/storage.js";
import type { ChangeRule, LevelRule } from "../../src/domain/rules.js";
import { FakeChannelSettings, FakePriceLog, FakeRuleStore } from "../fakes/fake-storage.js";

// Demo prices and times; not market data.
const T0 = Date.parse("2026-10-16T05:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms);

function above(level: string, extra: Partial<LevelRule> = {}): LevelRule {
  return {
    id: "rule-above",
    pair: "BTC/THB",
    kind: "above",
    level,
    channels: ["telegram", "line"],
    enabled: true,
    state: "armed",
    ...extra,
  };
}

const change: ChangeRule = {
  id: "rule-change",
  pair: "BTC/USDT",
  kind: "change",
  percent: "5",
  windowMinutes: 60,
  direction: "up",
  channels: ["discord"],
  enabled: true,
  state: "armed",
};

function setup(rules: FakeRuleStore, on: ChannelName[] = ["telegram", "line", "discord", "email"]) {
  const clock = { now: at(0) };
  const priceLog = new FakePriceLog();
  const lines: Record<string, unknown>[] = [];
  const dispatched: AlertDecision[] = [];
  const storedWhenDispatched: number[] = [];
  let next = 0;
  const pipeline = new DecisionPipeline({
    priceLog,
    rules,
    channels: new FakeChannelSettings(...on),
    logger: createLogger({ level: "debug", write: (line) => lines.push(JSON.parse(line)) }),
    now: () => clock.now,
    newId: () => `id-${++next}`,
    onDecision: (decision) => {
      dispatched.push(decision);
      storedWhenDispatched.push(rules.decisions.filter((d) => d.id === decision.id).length);
    },
  });
  /** Delivers a tick at local time `receivedMs`, as the feed would. */
  const receive = (pair: string, price: string, exchangeMs: number, receivedMs = exchangeMs) => {
    clock.now = at(receivedMs);
    const tick: FeedTick = {
      exchange: pair.endsWith("/THB") ? "bitkub" : "binance",
      pair,
      price,
      exchangeTime: at(exchangeMs),
      source: "stream",
    };
    pipeline.receive(tick);
  };
  const flushAt = async (ms: number) => {
    clock.now = at(ms);
    await pipeline.flush();
  };
  const events = () => lines.map((l) => l["event"]);
  return { pipeline, priceLog, dispatched, storedWhenDispatched, receive, flushAt, events, clock };
}

describe("DecisionPipeline: one tick per pair per second (EVENTS.md §2.1)", () => {
  it("keeps only the last tick of a second, once that second has ended", async () => {
    const rules = new FakeRuleStore(above("102"));
    const { priceLog, dispatched, receive, flushAt } = setup(rules);
    receive("BTC/THB", "100", 100);
    receive("BTC/THB", "101", 500);
    receive("BTC/THB", "102", 900, 950);

    await flushAt(999);
    expect(priceLog.ticks).toEqual([]);

    await flushAt(1000);
    expect(priceLog.ticks).toHaveLength(1);
    expect(priceLog.ticks[0]).toMatchObject({ price: "102", exchangeTime: at(900), receivedTime: at(950) });
    expect(dispatched.map((d) => d.tickId)).toEqual([priceLog.ticks[0]?.id]);
  });

  it("releases the held tick as soon as a tick of a later second arrives", async () => {
    const { pipeline, priceLog, receive, flushAt } = setup(new FakeRuleStore());
    receive("BTC/THB", "100", 100);
    receive("BTC/THB", "101", 1200);
    await pipeline.idle();
    expect(priceLog.ticks.map((t) => t.price)).toEqual(["100"]);
    await flushAt(2000);
    expect(priceLog.ticks.map((t) => t.price)).toEqual(["100", "101"]);
  });

  it("keeps each pair separately", async () => {
    const { priceLog, receive, flushAt } = setup(new FakeRuleStore());
    receive("BTC/THB", "100", 100);
    receive("ETH/THB", "50", 200);
    receive("BTC/USDT", "3", 300);
    await flushAt(1000);
    expect(priceLog.ticks.map((t) => t.pair).sort()).toEqual(["BTC/THB", "BTC/USDT", "ETH/THB"]);
  });

  it("drops a tick older than a second already released, and logs it", async () => {
    const { priceLog, receive, flushAt, events } = setup(new FakeRuleStore());
    receive("BTC/THB", "100", 1100);
    await flushAt(2000);
    receive("BTC/THB", "99", 900, 2100); // an earlier second
    receive("BTC/THB", "98", 1900, 2100); // the second already released
    await flushAt(3000);
    expect(priceLog.ticks.map((t) => t.price)).toEqual(["100"]);
    expect(events().filter((e) => e === "pipeline.tick_out_of_order")).toHaveLength(2);
  });
});

describe("DecisionPipeline: late ticks (EVENTS.md §2.1)", () => {
  it("stores a tick received more than 10 s after its exchange time but does not evaluate it", async () => {
    const rules = new FakeRuleStore(above("100"));
    const { priceLog, dispatched, receive, flushAt, events } = setup(rules);
    receive("BTC/THB", "150", 0, 10_001);
    await flushAt(10_001);
    expect(priceLog.ticks).toHaveLength(1);
    expect(dispatched).toEqual([]);
    expect(rules.rules.get("rule-above")?.state).toBe("armed");
    expect(events()).toContain("pipeline.tick_late");
  });

  it("evaluates a tick received exactly 10 s after its exchange time", async () => {
    const { dispatched, receive, flushAt } = setup(new FakeRuleStore(above("100")));
    receive("BTC/THB", "150", 0, 10_000);
    await flushAt(10_000);
    expect(dispatched).toHaveLength(1);
  });
});

describe("DecisionPipeline: decisions (EVENTS.md §2.2, §3)", () => {
  it("stores a complete decision before handing it to the dispatcher", async () => {
    const rules = new FakeRuleStore(above("100"));
    const { dispatched, storedWhenDispatched, receive, flushAt } = setup(rules, ["line", "email"]);
    receive("BTC/THB", "100", 0, 300);
    await flushAt(1500);
    expect(dispatched).toEqual([
      {
        id: "id-2",
        ruleId: "rule-above",
        tickId: "id-1",
        price: "100",
        referencePrice: null,
        changePercent: null,
        decidedAt: at(1500),
        channels: ["line"],
        message: "[Stark] BTC/THB สูงกว่า 100 แล้ว\nราคาล่าสุด 100 THB (Bitkub) เวลา 12:00:00 น.\nกฎ: ราคา ≥ 100",
      },
    ]);
    expect(storedWhenDispatched).toEqual([1]);
    expect(rules.rules.get("rule-above")?.state).toBe("fired");
  });

  it("stores a decision even when none of its channels is switched on (SC-2)", async () => {
    const rules = new FakeRuleStore(above("100"));
    const { dispatched, receive, flushAt } = setup(rules, []);
    receive("BTC/THB", "100", 0);
    await flushAt(1000);
    expect(rules.decisions.map((d) => d.channels)).toEqual([[]]);
    expect(dispatched).toHaveLength(1);
  });

  it("follows crossing and re-arm across ticks: 99 → 100 → 101 → 99 → 100 fires twice", async () => {
    const rules = new FakeRuleStore(above("100"));
    const { dispatched, receive, flushAt } = setup(rules);
    ["99", "100", "101", "99", "100"].forEach((p, i) => receive("BTC/THB", p, i * 1000));
    await flushAt(5000);
    expect(dispatched.map((d) => d.price)).toEqual(["100", "100"]);
    expect(rules.rules.get("rule-above")?.state).toBe("fired");
  });

  it("looks up the reference price at tick time minus the window: 104 → 105 → 106 fires once at +5.00 %", async () => {
    const rules = new FakeRuleStore(change);
    const { priceLog, dispatched, receive, flushAt } = setup(rules);
    priceLog.seed({
      id: "ref",
      exchange: "binance",
      pair: "BTC/USDT",
      price: "100",
      exchangeTime: at(1000 - 60 * 60_000),
      receivedTime: at(1000 - 60 * 60_000),
      source: "stream",
    });
    receive("BTC/USDT", "104", 0);
    receive("BTC/USDT", "105", 1000);
    receive("BTC/USDT", "106", 2000);
    await flushAt(3000);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ price: "105", referencePrice: "100", changePercent: "5.00" });
    expect(dispatched[0]?.message.split("\n")[0]).toBe("[Stark] BTC/USDT ขึ้น +5.00% ใน 60 นาที");
  });

  it("does not fire a change rule without a reference price", async () => {
    const { dispatched, receive, flushAt } = setup(new FakeRuleStore(change));
    receive("BTC/USDT", "500", 0);
    await flushAt(1000);
    expect(dispatched).toEqual([]);
  });

  it("leaves a disabled rule untouched", async () => {
    const rules = new FakeRuleStore(above("100", { enabled: false }));
    const { dispatched, receive, flushAt } = setup(rules);
    receive("BTC/THB", "150", 0);
    await flushAt(1000);
    expect(dispatched).toEqual([]);
    expect(rules.rules.get("rule-above")?.state).toBe("armed");
  });
});

describe("DecisionPipeline: failures and ordering", () => {
  it("does not evaluate a tick it could not store, and carries on with the next", async () => {
    const rules = new FakeRuleStore(above("100"));
    const { priceLog, dispatched, receive, flushAt, events } = setup(rules);
    priceLog.failNextAppend = true;
    receive("BTC/THB", "150", 0);
    receive("BTC/THB", "151", 1000);
    await flushAt(2000);
    expect(priceLog.ticks.map((t) => t.price)).toEqual(["151"]);
    expect(dispatched.map((d) => d.price)).toEqual(["151"]);
    expect(events()).toContain("pipeline.tick_failed");
  });

  it("never dispatches a decision it could not store; the rule stays armed and fires on the next tick", async () => {
    const rules = new FakeRuleStore(above("100"));
    const { dispatched, receive, flushAt, events } = setup(rules);
    rules.failNextSave = true;
    receive("BTC/THB", "150", 0);
    await flushAt(1000);
    expect(dispatched).toEqual([]);
    expect(rules.rules.get("rule-above")?.state).toBe("armed");
    expect(events()).toContain("pipeline.tick_failed");

    receive("BTC/THB", "151", 1000);
    await flushAt(2000);
    expect(dispatched.map((d) => d.price)).toEqual(["151"]);
  });

  it("logs a dispatcher error and keeps the stored decision", async () => {
    const rules = new FakeRuleStore(above("100"));
    const { pipeline, receive, flushAt, events } = setup(rules);
    pipeline.onDecision = () => {
      throw new Error("dispatcher down");
    };
    receive("BTC/THB", "150", 0);
    await flushAt(1000);
    expect(rules.decisions).toHaveLength(1);
    expect(events()).toContain("pipeline.dispatch_failed");
  });

  it("processes ticks one at a time in order, even when storage answers out of order", async () => {
    const rules = new FakeRuleStore(above("100"));
    const { priceLog, dispatched, receive, flushAt } = setup(rules);
    const append = priceLog.append.bind(priceLog);
    let delay = 30;
    priceLog.append = async (tick) => {
      await new Promise((resolve) => setTimeout(resolve, (delay -= 10)));
      return append(tick);
    };
    receive("BTC/THB", "101", 0);
    receive("BTC/THB", "99", 1000);
    receive("BTC/THB", "101", 2000);
    await flushAt(3000);
    expect(priceLog.ticks.map((t) => t.exchangeTime)).toEqual([at(0), at(1000), at(2000)]);
    expect(dispatched).toHaveLength(2);
  });
});
