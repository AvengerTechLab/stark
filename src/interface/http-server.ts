// The owner HTTP API and web page (API.md §1), on Node.js's own http module: no web framework is added
// (SECURITY.md T-13). Only the PO can use it (D-10): one password, sessions stored as hashes, logins
// locked after repeated failures, and state-changing requests accepted only from the page's own origin.

import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../logger.js";
import type { ChannelName } from "../ports/channel.js";
import type { AlertQuery, SessionStore } from "../ports/owner.js";
import type { DeliveryLog } from "../ports/storage.js";
import type { HealthSnapshot } from "../app/health.js";
import { channelOverview, type OwnerService, type RuleResult } from "../app/owner-service.js";
import type { PriceBoard } from "../app/price-board.js";
import { thaiClock } from "../domain/thai-time.js";
import { verifyPassword } from "./password.js";
import { APP_CSS, APP_JS, INDEX_HTML } from "./web.js";

export const SESSION_COOKIE = "stark_session";
export const SESSION_MS = 7 * 24 * 60 * 60_000;
export const LOCK_FAILURES = 5;
export const LOCK_WINDOW_MS = 15 * 60_000;
export const MAX_BODY_BYTES = 16 * 1024;
const MAX_ALERT_RANGE_MS = 31 * 24 * 60 * 60_000;
const ALERT_LIMIT = 500;

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

export interface OwnerHttpDeps {
  readonly service: OwnerService;
  readonly sessions: SessionStore;
  readonly alerts: AlertQuery;
  readonly deliveries: Pick<DeliveryLog, "usage">;
  /** Channels with credentials in the configuration (src/config.ts). */
  readonly configured: readonly ChannelName[];
  readonly health: () => HealthSnapshot;
  readonly prices: PriceBoard;
  readonly pairs: { list(quote: "THB" | "USDT"): readonly string[] };
  readonly passwordHash: string;
  /** Tells the PO on Telegram about logins and lockouts (API.md §1.1, SECURITY.md T-22). */
  readonly notifyOwner: (text: string) => Promise<void>;
  readonly now: () => Date;
  readonly logger: Logger;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: readonly unknown[],
  ) {
    super(message);
  }
}

const hashSession = (id: string) => createHash("sha256").update(id).digest("hex");

function cookieHeader(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

function sessionId(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === SESSION_COOKIE && value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  }
  return undefined;
}

/** A state-changing request must come from the page's own origin (SECURITY.md T-04). */
function originMatches(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === "" || origin === "null") return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(400, "BODY_INVALID", "body must be JSON");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(400, "BODY_INVALID", "body is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "BODY_INVALID", "body is not valid JSON");
  }
}

function send(res: ServerResponse, status: number, body: string, type: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": type, ...extra });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8", extra);
}

function ruleResult(res: ServerResponse, result: RuleResult, status: number): void {
  if (result.ok) return sendJson(res, status, result.rule);
  if ("notFound" in result) throw new HttpError(404, "NOT_FOUND", "no such rule");
  const first = result.errors[0];
  throw new HttpError(400, first?.code ?? "BODY_INVALID", first?.message ?? "invalid", result.errors);
}

function parseTime(value: string | null, fallback: Date): Date {
  if (value === null) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new HttpError(400, "BODY_INVALID", "from and to must be ISO 8601 times");
  }
  return new Date(value);
}

/** The request handler; pass it to http.createServer or https.createServer. */
export function ownerHandler(deps: OwnerHttpDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { service, sessions, logger } = deps;

  /** The time logins stay locked until, from the failures of the last 30 minutes (API.md §1.1). */
  async function lockedUntil(now: Date): Promise<number> {
    const failures = await sessions.failedLoginsSince(new Date(now.getTime() - 2 * LOCK_WINDOW_MS));
    let until = 0;
    for (let i = LOCK_FAILURES - 1; i < failures.length; i++) {
      const last = failures[i]?.getTime() ?? 0;
      const first = failures[i - (LOCK_FAILURES - 1)]?.getTime() ?? 0;
      if (last - first <= LOCK_WINDOW_MS) until = Math.max(until, last + LOCK_WINDOW_MS);
    }
    return until;
  }

  async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const now = deps.now();
    if (now.getTime() < (await lockedUntil(now))) throw new HttpError(429, "LOGIN_LOCKED", "too many wrong passwords; try again later");
    const body = await readJson(req);
    const password = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["password"] : undefined;
    if (typeof password !== "string" || !(await verifyPassword(deps.passwordHash, password))) {
      await sessions.recordFailedLogin(now);
      logger.warn("owner.login_failed");
      if ((await lockedUntil(now)) > now.getTime()) {
        logger.warn("owner.login_locked");
        await deps.notifyOwner("[Stark] ใส่รหัสผ่านหน้าเว็บผิด 5 ครั้งใน 15 นาที ล็อกการเข้าสู่ระบบ 15 นาที").catch(() => undefined);
      }
      throw new HttpError(401, "UNAUTHENTICATED", "wrong password");
    }
    const id = randomBytes(32).toString("base64url");
    await sessions.create(hashSession(id), now, new Date(now.getTime() + SESSION_MS));
    logger.info("owner.logged_in");
    await deps.notifyOwner(`[Stark] มีการเข้าสู่ระบบหน้าเว็บ เวลา ${thaiClock(now)} น.`).catch(() => undefined);
    send(res, 204, "", "text/plain; charset=utf-8", { "set-cookie": cookieHeader(id, SESSION_MS / 1000) });
  }

  const channels = () => channelOverview(service, deps.deliveries, deps.configured, deps.now());

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    const path = url.pathname;
    if (method !== "GET" && method !== "HEAD" && !originMatches(req)) {
      throw new HttpError(403, "ORIGIN_INVALID", "request must come from the Stark page");
    }
    if (path === "/api/v1/session" && method === "POST") return login(req, res);

    const id = sessionId(req);
    if (id === undefined || !(await sessions.isValid(hashSession(id), deps.now()))) {
      throw new HttpError(401, "UNAUTHENTICATED", "log in first");
    }
    if (path === "/api/v1/session" && method === "DELETE") {
      await sessions.remove(hashSession(id));
      return send(res, 204, "", "text/plain; charset=utf-8", { "set-cookie": cookieHeader("", 0) });
    }
    if (path === "/api/v1/prices" && method === "GET") return sendJson(res, 200, deps.prices.list(deps.now()));
    if (path === "/api/v1/pairs" && method === "GET") {
      const quote = url.searchParams.get("quote");
      if (quote !== "THB" && quote !== "USDT") throw new HttpError(400, "BODY_INVALID", "quote must be THB or USDT");
      return sendJson(res, 200, deps.pairs.list(quote));
    }
    if (path === "/api/v1/rules" && method === "GET") return sendJson(res, 200, await service.listRules());
    if (path === "/api/v1/rules" && method === "POST") return ruleResult(res, await service.createRule(await readJson(req), "web"), 201);
    const rule = /^\/api\/v1\/rules\/([0-9a-f-]{36})$/.exec(path)?.[1];
    if (rule !== undefined && method === "PATCH") return ruleResult(res, await service.updateRule(rule, await readJson(req), "web"), 200);
    if (rule !== undefined && method === "DELETE") {
      if (!(await service.deleteRule(rule, "web"))) throw new HttpError(404, "NOT_FOUND", "no such rule");
      return send(res, 204, "", "text/plain; charset=utf-8");
    }
    if (path === "/api/v1/channels" && method === "GET") return sendJson(res, 200, await channels());
    const channel = /^\/api\/v1\/channels\/([a-z]+)$/.exec(path)?.[1];
    if (channel !== undefined && method === "PATCH") {
      const body = await readJson(req);
      const enabled = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["enabled"] : undefined;
      if (typeof enabled !== "boolean") throw new HttpError(400, "BODY_INVALID", "enabled must be true or false");
      if (!(await service.setChannel(channel, enabled, "web"))) throw new HttpError(404, "NOT_FOUND", "no such channel");
      return sendJson(res, 200, (await channels()).find((c) => c.name === channel));
    }
    if (path === "/api/v1/alerts" && method === "GET") {
      const now = deps.now();
      // Without `to`, the range ends just after now, so a decision made this millisecond is included.
      const to = parseTime(url.searchParams.get("to"), new Date(now.getTime() + 1));
      const from = parseTime(url.searchParams.get("from"), new Date(to.getTime() - 24 * 60 * 60_000));
      if (from > to || to.getTime() - from.getTime() > MAX_ALERT_RANGE_MS) {
        throw new HttpError(400, "BODY_INVALID", "from must be before to, at most 31 days apart");
      }
      return sendJson(res, 200, await deps.alerts.decisions(from, to, ALERT_LIMIT));
    }
    if (path === "/api/v1/health" && method === "GET") return sendJson(res, 200, deps.health());
    throw new HttpError(404, "NOT_FOUND", "no such endpoint");
  }

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://stark.invalid");
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (req.method !== "GET") return send(res, 404, "not found", "text/plain; charset=utf-8");
      if (url.pathname === "/healthz") {
        const degraded = deps.health().degraded;
        return send(res, degraded ? 503 : 200, degraded ? "degraded" : "ok", "text/plain; charset=utf-8");
      }
      if (url.pathname === "/") return send(res, 200, INDEX_HTML, "text/html; charset=utf-8");
      if (url.pathname === "/app.js") return send(res, 200, APP_JS, "text/javascript; charset=utf-8");
      if (url.pathname === "/app.css") return send(res, 200, APP_CSS, "text/css; charset=utf-8");
      return send(res, 404, "not found", "text/plain; charset=utf-8");
    } catch (error) {
      if (error instanceof HttpError) {
        const body = { code: error.code, message: error.message, ...(error.details !== undefined && { details: error.details }) };
        return sendJson(res, error.status, { error: body });
      }
      // Details go to the server log only (API.md §1.4).
      logger.error("owner.request_failed", { method: req.method, path: url.pathname, error });
      return sendJson(res, 500, { error: { code: "INTERNAL", message: "internal error" } });
    }
  };
}
