# TASKS

Persistent execution state for Stark (standard §14). Product questions live in `SPEC.md` §5; they are not
repeated here.

Status: `[ ]` open · `[~]` in progress · `[x]` done · `[!]` blocked (say on what)
Tick a task only with evidence: the commit, the file created, or the command run and its result.

---

## Current Phase — Phase 0: Discovery

> Started 2026-10-03 on the PO's instruction to set up the repository structure.

- [x] **S0-1. Engineering package** — `CLAUDE.md`, `SPEC.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TASKS.md`, and the
  `engineering-playbook` skill with section 11 written for Stark (`.claude/skills/engineering-playbook/`).
- [ ] **S0-2. Open questions answered** — `[!]` waiting on the PO: `SPEC.md` §5, Q-01 to Q-09.
  *Done when:* every question has a row in `SPEC.md` §6.
- [ ] **S0-3. Problem, scope, actors, success criteria** written from the answers (`SPEC.md` §2–4, §9).

## Next Phases (not started)

Detailed tasks are written when the phase becomes current. Order from the standard §2.2 and §4–10.

- **Phase 2 — Architecture:** fill `ARCHITECTURE.md`; choose the stack (Q-08).
- **Phase 3 — Contracts:** `API.md`, `DATABASE.md`, event contracts; AI contracts if Q-07 says yes.
- **Phase 4 — Security:** threat model in `SECURITY.md` §2.
- **Phase 5 — Foundation:** project skeleton, lint / typecheck / test / build commands, CI workflow, `.env.example`,
  fakes for every external system; `CLAUDE.md` §8 lists the commands.
- **Phase 6 — First feature**, test-first.
- **Gate A-1 — MSAP audit** (`SPEC.md` D-02): Modes A + B once Phase 6 works end to end on fakes. Ask the PO
  before starting (D-05). No real alert is sent until A-1 passes its Stop Gate; findings are fixed only in a
  separate, PO-authorised remediation change, then re-audited (MSAP §28–29).

---

## Discovered Work

- [ ] **No CI yet.** There is nothing to check until Phase 5. Add the workflow with the first code.
- [ ] **`tdd` skill not copied.** The avengertech copy's "AvengerTech" section is specific to that repo. Copy it
  in Phase 5 with a Stark section that names this repo's commands.
- [ ] **`.gitignore` is the generic Node template.** Review it once the stack is chosen.
- [ ] **MSAP V1.0 path in `AvengerTechLab/avengertech` not confirmed** (`SPEC.md` D-03). The PO supplied the file in
  a session on 2026-10-03; adding it to avengertech is outside this repository's scope. Once it is there,
  `CLAUDE.md` §6a names its path. Needed before gate A-1.

---

## Done

(nothing yet)
