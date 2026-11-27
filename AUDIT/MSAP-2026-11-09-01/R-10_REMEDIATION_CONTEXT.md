# R-10 — Remediation context

| Field | Value |
|---|---|
| Remediation ID | R-10 |
| Source audit ID | MSAP-2026-11-09-01 |
| Source commit | `main` @ `289e243` (audited); changed after R-9 on the same branch |
| Selected findings | F-102 (a change rule compares against a price from before a gap; false "N minutes" alerts) |
| Approved scope | `src/domain/rules.ts` (reference window), `src/app/pipeline.ts`, `src/ports/storage.ts`, `src/storage/postgres.ts` (`priceAtOrBefore`), the fake price log, their tests, `EVENTS.md` §3.3/§3.5, `ARCHITECTURE.md` §5, the records |
| Excluded scope | Every other finding; feed behaviour (F-105, F-113, F-114); the price log's retention |
| Change objective | A change rule fires only on a reference that is really about N minutes old, as `EVENTS.md` §3.3 step 2 already required |
| Decision | Maximum reference age: 2 minutes before the cutoff, inclusive (PO, 2026-11-27, "ตามคำแนะนำ"; `SPEC.md` D-66) |
| Verification plan | Tests failing on the old code; control runs; full check with PostgreSQL; re-audit of the area |
| Rollback plan | Revert the R-10 commit; no schema change (the added SQL condition uses the existing `price_ticks_lookup` index) |
| Approver | PO, 2026-11-27 ("อนุมัติ R-9 R-10 ตามคำแนะนำ"; `SPEC.md` D-66) |
| Timestamp | 2026-11-27 |

## Change

- `REFERENCE_MAX_AGE_MS = 2 min` and `referenceEarliest(exchangeTime, windowMinutes)` = cutoff − 2 min
  (`src/domain/rules.ts`).
- `PriceLog.priceAtOrBefore(exchange, pair, time, notBefore)`: the price of the last stored tick at or before `time`
  and not before `notBefore`; PostgreSQL adds `AND exchange_time >= $5`. The pipeline passes the cutoff and the
  earliest time.
- Contract: `EVENTS.md` §3.3 step 1 states the 2-minute limit and its reason; §3.5 adds the gap example and the
  inclusive boundary; `ARCHITECTURE.md` §5 no longer lists the question as open.
- Effect the PO should know (recorded in D-66): a pair with no stored tick in the 2 minutes before the cutoff gives no
  change alert for that tick. While the feed streams, ticks arrive whenever the exchange publishes; quiet pairs on
  Bitkub may publish less often (not verified, as in 05).

## Verification

- New tests, each failing on the old code: `test/app/pipeline.test.ts` "does not fire a change rule whose only earlier
  price is from before a gap" and "accepts a reference exactly 2 minutes before the cutoff and refuses one a
  millisecond older"; `test/storage/postgres.test.ts` "finds no price older than the lower bound, which is inclusive";
  `test/domain/rules.test.ts` "accepts a reference at most 2 minutes before the cutoff".
- The existing tests still hold: the §3.5 example 104 → 105 → 106 fires once at +5.00 %; no reference → no decision.
- Control runs, each turning tests red: the SQL ignoring the bound (1); the fake ignoring it (2); 3 minutes instead of
  2 (2); an exclusive bound (2); the pipeline passing no bound (2).
- While writing the storage test it first shared a pair with the previous test and failed for that reason (the shared
  schema of F-119); it now uses a pair of its own.
- `npm run check` with PostgreSQL: see the commit.

## Re-audit of the affected area (MSAP §29)

- F-102: `priceAtOrBefore` now has a lower bound 2 minutes before the cutoff, so a tick from before a gap is never a
  reference; the §3.3 step 2 rule ("there is a gap … the condition is false") holds. **F-102: RESOLVED.**
- Not changed (outside the scope): F-109 (health counts ticks the engine discards) and F-105 (a polling-only feed gives
  about two ticks a minute, which with the 2-minute limit still leaves a reference in most minutes).
