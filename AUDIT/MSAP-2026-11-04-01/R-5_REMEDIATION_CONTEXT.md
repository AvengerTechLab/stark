# R-5 — Remediation context

| Field | Value |
|---|---|
| Remediation ID | R-5 |
| Source audit ID | MSAP-2026-11-04-01 (with the extensions found by MSAP-2026-11-09-01) |
| Source commit | `main` @ `b1c922d` (first audit), `289e243` (second); changed on `main` @ `11ecc2b` |
| Selected findings | F-007 (the dispatcher obeys any Retry-After); F-014 (shutdown does not wait for sends in flight); extensions: a channel sleeping on Retry-After never raises `channel_failing`; the restart sweep's sleeps could exceed systemd's 90 s stop timeout |
| Approved scope | `src/app/dispatcher.ts`, `src/app/stark.ts` (stop and sweep), their tests, the Telegram fake (a held send), `EVENTS.md` §2.3, `ARCHITECTURE.md` §7, the records |
| Excluded scope | `deploy/stark.service` (no `TimeoutStopSec` needed: a stop now ends within about 10 s, well inside the default 90 s); every other finding |
| Change objective | No channel can hold the dispatcher for long, and a stop does not cut off a send under way |
| Values | Retry-After at most 60 s; drain at most 10 s (`SPEC.md` D-67; developer choice, PO to confirm) |
| Verification plan | Tests failing on the old code; control runs; full check with PostgreSQL; re-audit of the area |
| Rollback plan | Revert the R-5 commit; no data or schema change |
| Approver | PO: R-5 authorised 2026-11-04 (`SPEC.md` D-63); chosen next 2026-11-27 ("A ตามคำแนะนำ") |
| Timestamp | 2026-11-27 |

## Change

- `MAX_RETRY_WAIT_MS = 60 s`. A Retry-After above it ends that channel's attempts for the alert: logged
  `dispatch.retry_after_too_long` and reported to the health monitor as `failed`, so a channel held off for long is
  reported like any failing one (the extension). Exactly 60 s is still waited.
- `Dispatcher.stop()`: a retry wait under way ends at once and no further attempt starts (`dispatch.retry_abandoned`);
  a send already under way finishes and is recorded. `Dispatcher.idle()`: resolves when every queued send is done.
- `StarkHandle.stop()`: after stopping feeds and timers it stops the dispatcher, then waits for the restart sweep, the
  pipeline and the dispatcher, at most `DRAIN_MS = 10 s` (`app.drain_timeout` otherwise). The sweep sends no further
  decision once Stark is stopping. Whatever is left is resent by the next start's sweep (idempotent per alert and
  channel).

## Verification

- New tests, failing on the old code: `test/app/dispatcher.test.ts` "waits at most 60 s …" (old: waited 3,600 s),
  "ends a retry wait at once when stopped …" and "idle() resolves only when …" (old: no such methods);
  `test/e2e/stark.test.ts` "on stop, waits for an alert still being sent …" and "on stop, gives up waiting … after
  10 s" (old: `stop()` returned while the send was still under way). Also new: "still waits a Retry-After of exactly
  60 s" (boundary; passes on old and new code) and "on stop, sends no more of the alerts a restart left unsent".
- Control runs, each turning tests red: no cap (1); the cap excluding 60 s (1); a too-long wait not reported (1); the
  wait not cut by stop (1); stop not waiting for the dispatcher (2); a 20 s drain (1); `idle()` resolving at once (3);
  the sweep not stopping (1).
- `npm run check` with PostgreSQL: see the commit.

## Re-audit of the affected area

- F-007: no wait exceeds 60 s, and a longer request is a reported failure. **RESOLVED**, including the extension.
- F-014: a stop waits for ticks and sends under way, within 10 s, and cannot run into systemd's stop timeout.
  **RESOLVED**, including the extension.
