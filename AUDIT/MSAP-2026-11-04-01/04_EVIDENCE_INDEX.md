# 04 — Evidence index

All paths are in the subject `main` @ `b1c922d` (read from a `git archive` export). Line numbers are for that commit.

| ID | Source | Location | Observation | Supports |
|---|---|---|---|---|
| E-001 | `src/feeds/stream-feed.ts` | L101-104, L126-135, L146-158 | Polling stops when a socket opens; only `onClose` starts polling and schedules a reconnect | F-001 |
| E-002 | `src/feeds/bitkub.ts` L34; `src/feeds/binance.ts` L69-70 | — | Bitkub `rotateAfterMs: null`; Binance renews after 23 h | F-001 |
| E-003 | `src/app/health.ts` | L46, L155-160, L162-180 | Conditions are feed, channel, quota, disk; a feed is reported stale after 60 s + 5 min | F-001, F-002 |
| E-004 | `src/app/stark.ts` | L130-134 | `health.tickSeen` runs before `pipeline.receive` | F-002 |
| E-005 | `src/app/pipeline.ts` | L83-87 | A failed price-log write is logged and the tick is not evaluated | F-002 |
| E-006 | `src/app/heartbeat.ts` L18-33; `src/interface/http-server.ts` L226-229 | — | Heartbeat pings while the process runs; `/healthz` uses only the health snapshot | F-002 |
| E-007 | `src/storage/postgres.ts` | L303-305 | `UPDATE rules SET state = $2 WHERE id = $1`, no guard | F-003 |
| E-008 | `src/app/pipeline.ts` L94-141; `src/app/owner-service.ts` L88-93 | — | Read rule → evaluate → save state; an edit sets `armed` in between | F-003 |
| E-009 | `src/backup/backup.ts` (forget step); `SECURITY.md` gap table | — | Prune needs delete; the gap is recorded as open | F-004 |
| E-010 | `src/interface/telegram-bot.ts` | L80, L91-113 | Offset starts at 0; advanced in memory, sent only with the next poll | F-005 |
| E-011 | `src/interface/telegram-bot.ts` | L109-112, L118-127, L136-140 | No `try` around the loop or before `handleUpdate`'s `try`; loop started with `void` | F-006 |
| E-012 | `src/app/dispatcher.ts` | L153-156 | `sleep(max(wait, Retry-After))` with no cap, inside the channel queue | F-007 |
| E-013 | `API.md` L44-45; `SPEC.md` D-53; `ARCHITECTURE.md` L299 | — | Tunnel decided; HTTPS line still "PO to confirm"; no tunnel command anywhere (`grep ssh -L` found none) | F-008 |
| E-014 | `src/interface/http-server.ts` | L64-66 | Cookie `Secure; SameSite=Strict; HttpOnly` | F-008 |
| E-015 | `src/feeds/binance.ts` | L101-103 | Trade time accepted if 1–16 digits | F-009 |
| E-016 | `src/app/pipeline.ts` L45-53; `src/storage/postgres.ts` L137-143, L159-166 | — | Out-of-order drop by newest second; partition created for any day; retention only drops past days | F-009 |
| E-017 | `TASKS.md` S6-15 evidence; `src/backup/backup.ts` dump step | — | Only run: empty database, 707 bytes; whole database dumped nightly | F-010 |
| E-018 | `src/storage/migrations.ts`; `src/storage/postgres.ts` L126-146 | — | Retention exists for `price_ticks` only | F-011 |
| E-019 | `test/` inventory | `test/feeds/node-network.test.ts` (fetchGet, timers only); `test/index.test.ts` (2 failure paths); `test/e2e/stark.test.ts` (in-memory stores) | No test of `webSocketConnect`, real start-up, or a browser | F-012 |
| E-020 | Import graph (grep of `import … from "../…"` per layer) | `src/*/` | Directions match `ARCHITECTURE.md` §1; type-only `domain` ↔ `ports` cycle | 01 §2 |
| E-021 | Probe P-01 ([`probes/probes.ts`](probes/probes.ts); run from `test/audit-probes/` in the audit export) | — | Open, silent Bitkub socket for 6 fake hours: 1 socket, 0 polls, 0 ticks | F-001 |
| E-022 | Probe P-02 (same file) | — | Trade time in 2100 parsed; next 5 normal ticks dropped, 0 stored, 5 `pipeline.tick_out_of_order` | F-009 |
| E-023 | `src/app/stark.ts` L237-242; `src/index.ts` L101-104 | — | Stop does not await dispatches; pool ends; exit | F-014 |
| E-024 | `README.md` L6; `EVENTS.md` §2.4 and §3.1; `API.md` L44-45 | — | Drifted statements | F-015 |
| E-025 | `npm audit` and `npm audit --omit=dev` (log in 06) | — | 11 moderate (dev only, `minimatch`); 0 in production | F-016 |
| E-026 | `.github/workflows/ci.yml` | L32-33 | `actions/checkout@v7`, `actions/setup-node@v7` (tags) | F-013 |
| E-027 | Mode B runs (06) | — | lint 0, typecheck 0, build 0; tests 26 files / 284 passed with PostgreSQL; 267 passed + 17 skipped twice without it | 01 §5, 18 |
