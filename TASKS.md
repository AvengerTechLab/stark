# TASKS

Persistent execution state for Stark (standard §14). Product questions live in `SPEC.md` §5; they are not
repeated here.

Status: `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked (say on what) · `[→]` carried to a later task
Tick a task only with evidence: the commit, the file created, or the command run and its result.

---

## Current Phase — Phase 4: Security

> Started 2026-10-14 when the PO started the threat-model work. Phase 3's last task, S3-4 hosting, stays open below
> and must be settled before Phase 5.

- [~] **S4-1. Threat model** — `SECURITY.md`: assets, actors, trust boundaries, STRIDE threats T-01 to T-35, controls
  C-1.1 to C-8.3 tied to the contracts, gaps. Draft written; waits on the PO's review.
- [ ] **S4-2. PO answers Q-26 to Q-29** (`SPEC.md` §5): Gmail scope, alert flood cap, public web page, outside
  heartbeat.
- [ ] **S4-3. Apply the contract changes** in `SECURITY.md` §7 to `EVENTS.md`, `API.md`, `DATABASE.md` and
  `ARCHITECTURE.md`, with the answers to S4-2.
- [ ] **S4-4. Verify the two Google facts** in `SECURITY.md` C-4.7 and C-4.8 (SMTP scope, 7-day refresh tokens in
  "Testing") from Google's own documentation.

*Phase done when:* the PO accepts the threat model, Q-26 to Q-29 are answered and the contracts carry every control.

## Phase 3: Contracts (open only for S3-4)

> Started 2026-10-03 on the PO's instruction (`SPEC.md` D-29).

- [x] **S3-1. Domain and event contracts** — `EVENTS.md`: types, events, rule evaluation, alert message; matches
  `SPEC.md` D-30 to D-33, D-35.
- [x] **S3-2. Owner interface contracts** — `API.md`: HTTP API with owner login, validation and error codes; Telegram
  bot commands.
- [x] **S3-3. Database contract** — `DATABASE.md`: tables, constraints, indexes; retention 35 days (D-34); sized for
  about 10 pairs (D-36).
- [~] **S3-4. Hosting carried over from Phase 2** — the PO's machine passes (`ARCHITECTURE.md` §8). Provider and
  budget still go with `ai-trading` (D-26), and each VPS candidate must pass the same checks. Must be settled before
  Phase 5.

*Phase done when:* the three contracts match every answer (done: D-30 to D-36). Only S3-4, hosting, remains; it
must be settled before Phase 5.

## Next Phases (not started)

Detailed tasks are written when the phase becomes current. Order from the standard §2.2 and §4–10.

- **AI contracts** before v1.2 (`SPEC.md` D-06).
- **Phase 5 — Foundation:** project skeleton, lint / typecheck / test / build commands, CI workflow, `.env.example`,
  fakes for every external system; `CLAUDE.md` §8 lists the commands.
- **Phase 6 — First feature**, test-first.
- **Gate A-1 — MSAP audit** (`SPEC.md` D-02): Modes A + B once Phase 6 works end to end on fakes. Ask the PO
  before starting (D-05). No real alert is sent until A-1 passes its Stop Gate; findings are fixed only in a
  separate, PO-authorised remediation change, then re-audited (MSAP §28–29).
- **Later audits** (`SPEC.md` D-16): before v1.1, before v1.2, before any user other than the PO, before any link to
  `ai-trading`, and a full audit every quarter. Ask the PO before each (D-05).

---

## Discovered Work

- [ ] **No CI yet.** There is nothing to check until Phase 5. Add the workflow with the first code.
- [ ] **`tdd` skill not copied.** The avengertech copy's "AvengerTech" section is specific to that repo. Copy it
  in Phase 5 with a Stark section that names this repo's commands.
- [ ] **`.gitignore` is the generic Node template.** Review it in Phase 5 (stack: `SPEC.md` D-13).
- [ ] **MSAP V1.0 path in `AvengerTechLab/avengertech` not confirmed** (`SPEC.md` D-03). The PO supplied the file in
  a session on 2026-10-03; adding it to avengertech is outside this repository's scope. Once it is there,
  `CLAUDE.md` §6a names its path. Needed before gate A-1.

---

## Done

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
