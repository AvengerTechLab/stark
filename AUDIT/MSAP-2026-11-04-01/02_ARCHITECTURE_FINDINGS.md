# 02 — Findings (frozen at `b1c922d`)

Severity (MSAP §20): S0 informational · S1 low · S2 moderate · S3 high · S4 critical. Severity ≠ confidence.
"Immediate action" means before the first real alert (gate A-1), not during the audit.

| ID | Title | Sev | Conf | Status | Immediate |
|---|---|---|---|---|---|
| F-001 | A stream that stays open but silent is never replaced | S3 | HIGH | CONFIRMED | YES |
| F-002 | A database failure stops all alerts and nothing reports it | S3 | HIGH | CONFIRMED | YES |
| F-003 | A rule edit can be overwritten by an evaluation already in flight | S2 | HIGH | CONFIRMED | NO |
| F-004 | Backups can be deleted from the VPS | S2 | HIGH | CONFIRMED | NO |
| F-005 | Telegram commands handled just before a restart run again | S1 | MEDIUM | PARTIALLY_CONFIRMED | NO |
| F-006 | An unexpected error in the Telegram poll loop ends the process | S1 | MEDIUM | CONFIRMED | NO |
| F-007 | The dispatcher obeys any Retry-After, with no upper limit | S1 | HIGH | CONFIRMED | NO |
| F-008 | How the PO opens the owner page is undocumented; the cookie path is unverified | S1 | HIGH | CONFIRMED | NO |
| F-009 | One future-dated tick blocks a pair until restart | S1 | HIGH | CONFIRMED | NO |
| F-010 | Backup size and a restore with real data are unproven | S1 | MEDIUM | UNCONFIRMED | NO |
| F-011 | Several tables grow without retention | S0 | HIGH | CONFIRMED | NO |
| F-012 | Real adapters and real wiring are untested | S1 | HIGH | CONFIRMED | NO |
| F-013 | CI actions are pinned to movable tags | S1 | HIGH | CONFIRMED | NO |
| F-014 | Shutdown does not wait for sends in flight | S1 | HIGH | CONFIRMED | NO |
| F-015 | Documentation drift | S0 | HIGH | CONFIRMED | NO |
| F-016 | Moderate npm advisories in lint tooling | S0 | HIGH | CONFIRMED | NO |

---

## F-001 — A stream that stays open but silent is never replaced
- **Category:** Reliability / runtime flow · **Severity:** S3 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-001, E-002, probe P-01 (E-021).
- **Observation:** Once a socket opens, polling stops (`stream-feed.ts` L101-104). Only the socket's `onClose` starts
  polling and a reconnect (L126-135). Nothing watches for an open socket that delivers no messages. Bitkub has no
  planned renewal (`bitkub.ts` L34 `rotateAfterMs: null`); Binance renews after 23 h (`binance.ts` L70).
- **Mechanism:** A half-open TCP connection, a provider that stops sending, or a stalled subscription keeps the
  socket "open". P-01: six fake hours with an open, silent Bitkub socket gave 0 polls, 0 reconnects, 0 ticks.
- **Impact:** Every rule on that exchange stops alerting until the process restarts (Bitkub) or up to 23 h (Binance).
  The health monitor reports `feed_stale` after about 6 minutes (E-003), so the PO learns of it, but nothing recovers.
- **Root cause:** Liveness is judged from the socket's open/closed state, not from data arriving.
- **Affected areas:** `src/feeds/stream-feed.ts`, both providers, every rule.
- **Recommendation:** Treat "no message for N seconds while connected" as a disconnect: reconnect, and poll meanwhile.
  Decide N per provider from its documented update cadence.
- **Immediate action required:** YES (before the first real alert).
- **Open questions:** Bitkub's documented keep-alive or ping behaviour was not re-read in this audit.

## F-002 — A database failure stops all alerts and nothing reports it
- **Category:** Reliability / error handling · **Severity:** S3 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-003, E-004, E-005, E-006.
- **Observation:** If PostgreSQL fails, each tick's INSERT fails and the tick is logged and dropped
  (`pipeline.ts` L83-87). The health monitor tracks only feeds, channels and disk (`health.ts` L46, L155-160), and
  counts a feed healthy from `tickSeen`, which runs before storage (`stark.ts` L130-134). The heartbeat pings while the
  process lives (`heartbeat.ts`). `/healthz` reflects only the health snapshot.
- **Mechanism:** Database down → no ticks stored → no rules evaluated → no alerts. Feeds still look fresh, the
  heartbeat still arrives, `/healthz` says ok. The only trace is `pipeline.tick_failed` in the journal.
- **Impact:** All alerts stop silently while every signal the PO watches says healthy.
- **Root cause:** The database is not one of the monitored conditions (also absent from `EVENTS.md` §2.4).
- **Affected areas:** `src/app/health.ts`, `src/app/stark.ts`, `src/app/heartbeat.ts`, `EVENTS.md` §2.4.
- **Recommendation:** Add a storage condition (e.g. consecutive failed writes, or a periodic `SELECT 1`), report it
  through a channel like the others, mark `/healthz` degraded, and consider withholding the heartbeat while storage
  fails so the outside monitor also notices.
- **Immediate action required:** YES (before the first real alert).
- **Open questions:** None.

## F-003 — A rule edit can be overwritten by an evaluation already in flight
- **Category:** Data flow / concurrency · **Severity:** S2 · **Confidence:** HIGH (mechanism), likelihood low ·
  **Status:** CONFIRMED (by code; not reproduced)
- **Evidence:** E-007, E-008.
- **Observation:** The pipeline reads a rule (`pipeline.ts` L96), evaluates it, then writes its state with an
  unconditional `UPDATE rules SET state = $2 WHERE id = $1` (`postgres.ts` L305). An owner edit or re-enable between
  the read and the write sets `state = 'armed'` (`owner-service.ts` L88-93), and the pipeline's write then replaces it.
- **Mechanism:** Owner changes a rule's level while a tick of that pair is being evaluated with the old level; the
  old evaluation fires and stores `fired`. The edited rule now starts `fired` and stays silent until its condition
  becomes false and true again. The reverse (an edit's `armed` replaced by a stale `armed`/`fired`) also exists.
- **Impact:** One missed alert after an edit, rarely. The window is the evaluation time (milliseconds).
- **Root cause:** No version or "unchanged since read" check on the state write.
- **Affected areas:** `src/storage/postgres.ts` `saveResult`, `src/app/pipeline.ts`, `src/app/owner-service.ts`.
- **Recommendation:** Guard the write (e.g. `WHERE id = $1 AND updated_at = <read value>` or a version column) and
  skip the decision when the guard fails.
- **Immediate action required:** NO.
- **Open questions:** None.

## F-004 — Backups can be deleted from the VPS
- **Category:** Security / reliability · **Severity:** S2 · **Confidence:** HIGH · **Status:** CONFIRMED (already
  recorded as an open gap: `SECURITY.md`, `TASKS.md` Discovered Work)
- **Evidence:** E-009.
- **Observation:** The R2 token is Object Read & Write because `restic forget --prune` deletes (`backup.ts`).
- **Mechanism:** Whoever gains root on the VPS reads `/etc/stark/backup.env` and can delete every backup.
- **Impact:** Loss of the only off-host copy in the same incident that needs it.
- **Root cause:** Pruning and writing share one credential on the host being protected.
- **Recommendation:** Options already listed for the PO (bucket lock, a second read-only copy, pruning elsewhere).
- **Immediate action required:** NO (already tracked).
- **Open questions:** The PO's choice among the options.

## F-005 — Telegram commands handled just before a restart run again
- **Category:** API / idempotency · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** PARTIALLY_CONFIRMED
- **Evidence:** E-010.
- **Observation:** The update offset starts at 0 on every start (`telegram-bot.ts` L80) and is only sent with the next
  `getUpdates` (L94-96, L111). Per the Bot API, an update is confirmed only when a later `getUpdates` carries a higher
  offset (not re-read in this audit: VALIDATION REQUIRED).
- **Mechanism:** A command handled, then a restart before the next poll → Telegram returns it again → handled twice.
- **Impact:** A duplicate rule, or a switch toggled twice. `/delete` is safe (its pending confirmation is not kept).
- **Recommendation:** Confirm the offset before handling (or persist it), and verify against the Bot API docs.
- **Immediate action required:** NO.

## F-006 — An unexpected error in the Telegram poll loop ends the process
- **Category:** Error handling · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** CONFIRMED (by code)
- **Evidence:** E-011.
- **Observation:** `loop` awaits `pollOnce()` with no `try` and is started with `void` (`telegram-bot.ts` L120-127).
  Code in `pollOnce` and `handleUpdate` before its `try` (L109-112, L136-140) can throw on a malformed update.
- **Mechanism:** A throw becomes an unhandled rejection; Node.js 22 ends the process; systemd restarts it
  (`Restart=always`). With F-005, the same update returns and the process can restart in a loop.
- **Impact:** Unlikely (needs a malformed update from Telegram), but a restart loop stops all alerts.
- **Recommendation:** Catch per update and per loop round; skip an update that cannot be handled.
- **Immediate action required:** NO.

## F-007 — The dispatcher obeys any Retry-After, with no upper limit
- **Category:** Reliability · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-012.
- **Observation:** `dispatcher.ts` L153-156 sleeps `max(wait, Retry-After)` inside the channel's serial queue.
- **Mechanism:** A channel answering, say, `Retry-After: 3600` holds every later alert on that channel for an hour.
- **Impact:** Delayed alerts on one channel; other channels unaffected.
- **Recommendation:** Cap the wait; above the cap, record the attempt as failed and let the next alert try.
- **Immediate action required:** NO.

## F-008 — How the PO opens the owner page is undocumented; the cookie path is unverified
- **Category:** Documentation / operations · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-013, E-014.
- **Observation:** D-53 decided an SSH tunnel, but no document gives the tunnel command or the URL, and `API.md` §1.1
  still says HTTPS is "chosen with hosting (PO to confirm)". The session cookie is `Secure` (`http-server.ts` L65);
  through a tunnel the browser sees `http://localhost:<port>`.
- **Mechanism:** Browsers that treat `http://localhost` as a secure context keep `Secure` cookies; whether the PO's
  browser does is VALIDATION REQUIRED (not tested in this audit).
- **Impact:** The PO may be unable to use the web page; Telegram commands still work.
- **Recommendation:** Document the tunnel (`ssh -L 8080:127.0.0.1:8080 …`, then `http://localhost:8080`), test login
  in the PO's browser, and update `API.md` §1.1.
- **Immediate action required:** NO.

## F-009 — One future-dated tick blocks a pair until restart
- **Category:** Data flow / validation · **Severity:** S1 · **Confidence:** HIGH (mechanism), likelihood low ·
  **Status:** CONFIRMED (probe P-02)
- **Evidence:** E-015, E-016, E-022.
- **Observation:** Binance's trade time is accepted if it is 1–16 digits (`binance.ts` L101-103). The pipeline drops
  any tick older than the newest second it has seen for that pair (`pipeline.ts` L45-53). A future tick also gets its
  own partition (`postgres.ts` L159-166) that retention never drops (L141).
- **Mechanism:** P-02: a trade time in 2100 passes the parser; afterwards 5 normal ticks were all dropped as out of
  order and none stored.
- **Impact:** Alerts on that pair stop until restart. Needs a wrong timestamp from Binance, so unlikely.
- **Recommendation:** Reject exchange times more than a few seconds ahead of the local clock.
- **Immediate action required:** NO.

## F-010 — Backup size and a restore with real data are unproven
- **Category:** Reliability · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** UNCONFIRMED
- **Evidence:** E-017.
- **Observation:** The nightly dump includes the whole 35-day price log (one row per pair per second). The only real
  run and restore were on an empty database (707 bytes, TASKS S6-15).
- **Impact:** Dump time, R2 usage (10 GB free) and restore time with real data are unknown.
- **Recommendation:** Measure after Stark has run for some days; repeat the restore test (already in Discovered Work).
- **Immediate action required:** NO.

## F-011 — Several tables grow without retention
- **Category:** Technical debt · **Severity:** S0 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-018.
- **Observation:** Only `price_ticks` has retention. `alert_decisions`, `delivery_attempts`, `health_events`,
  `owner_actions`, `login_attempts` and expired `owner_sessions` rows are never removed.
- **Impact:** Slow growth; small at one user's volumes.
- **Recommendation:** Decide retention per table with the PO (history may be wanted).
- **Immediate action required:** NO.

## F-012 — Real adapters and real wiring are untested
- **Category:** Testing · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-019.
- **Observation:** 284 tests pass; the end-to-end test runs on in-memory fakes. Not covered by any test: the real
  WebSocket adapter (`webSocketConnect`), `index.ts` beyond its two failure paths, the PostgreSQL stores under the
  full pipeline, and a browser using the owner page.
- **Impact:** Faults between the real pieces would first show in production.
- **Recommendation:** A start-up smoke test with a real PostgreSQL and fake network endpoints; a browser login test.
- **Immediate action required:** NO.

## F-013 — CI actions are pinned to movable tags
- **Category:** Infrastructure / supply chain · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-026 (`ci.yml` L32-33).
- **Observation:** `actions/checkout@v7` and `actions/setup-node@v7` are major tags that their owners can move.
  The workflow's token is read-only (`permissions: contents: read`), which limits the harm.
- **Recommendation:** Pin to commit SHAs and update them deliberately.
- **Immediate action required:** NO.

## F-014 — Shutdown does not wait for sends in flight
- **Category:** Runtime / reliability · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-023.
- **Observation:** `stop()` stops timers, feeds, server and bot (`stark.ts` L237-242); `index.ts` then ends the pool and
  exits (L101-104). Dispatches in progress are not awaited.
- **Mechanism:** A send delivered but not yet recorded is resent by the restart sweep.
- **Impact:** An occasional duplicate alert on Telegram or Discord (LINE dedupes by retry key).
- **Recommendation:** Track in-flight dispatches and await them (with a time limit) before closing the pool.
- **Immediate action required:** NO.

## F-015 — Documentation drift
- **Category:** Documentation · **Severity:** S0 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-024.
- **Observation:** `README.md` says hosting waits on the PO (done: D-56, S6-14). `EVENTS.md` §2.4 still marks the
  health timings "(proposed)" (decided in D-55). `EVENTS.md` §3.1 describes choosing "both THB and USDT" in the owner
  interface; the page has no such control (the PO creates two rules). `API.md` §1.1 (see F-008).
- **Recommendation:** Update the documents.
- **Immediate action required:** NO.

## F-016 — Moderate npm advisories in lint tooling
- **Category:** Dependencies · **Severity:** S0 · **Confidence:** HIGH · **Status:** CONFIRMED (already in Discovered
  Work)
- **Evidence:** E-025.
- **Observation:** `npm audit` reports 11 moderate advisories through `minimatch` in eslint/typescript-eslint;
  `npm audit --omit=dev` finds 0; CI's `--audit-level=high` passes.
- **Recommendation:** Update eslint when a fixed release exists; never `npm audit fix --force`.
- **Immediate action required:** NO.

## What the evidence shows is sound (not findings)

- Rule evaluation is pure, deterministic and uses exact decimals with no division (`domain/decimal.ts`, `rules.ts`).
- Every SQL value is a parameter; partition names come from dates only (`postgres.ts` L117-121).
- Secrets: read from the environment once; the logger redacts known values and patterns (`logger.ts`); channel
  errors are logged by fixed reasons, never by text that may carry a URL.
- Owner page: Argon2id, sessions stored as SHA-256 hashes, lockout, Origin check on writes, strict CSP, 16 KB body
  limit, values written with `textContent`.
- Delivery is idempotent per alert and channel; decisions and rule state commit together.
