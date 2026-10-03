# Stark — Architecture

Status: **not started (Phase 2).** It is written once `SPEC.md` Q-01 to Q-08 are answered. This file holds the
target shape from the engineering standard (§6) so the decisions have a place to land. No technology is chosen.

---

## 1. Layers

From the standard §6. Each layer gets a concrete component once the stack is decided.

```text
Market data provider / user / AvengerTech site
        ↓
Interface layer            — API and/or scheduled jobs                     (Q-05, Q-08)
        ↓
Application / orchestration — schedules data reads, evaluates alert rules
        ↓
Domain logic               — alert rules, thresholds: deterministic code   (CLAUDE.md §4)
        ↓
Data + external services   — data provider (Q-03), storage, alert channel (Q-04)
        ↓
Observability              — logs, health, alerts on Stark itself
```

If the PO approves an AI feature (Q-07), it sits behind the AI orchestrator shape in the standard §6
(policy/validation → context builder → model → output validator → deterministic business logic) and never decides
an alert or a financial action on its own.

## 2. Boundaries to define

| Boundary | Question | Waits on |
|---|---|---|
| Stark ↔ data provider | Which provider, rate limits, terms of use | Q-02, Q-03 |
| Stark ↔ alert channel | Which channel, delivery guarantees, retries | Q-04 |
| Stark ↔ `ai-trading` | Separate, caller, or shared data | Q-06 |
| Stark ↔ AvengerTech site | Whether Stark feeds `/api/v1/labs/status` and `/api/v1/activity` (avengertech backlog 3.0); those contracts are fixed in avengertech `src/lib/api/schemas.ts` | Later release |

## 3. Contracts

Written before implementation (standard §7): API, data and event contracts, plus AI contracts if Q-07 says yes.
They go in `API.md` and `DATABASE.md` when Phase 3 starts.
