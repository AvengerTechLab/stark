# TASKS

Persistent execution state for Stark (standard §14). Product questions live in `SPEC.md` §5; they are not
repeated here.

Status: `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked (say on what) · `[→]` carried to a later task
Tick a task only with evidence: the commit, the file created, or the command run and its result.

---

## Current Phase — Phase 6: First feature (v1.0 end to end on fakes)

> Started 2026-10-16 on the PO's instruction (`SPEC.md` D-46). Every task is test-first: the test fails on the code
> before the change, then passes. *Phase done when:* v1.0 works end to end on fakes, which opens gate A-1.

- [x] **S6-1. Rule engine** — `src/domain/rules.ts` (EVENTS.md §3: level and percentage rules, crossing and re-arm,
  D-19, D-20, D-31, D-32) on `src/domain/decimal.ts` (exact bigint decimals; comparisons need no division).
  Evidence: 42 domain tests, including every §3.5 example; control runs: `>` for `>=` and "never re-arm" each fail
  2 tests.
- [x] **S6-2. Rule validation** — `src/domain/rule-input.ts`: `API.md` §1.3 codes, one function for the web API and
  the Telegram commands; reports every problem at once; messages never repeat submitted text. Evidence: 16 tests
  (edges 0.01/100 and 1/1,440, JSON numbers refused, wrong-kind and unknown fields); control runs: dropping the
  `FIELD_NOT_ALLOWED` check and dropping the 2-decimal limit each fail 1 test.
- [x] **S6-3. Decision pipeline** — `src/app/pipeline.ts` on the storage ports in `src/ports/storage.ts` (PostgreSQL in
  S6-6; in-memory fakes in `test/fakes/fake-storage.ts`): last tick per pair per second, late ticks stored not
  evaluated, reference lookup, engine, decision stored with the rule state before the dispatcher sees it (EVENTS.md
  §2.1–2.2). Evidence: 16 tests (including storage failures and storage answering out of order); control runs:
  keeping the first tick of a second fails 1 test, dispatching before storing fails 2, no late check fails 1, no
  one-at-a-time processing fails 3.
- [x] **S6-4. Dispatcher** — `src/app/dispatcher.ts` on the `DeliveryLog` port: channels on/off (D-09), cooldown
  (D-42), retries and `Retry-After`, LINE and Gmail counters (D-17; limits are `SPEC.md` Q-32, PO to confirm), dead
  webhooks, idempotency by alert ID, channels in parallel and one send at a time per channel (EVENTS.md §2.3).
  Evidence: 17 tests; control runs: no cooldown fails 2, ignoring `Retry-After` 1, no idempotency check 2, no
  per-channel queue 2, UTC instead of the Thai calendar 2, never marking dead 1. Telling the PO about a failing,
  dead or exhausted channel is S6-9.
- [x] **S6-5. Alert message** — `src/domain/message.ts`: Thai text for `above`, `below` and `change` (D-33; the
  `below` and `change` wording is proposed, PO to confirm, `EVENTS.md` §4). It is plain text built from typed values
  only (`SECURITY.md` T-20). The pipeline fixes the text when it makes the decision and stores it as
  `AlertDecision.message`; the dispatcher sends that text. Thai time is in `src/domain/thai-time.ts`.
  Evidence: 11 new tests, 124 in all. Control runs: a UTC clock fails 6 tests; dropping decimals fails 4; no pair
  check fails 1; taking the direction from the rule instead of the change fails 1.
- [x] **S6-6. Storage** — `src/storage/`: the schema from `DATABASE.md` as migration `001_initial`, and the
  PostgreSQL implementations of every storage port. It uses `pg` 8.23.1 (D-49). The tests run against a real
  PostgreSQL: locally when `STARK_TEST_DATABASE_URL` is set, and always in CI (a PostgreSQL 16 service; CI fails
  without it). They include the pipeline and the dispatcher end to end on PostgreSQL.
  Evidence: 12 tests. Control runs, each failing at least 1 test:
  - state and decision saved outside one transaction
  - failed sends counted toward usage
  - no partition created on demand (3 tests fail)
  - the cooldown counting failed attempts
  - one day too many kept
  - no rule check on an attempt (2 tests fail)

  The cooldown and retention tests at first passed their control runs; both were tightened.
- [x] **S6-7. Feed adapters** — `src/feeds/`, built on what Node.js 22 already has: no new dependency.
  - Bitkub reads the ticker stream; Binance reads the `@trade` stream.
  - REST polling runs while a stream is down.
  - Reconnects back off, and a Binance connection is renewed after 23 hours.
  - `429`, `418`, `403` and `451` are obeyed.
  - Prices are read as exact text (`ARCHITECTURE.md` §2.1).
  - Fixtures are the providers' own documentation examples (`test/feeds/fixtures.ts`). No test opens a real socket.
  - Bitkub gives no price time, so its ticks are timed on arrival (`EVENTS.md` §2.1).

  Evidence: 30 tests (28 feed and 2 for the network layer on a local server), 166 in all with the database.
  Control runs, each failing at least 1 test:
  - ignoring `Retry-After`
  - no 60 s cap on reconnect waits
  - never renewing the connection
  - polls overlapping
  - prices passed through floats (3 tests fail)
  - accepting a zero price (2 tests fail)
  - no pause on `403` or `451`

  One mutation survived: no test caught a poll timer left running after reconnect. It sends no request, because a
  poll first checks the connection.
- [x] **S6-8. Channel adapters** — `src/channels/`: Telegram, LINE, Discord and Gmail on Node.js 22's `fetch`, with no
  new dependency (`ARCHITECTURE.md` §2.2).
  - Telegram sends plain text.
  - LINE uses the alert ID as `X-Line-Retry-Key`, and its 409 counts as delivered.
  - Discord sends with mentions off; a webhook answering 404 is dead.
  - Gmail goes through the Gmail API with the send-only scope (D-50, PO to confirm). It refreshes its token and
    reuses it.
  - Failures are reported only as fixed codes (T-19).

  Evidence: 21 tests against a fake HTTP client; `fetchPost` is tested on a local server; 187 tests in all with the
  database. Control runs, each failing 1 test:
  - Telegram parse mode on
  - error text used as the failure reason
  - no LINE retry key
  - LINE 409 counted as a failure
  - Discord mentions on
  - Discord 404 not dead
  - Gmail token used until the moment it expires
  - Gmail token kept after a 401
  - a line break allowed in the email subject
- [x] **S6-9. Health monitor and heartbeat** — EVENTS.md §2.4–2.5, D-43.
  - `src/app/health.ts` reports stale feeds, failing or dead channels, reached quotas and low disk, through a channel
    other than the one that failed, then reports each recovery once. Timings and wording are proposed, PO to confirm.
  - The dispatcher now reports each channel's final outcome (`onOutcome`).
  - `src/app/heartbeat.ts` pings `HEARTBEAT_URL` every 5 minutes. `src/app/disk.ts` reads free disk.
  - `PgHealthLog` stores each report.

  Evidence: 20 new tests, 207 in all with the database. Control runs, each failing at least 1 test:
  - a report sent through the failing channel
  - no 5-minute wait (5 tests fail)
  - feed recovery never reported
  - a quota reported at every check
  - 20 % still counted as low
  - reports sent through dead channels
  - the dispatcher hiding exhausted failures
  - a heartbeat every 10 minutes (2 tests fail)
- [x] **S6-10. Owner interface** — HTTP API with login (`API.md` §1) and Telegram commands (§2).
  - Part 1 is done: storage, password, pairs and prices.
    - `src/ports/owner.ts` and its PostgreSQL stores: rule admin, channel admin, sessions, failed logins and alert
      history. Each rule or channel change is saved together with its `owner_actions` row (T-22).
    - `verifyPassword` (Argon2id only, `hash-wasm`, D-51).
    - `PairCatalog`, from Bitkub `market/symbols` and Binance `exchangeInfo`.
    - `PriceBoard`.
  - Evidence: 11 new tests, 218 in all with the database. Control runs, each failing 1 test:
    - an update of a missing rule reported as success
    - old channels kept on update
    - a session still valid at its expiry
    - a failed refresh emptying the pair list
    - inactive Bitkub pairs listed
    - any Argon2 variant accepted (this one first survived; it is now tested with a real Argon2i hash)
    - an action kept for a delete of nothing
  - Part 2 is done: the shared rule service, the HTTP API and the web page.
    - `src/app/owner-service.ts` holds the rule and channel operations that the web page and Telegram share.
    - `src/interface/http-server.ts` is the API with login, lockout, Origin check and security headers (`API.md` §1).
    - `src/interface/web.ts` is the owner page.
    - `HealthMonitor.snapshot()` serves `/health` and `/healthz`.
  - Evidence: 27 new tests (9 service, 17 HTTP on a local server, 1 snapshot), 245 in all with the database. Control
    runs, each failing at least 1 test:
    - no Origin check
    - the raw session ID stored (9 tests fail)
    - the lock counted only over the last 15 minutes
    - a cookie readable by script, or `Lax` (2 tests fail)
    - no CSP
    - no body size limit (this one first survived; the test now pads a valid rule)
    - a changed rule keeping its state (2 tests fail)
  - Part 3 is done: the Telegram commands.
    - `src/interface/telegram-bot.ts` does long polling and handles every command in `API.md` §2.
    - It obeys only the PO's private chat.
    - `/delete` asks for confirmation, which counts within 60 s.
    - `channelOverview` is shared with the web page.
  - Evidence: 11 new tests, 256 in all with the database. Control runs, each failing at least 1 test:
    - group chats obeyed
    - a late yes accepted
    - a yes counted after another command
    - unconfigured channels used (2 tests fail)
    - the poll offset never advanced
- [x] **S6-11. End to end on fakes** — the whole flow with every external system faked.
  - `src/app/stark.ts` (`startStark`) is the one place where every component is built and joined, and `src/index.ts`
    gives it the real PostgreSQL, sockets, HTTP and timers.
  - What it starts:
    - migrations and partitions at start, and once a day after that (D-34)
    - the pair lists, refreshed every hour
    - one feed per exchange, for the pairs that have rules, rebuilt when the rules change
    - the pipeline flush every 250 ms
    - the health check every 30 s
    - the heartbeat
    - the web server on `OWNER_HTTP_HOST` and `OWNER_HTTP_PORT` (default 127.0.0.1:8080)
    - the Telegram bot
  - At start, a sweep resends the last 24 hours' decisions that a channel had not finished (ARCHITECTURE.md §7).
  - A bug found and fixed: `GET /alerts` without `to` left out a decision made in the same millisecond.

  Evidence: `test/e2e/stark.test.ts` covers, with every outside system faked and only the web API real on 127.0.0.1:
  - a rule made on the web page fires on Telegram and LINE
  - Telegram commands from the PO only
  - stale-feed and failing-LINE reports
  - the restart sweep and the heartbeat
  - a clean stop
  - no credential in the logs

  Its 8 tests make 268 in all with the database. Control runs, each failing at least 1 test:
  - no restart sweep
  - feeds not rebuilt on a rule change (3 tests fail)
  - ticks never flushed
  - the heartbeat not stopped
  - health never seeing ticks
  - health never seeing channel outcomes

  The last two first survived; 2 tests were added. Gate A-1 waits for the PO's go-ahead (D-05).
- [!] **S6-12. Hosting** (carried over from S5-6) — must be settled before the first deploy.
  - Decided on 2026-10-17:
    - the host: a Linux VPS in Asia from `ai-trading`'s provider, on its own machine (D-52)
    - the PO reaches the web page through an SSH tunnel (D-53)
    - the Google project is published "In production" (D-54)
  - Decided on 2026-10-19: the machine is a VisperHost "Cloud VPS 02" in Bangkok, rented month to month, not shared
    with the PO's POS project (D-56, which replaces the provider in D-52).
  - Blocked on the PO: renting the machine and a run of `scripts/hosting-check.mjs` on it. The budget stays open under
    D-26.
  - Prepared beforehand:
  - `scripts/hosting-check.mjs` is a read-only check to run on each candidate. It covers three REST calls and both
    WebSocket streams.
  - `deploy/stark.service` is a hardened systemd unit for a Linux host.
  - `ARCHITECTURE.md` §8.1 lists the host requirements and compares a Linux VPS with Railway, with a recommendation
    marked PO to confirm.
  - Evidence: `node --check` on the script and lint passing. The script was not run here: it calls the providers,
    which only the PO does on a candidate host.
- [x] **S6-13. Google's 7-day refresh token rule** (carried over from S5-7, `SECURITY.md` T-21).
  - Read on 2026-10-17 in Google Cloud Platform Console Help, "Manage App Audience"
    (`support.google.com/cloud/answer/15549945`): a test user's authorization, and its refresh token, expire seven
    days from consent; `gmail.send` is not one of the exempt scopes.
  - `developers.google.com` is blocked from this session; the help page is Google's own.
  - Recorded in `ARCHITECTURE.md` §2.2 and T-21. The PO chose to publish "In production" and accept the warning (D-54).

## Next Phases (not started)

Detailed tasks are written when the phase becomes current. Order from the standard §2.2 and §4–10.

- **AI contracts** before v1.2 (`SPEC.md` D-06).
- **Gate A-1 — MSAP audit** (`SPEC.md` D-02): Modes A + B once Phase 6 works end to end on fakes. Ask the PO
  before starting (D-05). No real alert is sent until A-1 passes its Stop Gate; findings are fixed only in a
  separate, PO-authorised remediation change, then re-audited (MSAP §28–29).
- **Later audits** (`SPEC.md` D-16): before v1.1, before v1.2, before any user other than the PO, before any link to
  `ai-trading`, and a full audit every quarter. Ask the PO before each (D-05).

---

## Discovered Work

- [ ] **CI actions on Node.js 20.** GitHub warns that `actions/checkout@v4` and `actions/setup-node@v4` target the
  deprecated Node.js 20 and are forced onto Node.js 24 (seen on the S6-6 CI run, 2026-10-16). Move to their current
  major versions in a CI change of their own.

- [ ] **`tdd` skill not copied.** The avengertech copy's "AvengerTech" section is specific to that repo. Copying it
  means reading avengertech, which the PO asked this session not to touch; the PO decides when.
- [ ] **MSAP V1.0 path in `AvengerTechLab/avengertech` not confirmed** (`SPEC.md` D-03). The PO supplied the file in
  a session on 2026-10-03; adding it to avengertech is outside this repository's scope. Once it is there,
  `CLAUDE.md` §6a names its path. Needed before gate A-1.

---

## Done

### Phase 5: Foundation (2026-10-14)

> Started 2026-10-14 on the PO's instruction (`SPEC.md` D-44), before hosting is chosen.

- [x] **S5-1. Project skeleton and commands** — `package.json`, `tsconfig.json`, `eslint.config.js`,
  `vitest.config.ts`; tooling in `SPEC.md` D-45. Evidence: `npm run check` green (lint, typecheck, 22 tests, build).
- [x] **S5-2. CI workflow** — `.github/workflows/ci.yml`: `npm ci` → audit → lint → typecheck → test → build.
  First run green on AvengerTechLab/stark#10 at `bd4dc62` (Actions run 38580660498, 2026-10-14).
- [x] **S5-3. `.env.example`** — names only, required and optional channel groups.
- [x] **S5-4. Configuration and logging** — `src/config.ts` (fail-fast, all-or-none channel groups, errors name
  variables only), `src/logger.ts` (JSON, `domain.action_result`, secret redaction by value and by pattern for Telegram bot tokens
  and Discord webhook URLs, `SECURITY.md` T-19); optional `HEARTBEAT_URL` (D-43). Control run: removing the
  redaction makes 2 logger tests fail; the T-19 and heartbeat tests failed before their code was written.
- [x] **S5-5. Interfaces and fakes** — `src/ports/channel.ts`, `src/ports/feed.ts`; `test/fakes/` for all four channels
  and both providers.
- [→] **S5-6. Hosting** (carried to S6-12) — the PO's machine passes (`ARCHITECTURE.md` §8); candidates are a
  Linux VPS or Railway (`ai-trading`'s dashboard host); each must pass the same check. The uptime monitor for the
  heartbeat (`SPEC.md` D-43) is picked with it. Must be settled before the first deploy, not before Phase 6 (D-44).
- [→] **S5-7. Google's 7-day refresh token rule** (carried to S6-13) (carried over from S4-5) for OAuth apps left in "Testing"
  (`SECURITY.md` T-21), in Google's own documentation.

CI green on AvengerTechLab/stark#10.

### Phase 4: Security (2026-10-14)

> Started 2026-10-14 on the PO's instruction (`SPEC.md` D-37).

- [x] **S4-1. Threat model** — `SECURITY.md` §2–4: assets, trust boundaries, 16 threats with controls mapped to the
  contracts; decisions D-38 to D-41.
- [x] **S4-2. Contracts updated for the answers** — `API.md` §1 (private network, no second factor), `SECURITY.md`
  §3–5.
- [→] **S4-3. Hosting** (carried to S5-6) — the PO's machine passes (`ARCHITECTURE.md` §8); provider and budget
  with `ai-trading` (D-26); each VPS candidate needs the same check; the uptime monitor (D-43) is picked with it.
- [x] **S4-4. Threat model additions** — `SECURITY.md` T-17 to T-24 from a second review; decisions D-42 (send
  cooldown) and D-43 (outside heartbeat); controls written into `EVENTS.md` §2.3–2.4, §3.5, `API.md` §1.1, §2,
  `DATABASE.md` `owner_actions` and `ARCHITECTURE.md` §7.
- [→] **S4-5. Check Google's 7-day refresh token rule** (carried to S5-7).

Threat model and decisions D-38 to D-43 done.

### Phase 3: Contracts (2026-10-03 to 2026-10-14)

> Started 2026-10-03 on the PO's instruction (`SPEC.md` D-29).

- [x] **S3-1. Domain and event contracts** — `EVENTS.md`: types, events, rule evaluation, alert message; matches
  `SPEC.md` D-30 to D-33, D-35.
- [x] **S3-2. Owner interface contracts** — `API.md`: HTTP API with owner login, validation and error codes; Telegram
  bot commands.
- [x] **S3-3. Database contract** — `DATABASE.md`: tables, constraints, indexes; retention 35 days (D-34); sized for
  about 10 pairs (D-36).
- [→] **S3-4. Hosting** (carried to S4-3) — the PO's machine passes (`ARCHITECTURE.md` §8). Provider and
  budget still go with `ai-trading` (D-26), and each VPS candidate must pass the same checks. Must be settled before
  Phase 5.

Contracts match every answer (D-30 to D-36).

### Phase 2: Architecture (2026-10-03, closed by `SPEC.md` D-29)

> Started 2026-10-03 on the PO's instruction ("เริ่ม Phase 2 ได้เลย"). Phase 1 of the standard is folded into
> Phase 0 for Stark.

- [x] **S2-1. Design draft** — components, data flow, timing budget, failure handling and hosting test in
  `ARCHITECTURE.md` §4–8. Matches D-19 to D-28.
- [x] **S2-2. Rule semantics** — `SPEC.md` D-19, D-20; reflected in `ARCHITECTURE.md` §4–5.
- [x] **S2-3. Owner interface and storage** — `SPEC.md` D-21 (web page and Telegram bot), D-22 (PostgreSQL).
- [→] **S2-4. Hosting** (carried to S3-4) — candidates decided (`SPEC.md` D-23); one always-on host runs everything, not Vercel
  (D-25). Provider and budget deferred (D-26): likely `ai-trading`'s provider, separate machine. Next: run the checks
  in `ARCHITECTURE.md` §8 from each candidate and record the results here; the PO picks (D-13).
- [x] **S2-5. Email method** — `SPEC.md` D-24 (SMTP of the PO's Gmail), D-28 (signed in with OAuth).
- [x] **S2-6. Provider terms and channel limits read** in primary sources — Bitkub and Binance APIs and terms,
  Telegram, LINE (including the Thailand quota), Discord and Gmail (`ARCHITECTURE.md` §2.1–2.2, each source named);
  Binance's List of Prohibited Countries checked by the PO (`SPEC.md` D-27).

### Phase 0: Discovery (2026-10-03)

> Started 2026-10-03 on the PO's instruction to set up the repository structure.

- [x] **S0-1. Engineering package** — `CLAUDE.md`, `SPEC.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TASKS.md`, and the
  `engineering-playbook` skill with section 11 written for Stark (`.claude/skills/engineering-playbook/`).
- [x] **S0-2. Open questions answered** — Q-01 to Q-11 answered: `SPEC.md` §6 D-06 to D-17 (2026-10-03).
- [x] **S0-3. Problem, scope, actors, success criteria** — problem statement (`SPEC.md` §2) and non-goals (§3)
  approved by the PO (D-18); scope by release (§3), actors (§4) and success criteria (§9) from D-06 to D-17.
