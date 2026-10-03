# Stark — Claude Code Project Instructions

Stark is the AvengerTech Lab for market intelligence and alerting. It is the reference module for Stage D of the
AvengerTech engineering roadmap (`AVENGERTECH_ENGINEERING_INTEGRATION_SYSTEM_V1.md` §32, in the
`AvengerTechLab/avengertech` repository).

The platform standard lives in `AvengerTechLab/avengertech`. This file applies it to this repository; it does not
copy it. Where this file is silent, the standard and the avengertech `CLAUDE.md` §19–24 apply.

Load these skills (`.claude/skills/`) before the matching work:

| Skill | Load before |
|---|---|
| `engineering-playbook` | any code or document change, commit or PR (section 11 holds the Stark settings) |

---

## 1. Current phase: Architecture (Phase 2)

The standard says no module starts with "start coding" (§2.2). Phase 0 discovery is complete (`SPEC.md` D-18). Stark
is in Phase 2: the architecture is being designed in `ARCHITECTURE.md`. Code starts in Phase 5 (`TASKS.md`). Until
then:

- Do not add application code, a framework, a package manager or dependencies.
- The stack, data providers and alert channels are decided (`SPEC.md` D-08, D-09, D-13). Do not change them, and do
  not choose hosting, a broker or another exchange. These are PO decisions.
- Documents may describe options and recommend one; they must mark it **PO to confirm**.

The phase order after discovery is in `TASKS.md`.

## 2. Instruction priority

1. Explicit user request
2. Decisions recorded in `SPEC.md` §6 (who decided, when)
3. This file
4. The avengertech engineering standard and `CLAUDE.md`
5. The `engineering-playbook` skill
6. Your own preference

## 3. Data honesty and product facts

- Never invent product facts, market data, prices, signals, performance figures or user counts.
- Demo or sample data is labelled as demo wherever it appears.
- A missing requirement goes to the PO as a question in `SPEC.md` §5, not into the code as an assumption.

## 4. Trading and financial safety

Stark works with market data. These hold regardless of what is built:

- Stark gives information and alerts. It does not place, modify or cancel orders unless the PO approves that scope
  in writing in `SPEC.md` §6, and then only behind a human approval step (standard §21: financial actions are
  review-required).
- Business rules, thresholds, alert conditions and any calculation that drives an alert are deterministic code,
  not model output (standard §2.3).
- An AI-generated text is never presented as investment advice. Wording for this is a PO decision.

## 5. Secrets

- Never print, log or commit a credential (API keys, broker tokens, bot tokens, webhook URLs).
- `.env` files are ignored by `.gitignore`; `.env.example` holds names only, no values.
- Tests use fakes for every external system (market data, brokers, notification channels, model providers).
  No test calls a real service.

## 6. Hard stop — ask before

- any action that sends a message, alert or order to a real account or channel
- any call that spends paid API credits
- choosing or changing the stack, data provider or alert channel
- production infrastructure changes
- force-pushing or rewriting history on a shared branch
- starting an audit (`SPEC.md` D-05)

## 6a. Audits

Audits follow MSAP V1.0 (`SPEC.md` D-02; source file in `AvengerTechLab/avengertech`, D-03). Inside an audit the
repository is frozen: read only, no fix, no commit (MSAP §3). Outputs are written outside the repository and
committed to `AUDIT/<audit-id>/` only after the Stop Gate passes (D-04). A finding is fixed only in a separate
remediation change that the PO authorises (MSAP §28).

## 7. Records

| Record | Holds |
|---|---|
| `TASKS.md` | Current phase, its tasks with evidence, and Discovered Work |
| `SPEC.md` | Problem, scope, non-goals, actors, open questions, decisions (who, when, why) |
| `ARCHITECTURE.md` | Boundaries and layers; filled in as decisions land |
| `SECURITY.md` | Threats, controls and gaps |
| `AUDIT/<audit-id>/` | MSAP audit outputs, committed after the Stop Gate (none yet) |
| Commit message and PR description | Why a change was made (replaces a fix log) |

Update the matching record in the same change. Tick a task only with evidence.

## 8. Commands

None yet: there is no code. The stack is TypeScript on Node.js (`SPEC.md` D-13); Phase 5 adds lint, typecheck, test and
build commands and a CI workflow, and lists them here in CI order.

For a documentation-only change, the report says which checks were skipped and why.

## 9. Reports

Use the avengertech format: **Blocked on me** (when anything waits on the PO), **Changed**, **Verification**
(commands and results, or "not applicable" with the reason), **Not verified**, **Remaining issues**.
Reply in the PO's language (Thai).

> **Define before building. Decide with the PO. Verify before declaring complete.**
