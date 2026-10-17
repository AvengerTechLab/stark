// S6-11: Stark end to end, with every outside system faked (CLAUDE.md §5). The feeds, Telegram, LINE,
// Google and the providers' lists are fakes; storage is in memory; time is a fake clock. Only the owner
// web API runs for real, on 127.0.0.1. Prices are demo values, not market data.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startStark, type StarkHandle } from "../../src/app/stark.js";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";
import type { AlertDecision } from "../../src/ports/storage.js";
import { BITKUB_TICKER } from "../feeds/fixtures.js";
import { FakeInternet } from "../fakes/fake-internet.js";
import { FakeClock, FakeSockets } from "../fakes/fake-network.js";
import { FakeAlertQuery, FakeChannelAdmin, FakeRuleAdmin, FakeSessionStore } from "../fakes/fake-owner-storage.js";
import { FakeChannelSettings, FakeDeliveryLog, FakeHealthLog, FakePriceLog, FakeRuleStore } from "../fakes/fake-storage.js";

// Made-up credentials; the hash is of the made-up password "demo-password".
const TOKEN = "123456:TEST-token-not-real";
const OWNER_CHAT = 424242;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$jEXthTpqW6vxp4kg3B7YPo8aY3N5KSs0V54IVOSCfYk";
const T0 = new Date("2026-10-16T07:00:00.000Z");

let running: StarkHandle[] = [];
afterEach(async () => {
  await Promise.all(running.map((s) => s.stop()));
  running = [];
});

async function boot(seed?: (stores: { rules: FakeRuleStore; deliveries: FakeDeliveryLog }) => void) {
  const config = loadConfig({
    DATABASE_URL: "postgres://not-used/in-this-test",
    OWNER_PASSWORD_HASH: HASH,
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_OWNER_CHAT_ID: String(OWNER_CHAT),
    LINE_CHANNEL_ACCESS_TOKEN: "line-test-token",
    LINE_OWNER_USER_ID: "U0000",
    HEARTBEAT_URL: "https://uptime.example.com/ping/not-real",
  });
  const clock = new FakeClock(T0);
  const sockets = new FakeSockets();
  const internet = new FakeInternet(TOKEN);
  const rules = new FakeRuleStore();
  const settings = new FakeChannelSettings("telegram", "line", "discord", "email");
  const deliveries = new FakeDeliveryLog();
  seed?.({ rules, deliveries });
  let next = 0;
  const lines: string[] = [];
  let base = "";
  const stark = await startStark({
    config,
    stores: {
      priceLog: new FakePriceLog(),
      rules,
      ruleAdmin: new FakeRuleAdmin(rules),
      channelSettings: settings,
      channelAdmin: new FakeChannelAdmin(settings),
      deliveries,
      healthLog: new FakeHealthLog(),
      sessions: new FakeSessionStore(),
      alerts: new FakeAlertQuery(rules, deliveries),
    },
    connect: sockets.connect,
    httpGet: internet.get,
    httpPost: internet.post,
    timers: clock,
    now: clock.now,
    newId: () => `0000${String(++next).padStart(4, "0")}-0000-4000-8000-000000000000`,
    logger: createLogger({ level: "debug", secrets: [TOKEN], write: (l) => lines.push(l) }),
    diskFree: async () => 0.5,
    listen: async (handler) => {
      const server = createServer((req, res) => void handler(req, res));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return { close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
    },
  });
  running.push(stark);
  await clock.advance(0);

  let cookie = "";
  const web = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, origin: base, ...(body !== undefined && { "content-type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie !== null) cookie = setCookie.split(";")[0] ?? "";
    const text = await response.text();
    return { status: response.status, json: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  return { stark, clock, sockets, internet, rules, deliveries, settings, web, lines };
}

const tickerAt = (last: string) => BITKUB_TICKER.replace('"last": 2883194.85', `"last": ${last}`);

describe("Stark end to end on fakes (TASKS.md S6-11)", () => {
  it("alerts on Telegram and LINE when Bitkub's price reaches a rule made on the web page", async () => {
    const { clock, sockets, internet, web, deliveries } = await boot();
    expect(internet.gets).toContain("https://api.bitkub.com/api/v3/market/symbols");
    expect(sockets.sockets).toHaveLength(0); // no rules yet, so no feed

    expect((await web("POST", "/api/v1/session", { password: "demo-password" })).status).toBe(204);
    const created = await web("POST", "/api/v1/rules", { kind: "above", pair: "BTC/THB", level: "3000000", channels: ["telegram", "line"] });
    expect(created.status).toBe(201);
    await clock.advance(0);
    expect(sockets.last.url).toBe("wss://api.bitkub.com/websocket-api/market.ticker.thb_btc");

    sockets.last.open();
    sockets.last.message(BITKUB_TICKER); // 2,883,194.85: below the level
    await clock.advance(1000);
    expect(internet.telegramTexts().filter((t) => t.startsWith("[Stark] BTC/THB"))).toEqual([]);

    sockets.last.message(tickerAt("3000000.5"));
    await clock.advance(1000);
    await clock.advance(0);
    const alert = internet.telegramTexts().find((t) => t.startsWith("[Stark] BTC/THB"));
    expect(alert?.split("\n")[0]).toBe("[Stark] BTC/THB สูงกว่า 3,000,000 แล้ว");
    const line = internet.posts.find((p) => p.url === "https://api.line.me/v2/bot/message/push");
    expect(line?.request.headers["x-line-retry-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(deliveries.recorded.map((a) => `${a.channel}:${a.status}`).sort()).toEqual(["line:delivered", "telegram:delivered"]);

    const prices = (await web("GET", "/api/v1/prices")).json as { price: string }[];
    expect(prices.map((p) => p.price)).toEqual(["3000000.5"]);
    const alerts = (await web("GET", "/api/v1/alerts")).json as { attempts: unknown[] }[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.attempts).toHaveLength(2);
  });

  it("takes rule commands from the PO on Telegram and ignores anyone else", async () => {
    const { clock, internet, rules, sockets } = await boot();
    internet.telegramMessage(999, "/above BTC/THB 1");
    await clock.advance(0);
    expect(rules.rules.size).toBe(0);
    internet.telegramMessage(OWNER_CHAT, "/above BTC/THB 1");
    await clock.advance(0);
    expect(rules.rules.size).toBe(1);
    expect(internet.telegramTexts().at(-1)).toMatch(/^เพิ่มกฎแล้ว [0-9a-f]{8}: BTC\/THB ราคา ≥ 1 \(telegram, line\)$/);
    await clock.advance(0);
    expect(sockets.last.url).toContain("market.ticker.thb_btc");
  });

  it("tells the PO when a feed stays silent, through a working channel", async () => {
    const { clock, internet, web } = await boot();
    await web("POST", "/api/v1/session", { password: "demo-password" });
    await web("POST", "/api/v1/rules", { kind: "above", pair: "BTC/THB", level: "1", channels: ["telegram"] });
    await clock.advance(7 * 60_000);
    expect(internet.telegramTexts().some((t) => t.startsWith("[Stark] ไม่ได้รับราคาจาก Bitkub"))).toBe(true);
  });

  it("never calls a feed stale while its prices keep coming", async () => {
    const { clock, sockets, internet, web } = await boot();
    await web("POST", "/api/v1/session", { password: "demo-password" });
    await web("POST", "/api/v1/rules", { kind: "above", pair: "BTC/THB", level: "9000000", channels: ["telegram"] });
    await clock.advance(0);
    sockets.last.open();
    for (let s = 0; s < 7 * 60; s += 10) {
      sockets.last.message(BITKUB_TICKER);
      await clock.advance(10_000);
    }
    expect(internet.telegramTexts().some((t) => t.includes("ไม่ได้รับราคา"))).toBe(false);
  });

  it("tells the PO on Telegram when LINE keeps failing", async () => {
    const { clock, sockets, internet, web } = await boot();
    internet.lineStatus = 500;
    await web("POST", "/api/v1/session", { password: "demo-password" });
    await web("POST", "/api/v1/rules", { kind: "above", pair: "BTC/THB", level: "1", channels: ["line"] });
    await clock.advance(0);
    sockets.last.open();
    for (let s = 0; s < 6 * 60; s += 10) {
      sockets.last.message(BITKUB_TICKER);
      await clock.advance(10_000);
    }
    expect(internet.telegramTexts().some((t) => t.startsWith("[Stark] ส่งแจ้งเตือนทาง LINE ไม่สำเร็จ"))).toBe(true);
  });

  it("sends at start the alerts a restart left unsent, and pings the uptime monitor", async () => {
    const decision: AlertDecision = {
      id: "0000aaaa-0000-4000-8000-000000000000",
      ruleId: "r1",
      tickId: "t1",
      price: "100",
      referencePrice: null,
      changePercent: null,
      decidedAt: new Date(T0.getTime() - 60_000),
      channels: ["telegram"],
      message: "[Stark] demo alert left unsent by a restart",
    };
    const { clock, internet } = await boot(({ rules }) => rules.decisions.push(decision));
    await clock.advance(0);
    expect(internet.telegramTexts()).toContain("[Stark] demo alert left unsent by a restart");
    expect(internet.gets).toContain("https://uptime.example.com/ping/not-real");
  });

  it("stops everything it started", async () => {
    const { stark, clock, internet, sockets, web } = await boot();
    await web("POST", "/api/v1/session", { password: "demo-password" });
    await web("POST", "/api/v1/rules", { kind: "above", pair: "BTC/THB", level: "1", channels: ["telegram"] });
    await clock.advance(0);
    await stark.stop();
    running = [];
    const before = { gets: internet.gets.length, posts: internet.posts.length, sockets: sockets.sockets.length };
    await clock.advance(30 * 60_000);
    expect({ gets: internet.gets.length, posts: internet.posts.length, sockets: sockets.sockets.length }).toEqual(before);
    expect(sockets.sockets.every((s) => s.closed)).toBe(true);
  });

  it("never logs a credential", async () => {
    const { clock, internet, lines } = await boot();
    internet.telegramMessage(OWNER_CHAT, "/status");
    await clock.advance(60_000);
    expect(lines.join("\n")).not.toContain("TEST-token-not-real");
    expect(lines.join("\n")).not.toContain("line-test-token");
  });
});
