# TASKS

Persistent execution state for Stark (standard §14). Product questions live in `SPEC.md` §5; they are not
repeated here.

Status: `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked (say on what)
Tick a task only with evidence: the commit, the file created, or the command run and its result.

---

## Current Phase — Phase 2: Architecture

> Started 2026-10-03 on the PO's instruction ("เริ่ม Phase 2 ได้เลย"). Phase 1 of the standard is folded into
> Phase 0 for Stark.

- [~] **S2-1. Design draft** — components, data flow, timing budget, failure handling and hosting test in
  `ARCHITECTURE.md` §4–8. *Done when:* Q-16 is answered, hosting is picked and the draft matches every answer.
- [x] **S2-2. Rule semantics** — `SPEC.md` D-19, D-20; reflected in `ARCHITECTURE.md` §4–5.
- [x] **S2-3. Owner interface and storage** — `SPEC.md` D-21 (web page and Telegram bot), D-22 (PostgreSQL).
- [ ] **S2-4. Hosting** — candidates decided (`SPEC.md` D-23); one always-on host runs everything, not Vercel
  (D-25). Provider and budget deferred (D-26): likely `ai-trading`'s provider, separate machine. Next: run the checks
  in `ARCHITECTURE.md` §8 from each candidate and record the results here; the PO picks (D-13).
- [x] **S2-5. Email method** — `SPEC.md` D-24 (SMTP of the PO's existing mailbox).
- [~] **S2-6. Provider terms and channel limits read** in primary sources — done for the Bitkub and Binance APIs,
  Telegram, LINE message counting and Discord (`ARCHITECTURE.md` §2.1–2.2, each source named). Still open:
  - `[!]` Bitkub terms and Binance Product Terms: both sites answer automated requests with a bot challenge. Needs the
    PO to save each page as PDF and upload it.
  - `[!]` LINE free quota for Thailand: on `lineforbusiness.com`, not yet an allowed host.
  - `[!]` Email sending limits: waits on the PO naming the mailbox provider.

## Next Phases (not started)

Detailed tasks are written when the phase becomes current. Order from the standard §2.2 and §4–10.

- **Phase 3 — Contracts:** `API.md`, `DATABASE.md`, event contracts; AI contracts before v1.2 (`SPEC.md` D-06).
- **Phase 4 — Security:** threat model in `SECURITY.md` §2.
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

### Phase 0: Discovery (2026-10-03)

> Started 2026-10-03 on the PO's instruction to set up the repository structure.

- [x] **S0-1. Engineering package** — `CLAUDE.md`, `SPEC.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TASKS.md`, and the
  `engineering-playbook` skill with section 11 written for Stark (`.claude/skills/engineering-playbook/`).
- [x] **S0-2. Open questions answered** — Q-01 to Q-11 answered: `SPEC.md` §6 D-06 to D-17 (2026-10-03).
- [x] **S0-3. Problem, scope, actors, success criteria** — problem statement (`SPEC.md` §2) and non-goals (§3)
  approved by the PO (D-18); scope by release (§3), actors (§4) and success criteria (§9) from D-06 to D-17.
