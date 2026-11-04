# R-1 — Remediation context

| Field | Value |
|---|---|
| Remediation ID | R-1 |
| Source audit ID | MSAP-2026-11-04-01 |
| Source commit | `main` @ `b1c922d` |
| Selected findings | F-001 (a stream that stays open but silent is never replaced) |
| Approved scope | `src/feeds/stream-feed.ts` and its tests; the feed rules in `ARCHITECTURE.md` §2.1 and §6 |
| Excluded scope | Everything else, including F-002 (R-2) and the findings not authorised |
| Change objective | An open stream that sends nothing for a set time is handled as a lost connection: poll and reconnect |
| Verification plan | Tests written first and failing on the old code; full check green; control runs (mutations); re-audit of the area |
| Rollback plan | Revert the R-1 commit; no data or schema change |
| Approver | PO, 2026-11-04 ("บันทึก แล้วอนุมัติ R-1 R-2"; `SPEC.md` D-59) |
| Timestamp | 2026-11-04 |

## Change

- `SILENT_AFTER_MS` = 60 s (proposed, PO to confirm; equal to the health monitor's stale time).
- On open and on every message (with or without a price) the silence timer restarts. When it fires, the feed logs
  `feed.silent`, ignores and closes the old socket, and goes through the normal lost-connection path: REST polling
  at once, reconnect with the usual backoff. Stop, a close and a planned reconnect cancel the timer.
- Source facts: Bitkub `websocket-public.md` "Keep-Alive: No explicit ping required. Reconnect on disconnect";
  Binance `web-socket-streams.md`: the server sends ping frames every 20 s (handled by the WebSocket layer, not
  visible to Stark's code).
- Trade-off: a pair with no trades for a minute reconnects about once a minute, with REST prices in between.

## Verification

- New tests in `test/feeds/stream-feed.test.ts` (failing before the change): a minute of silence → `feed.silent`,
  old socket closed, a REST poll, a new socket after 1 s; messages without a price keep the stream; the P-01 case
  (open and silent for 6 hours) now recovers and yields prices; no silence handling after stop. The 23-hour Binance
  renewal test now sends trades, since a silent stream is no longer kept for 23 hours.
- Control runs: no re-arm on messages, timer left running after stop or close, silence not handled, and a
  10-minute limit each turn a test red (the last after adding an explicit check of the 60 s value).

## Re-audit of the affected area (MSAP §29)

- F-001: the mechanism in 02 (only `onClose` leads to polling and reconnect) no longer holds; silence now leads to
  both (`stream-feed.ts` `watchSilence`). Probe P-01's scenario is a test that passes. **F-001: RESOLVED**, with
  the 60 s value still to be confirmed by the PO.
- No new finding in `src/feeds/stream-feed.ts`.

## After review

The PO confirmed the proposed values and wording on 2026-11-04 (`SPEC.md` D-60) and merged the change (PR #19,
`10c7098`).
