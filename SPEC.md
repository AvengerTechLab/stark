# Stark — Specification (Phase 0: Discovery)

Status: **draft, waiting on the PO.** Nothing below §1 is decided until it appears in §6 with who decided and when.
Structure follows the Discovery outputs in `AVENGERTECH_ENGINEERING_INTEGRATION_SYSTEM_V1.md` §4.

---

## 1. What is known

Evidence only. Each line names its source.

| Fact | Source |
|---|---|
| Stark is "Market Intelligence & Alerting Platform" | this repository's `README.md` (initial commit) |
| Stark is one of six AvengerTech Labs, described as "Market Intelligence & Trading Analysis" | avengertech `src/i18n/locales/en.ts`, `src/data/labs.ts` |
| The AvengerTech site lists Stark as `online` at `/labs/stark` | avengertech `src/data/labs.ts` |
| Stark is the reference implementation for Stage D (apply the engineering standard to modules) | avengertech `TASKS.md`, standard §32 |
| Engineering focus: API, orchestration, DB, workers, contracts. AI focus: reasoning/orchestration, structured outputs, evals | standard §23 |
| The Stark Lab page content (capabilities, architecture, metrics) is still waiting on the PO | avengertech `docs/backlog.md` 2.1 |
| The AvengerTech site expects a live backend for `/api/v1/labs/status` and `/api/v1/activity`; none exists yet | avengertech `docs/backlog.md` 3.0 |
| A separate repository, `AvengerTechLab/ai-trading`, exists and is under active work | session list, 2026-10-03 |

## 2. Problem statement

*PO to write.* One paragraph: who has which problem today, and what changes for them when Stark works.

## 3. Scope and non-goals

*PO to confirm.* Proposed first release, to be accepted or changed:

| Area | Proposed for v1 | Proposed non-goal |
|---|---|---|
| Market data | Read one market's data from one provider | Several markets or providers at once |
| Alerts | User-defined, deterministic rules on that data; send to one channel | AI-generated trade signals |
| Analysis | — | Automated order placement (see `CLAUDE.md` §4) |
| AvengerTech site | — | Feeding the site's Lab status and activity (later, backlog 3.0) |

## 4. Actors

*PO to confirm.*

| Actor | Needs from Stark |
|---|---|
| ? | ? |

## 5. Open questions

Each needs a PO answer before the phase it blocks. Answers move to §6.

| ID | Question | Blocks | Options (recommendation in bold) |
|---|---|---|---|
| Q-01 | What must v1 do? (price tracking, rule alerts, news analysis, reports …) | Scope, everything after | — |
| Q-02 | Which market(s)? (Thai stocks / SET, crypto, forex, US stocks …) | Data provider, data model | — |
| Q-03 | Which data provider, and is a paid plan acceptable? | Architecture, contracts | Decide after Q-02 |
| Q-04 | Which alert channel(s)? (LINE, Telegram, email, web push …) | Architecture, contracts | — |
| Q-05 | Who uses v1: only the PO, a team, or the public? | Security model, auth, hosting | **Only the PO** for v1: no accounts, smallest security surface |
| Q-06 | What is Stark's boundary with `ai-trading`? Does either call the other, or share data? | Scope, architecture | — |
| Q-07 | Does Stark use an AI model in v1, and for what? | AI contracts, evals, cost | **No AI in v1**: deterministic alerts first, AI after rules work (standard §2.3) |
| Q-08 | Stack and hosting | Phase 2 | **TypeScript on Node.js**, to match the avengertech repo and share tooling; hosting after Q-05 |
| Q-09 | Success criteria: how will we know v1 works? | Acceptance | — |

## 6. Decisions

| ID | Decision | Who | When | Why |
|---|---|---|---|---|
| D-01 | Start Stark with the Phase 0 engineering package, no code | PO ("เริ่มวางโครงสร้าง repo stark ได้เลย") | 2026-10-03 | Standard §2.2 |

## 7. Constraints

- Follow the AvengerTech engineering standard and the `engineering-playbook` rules (`CLAUDE.md`).
- No fabricated market data or performance figures (`CLAUDE.md` §3).
- Financial actions require human approval (standard §21).

## 8. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Scope overlaps with `ai-trading` | Two systems doing the same job, diverging data | Answer Q-06 before Phase 2 |
| Data provider terms forbid redistribution or storage | Legal exposure; may block alerts to others | Read the provider's terms during Q-03 |
| An alert is read as investment advice | Legal and trust risk | Wording decided by the PO; disclaimer if the audience is beyond the PO |
| Missed or late alerts | The core promise fails silently | Observability and alerting on Stark itself, defined in Phase 2 |

## 9. Success criteria

*PO to confirm* (Q-09).
