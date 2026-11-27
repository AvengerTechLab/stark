# 02 — Findings

Severity S0 (cosmetic) to S4 (critical); confidence and status per MSAP §20. Each finding states what was observed
(fact) apart from mechanism and impact (interpretation). IDs continue from MSAP-2026-11-04-01 (F-001…F-016) with
F-101 onward. "Reviewer" means one of the three independent read-only reviewers (`06`, `logs/14`, `16`, `19`); every
finding below was checked by the audit lead as stated in its evidence line.

## Summary

| ID | Title | Sev | Conf | Status | Before more real use? |
|---|---|---|---|---|---|
| F-101 | One request with a malformed target ends the Stark process (a browser can send it) | S3 | HIGH | CONFIRMED (P-05, P-06) | **YES** |
| F-102 | A change rule compares against a price from before a gap; false "N minutes" alerts | S2 | HIGH | CONFIRMED (code + SQL) | **YES** (or no change rules) |
| F-103 | Parallel wrong passwords bypass the login lock; every failure past the 5th sends a Telegram notice | S2 | HIGH | CONFIRMED (P-03) | No |
| F-104 | Changing the owner password does not end existing sessions | S2 | HIGH | CONFIRMED (code) | No |
| F-105 | R-1 is incomplete: a provider that accepts connections but never publishes gives ~2 prices a minute, unreported | S2 | HIGH | CONFIRMED (P-07) | No |
| F-106 | R-2 is incomplete: a hanging (not refusing) database exhausts the pool and blocks the report; duplicates on recovery | S2 | MEDIUM | PARTIALLY_CONFIRMED (code) | No |
| F-107 | The daily partition DDL can stall every price write behind the nightly pg_dump; nothing measures pipeline lag | S1 | MEDIUM | CONFIRMED (lock chain on PG 16) | No |
| F-108 | No Host check: a DNS-rebinding page passes the Origin check while the tunnel is open | S1 | HIGH | CONFIRMED (P-04) | No |
| F-109 | Feed health and the price board count ticks the rule engine then discards | S1 | MEDIUM | CONFIRMED (code) | No |
| F-110 | A Binance trade time above 8.64e15 becomes an Invalid Date and silently replaces the held tick | S1 | HIGH | CONFIRMED (reviewer probe + code) | No |
| F-111 | An empty pair list at start refuses every rule create and edit for up to an hour | S1 | HIGH | CONFIRMED (code) | No |
| F-112 | R-4: a confirmation whose reply is lost drops that batch of commands without a trace | S1 | MEDIUM | PARTIALLY_CONFIRMED (code + Bot API text) | No |
| F-113 | No polling during the first connect or a planned reconnect; a hung handshake leaves a gap | S1 | MEDIUM | PARTIALLY_CONFIRMED (code) | No |
| F-114 | A poll already in flight can emit an older price after the stream is back | S1 | MEDIUM | PARTIALLY_CONFIRMED (code) | No |
| F-115 | Health reports bypass the LINE/Gmail quota and usage count | S1 | HIGH | CONFIRMED (code) | No |
| F-116 | Deploy steps: rsync copies `.env.*` to the server; dev dependencies are installed as root on it | S1 | MEDIUM | CONFIRMED (docs) | No |
| F-117 | systemd sandboxing is partial (both units) | S1 | HIGH | CONFIRMED (units; score pending VPS) | No |
| F-118 | How to make the owner password hash is undocumented; any Argon2id parameters are accepted | S1 | MEDIUM | CONFIRMED (docs + code) | No |
| F-119 | Test suite: order-dependent tests, survivors in alert logic, untested composition root | S1 | HIGH | CONFIRMED (runs) | No |
| F-120 | Minor drift and hygiene items (bundle) | S0 | HIGH | CONFIRMED | No |

Re-check of the 16 findings of MSAP-2026-11-04-01: section at the end.

---

## F-101 — One request with a malformed target ends the Stark process
- **Category:** Security / reliability (availability) · **Severity:** S3 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-101, E-102 (P-05, P-06), E-103.
- **Observation:** `ownerHandler` builds `new URL(req.url ?? "/", "http://stark.invalid")` before its `try`
  (`http-server.ts` L221-223); `index.ts` L86 calls it as `void handler(req, res)`; `src/` installs no
  `unhandledRejection` handler. On Node v24.22.2 with the audited build: `GET http://a:99999/ HTTP/1.1` (raw) and
  `curl --path-as-is http://localhost:PORT//` each ended the server process with exit code 1 (`TypeError: Invalid
  URL`). Chromium's `page.goto("http://localhost:PORT//")` did the same.
- **Mechanism:** `new URL("//", base)` throws; the async handler rejects; Node ends the process on an unhandled
  rejection.
- **Impact:** No login is needed. All feeds, alerts and Telegram commands stop until systemd restarts Stark 5 s later;
  repeated requests keep it down, and each restart reconnects the exchange feeds. Who can send it: any local process on
  the VPS, anything on the PO's Mac while the tunnel is open, and — because a browser sends `//` as is — any web page
  open in the PO's browser while the tunnel is open (for example an image tag pointing at `http://localhost:8080//`;
  some browsers' local-network protections may block or prompt, not tested) and a mistyped address.
- **Root cause:** request parsing outside the error boundary; no process-level guard.
- **Recommendation:** parse the URL inside the `try` (answer 400), and decide a process-level policy for unhandled
  rejections. Until fixed: open the tunnel only while using the page.
- **Immediate action required:** YES.

## F-102 — A change rule compares against a price from before a gap
- **Category:** Correctness / data honesty · **Severity:** S2 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-104.
- **Observation:** `priceAtOrBefore` has no lower bound (`postgres.ts` L170-176: `exchange_time <= $4 ORDER BY
  exchange_time DESC LIMIT 1`); the pipeline passes its result straight to `evaluateRule` (`pipeline.ts` L112-119).
  In `stark_volume`, a cutoff of 2026-11-20 returned the 2026-11-08 23:59:59 tick. `EVENTS.md` §3.3 step 2: "If no such
  tick exists (Stark has not been running that long, or there is a gap) … the condition is false"; §3.5: "Stark started
  10 min ago → Nothing: no reference price yet". The message says `ราคาเมื่อ ${windowMinutes} นาทีก่อน` (`message.ts` L56).
- **Mechanism:** the price log keeps 35 days. Stark only streams pairs that have rules, so a pair's log has gaps
  whenever it had no rule, and Stark itself can be down. The first tick after a gap longer than the window finds a
  reference from before the gap.
- **Impact:** a change rule created for a pair that was watched days ago, or any change rule after a restart or feed
  outage longer than its window, can fire at once with a move measured across hours or days but described as "N นาที".
  A false alert with false text (`CLAUDE.md` §3; SC-2).
- **Recommendation:** bound the reference by age (a PO decision on how old is acceptable); follow §3.3 step 2.
- **Immediate action required:** YES, or create no `change` rules until fixed.

## F-103 — Parallel wrong passwords bypass the lock; one Telegram notice per failure past the 5th
- **Category:** Security · **Severity:** S2 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-105 (P-03), E-106.
- **Observation:** `login` reads the lock (`lockedUntil`) before verifying and records the failure after
  (`http-server.ts` L145-156); nothing serialises logins. P-03: 30 parallel wrong passwords on fakes → 12 were
  checked (401), 18 refused (429); the reviewer saw 40 of 40 checked with a 1 ms store latency. Each failure that
  finds the lock active afterwards calls `notifyOwner(... ล็อก ...)` (L150-154).
- **Impact:** the "5 wrong in 15 minutes" control (`API.md` §1.1, T-02) holds only for sequential guesses; a burst
  multiplies guesses per window and floods the PO's Telegram chat, which may push Telegram rate limits onto real alerts
  (inference). Reachable only through the tunnel or F-108.
- **Recommendation:** serialise login attempts (or count the attempt before verifying) and send one lock notice per lock.

## F-104 — Changing the owner password does not end existing sessions
- **Category:** Security · **Severity:** S2 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-107.
- **Observation:** sessions are deleted only on logout (`postgres.ts` `DELETE FROM owner_sessions WHERE id_hash = $1`,
  called from `http-server.ts` L181); validity checks the hash and expiry only. `deploy/WEB.md` tells the PO to change
  the password at once after an unexpected login notice.
- **Impact:** the documented response to a stolen login leaves the intruder's session valid for up to 7 days.
- **Recommendation:** end all sessions on start when the hash changes (or on demand), and document it.

## F-105 — R-1 is incomplete: open-then-silent cycle
- **Category:** Reliability · **Severity:** S2 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-108 (P-07).
- **Observation:** on open, `failures = 0`, polling stops and the silence timer starts (`stream-feed.ts` L109-114);
  after 60 s of silence the feed closes, polls once and reconnects after 1 s (L136-158). P-07, one fake hour where
  every socket opens and stays silent: 60 sockets, 118 polls, 118 ticks, longest gap 60 s. `tickSeen` forgets an
  unreported stale condition (`health.ts` L104-111); a report needs 60 s + 5 min of continuous staleness.
- **Impact:** in the scenario F-001 described as "a stalled subscription", rules run on about two samples a minute:
  alerts up to ~60 s late, brief crossings missed, and the PO is never told. SC-1 (alerts within 10 s) cannot hold.
  The R-1 test opens only the first socket, so the cycle is untested.
- **Recommendation:** keep polling until the stream has delivered data, back off on repeated silent opens, and report
  a feed that only polls.

## F-106 — R-2 is incomplete: a hanging database
- **Category:** Reliability · **Severity:** S2 · **Confidence:** MEDIUM · **Status:** PARTIALLY_CONFIRMED
- **Evidence:** E-109.
- **Observation:** the pool has pg's defaults (10 clients, no `connectionTimeoutMillis`, no statement or query timeout;
  `index.ts` L46). `storageCheck` races `SELECT 1` against 5 s (L33-43); the losing query keeps its client.
  `report()` awaits `settings.switchedOn()` with no limit (`health.ts` L290). `every()` starts a new run every 30 s
  without waiting for the last (`stark.ts` L76-91).
- **Mechanism (from code; not reproduced):** a frozen database fills the pool after ~10 checks; from 5 minutes on each
  check blocks inside `report()`; when the database answers again, every blocked check sends its own
  "ฐานข้อมูลใช้งานไม่ได้" report.
- **Impact:** in the hang case R-2 targeted, the in-band report does not arrive; the outside monitor still reports Stark
  down (heartbeat withheld). A burst of duplicate reports follows recovery. Overlapping checks can also duplicate other
  reports when a check takes over 30 s.
- **Recommendation:** time-limit every database call on the health path, serialise checks, and give the pool timeouts.

## F-107 — Partition DDL can stall price writes behind pg_dump
- **Category:** Reliability / performance · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** CONFIRMED (mechanism)
- **Evidence:** E-110.
- **Observation:** daily maintenance runs `CREATE TABLE IF NOT EXISTS … PARTITION OF price_ticks` and `DROP TABLE`
  (`postgres.ts` L118-142) every 24 h from process start (`stark.ts` L192); `pg_dump` runs at 03:30 Bangkok. On
  PostgreSQL 16 here: with ACCESS SHARE held 8 s (as pg_dump holds it), the DDL waited 7.0 s and a price INSERT queued
  behind it waited 6.0 s. One pipeline queue serves every pair (`pipeline.ts` L38, L76).
- **Impact:** when the two coincide, every price write and every rule evaluation waits for the dump (13 s for 35 days of
  4 pairs here; longer on the VPS), then runs late; nothing measures pipeline lag. Today's timing does not coincide
  (Stark started 15:30; dump 03:30); a restart near 03:30 would.
- **Recommendation:** schedule maintenance away from the dump, set `lock_timeout` on DDL, and watch pipeline lag.

## F-108 — No Host check (DNS rebinding)
- **Category:** Security · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-111 (P-04).
- **Observation:** `originMatches` compares `Origin` with `Host` only (`http-server.ts` L77-82). P-04: `Host:
  evil.example:8080` with a matching Origin reached the login (401 "wrong password", counted) and `/healthz` (200).
- **Impact:** while the tunnel is open, a page in the PO's browser that rebinds its name to 127.0.0.1 can guess the
  password (with F-103), lock the PO out and flood Telegram. It cannot use a session it does not have
  (`SameSite=Strict`, cookie host).
- **Recommendation:** accept only `localhost:<port>` / `127.0.0.1:<port>` as Host.

## F-109 — Health and the price board count ticks the engine discards
- **Category:** Reliability · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** CONFIRMED (code)
- **Evidence:** E-112.
- **Observation:** `onTick` calls `health.tickSeen`, `board.update`, then `pipeline.receive` (`stark.ts` L133-136); the
  pipeline drops out-of-order ticks and does not evaluate ticks more than 10 s late (`pipeline.ts` L47-53, L89-92).
- **Impact:** with the host clock >10 s ahead of Binance, or a pair blocked by F-009, rules stop firing while health,
  `/healthz` and the price board look normal. Breaks SC-3 in those cases.

## F-110 — Out-of-range Binance trade time
- **Category:** Data validation · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-113.
- **Observation:** `binance.ts` L44 accepts 1–16 digits; `new Date(9999999999999999)` is Invalid Date; in `receive()`
  every comparison with NaN is false, so the code reaches `held.set` and replaces the held valid tick, which is lost
  without a log; the NaN tick is never released.
- **Impact:** a lost price per malformed message. Same root as F-009 (no range check on the trade time).

## F-111 — An empty pair list at start blocks rule changes for up to an hour
- **Category:** Availability (owner interface) · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED (code)
- **Evidence:** E-114.
- **Observation:** the catalog loads once at start and then hourly (`stark.ts` L95-96, L190); a failed load keeps the
  last list, which at start is empty (`pairs.ts` L55-57); create and field edits re-validate the pair
  (`owner-service.ts` L57, L84).
- **Impact:** if Bitkub's or Binance's list endpoint fails at start, every create or edit for that quote answers
  `PAIR_UNKNOWN` for up to an hour. Existing rules keep alerting.

## F-112 — R-4: a lost confirmation reply drops the batch
- **Category:** Reliability · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** PARTIALLY_CONFIRMED
- **Evidence:** E-115.
- **Observation:** when the confirming `getUpdates` fails, the bot returns without handling and keeps the old offset
  (`telegram-bot.ts` L107-111). If Telegram processed the call but the reply was lost (timeout, reset), those updates
  are already confirmed and will not return. No log line names lost commands.
- **Impact:** a command occasionally gets no reply and must be resent. `R-4_REMEDIATION_CONTEXT.md` says the same batch
  is fetched again, which is true only when Telegram did not process the call.

## F-113 — No polling during first connect or planned reconnect
- **Category:** Reliability · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** PARTIALLY_CONFIRMED
- **Evidence:** E-116.
- **Observation:** `start()` and `reconnectNow()` open a socket without polling (`stream-feed.ts` L76-80, L161-169);
  the silence timer starts only on open; `node-network.ts` L11 sets no handshake time limit.
- **Impact:** if a WebSocket upgrade hangs (not fails), that exchange has no prices until it fails; the length depends
  on the runtime's handshake timeout (not verified).

## F-114 — In-flight poll after the stream is back
- **Category:** Data flow · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** PARTIALLY_CONFIRMED
- **Evidence:** E-117.
- **Observation:** `poll()` checks `connected` before the request but only `running` after it (`stream-feed.ts`
  L186-195).
- **Impact:** a poll answered after the stream reconnects emits an older price; for Bitkub it can replace a newer
  stream price in that second ("last tick of a second wins"); for Binance its second can make later trades look out
  of order. Occasional extra decisions; the 5-minute cooldown limits sends.

## F-115 — Health reports bypass quotas
- **Category:** Correctness · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED (code)
- **Evidence:** E-118.
- **Observation:** `report()` calls `channel.send` directly (`health.ts` L298); only the dispatcher records usage
  (`dispatcher.ts` L137).
- **Impact:** once LINE or Gmail is configured, health reports through them are not counted and are sent past Stark's
  own caps (300 a month, 400 a day; D-17, D-47).

## F-116 — Deploy steps: `.env.*` copied; dev dependencies installed as root
- **Category:** Security / operations · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** CONFIRMED (docs)
- **Evidence:** E-119.
- **Observation:** `.gitignore` treats `.env` and `.env.*` as secret; the rsync in `deploy/SETUP.md` §7/§10 excludes
  only `.env`; `chown -R root:root` keeps the Mac's modes (usually 0644). `npm ci` with all dev dependencies runs as
  root on the production host (`SETUP.md` §7/§10, `BACKUP.md` §1).
- **Impact:** a local `.env.local` would land in `/opt/stark`, readable by every account on the VPS (whether one
  exists on the PO's Mac is not known); install scripts of ~150 dev packages run as root beside all secrets (T-13).

## F-117 — systemd sandboxing is partial
- **Category:** Security hardening · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED (unit files)
- **Evidence:** E-120.
- **Observation:** `deploy/stark.service` lacks `RestrictAddressFamilies`, `SystemCallFilter`, `SystemCallArchitectures`,
  `ProtectProc`, `ProcSubset`, `ProtectClock`, `ProtectHostname`, `ProtectKernelLogs`, `RestrictNamespaces`,
  `RestrictRealtime`, `UMask`, `TimeoutStopSec`; `deploy/stark-backup.service` runs as root with the full capability
  set and `ProtectSystem=full`.
- **Impact:** defence in depth only; no exploit shown. `systemd-analyze security` score: see 05 (VPS output).

## F-118 — Owner password hash procedure undocumented; parameters unchecked
- **Category:** Security / operations · **Severity:** S1 · **Confidence:** MEDIUM · **Status:** CONFIRMED
- **Evidence:** E-121.
- **Observation:** `deploy/WEB.md` says to ask Claude for a new hash; no document gives the steps or the parameters.
  `password.ts` L7 and `config.ts` check only the `$argon2id$` prefix.
- **Impact:** pushes the PO towards sharing a password in chat (against `SETUP.md`); a weak hash is accepted silently.

## F-119 — Test suite gaps
- **Category:** Testing · **Severity:** S1 · **Confidence:** HIGH · **Status:** CONFIRMED
- **Evidence:** E-122, E-123, E-124.
- **Observation:**
  - Order dependence: with shuffled order, seeds 6, 7 and 12345 fail the same 2 storage tests (shared schema,
    `channel_settings` state); 10 normal runs and 5 other seeds pass.
  - Mutation score 76.94 % (4,187 mutants: 3,201 killed, 19 timeouts, 726 survived, 239 without coverage). Survivors in
    alert logic, each a regression no test would catch: `rules.ts` L70 (an `up` rule firing on a fall, a `down` rule on a
    rise), `rules.ts` L98 (a fired rule whose condition still holds re-arming, so it fires again), `dispatcher.ts` L89
    (the sweep re-sending an alert already delivered), `rule-input.ts` L90 (a channel list with one unknown name
    accepted).
  - Coverage 92.05 % statements / 89.32 % branches; `index.ts` 35 %, `node-network.ts` 39 %, `backup/main.ts` 47 %
    (the real wiring, as F-012).
- **Impact:** green CI does not guard several alert-correctness properties.

## F-120 — Minor drift and hygiene (bundle)
- **Severity:** S0 · **Confidence:** HIGH · **Status:** CONFIRMED · **Evidence:** E-125.
  1. `/rules` in Telegram shows on/off but not armed/fired, which `API.md` §2 promises ("state").
  2. Leading zeros pass validation and are echoed (`/above BTC/THB 0003500000` → "0,003,500,000"); a percent has no
     length cap.
  3. The price board is never pruned: `/prices` keeps pairs no longer watched.
  4. `EVENTS.md` §2.2 "rounded half-up" vs the code's half away from zero (−5.005 → −5.01).
  5. `DATABASE.md` says Gmail's 500 a day and `price_ticks` keyed by `id`; code uses 400 (D-47) and `(id, exchange_time)`.
  6. Disk share uses `Math.floor(share * 100)` (0.29 → 28 %).
  7. The web page's alert history uses the browser's time zone and the Buddhist year.
  8. `/alerts` with a pattern-valid but impossible time, and `/rules/<36 dashes>`, answer 500 instead of 400.
  9. `DROP TABLE ${name}` formats a catalog name unquoted (only Stark's own DB role could exploit it).
  10. `telegram.command_rejected` is logged for every stranger's message with no rate limit.
  11. Logger redaction covers whole configured values and two patterns; the DB password alone, the runtime Gmail
      access token and Buffers are not covered (no call site logs them today).
  12. Health state lives in memory: a restart loses the "recovered" message of an open condition.

---

## Re-check of MSAP-2026-11-04-01 findings

| ID | Then | Now | Basis |
|---|---|---|---|
| F-001 | S3 open | **RESOLVED** for the open-and-silent socket; residual F-105 | P-01 no longer reproduces (sockets 2, polls 21,541 in 6 h); P-07 |
| F-002 | S3 open | **RESOLVED** for a refusing database; residual F-106 (hang) | R-2 tests; code |
| F-003 | S2 | **OPEN**, extended: a decision is stored and sent for a rule deleted or disabled mid-evaluation | `postgres.ts` L305-322; no FK on `alert_decisions.rule_id` |
| F-004 | S2 | **OPEN** | design unchanged; VPS output pending |
| F-005 | S1 | **RESOLVED**; residual F-112 | R-4 tests |
| F-006 | S1 | **RESOLVED** for the poll loop; the same class of defect exists in the HTTP server (F-101) | R-4 tests; P-05 |
| F-007 | S1 | **OPEN**, extended: a channel sleeping on Retry-After never raises `channel_failing` | `dispatcher.ts` L153-156 |
| F-008 | S1 | **RESOLVED** | R-7; PO's login 2026-11-04 |
| F-009 | S1 | **OPEN** (P-02 reproduces); variant F-110 | P-02 |
| F-010 | S1 | **PARTIAL**: size measured on synthetic data (E-126); a restore with real data is still not done | dimension 7 |
| F-011 | S0 | **OPEN** | unchanged |
| F-012 | S1 | **OPEN** | coverage of `index.ts` 35 %, `node-network.ts` 39 % |
| F-013 | S1 | **OPEN** | `ci.yml` uses `@v7` tags and `postgres:16` |
| F-014 | S1 | **OPEN**, extended: the restart sweep's sleeps can exceed systemd's 90 s stop timeout | `stark.ts` L241-246, `index.ts` L116-120 |
| F-015 | S0 | **RESOLVED**; new drift in F-120 | R-7 |
| F-016 | S0 | **OPEN** (now 10 moderate, all dev) | `npm audit` |
