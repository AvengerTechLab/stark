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


import { request } from "node:http";

function raw(base: string, path: string, headers: Record<string, string>, body?: string): Promise<{ status: number; text: string }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path, method: body === undefined ? "GET" : "POST", headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe("audit probes MSAP-2026-11-09-01", () => {
  it("P-03: parallel wrong passwords — how many are checked before the lockout applies", async () => {
    const { call, sessions } = await setup();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => call("POST", "/api/v1/session", { password: `wrong-${i}` })));
    const counts: Record<number, number> = {};
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const recorded = (await sessions.failedLoginsSince(new Date(0))).length;
    console.log("P-03 statuses", JSON.stringify(counts), "failures recorded", recorded);
    expect(true).toBe(true);
  }, 60_000);

  it("P-04: a request from a foreign host name (DNS rebinding) passes the Origin check", async () => {
    const { base } = await setup();
    const body = JSON.stringify({ password: "guess" });
    const r = await raw(base, "/api/v1/session", { host: "evil.example:8080", origin: "http://evil.example:8080", "content-type": "application/json", "content-length": String(body.length) }, body);
    const h = await raw(base, "/healthz", { host: "evil.example:8080" });
    console.log("P-04 login from foreign host:", r.status, r.text, "| /healthz:", h.status, h.text.slice(0, 120));
    expect(true).toBe(true);
  });
});
