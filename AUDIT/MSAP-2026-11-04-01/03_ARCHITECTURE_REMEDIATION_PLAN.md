# 03 — Remediation plan (a plan only, not permission to change code)

MSAP §25, §27–28: nothing here may be changed until the PO reviews the findings and authorises a package. Each
authorised package gets its own remediation context (`R-n_REMEDIATION_CONTEXT.md`) and, afterwards, a re-audit of
the area (MSAP §29). Order is a recommendation (**PO to confirm**).

| Package | Findings | Change (outline) | Verification | Before first real alert? |
|---|---|---|---|---|
| R-1 | F-001 | Per-provider inactivity limit on an open stream: treat silence as a disconnect (poll + reconnect) | A failing test like probe P-01 (open, silent socket → polling and a reconnect within the limit) | **Yes (recommended)** |
| R-2 | F-002 | A storage health condition (failed writes or a periodic `SELECT 1`), reported like the others; `/healthz` degraded; heartbeat withheld while storage fails; `EVENTS.md` §2.4 updated | Tests with a failing fake store: report sent, `/healthz` 503, no heartbeat | **Yes (recommended)** |
| R-3 | F-003 | Guarded state write (version or `updated_at` check); skip the stale decision | Storage test: edit between read and write leaves the edit in place | No |
| R-4 | F-005, F-006 | Confirm the Telegram offset before handling; catch per update and per round | Tests: an update is not handled twice across a restart; a malformed update is skipped, the loop continues | No |
| R-5 | F-007, F-014 | Cap Retry-After in the dispatcher; await in-flight dispatches on stop (time-limited) | Dispatcher and shutdown tests | No |
| R-6 | F-009 | Reject exchange times more than a few seconds ahead of the local clock | Parser and pipeline tests (P-02 turned into a test) | No |
| R-7 | F-008, F-015 | Document the SSH tunnel and URL; test login in the PO's browser; fix the drifted statements | PO's login result; doc review | No (but before the PO relies on the page) |
| R-8 | F-012, F-013 | Start-up smoke test with real PostgreSQL and fake endpoints; pin CI actions to SHAs | CI green with the new test; workflow guard test | No |
| — | F-004 | Already tracked; PO chooses among bucket lock, a read-only copy, or pruning elsewhere | Per option | No |
| — | F-010 | Measure dump size and restore with real data after Stark has run (already in Discovered Work) | Measured numbers recorded | No (soon after go-live) |
| — | F-011, F-016 | Retention per table (PO decision); update eslint when fixed upstream | — | No |

Rollback for every package: revert its commit(s); each package is independent of the others.
