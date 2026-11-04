# R-4 — Remediation context

| Field | Value |
|---|---|
| Remediation ID | R-4 |
| Source audit ID | MSAP-2026-11-04-01 |
| Source commit | `main` @ `b1c922d` (audited); changed on `main` @ `3f81e9d` |
| Selected findings | F-005 (Telegram commands handled just before a restart run again), F-006 (an unexpected error in the Telegram poll loop ends the process) |
| Approved scope | `src/interface/telegram-bot.ts` (polling and the loop), its tests, the Telegram fake in `test/fakes/fake-internet.ts`, `API.md` §2 "As built" |
| Excluded scope | The commands themselves, the reply channel, every other finding |
| Change objective | A command is handled at most once across a restart, and no single update or polling round can stop the bot or the process |
| Verification plan | Tests written first and failing on the old code; control runs; full check green with PostgreSQL; re-audit of the area |
| Rollback plan | Revert the R-4 commit; no data or schema change |
| Approver | PO, 2026-11-04 ("อนุมัติ R-3 ถึง R-8"; `SPEC.md` D-63) |
| Timestamp | 2026-11-04 |

## Source checked

Telegram Bot API, `getUpdates`, read 2026-11-04 (`core.telegram.org/bots/api`): "An update is considered confirmed as
soon as getUpdates is called with an offset higher than its update_id"; by default "updates starting with the earliest
unconfirmed update are returned"; `limit` accepts 1–100; `timeout` 0 is a short poll; updates are kept for at most
24 hours. This settles the audit's VALIDATION REQUIRED on F-005 (`05_AUDIT_BLIND_SPOTS.md`): the mechanism holds.

## Change

- After a batch arrives, the bot sends a confirming `getUpdates` with `offset` = highest update ID + 1, `timeout` 0,
  `limit` 1 and a 10 s limit, and only then handles the batch. If the confirmation fails, nothing is handled and the
  next round fetches the same batch (`telegram.confirm_failed`). Any update the confirming call returns is not yet
  confirmed, so the next long poll returns it.
- The trade-off, chosen on purpose: a command is handled at most once. If the process stops after the confirmation
  but before the reply, that command is lost and the PO sees no reply and sends it again. Handling it twice (a second
  rule, a switch flipped back) is the worse outcome.
- Entries that are not objects with an integer `update_id` are skipped. Each update is handled inside its own `try`
  (`telegram.update_failed`); a round that throws is caught in the loop (`telegram.loop_failed`) and retried after 5 s.
- The Telegram fake now follows the Bot API: updates stay queued until a call carries a higher offset, `limit` caps
  the batch, and `timeout` 0 answers at once. The old fake dropped updates as soon as they were read and ignored
  `timeout`, so it could neither show a replay nor answer a short poll.

## Verification

- New tests in `test/interface/telegram-bot.test.ts`, each failing on the old code (5 failed, 10 passed):
  the batch is confirmed before any reply or rule (exact request body and limit); a failed confirmation handles
  nothing and the same offset is asked for again, including a `429` with `retry_after`; a `null` entry and an update
  without a chat are skipped while the next update is handled; a round that throws is logged and the loop polls again
  after 5 s. The existing polling test now scripts the confirmation.
- Control runs, each turning at least one test red: handling before confirming (4 failed); handling despite a failed
  confirmation (1); no per-update `try` (1); no `try` in the loop (1); confirming with the old offset (2).
- `npm run check` with `STARK_TEST_DATABASE_URL`: 26 files, 298 tests passed, lint, typecheck and build clean.

## Re-audit of the affected area (MSAP §29)

- F-005: an update is confirmed before it is handled, so a restart cannot return it. **F-005: RESOLVED.**
- F-006: neither a malformed update nor a throwing round leaves the loop; `void loop()` can no longer reject.
  **F-006: RESOLVED.**
- New behaviour to know (not a finding): a command can be lost, never repeated, if Stark stops between the
  confirmation and the reply.
