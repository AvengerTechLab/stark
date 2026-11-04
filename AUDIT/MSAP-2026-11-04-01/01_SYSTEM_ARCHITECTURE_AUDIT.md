# 01 — System architecture (reconstructed from `main` @ `b1c922d`)

Reconstructed from the code, then compared with `ARCHITECTURE.md`, `EVENTS.md`, `API.md` and `DATABASE.md`.
Evidence references (E-nnn) are in 04.

## 1. System context

One Node.js 22 process (`src/index.ts`) on one Linux VPS (D-56), with PostgreSQL 16 on the same host. It has no
inbound port: the owner page listens on 127.0.0.1:8080 by default (`src/config.ts`) and is reached by SSH tunnel
(D-53). Outbound only:

| External system | Direction | Code |
|---|---|---|
| Bitkub (WSS stream, REST ticker, symbols) | in (data) | `src/feeds/bitkub.ts`, `pairs.ts` |
| Binance market-data hosts (WSS trades, REST price, exchangeInfo) | in (data) | `src/feeds/binance.ts`, `pairs.ts` |
| Telegram Bot API (sendMessage, getUpdates) | out, and long-poll in | `src/channels/telegram.ts`, `src/interface/telegram-bot.ts` |
| LINE Messaging API, Discord webhook, Gmail API + Google token endpoint | out | `src/channels/*.ts` |
| Uptime monitor (Healthchecks, D-57) | out (GET ping) | `src/app/heartbeat.ts` |
| Cloudflare R2 (restic), second Healthchecks check | out, separate process | `src/backup/`, `deploy/stark-backup.*` |

## 2. Layers and ownership

| Layer | Modules | Responsibility | Depends on |
|---|---|---|---|
| Domain | `domain/decimal`, `rules`, `rule-input`, `message`, `thai-time` | Exact decimals, rule evaluation, input validation, alert text. Pure: no I/O, clock or randomness | `ports` (type-only: `ChannelName`) |
| Ports | `ports/feed`, `channel`, `storage`, `owner` | Interfaces between layers | `domain` (type-only) |
| Application | `app/pipeline`, `dispatcher`, `health`, `heartbeat`, `owner-service`, `price-board`, `stark` | Tick → decision → dispatch; health; owner actions; composition root (`stark.ts`) | domain, ports, feeds, channels, interface (composition root only) |
| Adapters | `feeds/*`, `channels/*`, `storage/postgres` | Providers, channels, PostgreSQL | ports, domain |
| Interface | `interface/http-server`, `web`, `telegram-bot`, `password` | Owner web page and API, Telegram commands | app (`OwnerService`, types), channels (Telegram adapter for replies) |
| Entry points | `index.ts`, `backup/main.ts` | Build the real world and start | everything |

Dependency direction matches `ARCHITECTURE.md` §1 (E-020). Two small observations, not findings: `domain` ↔ `ports`
form a type-only import cycle (no runtime effect), and `backup/` reuses `feeds/node-network.ts` for its HTTP GET.

## 3. Runtime flow (representative: a price alert)

```
StreamFeed (WSS; REST poll 1/s while disconnected)        src/feeds/stream-feed.ts
  → onTick: health.tickSeen, board.update, pipeline.receive  src/app/stark.ts L130-134
  → hold last tick per pair per second; flush every 250 ms   src/app/pipeline.ts L45-77
  → serial queue: price_ticks INSERT                          pipeline.ts L83-88
  → late (>10 s) ticks stored, not evaluated                  pipeline.ts L89-92
  → rulesFor(pair) → evaluateRule (pure)                      pipeline.ts L94-120, domain/rules.ts
  → saveResult: rule state + decision in one transaction      storage/postgres.ts L303-324
  → dispatcher (not awaited): per channel, serial queue       app/dispatcher.ts L74-82
      idempotency by alert id → skip reasons (off, dead, cooldown 5 min, quota) → send, up to 3 attempts
      → delivery_attempts (+ channel_usage) in one transaction
  → health.channelOutcome                                     dispatcher.ts L160-166
```

Timers (`stark.ts`): pipeline flush 250 ms, health check 30 s, pair lists hourly, maintenance daily, heartbeat
5 minutes. Restart: decisions from the last 24 hours are re-dispatched; idempotency skips finished channels
(`stark.ts` L228-233).

Owner flows: the web API (`http-server.ts`) and Telegram commands (`telegram-bot.ts`) both go through
`OwnerService` (`owner-service.ts`), which validates with `domain/rule-input.ts` and writes rule + owner action in
one transaction (`postgres.ts` L246-301).

## 4. State

| State | Where | Lifetime |
|---|---|---|
| Rules, rule state (armed/fired), channels on/off/dead | PostgreSQL `rules`, `rule_channels`, `channel_settings` | Durable |
| Price log | `price_ticks`, daily partitions, 35 days (D-34) | Dropped daily |
| Decisions, attempts, usage, health events, owner actions, sessions, failed logins | PostgreSQL | Durable, no retention (F-011) |
| Held ticks, last released second per pair | Pipeline memory | Process |
| Health conditions, quota reports | `HealthMonitor` memory | Process |
| Latest prices | `PriceBoard` memory | Process |
| Telegram update offset, pending /delete | `TelegramBot` memory | Process (F-005) |
| Gmail access token | Adapter memory | Process |

## 5. Subsystem answers (MSAP §10)

| Subsystem | Failure behaviour | Verification |
|---|---|---|
| Feeds | Reconnect with backoff 1 s → 60 s; REST polling while down; rate limits obeyed. A silent open socket is not detected (F-001) | `test/feeds/` (fakes), probe P-01 |
| Pipeline | Storage error → tick logged and dropped, not evaluated; rule error → state unchanged | `test/app/pipeline.test.ts` |
| Dispatcher | 3 attempts, waits 1 s/2 s or Retry-After (no cap, F-007); dead channel marked; idempotent by alert id | `test/app/dispatcher.test.ts` |
| Health | Feeds stale, channels failing, quotas, disk; not the database (F-002) | `test/app/health.test.ts`, e2e |
| Owner interface | Argon2id, hashed sessions, lockout, Origin check, CSP, body limit | `test/interface/` |
| Storage | Parameterised SQL, transactions, partitioned price log | `test/storage/` (real PostgreSQL) |
| Backup | Separate oneshot: dump → restic → prune → check → ping, `/fail` on any failure | `test/backup/`; installed and run once (TASKS S6-15) |
