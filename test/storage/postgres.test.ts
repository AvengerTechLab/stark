import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Dispatcher } from "../../src/app/dispatcher.js";
import { DecisionPipeline } from "../../src/app/pipeline.js";
import type { ChangeRule, LevelRule } from "../../src/domain/rules.js";
import { createLogger } from "../../src/logger.js";
import type { AlertDecision, PriceTick } from "../../src/ports/storage.js";
import {
  dropExpiredPartitions,
  ensurePartitions,
  migrate,
  PgAlertQuery,
  PgChannelSettings,
  PgDeliveryLog,
  PgHealthLog,
  PgPriceLog,
  PgRuleStore,
  PgSessionStore,
} from "../../src/storage/postgres.js";
import type { OwnerAction } from "../../src/ports/owner.js";
import { FakeChannel } from "../fakes/fake-channel.js";
import { TEST_DATABASE_URL, testPool } from "./database.js";

// Demo prices and times; not market data.
const T0 = Date.parse("2026-10-16T05:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms);
const DAY = 86_400_000;
const silent = createLogger({ level: "error", write: () => undefined });

it("runs against a real PostgreSQL in CI (DATABASE.md, S6-6)", () => {
  if (process.env["CI"] !== undefined) expect(TEST_DATABASE_URL).toBeDefined();
});

describe.skipIf(TEST_DATABASE_URL === undefined)("PostgreSQL storage", () => {
  let pool: pg.Pool;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ pool, close } = await testPool());
    await migrate(pool);
  });
  afterAll(async () => close());

  const tick = (extra: Partial<PriceTick> = {}): PriceTick => ({
    id: randomUUID(),
    exchange: "bitkub",
    pair: "BTC/THB",
    price: "100",
    exchangeTime: at(0),
    receivedTime: at(0),
    source: "stream",
    ...extra,
  });

  const levelRule = (extra: Partial<LevelRule> = {}): LevelRule => ({
    id: randomUUID(),
    pair: "BTC/THB",
    kind: "above",
    level: "3500000.5",
    channels: ["email", "telegram"],
    enabled: true,
    state: "armed",
    ...extra,
  });

  const decisionFor = (ruleId: string, extra: Partial<AlertDecision> = {}): AlertDecision => ({
    id: randomUUID(),
    ruleId,
    tickId: randomUUID(),
    price: "100",
    referencePrice: null,
    changePercent: null,
    decidedAt: at(0),
    channels: ["telegram"],
    message: "[Stark] demo",
    ...extra,
  });

  describe("migrations", () => {
    it("applies each migration once and records it", async () => {
      expect(await migrate(pool)).toEqual([]);
      const { rows } = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
      expect(rows.map((r) => r.version)).toEqual(["001_initial"]);
    });
  });

  describe("price log", () => {
    it("finds the last stored price at or before a time, for that exchange and pair only, at full precision", async () => {
      const log = new PgPriceLog(pool);
      await log.append(tick({ price: "100.123456789012345678901234567890", exchangeTime: at(-2000) }));
      await log.append(tick({ price: "101", exchangeTime: at(-1000) }));
      await log.append(tick({ price: "999", exchangeTime: at(1000) }));
      await log.append(tick({ exchange: "binance", pair: "BTC/USDT", price: "5", exchangeTime: at(-500) }));
      await log.append(tick({ pair: "ETH/THB", price: "7", exchangeTime: at(-500) }));

      expect(await log.priceAtOrBefore("bitkub", "BTC/THB", at(-1000))).toBe("101");
      expect(await log.priceAtOrBefore("bitkub", "BTC/THB", at(-1001))).toBe("100.123456789012345678901234567890");
      expect(await log.priceAtOrBefore("bitkub", "BTC/THB", at(-3000))).toBeUndefined();
      expect(await log.priceAtOrBefore("binance", "BTC/USDT", at(0))).toBe("5");
    });

    it("creates a missing day's partition on first write", async () => {
      const log = new PgPriceLog(pool);
      await log.append(tick({ exchangeTime: at(40 * DAY), price: "1" }));
      expect(await log.priceAtOrBefore("bitkub", "BTC/THB", at(40 * DAY))).toBe("1");
    });

    it("drops whole days older than the 35-day retention and keeps the rest (D-34)", async () => {
      // now is 2026-10-16 05:00 UTC, so the cutoff is 2026-09-11 05:00: the day of 2026-09-10 ends before it.
      await ensurePartitions(pool, at(-40 * DAY), 7);
      const dropped = await dropExpiredPartitions(pool, at(0));
      expect(dropped).toEqual([
        "price_ticks_20260906",
        "price_ticks_20260907",
        "price_ticks_20260908",
        "price_ticks_20260909",
        "price_ticks_20260910",
      ]);
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'price_ticks_20260911'",
      );
      expect(rows[0].n).toBe(1);
    });
  });

  describe("rules", () => {
    it("returns the rules of a pair as they were created, channels in a fixed order", async () => {
      const store = new PgRuleStore(pool);
      const level = levelRule({ pair: "SOL/THB" });
      const change: ChangeRule = {
        id: randomUUID(),
        pair: "SOL/THB",
        kind: "change",
        percent: "2.5",
        windowMinutes: 60,
        direction: "either",
        channels: ["line"],
        enabled: false,
        state: "fired",
      };
      await store.create(level);
      await store.create(change);
      await store.create(levelRule({ pair: "SOL/USDT" }));

      const rules = await store.rulesFor("SOL/THB");
      expect(rules).toHaveLength(2);
      expect(rules.find((r) => r.id === level.id)).toEqual({ ...level, channels: ["telegram", "email"] });
      expect(rules.find((r) => r.id === change.id)).toEqual({ ...change, percent: "2.50" });
    });

    it("refuses a row the contract forbids, such as a level on a change rule or THB on Binance", async () => {
      const store = new PgRuleStore(pool);
      await expect(
        pool.query(
          `INSERT INTO rules (id, exchange, base, quote, kind, level, percent, window_minutes, direction, enabled, state)
           VALUES ($1, 'binance', 'BTC', 'USDT', 'change', 1, 5, 60, 'up', true, 'armed')`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
      await expect(store.create(levelRule({ pair: "BTC/EUR" }))).rejects.toThrow();
    });

    it("saves a rule's state and its decision together, or neither", async () => {
      const store = new PgRuleStore(pool);
      const rule = levelRule({ pair: "ADA/THB" });
      await store.create(rule);
      const decision = decisionFor(rule.id);
      await store.saveResult(rule.id, "fired", decision);
      expect((await store.rulesFor("ADA/THB"))[0]?.state).toBe("fired");

      // The same decision ID again fails, so the state change must roll back too.
      await expect(store.saveResult(rule.id, "armed", decision)).rejects.toThrow();
      expect((await store.rulesFor("ADA/THB"))[0]?.state).toBe("fired");
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM alert_decisions WHERE rule_id = $1", [rule.id]);
      expect(rows[0].n).toBe(1);
    });
  });

  describe("channel settings", () => {
    it("starts with every channel on, switches one off, and keeps the first time a channel died", async () => {
      const settings = new PgChannelSettings(pool);
      expect([...(await settings.switchedOn())].sort()).toEqual(["discord", "email", "line", "telegram"]);
      await settings.setEnabled("line", false);
      expect((await settings.switchedOn()).has("line")).toBe(false);

      expect(await settings.isDead("discord")).toBe(false);
      await settings.markDead("discord", at(0));
      await settings.markDead("discord", at(1000));
      expect(await settings.isDead("discord")).toBe(true);
      const { rows } = await pool.query("SELECT dead_since FROM channel_settings WHERE channel = 'discord'");
      expect(rows[0].dead_since).toEqual(at(0));
      await settings.setEnabled("line", true);
    });
  });

  describe("delivery log", () => {
    it("records attempts in order, refuses a repeated attempt number, and counts only delivered sends", async () => {
      const rules = new PgRuleStore(pool);
      const deliveries = new PgDeliveryLog(pool);
      const rule = levelRule({ pair: "DOT/THB" });
      await rules.create(rule);
      const decision = decisionFor(rule.id);
      await rules.saveResult(rule.id, "fired", decision);

      const attempt = (n: number, status: "failed" | "delivered", ms: number) => ({
        alertId: decision.id,
        channel: "line" as const,
        attempt: n,
        status,
        reason: status === "failed" ? "http_500" : null,
        at: at(ms),
      });
      await deliveries.record(attempt(1, "failed", 0), rule.id, "2026-10-01");
      await deliveries.record(attempt(2, "delivered", 1000), rule.id, "2026-10-01");
      await expect(deliveries.record(attempt(2, "delivered", 2000), rule.id, "2026-10-01")).rejects.toThrow();

      expect((await deliveries.attempts(decision.id, "line")).map((a) => [a.attempt, a.status])).toEqual([
        [1, "failed"],
        [2, "delivered"],
      ]);
      expect(await deliveries.usage("line", "2026-10-01")).toBe(1);
      // A later failed attempt of another decision of the same rule does not move the cooldown.
      const later = decisionFor(rule.id);
      await rules.saveResult(rule.id, "fired", later);
      await deliveries.record({ ...attempt(1, "failed", 5000), alertId: later.id }, rule.id, "2026-10-01");
      expect(await deliveries.lastDelivered(rule.id, "line")).toEqual(at(1000));
      expect(await deliveries.lastDelivered(rule.id, "telegram")).toBeUndefined();
    });

    it("refuses an attempt whose rule does not match its decision", async () => {
      const rules = new PgRuleStore(pool);
      const rule = levelRule({ pair: "XRP/THB" });
      await rules.create(rule);
      const decision = decisionFor(rule.id);
      await rules.saveResult(rule.id, "fired", decision);
      const attempt = { alertId: decision.id, channel: "line" as const, attempt: 1, status: "delivered" as const, reason: null, at: at(0) };
      await expect(new PgDeliveryLog(pool).record(attempt, randomUUID(), "2026-10-01")).rejects.toThrow();
    });
  });

  describe("owner interface stores (API.md, SECURITY.md T-22)", () => {
    const action = (name: string, subject: string): OwnerAction => ({
      id: randomUUID(),
      at: at(0),
      source: "web",
      action: name,
      subject,
      detail: { demo: true },
    });
    const actionsFor = async (subject: string) =>
      (await pool.query("SELECT action, source, detail FROM owner_actions WHERE subject = $1 ORDER BY at, action", [subject])).rows;

    it("lists, gets, updates and removes rules, recording each change with the change", async () => {
      const store = new PgRuleStore(pool);
      const rule = levelRule({ pair: "AVAX/THB", channels: ["telegram"] });
      await store.create(rule, action("rule.created", rule.id));
      expect((await store.list()).some((r) => r.id === rule.id)).toBe(true);
      expect(await store.get(rule.id)).toEqual(rule);

      const changed: ChangeRule = {
        id: rule.id,
        pair: "AVAX/THB",
        kind: "change",
        percent: "3",
        windowMinutes: 15,
        direction: "down",
        channels: ["line", "discord"],
        enabled: false,
        state: "armed",
      };
      expect(await store.update(changed, action("rule.updated", rule.id))).toBe(true);
      expect(await store.get(rule.id)).toEqual({ ...changed, percent: "3.00", channels: ["line", "discord"] });
      expect(await store.update({ ...changed, id: randomUUID() }, action("rule.updated", "x"))).toBe(false);

      const decision = decisionFor(rule.id);
      await store.saveResult(rule.id, "armed", decision);
      expect(await store.remove(rule.id, action("rule.deleted", rule.id))).toBe(true);
      expect(await store.get(rule.id)).toBeUndefined();
      expect(await store.remove(rule.id, action("rule.deleted", rule.id))).toBe(false);
      const kept = await pool.query("SELECT count(*)::int AS n FROM alert_decisions WHERE id = $1", [decision.id]);
      expect(kept.rows[0].n).toBe(1);
      expect((await actionsFor(rule.id)).map((r) => r.action)).toEqual(["rule.created", "rule.deleted", "rule.updated"]);
    });

    it("does not record an action for a change that fails", async () => {
      const store = new PgRuleStore(pool);
      const rule = levelRule({ pair: "NEAR/THB" });
      await store.create(rule);
      // The table refuses a level of 0 (DATABASE.md), so the update fails and its action must not be kept.
      await expect(store.update({ ...rule, level: "0" }, action("rule.updated", rule.id))).rejects.toThrow();
      expect(await actionsFor(rule.id)).toEqual([]);
    });

    it("lists channels with their dead time and switches one, with its action", async () => {
      const settings = new PgChannelSettings(pool);
      await settings.setEnabled("email", false, action("channel.switched_off", "email"));
      const list = await settings.list();
      expect(list.map((c) => c.channel)).toEqual(["telegram", "line", "discord", "email"]);
      expect(list.find((c) => c.channel === "email")?.enabled).toBe(false);
      expect(list.find((c) => c.channel === "discord")?.deadSince).toEqual(at(0));
      expect(await actionsFor("email")).toEqual([{ action: "channel.switched_off", source: "web", detail: { demo: true } }]);
      await settings.setEnabled("email", true, action("channel.switched_on", "email"));
    });

    it("keeps sessions by hash until they expire, and failed logins by time", async () => {
      const sessions = new PgSessionStore(pool);
      await sessions.create("hash-1", at(0), at(1000));
      expect(await sessions.isValid("hash-1", at(999))).toBe(true);
      expect(await sessions.isValid("hash-1", at(1000))).toBe(false);
      expect(await sessions.isValid("hash-2", at(0))).toBe(false);
      await sessions.remove("hash-1");
      expect(await sessions.isValid("hash-1", at(0))).toBe(false);

      await sessions.recordFailedLogin(at(-5000));
      await sessions.recordFailedLogin(at(-1000));
      expect(await sessions.failedLoginsSince(at(-2000))).toEqual([at(-1000)]);
    });

    it("returns decisions in a time range, newest first, with their attempts", async () => {
      const rules = new PgRuleStore(pool);
      const deliveries = new PgDeliveryLog(pool);
      const rule = levelRule({ pair: "ATOM/THB" });
      await rules.create(rule);
      const early = decisionFor(rule.id, { decidedAt: at(10_000_000) });
      const late = decisionFor(rule.id, { decidedAt: at(10_001_000) });
      await rules.saveResult(rule.id, "fired", early);
      await rules.saveResult(rule.id, "fired", late);
      await deliveries.record(
        { alertId: late.id, channel: "telegram", attempt: 1, status: "delivered", reason: null, at: at(10_001_500) },
        rule.id,
        null,
      );
      const found = await new PgAlertQuery(pool).decisions(at(10_000_000), at(10_002_000), 10);
      expect(found.map((d) => d.decision.id)).toEqual([late.id, early.id]);
      expect(found[0]?.decision).toEqual(late);
      expect(found[0]?.attempts.map((a) => a.status)).toEqual(["delivered"]);
      expect(found[1]?.attempts).toEqual([]);
      expect(await new PgAlertQuery(pool).decisions(at(10_000_001), at(10_002_000), 1)).toHaveLength(1);
    });
  });

  describe("health log", () => {
    it("stores each reported health event", async () => {
      const id = randomUUID();
      await new PgHealthLog(pool).record({ id, kind: "feed_stale", subject: "bitkub", since: at(0), reportedAt: at(6 * 60_000) });
      const { rows } = await pool.query("SELECT kind, subject, since, reported_at FROM health_events WHERE id = $1", [id]);
      expect(rows).toEqual([{ kind: "feed_stale", subject: "bitkub", since: at(0), reported_at: at(6 * 60_000) }]);
    });
  });

  describe("the pipeline and dispatcher on PostgreSQL", () => {
    it("turns a tick into a stored decision and a recorded delivery", async () => {
      const rules = new PgRuleStore(pool);
      const deliveries = new PgDeliveryLog(pool);
      const settings = new PgChannelSettings(pool);
      const rule = levelRule({ pair: "LINK/THB", level: "100", channels: ["telegram"] });
      await rules.create(rule);

      const telegram = new FakeChannel("telegram");
      const dispatcher = new Dispatcher({
        channels: [telegram],
        settings,
        deliveries,
        logger: silent,
        now: () => at(2000),
        sleep: async () => undefined,
      });
      const sends: Promise<void>[] = [];
      const pipeline = new DecisionPipeline({
        priceLog: new PgPriceLog(pool),
        rules,
        channels: settings,
        logger: silent,
        now: () => at(1500),
        newId: randomUUID,
        onDecision: (d) => {
          sends.push(dispatcher.dispatch(d));
        },
      });
      pipeline.receive({ exchange: "bitkub", pair: "LINK/THB", price: "100", exchangeTime: at(0), source: "stream" });
      await pipeline.flush();
      await Promise.all(sends);

      expect(telegram.sent).toHaveLength(1);
      expect(telegram.sent[0]?.text.split("\n")[0]).toBe("[Stark] LINK/THB สูงกว่า 100 แล้ว");
      expect((await rules.rulesFor("LINK/THB"))[0]?.state).toBe("fired");
      const alertId = telegram.sent[0]?.alertId ?? "";
      expect((await deliveries.attempts(alertId, "telegram")).map((a) => a.status)).toEqual(["delivered"]);
    });
  });
});
