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
- [ ] **S6-2. Rule validation** — `API.md` §1.3 codes, shared by the web API and Telegram commands.
- [ ] **S6-3. Decision pipeline** — tick → one tick per pair per second, late ticks stored not evaluated →
  reference lookup → engine → decision stored before sending (EVENTS.md §2.1–2.2).
- [ ] **S6-4. Dispatcher** — channels on/off (D-09), cooldown (D-42), retries and `Retry-After`, LINE and Gmail
  counters (D-17), dead webhooks, idempotency by alert ID (EVENTS.md §2.3).
- [ ] **S6-5. Alert message** — Thai text (D-33), plain text only (`SECURITY.md` T-20).
- [ ] **S6-6. Storage** — PostgreSQL schema and migrations from `DATABASE.md`; tests against a real PostgreSQL in CI.
- [ ] **S6-7. Feed adapters** — Bitkub and Binance parsing, reconnects, 429 handling, from recorded fixtures.
- [ ] **S6-8. Channel adapters** — Telegram, LINE, Discord, Gmail, against fakes of their HTTP APIs.
- [ ] **S6-9. Health monitor and heartbeat** — EVENTS.md §2.4, D-43.
- [ ] **S6-10. Owner interface** — HTTP API with login (`API.md` §1) and Telegram commands (§2).
- [ ] **S6-11. End to end on fakes** — the whole flow with every external system faked; then ask the PO to start
  gate A-1 (D-05).
- [ ] **S6-12. Hosting** (carried over from S5-6) — must be settled before the first deploy.
- [ ] **S6-13. Google's 7-day refresh token rule** (carried over from S5-7, `SECURITY.md` T-21).

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
