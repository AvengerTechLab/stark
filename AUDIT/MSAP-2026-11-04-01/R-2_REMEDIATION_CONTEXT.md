# R-2 — Remediation context

| Field | Value |
|---|---|
| Remediation ID | R-2 |
| Source audit ID | MSAP-2026-11-04-01 |
| Source commit | `main` @ `b1c922d` |
| Selected findings | F-002 (a database failure stops all alerts and nothing reports it) |
| Approved scope | `src/app/health.ts`, `heartbeat.ts`, `stark.ts`, `src/index.ts`, `src/ports/storage.ts` (health kinds), a migration for the `health_events` kinds, their tests, and `EVENTS.md` §2.4, `DATABASE.md`, `ARCHITECTURE.md` §6 |
| Excluded scope | Everything else, including F-001 (R-1), pipeline behaviour on a failed write, and the findings not authorised |
| Change objective | A database that does not answer is reported to the PO through a channel and the outside monitor, and `/healthz` shows it |
| Verification plan | Tests written first and failing on the old code; full check green with PostgreSQL; control runs; re-audit of the area |
| Rollback plan | Revert the R-2 commit. Migration `002_storage_health` only widens a CHECK; leaving it in place after a revert is harmless |
| Approver | PO, 2026-11-04 ("บันทึก แล้วอนุมัติ R-1 R-2"; `SPEC.md` D-59) |
| Timestamp | 2026-11-04 |

## Change

- The health monitor runs a storage check first at each 30 s check: `SELECT 1` with a 5 s limit (`src/index.ts`).
  A failure starts `storage_failing`; it is reported after 5 minutes (as D-55 does for the others; proposed, PO to
  confirm), once, and its recovery once. Thai wording (proposed): "[Stark] ฐานข้อมูลใช้งานไม่ได้ตั้งแต่ HH:MM:SS น."
  with a second line saying alerts are stopped until it is back; "[Stark] ฐานข้อมูลกลับมาใช้งานได้แล้ว เวลา HH:MM:SS น."
- Found while making the change, and needed for the report to go out at all: the report step read the channel
  settings from the database, and a failure to store a delivered report made it repeat every 30 s. Now, when the
  settings cannot be read, every configured channel is tried in the usual order; a store failure is logged
  (`health.record_failed`) and the report still counts as sent.
- `storage_failing` is an open condition in the snapshot, so `/healthz` answers 503 while it lasts.
- The heartbeat is withheld (`heartbeat.withheld`) from the first failed check until the database answers, so the
  outside monitor (D-57) reports Stark down within its 15 minutes, independently of Stark's channels.
- Migration `002_storage_health` widens `health_events.kind` to the two new kinds.

## Verification

- New tests, each failing before the change: `test/app/health.test.ts` (report after 5 minutes though the settings
  and the health log fail, sent once; a short outage forgotten; recovery reported once and stored),
  `test/app/heartbeat.test.ts` (no ping while withheld, resumes after), `test/e2e/stark.test.ts` (database down:
  Telegram report, `/healthz` 503, no heartbeat; back: recovery report, heartbeat resumes),
  `test/storage/postgres.test.ts` (the new kinds are accepted; migrations list).
- Control runs: the report needing the database, a store failure not caught, the heartbeat ignoring storage, the
  check not wired, an immediate report, `storageFailing()` always false, and the check never run each turn a test red.

## Re-audit of the affected area (MSAP §29)

- F-002: the mechanism in 02 no longer holds. A database failure now produces a Telegram (or other channel) report,
  a degraded `/healthz` and a missing heartbeat. **F-002: RESOLVED**, with the 5-minute timing and the wording
  still to be confirmed by the PO.
- Not changed (outside the approved scope, recorded for the PO): ticks that fail to store are still dropped, so
  alerts during the outage are lost, not delayed; the pipeline's queue has no limit while the database hangs.
