import { describe, expect, it } from "vitest";
import { HealthMonitor } from "../../src/app/health.js";
import { createLogger } from "../../src/logger.js";
import type { ChannelName } from "../../src/ports/channel.js";
import { FakeChannel } from "../fakes/fake-channel.js";
import { FakeChannelSettings, FakeHealthLog } from "../fakes/fake-storage.js";

// Demo times; not real events.
const T0 = Date.parse("2026-10-16T07:00:00.000Z"); // 14:00:00 in Thailand
const at = (ms: number) => new Date(T0 + ms);
const SECOND = 1000;
const MINUTE = 60 * SECOND;

function setup(options: { on?: ChannelName[]; disk?: number } = {}) {
  const clock = { now: at(0) };
  const channels = (["telegram", "line", "discord", "email"] as const).map((name) => new FakeChannel(name));
  const settings = new FakeChannelSettings(...(options.on ?? ["telegram", "line", "discord", "email"]));
  const log = new FakeHealthLog();
  const lines: Record<string, unknown>[] = [];
  const disk = { free: options.disk ?? 0.5 };
  let next = 0;
  const monitor = new HealthMonitor({
    exchanges: ["bitkub", "binance"],
    channels,
    settings,
    log,
    diskFree: async () => disk.free,
    now: () => clock.now,
    newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
    logger: createLogger({ level: "debug", write: (line) => lines.push(JSON.parse(line)) }),
  });
  const byName = (name: ChannelName) => channels.find((c) => c.name === name) as FakeChannel;
  /** Every message sent, as "channel: first line". */
  const sent = () =>
    channels.flatMap((c) => c.sent.map((s) => ({ c: c.name, id: s.alertId, line: s.text.split("\n")[0] ?? "" })));
  const checkAt = async (ms: number) => {
    clock.now = at(ms);
    await monitor.check();
  };
  /** Both feeds tick at `ms`. */
  const ticks = (ms: number) => {
    clock.now = at(ms);
    monitor.tickSeen("bitkub");
    monitor.tickSeen("binance");
  };
  const events = () => lines.map((l) => l["event"]);
  return { monitor, clock, settings, log, disk, byName, sent, checkAt, ticks, events };
}

describe("HealthMonitor: feeds (EVENTS.md §2.4, SC-3)", () => {
  it("reports a stale feed after it stays stale, through the first working channel, and records it", async () => {
    const { monitor, log, sent, checkAt, clock } = setup();
    clock.now = at(0);
    monitor.tickSeen("bitkub");
    monitor.tickSeen("binance");
    const keepBinance = (ms: number) => {
      clock.now = at(ms);
      monitor.tickSeen("binance");
    };
    for (let s = 30; s <= 6 * 60; s += 30) {
      keepBinance(s * SECOND);
      await checkAt(s * SECOND);
      if (s * SECOND < 6 * MINUTE) expect(sent()).toEqual([]);
    }
    expect(sent()).toEqual([
      { c: "telegram", id: "00000000-0000-4000-8000-000000000001", line: "[Stark] ไม่ได้รับราคาจาก Bitkub ตั้งแต่ 14:00:00 น." },
    ]);
    expect(log.events).toEqual([
      { id: "00000000-0000-4000-8000-000000000002", kind: "feed_stale", subject: "bitkub", since: at(0), reportedAt: at(6 * MINUTE) },
    ]);
    await checkAt(7 * MINUTE);
    expect(sent()).toHaveLength(1);
  });

  it("says nothing about a gap shorter than that, and nothing on recovery from an unreported gap", async () => {
    const { monitor, sent, checkAt, ticks } = setup();
    ticks(0);
    await checkAt(4 * MINUTE);
    ticks(4 * MINUTE + SECOND);
    await checkAt(4 * MINUTE + 2 * SECOND);
    expect(sent()).toEqual([]);
    void monitor;
  });

  it("reports the recovery once, after a reported stale feed ticks again", async () => {
    const { monitor, sent, checkAt, clock } = setup();
    clock.now = at(0);
    monitor.tickSeen("bitkub");
    monitor.tickSeen("binance");
    for (let s = 30; s <= 6 * 60; s += 30) {
      clock.now = at(s * SECOND);
      monitor.tickSeen("binance");
      await checkAt(s * SECOND);
    }
    clock.now = at(7 * MINUTE);
    monitor.tickSeen("bitkub");
    monitor.tickSeen("binance");
    await checkAt(7 * MINUTE);
    await checkAt(7 * MINUTE + 30 * SECOND);
    expect(sent().map((m) => m.line)).toEqual([
      "[Stark] ไม่ได้รับราคาจาก Bitkub ตั้งแต่ 14:00:00 น.",
      "[Stark] ราคาจาก Bitkub กลับมาแล้ว เวลา 14:07:00 น.",
    ]);
  });

  it("counts a feed that never ticked from the moment the monitor started", async () => {
    const { sent, checkAt } = setup();
    await checkAt(6 * MINUTE);
    expect(sent().map((m) => m.line).sort()).toEqual([
      "[Stark] ไม่ได้รับราคาจาก Binance ตั้งแต่ 14:00:00 น.",
      "[Stark] ไม่ได้รับราคาจาก Bitkub ตั้งแต่ 14:00:00 น.",
    ]);
  });
});

describe("HealthMonitor: channels", () => {
  const failed = (channel: ChannelName, ms: number, reason = "http_500") => ({
    channel,
    outcome: "failed" as const,
    reason,
    at: at(ms),
  });

  it("reports a failing channel after 5 minutes through another channel, never through itself", async () => {
    const { monitor, sent, checkAt, ticks } = setup();
    ticks(0);
    monitor.channelOutcome(failed("telegram", 0));
    ticks(4 * MINUTE);
    await checkAt(4 * MINUTE);
    expect(sent()).toEqual([]);
    ticks(5 * MINUTE);
    await checkAt(5 * MINUTE);
    expect(sent()).toEqual([
      { c: "discord", id: expect.any(String), line: "[Stark] ส่งแจ้งเตือนทาง Telegram ไม่สำเร็จตั้งแต่ 14:00:00 น." },
    ]);
  });

  it("forgets a failure that a delivery cleared before it was reported", async () => {
    const { monitor, sent, checkAt, ticks } = setup();
    ticks(0);
    monitor.channelOutcome(failed("line", 0));
    monitor.channelOutcome({ channel: "line", outcome: "delivered", reason: null, at: at(MINUTE) });
    ticks(6 * MINUTE);
    await checkAt(6 * MINUTE);
    expect(sent()).toEqual([]);
  });

  it("reports the recovery once after a reported failure", async () => {
    const { monitor, sent, checkAt, ticks } = setup();
    ticks(0);
    monitor.channelOutcome(failed("line", 0));
    ticks(5 * MINUTE);
    await checkAt(5 * MINUTE);
    monitor.channelOutcome({ channel: "line", outcome: "delivered", reason: null, at: at(6 * MINUTE) });
    ticks(6 * MINUTE);
    await checkAt(6 * MINUTE);
    await checkAt(6 * MINUTE + 30 * SECOND);
    expect(sent().map((m) => m.line)).toEqual([
      "[Stark] ส่งแจ้งเตือนทาง LINE ไม่สำเร็จตั้งแต่ 14:00:00 น.",
      "[Stark] ส่งแจ้งเตือนทาง LINE ได้ตามปกติแล้ว",
    ]);
  });

  it("reports a dead channel at the next check, and never sends a report through a dead channel", async () => {
    const { monitor, settings, sent, checkAt, ticks } = setup();
    ticks(0);
    settings.dead.set("telegram", at(0));
    monitor.channelOutcome({ channel: "discord", outcome: "dead", reason: "http_404", at: at(0) });
    await checkAt(30 * SECOND);
    expect(sent()).toEqual([
      { c: "email", id: expect.any(String), line: "[Stark] ช่องทาง Discord ใช้ไม่ได้แล้ว ต้องตั้งค่าใหม่" },
    ]);
  });

  it("tells the PO to reconnect Google when the Gmail token cannot be refreshed (SECURITY.md T-21)", async () => {
    const { monitor, sent, checkAt, ticks } = setup();
    ticks(0);
    monitor.channelOutcome(failed("email", 0, "token_refresh_failed"));
    ticks(5 * MINUTE);
    await checkAt(5 * MINUTE);
    expect(sent()[0]?.line).toBe("[Stark] ส่งอีเมลไม่ได้ เพราะ Google ไม่ต่ออายุการเข้าสู่ระบบ ต้องเชื่อมบัญชี Google ใหม่");
  });

  it("reports a reached quota once per period", async () => {
    const { monitor, sent, checkAt, clock, ticks } = setup();
    const quota = (ms: number) => monitor.channelOutcome({ channel: "line", outcome: "quota_reached", reason: null, at: at(ms) });
    ticks(0);
    quota(0);
    await checkAt(0);
    quota(MINUTE);
    await checkAt(MINUTE);
    expect(sent().map((m) => m.line)).toEqual(["[Stark] LINE ใช้โควตาของรอบนี้ครบแล้ว หยุดส่งทาง LINE จนถึงรอบถัดไป"]);
    // A new month on the Thai calendar.
    clock.now = new Date("2026-11-01T00:00:00.000Z");
    monitor.tickSeen("bitkub");
    monitor.tickSeen("binance");
    monitor.channelOutcome({ channel: "line", outcome: "quota_reached", reason: null, at: clock.now });
    await monitor.check();
    expect(sent()).toHaveLength(2);
  });
});

describe("HealthMonitor: disk (SECURITY.md T-23)", () => {
  it("reports free disk below 20 % once, and its recovery once", async () => {
    const { disk, sent, checkAt, ticks } = setup({ disk: 0.25 });
    ticks(0);
    await checkAt(0);
    disk.free = 0.19;
    await checkAt(30 * SECOND);
    await checkAt(60 * SECOND);
    disk.free = 0.2;
    ticks(90 * SECOND);
    await checkAt(90 * SECOND);
    expect(sent().map((m) => m.line)).toEqual([
      "[Stark] พื้นที่ดิสก์บนเครื่องเหลือ 19%",
      "[Stark] พื้นที่ดิสก์บนเครื่องกลับมาเหลือ 20% แล้ว",
    ]);
  });
});

describe("HealthMonitor: when no channel can carry the report", () => {
  it("logs it and tries again at the next check", async () => {
    const { monitor, settings, byName, sent, checkAt, ticks, events } = setup({ on: ["telegram"] });
    ticks(0);
    monitor.channelOutcome({ channel: "telegram", outcome: "dead", reason: "x", at: at(0) });
    await checkAt(30 * SECOND);
    expect(sent()).toEqual([]);
    expect(events()).toContain("health.report_failed");
    settings.on.add("line");
    byName("line");
    ticks(60 * SECOND);
    await checkAt(60 * SECOND);
    expect(sent().map((m) => m.c)).toEqual(["line"]);
  });

  it("tries the next channel when the first one fails to deliver the report", async () => {
    const { monitor, byName, sent, checkAt, ticks } = setup();
    byName("discord").willReturn({ status: "failed", reason: "http_500" });
    ticks(0);
    monitor.channelOutcome({ channel: "telegram", outcome: "dead", reason: "x", at: at(0) });
    await checkAt(30 * SECOND);
    expect(sent().map((m) => m.c)).toEqual(["discord", "email"]);
  });
});

describe("HealthMonitor: snapshot for GET /health and /healthz (API.md §1.2)", () => {
  it("lists each feed's last tick and every open condition, and says when Stark is degraded", async () => {
    const { monitor, checkAt, ticks } = setup();
    ticks(0);
    await checkAt(0);
    expect(monitor.snapshot()).toEqual({
      degraded: false,
      feeds: [
        { exchange: "bitkub", lastTickAt: at(0), stale: false },
        { exchange: "binance", lastTickAt: at(0), stale: false },
      ],
      conditions: [],
    });
    monitor.channelOutcome({ channel: "line", outcome: "failed", reason: "http_500", at: at(0) });
    await checkAt(61 * SECOND);
    expect(monitor.snapshot()).toMatchObject({
      degraded: true,
      feeds: [{ exchange: "bitkub", stale: true }, { exchange: "binance", stale: true }],
      conditions: expect.arrayContaining([
        { kind: "channel_failing", subject: "line", since: at(0), reported: false },
        { kind: "feed_stale", subject: "bitkub", since: at(0), reported: false },
      ]),
    });
  });
});

describe("HealthMonitor: which feeds it watches", () => {
  it("watches only the exchanges it is told to, so a feed with no rules is never called stale", async () => {
    const { monitor, sent, checkAt } = setup();
    monitor.setExchanges(["bitkub"]);
    await checkAt(6 * 60_000);
    expect(sent().map((m) => m.line)).toEqual(["[Stark] ไม่ได้รับราคาจาก Bitkub ตั้งแต่ 14:00:00 น."]);
    expect(monitor.snapshot().feeds.map((f) => f.exchange)).toEqual(["bitkub"]);
  });

  it("counts a newly watched exchange from when it was added", async () => {
    const { monitor, sent, checkAt, clock } = setup();
    monitor.setExchanges([]);
    clock.now = at(10 * 60_000);
    monitor.setExchanges(["binance"]);
    await checkAt(10 * 60_000 + 5 * 60_000);
    expect(sent()).toEqual([]);
    await checkAt(10 * 60_000 + 6 * 60_000);
    expect(sent().map((m) => m.line)).toEqual(["[Stark] ไม่ได้รับราคาจาก Binance ตั้งแต่ 14:10:00 น."]);
  });
});
