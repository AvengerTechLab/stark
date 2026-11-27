# 01 — System architecture (re-check)

The full reconstruction is in `AUDIT/MSAP-2026-11-04-01/01_SYSTEM_ARCHITECTURE_AUDIT.md`. This file records what the
second audit confirmed and what changed since `b1c922d`.

## What changed since MSAP-2026-11-04-01 (`b1c922d` → `289e243`)

| Change | Files | Effect on the architecture |
|---|---|---|
| R-1 silence detection | `src/feeds/stream-feed.ts` | A socket silent for 60 s is treated as lost (poll + reconnect). New timer per feed |
| R-2 storage health | `src/app/health.ts`, `heartbeat.ts`, `stark.ts`, `src/index.ts`, migration `002_storage_health` | A `SELECT 1` check with a 5 s race; new condition kinds; heartbeat withheld while storage fails |
| R-4 Telegram polling | `src/interface/telegram-bot.ts` | A confirming `getUpdates` before handling; per-update and per-round error boundaries |
| R-7 | documents only | Owner page through the SSH tunnel (`deploy/WEB.md`) |
| D-64 Node.js 24 | `package.json`, CI, `@types/node` | Runtime moves to v24; no code change |

Size: `src/` 4,526 lines, `test/` 4,742 lines (was 4,369 / 4,491). Runtime dependencies unchanged: `pg` 8.23.1,
`hash-wasm` 4.12.0.

## Confirmed unchanged (checked in this audit)

- Layers and dependency direction: `domain` imports nothing outside itself; `app` depends on ports; adapters
  (`feeds`, `channels`, `storage`, `interface`) implement ports; `index.ts` is the only composition root.
- Data flow: feed → `onTick` (health, board) → pipeline (one tick per second per pair, store, evaluate, save state and
  decision in one transaction) → dispatcher (per-channel queues, retries, cooldown, quota) → channels.
- Owner flow: web page / Telegram → `OwnerService` → stores; feeds rebuilt when pairs with rules change.
- Process: one Node.js process under systemd; PostgreSQL on localhost; owner page on 127.0.0.1:8080 (SSH tunnel);
  nightly backup by a separate unit.

## Points of note for the findings

- Error boundaries: the Telegram loop (after R-4), `every()` jobs, the pipeline queue and the dispatcher catch their
  errors; the HTTP handler does not cover its first line, and no process-level handler exists (F-101).
- Concurrency: one pipeline queue for all pairs (F-107); health checks overlap when slow (F-106); logins unserialised
  (F-103); evaluation vs owner edits unguarded (F-003).
- Time: exchange time drives evaluation and the reference lookup; arrival time drives health and the late cut-off;
  the two meet in F-102, F-109 and F-110.
