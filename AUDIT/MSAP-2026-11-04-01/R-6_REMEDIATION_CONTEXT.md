# R-6 — Remediation context

| Field | Value |
|---|---|
| Remediation ID | R-6 |
| Source audit ID | MSAP-2026-11-04-01 (with MSAP-2026-11-09-01 F-110, the same root cause) |
| Source commit | `main` @ `b1c922d` (first audit), `289e243` (second); changed on `main` @ `7902810` |
| Selected findings | F-009 (one future-dated tick blocks a pair until restart); MSAP-2026-11-09-01 F-110 (an out-of-range Binance trade time becomes an Invalid Date and replaces the held tick) |
| Approved scope | `src/feeds/stream-feed.ts` (`emit`), its tests, an end-to-end test (probe P-02 as a test), `EVENTS.md` §2.1, the records |
| Excluded scope | F-109 (health counting ticks the engine discards), the pipeline's own ordering rules, every other finding |
| Change objective | No tick with an exchange time ahead of the clock, or not a real time, reaches the price board, the health monitor or the pipeline |
| Value | At most 5 s ahead, inclusive (`SPEC.md` D-68; developer choice, PO to confirm) |
| Verification plan | Tests failing on the old code; control runs; full check with PostgreSQL; re-audit of the area |
| Rollback plan | Revert the R-6 commit; no data or schema change |
| Approver | PO: R-6 authorised 2026-11-04 (`SPEC.md` D-63); chosen next 2026-11-27 ("ก ตามคำแนะนำ") |
| Timestamp | 2026-11-27 |

## Change

- `StreamFeed.emit` drops a tick whose `exchangeTime` is not a finite time (`time_invalid`) or is more than
  `MAX_FUTURE_MS = 5 s` ahead of the local clock (`time_in_future`), logs `feed.tick_rejected` with the exchange, pair
  and reason, and passes on the rest. It sits before `onTick`, so the health monitor, the price board and the pipeline
  never see such a tick; a future time can no longer create a far-future partition either.
- Bitkub ticks and polled prices carry their arrival time, so in practice only a Binance stream trade time is checked
  against a value that can differ from the clock. If Stark's clock itself falls more than 5 s behind Binance, its
  trades are dropped, the feed goes stale and the health monitor reports it (EVENTS.md §2.4) instead of evaluating
  rules on wrong times.

## Verification

- New tests, failing on the old code: `test/feeds/stream-feed.test.ts` "drops a tick timed more than 5 s ahead …",
  "accepts a tick exactly 5 s ahead and drops one a millisecond further", "drops a trade time that is not a real
  time"; `test/e2e/stark.test.ts` "keeps alerting on a pair after Binance sends a trade timed in the future" (P-02 as a
  test: on the old code no alert was sent after the future trade). While writing it, the first version used BTC/USDT,
  which the demo exchange-info fixture does not list; it now uses ETH/USDT.
- Control runs, each turning tests red: no future check (3); no invalid-time check (1); an exclusive 5 s (1); a 60 s
  tolerance (2); no log line (3).
- `npm run check` with PostgreSQL: see the commit.

## Re-audit of the affected area

- F-009: a future-dated trade is dropped before the pipeline, so it cannot block the pair; P-02's scenario now alerts.
  **RESOLVED.**
- MSAP-2026-11-09-01 F-110: an Invalid Date is dropped the same way. **RESOLVED.**
- Not changed: F-109 (ticks the pipeline still discards as late are counted by health) remains for R-13.
