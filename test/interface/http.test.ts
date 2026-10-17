import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HealthMonitor } from "../../src/app/health.js";
import { OwnerService } from "../../src/app/owner-service.js";
import { PriceBoard } from "../../src/app/price-board.js";
import { ownerHandler } from "../../src/interface/http-server.js";
import { createLogger } from "../../src/logger.js";
import { FakeChannel } from "../fakes/fake-channel.js";
import { FakeAlertQuery, FakeChannelAdmin, FakeRuleAdmin, FakeSessionStore } from "../fakes/fake-owner-storage.js";
import { FakeChannelSettings, FakeDeliveryLog, FakeHealthLog, FakeRuleStore } from "../fakes/fake-storage.js";

// A made-up test password and its Argon2id hash; not a real credential. Prices are demo values.
const PASSWORD = "demo-password";
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$jEXthTpqW6vxp4kg3B7YPo8aY3N5KSs0V54IVOSCfYk";
const T0 = Date.parse("2026-10-16T07:00:00.000Z");
const MINUTE = 60_000;
const listed = new Set(["BTC/THB", "ETH/THB", "BTC/USDT"]);

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers = [];
});

async function setup() {
  const clock = { now: new Date(T0) };
  const store = new FakeRuleStore();
  const settings = new FakeChannelSettings("telegram", "line", "discord", "email");
  const deliveries = new FakeDeliveryLog();
  const sessions = new FakeSessionStore();
  const notices: string[] = [];
  let next = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
  const service = new OwnerService({
    rules: new FakeRuleAdmin(store),
    channels: new FakeChannelAdmin(settings),
    isListed: (pair) => listed.has(pair),
    newId,
    now: () => clock.now,
  });
  const logger = createLogger({ level: "error", write: () => undefined });
  const health = new HealthMonitor({
    exchanges: ["bitkub", "binance"],
    channels: [new FakeChannel("telegram")],
    settings,
    log: new FakeHealthLog(),
    diskFree: async () => 0.5,
    now: () => clock.now,
    newId,
    logger,
  });
  const prices = new PriceBoard();
  prices.update({ exchange: "bitkub", pair: "BTC/THB", price: "100", exchangeTime: new Date(T0), source: "stream" }, new Date(T0));
  const handler = ownerHandler({
    service,
    sessions,
    alerts: new FakeAlertQuery(store, deliveries),
    deliveries,
    configured: ["telegram", "line"],
    health: () => health.snapshot(),
    prices,
    pairs: { list: (quote) => [...listed].filter((p) => p.endsWith(`/${quote}`)) },
    passwordHash: HASH,
    notifyOwner: async (text) => {
      notices.push(text);
    },
    now: () => clock.now,
    logger,
  });
  const server = createServer((req, res) => void handler(req, res));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const base = `http://${host}`;
  let cookie = "";

  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...(cookie !== "" && { cookie }), ...extra };
    if (method !== "GET" && !("origin" in extra)) headers["origin"] = base;
    if (body !== undefined && !("content-type" in extra)) headers["content-type"] = "application/json";
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie !== null) cookie = setCookie.split(";")[0] ?? "";
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, headers: response.headers, text, json: json as Record<string, unknown>, setCookie };
  };
  const login = () => call("POST", "/api/v1/session", { password: PASSWORD });
  return { call, login, clock, sessions, notices, store, settings, deliveries, health, base, host, setCookie: (c: string) => (cookie = c) };
}

describe("owner HTTP API: public endpoints and headers", () => {
  it("answers /healthz without login, and 503 when Stark is degraded", async () => {
    const { call, clock } = await setup();
    expect(await call("GET", "/healthz")).toMatchObject({ status: 200, text: "ok" });
    clock.now = new Date(T0 + 61_000); // no tick for over 60 s: the feeds are stale
    expect(await call("GET", "/healthz")).toMatchObject({ status: 503, text: "degraded" });
  });

  it("sends the security headers on every response (SECURITY.md T-05)", async () => {
    const { call } = await setup();
    for (const path of ["/healthz", "/api/v1/rules", "/"]) {
      const { headers } = await call("GET", path);
      expect(headers.get("content-security-policy")).toBe(
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("referrer-policy")).toBe("no-referrer");
      expect(headers.get("cache-control")).toBe("no-store");
    }
  });

  it("serves the web page with no inline script, and its script and style", async () => {
    const { call } = await setup();
    const page = await call("GET", "/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.text).toContain('<script src="/app.js" defer></script>');
    expect(page.text.match(/<script/g)).toHaveLength(1);
    expect(page.text).not.toMatch(/ on[a-z]+=/);
    const script = await call("GET", "/app.js");
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(script.text).not.toContain("innerHTML");
    expect((await call("GET", "/app.css")).headers.get("content-type")).toBe("text/css; charset=utf-8");
  });
});

describe("owner HTTP API: login (API.md §1.1)", () => {
  it("refuses every endpoint without a session", async () => {
    const { call } = await setup();
    const response = await call("GET", "/api/v1/rules");
    expect(response.status).toBe(401);
    expect(response.json).toEqual({ error: { code: "UNAUTHENTICATED", message: "log in first" } });
  });

  it("logs in with the right password: a fresh random session, stored only as a hash, in a strict cookie", async () => {
    const { login, call, sessions, notices } = await setup();
    const first = await login();
    expect(first.status).toBe(204);
    expect(first.setCookie).toMatch(/^stark_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict$/);
    const id = (first.setCookie ?? "").split(";")[0]?.split("=")[1] ?? "";
    expect([...sessions.sessions.keys()]).toEqual([createHash("sha256").update(id).digest("hex")]);
    expect(sessions.sessions.get(createHash("sha256").update(id).digest("hex"))?.expiresAt).toEqual(new Date(T0 + 7 * 24 * 60 * MINUTE));
    expect((await call("GET", "/api/v1/rules")).status).toBe(200);
    expect(notices).toEqual(["[Stark] มีการเข้าสู่ระบบหน้าเว็บ เวลา 14:00:00 น."]);
    const second = await login();
    expect(second.setCookie).not.toBe(first.setCookie);
  });

  it("refuses a wrong password and records the failure", async () => {
    const { call, sessions } = await setup();
    const response = await call("POST", "/api/v1/session", { password: "wrong" });
    expect(response.status).toBe(401);
    expect(response.json).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(sessions.failures).toHaveLength(1);
  });

  it("locks logins for 15 minutes after 5 wrong passwords in 15 minutes, and tells the PO", async () => {
    const { call, login, clock, notices } = await setup();
    for (let i = 0; i < 5; i++) {
      clock.now = new Date(T0 + i * MINUTE);
      expect((await call("POST", "/api/v1/session", { password: "wrong" })).status).toBe(401);
    }
    expect(notices).toEqual(["[Stark] ใส่รหัสผ่านหน้าเว็บผิด 5 ครั้งใน 15 นาที ล็อกการเข้าสู่ระบบ 15 นาที"]);
    clock.now = new Date(T0 + 18 * MINUTE + 59_000);
    const locked = await login();
    expect(locked.status).toBe(429);
    expect(locked.json).toMatchObject({ error: { code: "LOGIN_LOCKED" } });
    clock.now = new Date(T0 + 19 * MINUTE);
    expect((await login()).status).toBe(204);
  });

  it("logs out by deleting the session and clearing the cookie", async () => {
    const { login, call, sessions } = await setup();
    await login();
    const out = await call("DELETE", "/api/v1/session");
    expect(out.status).toBe(204);
    expect(out.setCookie).toBe("stark_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
    expect(sessions.sessions.size).toBe(0);
    expect((await call("GET", "/api/v1/rules")).status).toBe(401);
  });

  it("refuses an expired session", async () => {
    const { login, call, clock } = await setup();
    await login();
    clock.now = new Date(T0 + 7 * 24 * 60 * MINUTE);
    expect((await call("GET", "/api/v1/rules")).status).toBe(401);
  });

  it("refuses a state-changing request without a matching Origin (SECURITY.md T-04)", async () => {
    const { login, call } = await setup();
    await login();
    const missing = await call("POST", "/api/v1/rules", {}, { origin: "" });
    expect(missing.status).toBe(403);
    expect(missing.json).toMatchObject({ error: { code: "ORIGIN_INVALID" } });
    expect((await call("DELETE", "/api/v1/session", undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/api/v1/session", { password: PASSWORD }, { origin: "null" })).status).toBe(403);
  });
});

describe("owner HTTP API: rules (API.md §1.2–1.4)", () => {
  const above = { kind: "above", pair: "BTC/THB", level: "3500000", channels: ["telegram"] };

  it("creates, lists, changes and deletes a rule", async () => {
    const { login, call } = await setup();
    await login();
    const created = await call("POST", "/api/v1/rules", above);
    expect(created.status).toBe(201);
    const rule = created.json as { id: string };
    expect(created.json).toEqual({ ...above, id: rule.id, enabled: true, state: "armed" });
    expect((await call("GET", "/api/v1/rules")).json).toEqual([created.json]);
    expect((await call("PATCH", `/api/v1/rules/${rule.id}`, { enabled: false })).json).toMatchObject({ enabled: false });
    expect((await call("DELETE", `/api/v1/rules/${rule.id}`)).status).toBe(204);
    expect((await call("DELETE", `/api/v1/rules/${rule.id}`)).json).toEqual({ error: { code: "NOT_FOUND", message: "no such rule" } });
    expect((await call("PATCH", `/api/v1/rules/${rule.id}`, { enabled: true })).status).toBe(404);
  });

  it("answers an invalid rule with 400, the first error's code, and every error in details", async () => {
    const { login, call } = await setup();
    await login();
    const response = await call("POST", "/api/v1/rules", { ...above, level: 3500000, channels: [] });
    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      error: {
        code: "LEVEL_INVALID",
        message: expect.any(String),
        details: [
          { field: "level", code: "LEVEL_INVALID", message: expect.any(String) },
          { field: "channels", code: "CHANNELS_INVALID", message: expect.any(String) },
        ],
      },
    });
  });

  it("refuses a body that is not JSON, not sent as JSON, or too large", async () => {
    const { login, call } = await setup();
    await login();
    expect((await call("POST", "/api/v1/rules", "{not json")).json).toMatchObject({ error: { code: "BODY_INVALID" } });
    expect((await call("POST", "/api/v1/rules", JSON.stringify(above), { "content-type": "text/plain" })).status).toBe(400);
    // A valid rule padded past 16 KB with whitespace: only the size limit can refuse it.
    const huge = JSON.stringify(above) + " ".repeat(20_000);
    expect((await call("POST", "/api/v1/rules", huge)).json).toMatchObject({ error: { code: "BODY_INVALID" } });
  });
});

describe("owner HTTP API: channels, prices, pairs, alerts, health", () => {
  it("lists channels with configuration, switch, dead state and this period's usage", async () => {
    const { login, call, deliveries, settings } = await setup();
    await login();
    deliveries.setUsage("line", "2026-10-01", 12);
    deliveries.setUsage("email", "2026-10-16", 3);
    settings.dead.set("discord", new Date(T0));
    const list = (await call("GET", "/api/v1/channels")).json as unknown as Record<string, unknown>[];
    expect(list).toEqual([
      { name: "telegram", configured: true, enabled: true, deadSince: null, usage: null },
      { name: "line", configured: true, enabled: true, deadSince: null, usage: { period: "2026-10-01", sent: 12, limit: 300 } },
      { name: "discord", configured: false, enabled: true, deadSince: new Date(T0).toISOString(), usage: null },
      { name: "email", configured: false, enabled: true, deadSince: null, usage: { period: "2026-10-16", sent: 3, limit: 400 } },
    ]);
    expect((await call("PATCH", "/api/v1/channels/line", { enabled: false })).json).toMatchObject({ name: "line", enabled: false });
    expect((await call("PATCH", "/api/v1/channels/sms", { enabled: false })).status).toBe(404);
    expect((await call("PATCH", "/api/v1/channels/line", { enabled: "no" })).status).toBe(400);
  });

  it("shows the latest prices and the listed pairs for a quote", async () => {
    const { login, call } = await setup();
    await login();
    expect((await call("GET", "/api/v1/prices")).json).toEqual([
      { exchange: "bitkub", pair: "BTC/THB", price: "100", exchangeTime: new Date(T0).toISOString(), receivedTime: new Date(T0).toISOString(), ageSeconds: 0 },
    ]);
    expect((await call("GET", "/api/v1/pairs?quote=THB")).json).toEqual(["BTC/THB", "ETH/THB"]);
    expect((await call("GET", "/api/v1/pairs?quote=EUR")).status).toBe(400);
  });

  it("lists alert decisions in a time range, 24 hours by default, refusing a bad range", async () => {
    const { login, call, store } = await setup();
    await login();
    store.decisions.push({
      id: "d1",
      ruleId: "r1",
      tickId: "t1",
      price: "100",
      referencePrice: null,
      changePercent: null,
      decidedAt: new Date(T0 - MINUTE),
      channels: ["telegram"],
      message: "[Stark] demo",
    });
    expect((await call("GET", "/api/v1/alerts")).json).toEqual([
      expect.objectContaining({ decision: expect.objectContaining({ id: "d1" }), attempts: [] }),
    ]);
    expect((await call("GET", `/api/v1/alerts?from=${new Date(T0).toISOString()}`)).json).toEqual([]);
    expect((await call("GET", "/api/v1/alerts?from=yesterday")).status).toBe(400);
    expect((await call("GET", "/api/v1/alerts?from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z")).status).toBe(400);
  });

  it("shows health in detail and answers unknown paths with 404", async () => {
    const { login, call } = await setup();
    await login();
    expect((await call("GET", "/api/v1/health")).json).toMatchObject({ degraded: false, feeds: expect.any(Array) });
    expect((await call("GET", "/api/v1/nothing")).json).toEqual({ error: { code: "NOT_FOUND", message: "no such endpoint" } });
  });
});
