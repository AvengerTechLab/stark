import { describe, expect, it } from "vitest";
import { HealthMonitor } from "../../src/app/health.js";
import { OwnerService } from "../../src/app/owner-service.js";
import { PriceBoard } from "../../src/app/price-board.js";
import { TelegramBot } from "../../src/interface/telegram-bot.js";
import { createLogger } from "../../src/logger.js";
import { FakeChannel } from "../fakes/fake-channel.js";
import { FakeHttpPost, response } from "../fakes/fake-http-post.js";
import { FakeClock } from "../fakes/fake-network.js";
import { FakeChannelAdmin, FakeRuleAdmin } from "../fakes/fake-owner-storage.js";
import { FakeChannelSettings, FakeDeliveryLog, FakeHealthLog, FakeRuleStore } from "../fakes/fake-storage.js";

// Made-up token and chat IDs; demo prices. No request leaves the fake HTTP client.
const TOKEN = "123456:TEST-token-not-real";
const OWNER = "424242";
const T0 = Date.parse("2026-10-16T07:00:00.000Z");
const listed = new Set(["BTC/THB", "BTC/USDT"]);

function setup() {
  const clock = { now: new Date(T0) };
  const http = new FakeHttpPost(response(200, { ok: true, result: { message_id: 1 } }));
  const store = new FakeRuleStore();
  const settings = new FakeChannelSettings("telegram", "line", "discord");
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ level: "debug", write: (l) => lines.push(JSON.parse(l)) });
  let next = 0;
  const newId = () => `3f2a${String(++next).padStart(4, "0")}-0000-4000-8000-000000000000`;
  const service = new OwnerService({
    rules: new FakeRuleAdmin(store),
    channels: new FakeChannelAdmin(settings),
    isListed: (p) => listed.has(p),
    newId,
    now: () => clock.now,
  });
  const prices = new PriceBoard();
  prices.update({ exchange: "bitkub", pair: "BTC/THB", price: "3512400", exchangeTime: new Date(T0), source: "stream" }, new Date(T0));
  const health = new HealthMonitor({
    exchanges: ["bitkub"],
    channels: [new FakeChannel("telegram")],
    settings,
    log: new FakeHealthLog(),
    diskFree: async () => 0.5,
    now: () => clock.now,
    newId,
    logger,
  });
  health.tickSeen("bitkub");
  const bot = new TelegramBot({
    botToken: TOKEN,
    ownerChatId: OWNER,
    post: http.post,
    service,
    deliveries: new FakeDeliveryLog(),
    configured: ["telegram", "line"],
    prices,
    health: () => health.snapshot(),
    now: () => clock.now,
    newId,
    logger,
  });
  let updateId = 0;
  const say = (text: string, chat: { id: number; type: string } = { id: Number(OWNER), type: "private" }) =>
    bot.handleUpdate({ update_id: ++updateId, message: { message_id: updateId, chat, text } });
  const replies = () =>
    http.requests.filter((r) => r.url.endsWith("/sendMessage")).map((r) => (JSON.parse(r.request.body) as { text: string }).text);
  const events = () => lines.map((l) => l["event"]);
  return { bot, http, store, settings, clock, say, replies, events };
}

describe("TelegramBot: who may command it (API.md §2, SECURITY.md T-06, T-24)", () => {
  it("ignores, without a reply, anyone but the PO and any group chat, and logs it", async () => {
    const { say, replies, events } = setup();
    await say("/rules", { id: 999, type: "private" });
    await say("/rules", { id: Number(OWNER), type: "group" });
    expect(replies()).toEqual([]);
    expect(events().filter((e) => e === "telegram.command_rejected")).toHaveLength(2);
  });

  it("answers the PO's private chat in plain text", async () => {
    const { say, http } = setup();
    await say("/help");
    const sent = http.requests[0];
    expect(sent?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(sent?.request.body ?? "{}")).toMatchObject({ chat_id: OWNER });
    expect(JSON.parse(sent?.request.body ?? "{}")).not.toHaveProperty("parse_mode");
  });
});

describe("TelegramBot: commands", () => {
  it("creates an above rule on every switched-on, configured channel", async () => {
    const { say, replies, store } = setup();
    await say("/above BTC/THB 3500000");
    const rule = [...store.rules.values()][0];
    expect(rule).toMatchObject({ kind: "above", pair: "BTC/THB", level: "3500000", channels: ["telegram", "line"], enabled: true });
    expect(replies()).toEqual(["เพิ่มกฎแล้ว 3f2a0001: BTC/THB ราคา ≥ 3,500,000 (telegram, line)"]);
  });

  it("creates below and change rules, and accepts the command with the bot's name", async () => {
    const { say, store } = setup();
    await say("/below@stark_bot btc/usdt 60000");
    await say("/change BTC/USDT 5 60 up");
    expect([...store.rules.values()].map((r) => r.kind)).toEqual(["below", "change"]);
    expect([...store.rules.values()][1]).toMatchObject({ percent: "5", windowMinutes: 60, direction: "up" });
  });

  it("answers invalid input in Thai with what is wrong, and creates nothing", async () => {
    const { say, replies, store } = setup();
    await say("/above DOGE/THB 0");
    await say("/change BTC/USDT 5 1.5 sideways");
    await say("/above BTC/THB");
    expect(store.rules.size).toBe(0);
    expect(replies()).toEqual([
      "เพิ่มกฎไม่ได้\n- ไม่รู้จักคู่เหรียญนี้\n- ราคาต้องเป็นตัวเลขมากกว่า 0",
      "เพิ่มกฎไม่ได้\n- นาทีต้องเป็นจำนวนเต็ม 1 ถึง 1440\n- ทิศทางต้องเป็น up, down หรือ either",
      "ใช้แบบนี้: /above BTC/THB 3500000",
    ]);
  });

  it("lists rules with their short ID, and the latest prices", async () => {
    const { say, replies } = setup();
    await say("/above BTC/THB 3500000");
    await say("/rules");
    await say("/prices");
    expect(replies().slice(1)).toEqual([
      "3f2a0001 BTC/THB ราคา ≥ 3,500,000 · telegram, line · เปิด",
      "BTC/THB 3,512,400 THB (Bitkub) 0 วินาทีที่แล้ว",
    ]);
  });

  it("disables and enables a rule by short ID, and says when an ID is unknown or too short", async () => {
    const { say, replies, store } = setup();
    await say("/above BTC/THB 3500000");
    await say("/off 3f2a0001");
    expect([...store.rules.values()][0]?.enabled).toBe(false);
    await say("/on 3f2a0001");
    expect([...store.rules.values()][0]?.enabled).toBe(true);
    await say("/off ffff");
    await say("/off 3f");
    expect(replies().slice(1)).toEqual(["ปิดกฎ 3f2a0001 แล้ว", "เปิดกฎ 3f2a0001 แล้ว", "ไม่พบกฎ ffff", "ไม่พบกฎ 3f"]);
  });

  it("deletes a rule only after a yes to that question within 60 seconds", async () => {
    const { say, replies, store, clock } = setup();
    await say("/above BTC/THB 3500000");
    await say("/delete 3f2a0001");
    expect(replies().at(-1)).toBe("ลบกฎ 3f2a0001 (BTC/THB ราคา ≥ 3,500,000) ใช่ไหม? ตอบ yes ภายใน 60 วินาที");
    clock.now = new Date(T0 + 61_000);
    await say("yes");
    expect(replies().at(-1)).toBe("หมดเวลา ไม่ได้ลบกฎ");
    expect(store.rules.size).toBe(1);

    await say("/delete 3f2a0001");
    await say("/rules");
    await say("yes");
    expect(store.rules.size).toBe(1);

    await say("/delete 3f2a0001");
    clock.now = new Date(T0 + 120_000);
    await say("yes");
    expect(store.rules.size).toBe(0);
    expect(replies().at(-1)).toBe("ลบกฎ 3f2a0001 แล้ว");
  });

  it("switches a channel and reports status", async () => {
    const { say, replies, settings } = setup();
    await say("/channel line off");
    expect(settings.on.has("line")).toBe(false);
    await say("/channel sms on");
    await say("/status");
    expect(replies()[0]).toBe("ปิดช่องทาง line แล้ว");
    expect(replies()[1]).toBe("ใช้แบบนี้: /channel line on หรือ /channel line off");
    expect(replies()[2]).toBe(
      [
        "สถานะ Stark: ปกติ",
        "ราคา Bitkub: ปกติ",
        "telegram: เปิด",
        "line: ปิด · ใช้ไป 0/300",
        "discord: ยังไม่ได้ตั้งค่า",
        "email: ยังไม่ได้ตั้งค่า",
      ].join("\n"),
    );
  });
});

const ownerUpdate = (updateId: number, text: string) => ({
  update_id: updateId,
  message: { message_id: updateId, chat: { id: Number(OWNER), type: "private" }, text },
});

describe("TelegramBot: long polling (Bot API getUpdates)", () => {
  it("fetches updates after the last one seen, and handles each", async () => {
    const { bot, http, store } = setup();
    http.willReturn(
      response(200, {
        ok: true,
        result: [{ update_id: 7, message: { message_id: 1, chat: { id: Number(OWNER), type: "private" }, text: "/above BTC/THB 1" } }],
      }),
    );
    http.willReturn(response(200, { ok: true, result: [] })); // the confirmation
    await bot.pollOnce();
    expect(http.requests[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(JSON.parse(http.requests[0]?.request.body ?? "{}")).toEqual({ offset: 0, timeout: 50, allowed_updates: ["message"] });
    expect(http.requests[0]?.request.timeoutMs).toBe(60_000);
    expect(store.rules.size).toBe(1);
    http.willReturn(response(200, { ok: true, result: [] }));
    await bot.pollOnce();
    const getUpdates = http.requests.filter((r) => r.url.endsWith("/getUpdates"));
    expect(JSON.parse(getUpdates[2]?.request.body ?? "{}")).toMatchObject({ offset: 8, timeout: 50 });
  });

  // R-4 (F-005): Telegram forgets an update only when a later getUpdates carries a higher offset (Bot API,
  // getUpdates "offset", read 2026-11-04). Confirming before handling means a restart cannot replay a command.
  it("confirms a batch with Telegram before handling it", async () => {
    const { bot, http, store } = setup();
    http.willReturn(
      response(200, { ok: true, result: [ownerUpdate(7, "/above BTC/THB 1"), ownerUpdate(9, "/above BTC/THB 2")] }),
      response(200, { ok: true, result: [ownerUpdate(10, "/above BTC/THB 3")] }), // a newer one, not handled yet
    );
    expect(await bot.pollOnce()).toEqual({ ok: true });
    expect(http.requests[1]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(http.json(1)).toEqual({ offset: 10, timeout: 0, limit: 1, allowed_updates: ["message"] });
    expect(http.requests[1]?.request.timeoutMs).toBe(10_000);
    expect(http.requests.slice(2).every((r) => r.url.endsWith("/sendMessage"))).toBe(true);
    expect([...store.rules.values()].map((r) => r.kind === "above" && r.level)).toEqual(["1", "2"]);
    http.willReturn(response(200, { ok: true, result: [] }));
    await bot.pollOnce();
    expect(http.json(http.requests.length - 1)).toMatchObject({ offset: 10, timeout: 50 });
  });

  it("handles nothing when the confirmation fails, and asks for the same batch again", async () => {
    const { bot, http, store, events } = setup();
    http.willReturn(
      response(200, { ok: true, result: [ownerUpdate(7, "/above BTC/THB 1")] }),
      new Error(`socket hang up https://api.telegram.org/bot${TOKEN}/getUpdates`),
    );
    expect(await bot.pollOnce()).toEqual({ ok: false, retryAfterSeconds: undefined });
    http.willReturn(response(200, { ok: true, result: [ownerUpdate(7, "/above BTC/THB 1")] }), response(429, { ok: false, parameters: { retry_after: 3 } }));
    expect(await bot.pollOnce()).toEqual({ ok: false, retryAfterSeconds: 3 });
    expect(store.rules.size).toBe(0);
    expect(http.requests.some((r) => r.url.endsWith("/sendMessage"))).toBe(false);
    expect(http.json(2)).toMatchObject({ offset: 0, timeout: 50 });
    expect(events().filter((e) => e === "telegram.confirm_failed")).toHaveLength(2);
  });

  // R-4 (F-006): one update that cannot be handled must not stop the others or the process.
  it("skips an update it cannot handle and goes on with the rest", async () => {
    const { bot, http, store, events } = setup();
    http.willReturn(
      response(200, {
        ok: true,
        result: [null, { update_id: 8, message: { message_id: 1, text: "/rules" } }, ownerUpdate(9, "/above BTC/THB 1")],
      }),
      response(200, { ok: true, result: [] }),
    );
    expect(await bot.pollOnce()).toEqual({ ok: true });
    expect(http.json(1)).toMatchObject({ offset: 10 });
    expect(store.rules.size).toBe(1);
    expect(events()).toContain("telegram.update_failed");
  });

  it("keeps polling after a round fails unexpectedly", async () => {
    const { bot, events } = setup();
    const clock = new FakeClock(new Date(T0));
    let rounds = 0;
    bot.pollOnce = async () => {
      rounds++;
      if (rounds === 1) throw new TypeError("Cannot read properties of undefined");
      return { ok: false, retryAfterSeconds: undefined }; // each later round waits 5 s
    };
    bot.start(clock);
    await clock.advance(0);
    expect(rounds).toBe(1);
    expect(events()).toContain("telegram.loop_failed");
    await clock.advance(4_999);
    expect(rounds).toBe(1);
    await clock.advance(1);
    expect(rounds).toBe(2);
    bot.stop();
  });

  it("reports a failed poll without its URL, which holds the token (T-19)", async () => {
    const { bot, http, events } = setup();
    http.willReturn(new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/getUpdates`));
    expect(await bot.pollOnce()).toEqual({ ok: false, retryAfterSeconds: undefined });
    http.willReturn(response(429, { ok: false, parameters: { retry_after: 9 } }));
    expect(await bot.pollOnce()).toEqual({ ok: false, retryAfterSeconds: 9 });
    expect(events()).toContain("telegram.poll_failed");
  });
});
