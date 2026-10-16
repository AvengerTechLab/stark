import { describe, expect, it } from "vitest";
import { Dispatcher, DEFAULT_QUOTAS, usagePeriod } from "../../src/app/dispatcher.js";
import { createLogger } from "../../src/logger.js";
import type { AlertChannel, ChannelName, SendResult } from "../../src/ports/channel.js";
import type { AlertDecision } from "../../src/ports/storage.js";
import { FakeChannel } from "../fakes/fake-channel.js";
import { FakeChannelSettings, FakeDeliveryLog } from "../fakes/fake-storage.js";

// Demo decisions and times; not market data.
const T0 = Date.parse("2026-10-16T05:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms);
const MINUTE = 60_000;

function decision(id: string, channels: ChannelName[], ruleId = "rule-1"): AlertDecision {
  return {
    id,
    ruleId,
    tickId: `tick-${id}`,
    price: "100",
    referencePrice: null,
    changePercent: null,
    decidedAt: at(0),
    channels,
  };
}

function setup(options: { channels?: AlertChannel[]; on?: ChannelName[] } = {}) {
  const clock = { now: at(0) };
  const waits: number[] = [];
  const lines: Record<string, unknown>[] = [];
  const channels = options.channels ?? [
    new FakeChannel("telegram"),
    new FakeChannel("line"),
    new FakeChannel("discord"),
    new FakeChannel("email"),
  ];
  const settings = new FakeChannelSettings(...(options.on ?? ["telegram", "line", "discord", "email"]));
  const deliveries = new FakeDeliveryLog();
  const dispatcher = new Dispatcher({
    channels,
    settings,
    deliveries,
    format: (d) => `alert ${d.id}`,
    logger: createLogger({ level: "debug", write: (line) => lines.push(JSON.parse(line)) }),
    now: () => clock.now,
    sleep: async (ms) => {
      waits.push(ms);
      clock.now = new Date(clock.now.getTime() + ms);
    },
  });
  const byName = (name: ChannelName) => channels.find((c) => c.name === name) as FakeChannel;
  const attempts = (channel?: ChannelName) =>
    deliveries.recorded
      .filter((a) => channel === undefined || a.channel === channel)
      .map((a) => `${a.alertId}/${a.channel}#${a.attempt}:${a.status}${a.reason === null ? "" : `(${a.reason})`}`);
  const events = () => lines.map((l) => l["event"]);
  return { dispatcher, settings, deliveries, clock, waits, byName, attempts, events };
}

describe("Dispatcher: sending (EVENTS.md §2.3)", () => {
  it("sends the alert text with its ID to every channel of the decision and records each delivery", async () => {
    const { dispatcher, byName, attempts } = setup();
    await dispatcher.dispatch(decision("a1", ["telegram", "discord"]));
    expect(byName("telegram").sent).toEqual([{ alertId: "a1", text: "alert a1" }]);
    expect(byName("discord").sent).toEqual([{ alertId: "a1", text: "alert a1" }]);
    expect(byName("line").sent).toEqual([]);
    expect(attempts().sort()).toEqual(["a1/discord#1:delivered", "a1/telegram#1:delivered"]);
  });

  it("does not let a slow channel delay the others", async () => {
    let release: () => void = () => undefined;
    const slow: AlertChannel = {
      name: "email",
      send: () => new Promise<SendResult>((resolve) => (release = () => resolve({ status: "delivered" }))),
    };
    const line = new FakeChannel("line");
    const { dispatcher, attempts } = setup({ channels: [slow, line] });
    const done = dispatcher.dispatch(decision("a1", ["email", "line"]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attempts()).toEqual(["a1/line#1:delivered"]);
    release();
    await done;
    expect(attempts()).toEqual(["a1/line#1:delivered", "a1/email#1:delivered"]);
  });

  it("retries a failed send up to 3 attempts, 1 s then 2 s apart, with the same alert ID", async () => {
    const { dispatcher, byName, attempts, waits } = setup();
    byName("line").willReturn({ status: "failed", reason: "http_500" }, { status: "failed", reason: "http_502" });
    await dispatcher.dispatch(decision("a1", ["line"]));
    expect(attempts()).toEqual(["a1/line#1:failed(http_500)", "a1/line#2:failed(http_502)", "a1/line#3:delivered"]);
    expect(byName("line").sent.map((s) => s.alertId)).toEqual(["a1", "a1", "a1"]);
    expect(waits).toEqual([1000, 2000]);
  });

  it("stops after 3 failed attempts and logs the channel as failing", async () => {
    const { dispatcher, byName, attempts, events } = setup();
    const fail: SendResult = { status: "failed", reason: "http_500" };
    byName("line").willReturn(fail, fail, fail, fail);
    await dispatcher.dispatch(decision("a1", ["line"]));
    expect(attempts()).toHaveLength(3);
    expect(byName("line").sent).toHaveLength(3);
    expect(events()).toContain("dispatch.channel_failed");
  });

  it("waits the channel's Retry-After before the next attempt, never less than the normal wait", async () => {
    const { dispatcher, byName, waits } = setup();
    byName("telegram").willReturn(
      { status: "failed", reason: "http_429", retryAfterSeconds: 30 },
      { status: "failed", reason: "http_429", retryAfterSeconds: 0.5 },
    );
    await dispatcher.dispatch(decision("a1", ["telegram"]));
    expect(waits).toEqual([30_000, 2000]);
  });

  it("treats a send that throws as a failed attempt and retries it", async () => {
    let calls = 0;
    const flaky: AlertChannel = {
      name: "discord",
      send: async () => {
        if (++calls === 1) throw new Error("socket hang up");
        return { status: "delivered" };
      },
    };
    const { dispatcher, attempts } = setup({ channels: [flaky] });
    await dispatcher.dispatch(decision("a1", ["discord"]));
    expect(attempts()).toEqual(["a1/discord#1:failed(send_error)", "a1/discord#2:delivered"]);
  });
});

describe("Dispatcher: skips (EVENTS.md §2.3, D-09, D-17, D-42)", () => {
  it("skips a channel switched off after the decision, and one with no adapter configured", async () => {
    const { dispatcher, settings, byName, attempts } = setup({ channels: [new FakeChannel("telegram")] });
    settings.on.delete("telegram");
    await dispatcher.dispatch(decision("a1", ["telegram", "line"]));
    expect(byName("telegram").sent).toEqual([]);
    expect(attempts().sort()).toEqual(["a1/line#1:skipped(channel_off)", "a1/telegram#1:skipped(channel_off)"]);
  });

  it("marks a channel dead when it says so, does not retry it, and skips it afterwards", async () => {
    const { dispatcher, settings, byName, attempts, events } = setup();
    byName("discord").willReturn({ status: "dead", reason: "http_404" });
    await dispatcher.dispatch(decision("a1", ["discord"]));
    await dispatcher.dispatch(decision("a2", ["discord"], "rule-2"));
    expect(byName("discord").sent).toHaveLength(1);
    expect(settings.dead.has("discord")).toBe(true);
    expect(attempts()).toEqual(["a1/discord#1:failed(http_404)", "a2/discord#1:skipped(channel_dead)"]);
    expect(events()).toContain("dispatch.channel_dead");
  });

  it("sends a rule at most once per channel per 5 minutes; other rules and channels are not affected", async () => {
    const { dispatcher, clock, byName, attempts } = setup();
    await dispatcher.dispatch(decision("a1", ["telegram"]));
    clock.now = at(5 * MINUTE - 1);
    await dispatcher.dispatch(decision("a2", ["telegram", "line"]));
    await dispatcher.dispatch(decision("b1", ["telegram"], "rule-2"));
    clock.now = at(5 * MINUTE);
    await dispatcher.dispatch(decision("a3", ["telegram"]));
    expect(attempts("telegram")).toEqual([
      "a1/telegram#1:delivered",
      "a2/telegram#1:skipped(cooldown)",
      "b1/telegram#1:delivered",
      "a3/telegram#1:delivered",
    ]);
    expect(byName("line").sent.map((s) => s.alertId)).toEqual(["a2"]);
  });

  it("starts the cooldown only from a delivered attempt", async () => {
    const { dispatcher, byName, attempts } = setup();
    const fail: SendResult = { status: "failed", reason: "http_500" };
    byName("line").willReturn(fail, fail, fail);
    await dispatcher.dispatch(decision("a1", ["line"]));
    await dispatcher.dispatch(decision("a2", ["line"]));
    expect(attempts("line").at(-1)).toBe("a2/line#1:delivered");
  });

  it("stops LINE at its monthly quota and counts the month in Thai time", async () => {
    const { dispatcher, deliveries, clock, attempts, events } = setup();
    clock.now = new Date("2026-10-31T16:59:59.000Z"); // 23:59:59 on 31 October in Thailand
    deliveries.setUsage("line", "2026-10-01", DEFAULT_QUOTAS.line?.limit ?? 0);
    await dispatcher.dispatch(decision("a1", ["line"]));
    clock.now = new Date("2026-10-31T17:00:00.000Z"); // 00:00 on 1 November in Thailand
    await dispatcher.dispatch(decision("a2", ["line"], "rule-2"));
    expect(attempts()).toEqual(["a1/line#1:skipped(quota_reached)", "a2/line#1:delivered"]);
    expect(await deliveries.usage("line", "2026-11-01")).toBe(1);
    expect(events()).toContain("dispatch.quota_reached");
  });

  it("counts Gmail per day and stops at its daily limit", async () => {
    const { dispatcher, deliveries, attempts } = setup();
    const limit = DEFAULT_QUOTAS.email?.limit ?? 0;
    deliveries.setUsage("email", "2026-10-16", limit - 1);
    await dispatcher.dispatch(decision("a1", ["email", "telegram"]));
    await dispatcher.dispatch(decision("a2", ["email"], "rule-2"));
    expect(attempts("email")).toEqual(["a1/email#1:delivered", "a2/email#1:skipped(quota_reached)"]);
    expect(await deliveries.usage("email", "2026-10-16")).toBe(limit);
    expect(await deliveries.usage("telegram", "2026-10-16")).toBe(0);
  });

  it("names usage periods by the Thai calendar", () => {
    expect(usagePeriod("month", new Date("2026-12-31T17:00:00.000Z"))).toBe("2027-01-01");
    expect(usagePeriod("day", new Date("2026-10-16T16:59:59.999Z"))).toBe("2026-10-16");
    expect(usagePeriod("day", new Date("2026-10-16T17:00:00.000Z"))).toBe("2026-10-17");
  });
});

describe("Dispatcher: idempotency by alert ID (EVENTS.md §2.2–2.3)", () => {
  it("never sends the same alert to the same channel twice, even after the cooldown", async () => {
    const { dispatcher, clock, byName, attempts } = setup();
    const d = decision("a1", ["telegram"]);
    await Promise.all([dispatcher.dispatch(d), dispatcher.dispatch(d)]);
    clock.now = at(10 * MINUTE);
    await dispatcher.dispatch(d);
    expect(byName("telegram").sent).toHaveLength(1);
    expect(attempts()).toEqual(["a1/telegram#1:delivered"]);
  });

  it("records nothing more for an alert a channel already skipped", async () => {
    const { dispatcher, settings, attempts } = setup();
    settings.on.delete("line");
    await dispatcher.dispatch(decision("a1", ["line"]));
    settings.on.add("line");
    await dispatcher.dispatch(decision("a1", ["line"]));
    expect(attempts()).toEqual(["a1/line#1:skipped(channel_off)"]);
  });

  it("after a restart, continues from the attempts already recorded and never exceeds 3", async () => {
    const { dispatcher, deliveries, byName, attempts } = setup();
    for (const attempt of [1, 2]) {
      await deliveries.record(
        { alertId: "a1", channel: "line", attempt, status: "failed", reason: "http_500", at: at(0) },
        "rule-1",
        null,
      );
    }
    byName("line").willReturn({ status: "failed", reason: "http_500" });
    await dispatcher.dispatch(decision("a1", ["line"]));
    expect(byName("line").sent).toHaveLength(1);
    expect(attempts()).toHaveLength(3);
  });

  it("does not send a second decision of a rule while the first is still being sent", async () => {
    const { dispatcher, byName, attempts } = setup();
    await Promise.all([dispatcher.dispatch(decision("a1", ["telegram"])), dispatcher.dispatch(decision("a2", ["telegram"]))]);
    expect(byName("telegram").sent.map((s) => s.alertId)).toEqual(["a1"]);
    expect(attempts()).toEqual(["a1/telegram#1:delivered", "a2/telegram#1:skipped(cooldown)"]);
  });
});
