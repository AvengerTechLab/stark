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

v1 capabilities and their release order are decided (D-06). The market is crypto (D-07), with THB prices from Bitkub
and USDT prices from Binance (D-08). Alerts go to Telegram, LINE, Discord and email, each switchable (D-09). Users
wait on Q-05.

| Release | Delivers | Uses AI |
|---|---|---|
| v1.0 | Price tracking: read and store market data, and let the user view it. Rule alerts: user-defined, deterministic conditions (for example a price crossing a level) that send an alert | No |
| v1.1 | Summary reports (daily or weekly market summary) | Open: Q-07 |
| v1.2 | News analysis: summarise or classify market news | Yes |

*PO to confirm.* Proposed non-goals:

| Area | Proposed non-goal |
|---|---|
| Market data | Markets other than crypto, and providers other than Bitkub and Binance, in v1.0 |
| Alerts | AI-generated trade signals; AI deciding whether an alert fires (`CLAUDE.md` §4) |
| Trading | Automated order placement (`CLAUDE.md` §4) |
| AvengerTech site | Feeding the site's Lab status and activity (later, backlog 3.0) |

## 4. Actors

*PO to confirm.*

| Actor | Needs from Stark |
|---|---|
| ? | ? |

## 5. Open questions

Each needs a PO answer before the phase it blocks. Answers move to §6.

| ID | Question | Blocks | Options (recommendation in bold) |
|---|---|---|---|
| Q-01 | ~~What must v1 do?~~ Answered: D-06 | — | — |
| Q-02 | ~~Which market(s)?~~ Answered: D-07 | — | — |
| Q-03 | ~~Which data provider, and is a paid plan acceptable?~~ Answered: D-08 | — | — |
| Q-04 | ~~Which alert channel(s)?~~ Answered: D-09 | — | — |
| Q-05 | Who uses v1: only the PO, a team, or the public? | Security model, auth, hosting | **Only the PO** for v1: no accounts, smallest security surface |
| Q-06 | What is Stark's boundary with `ai-trading`? Does either call the other, or share data? | Scope, architecture | — |
| Q-07 | Partly answered by D-06: no AI in v1.0, AI news analysis in v1.2. Still open: are v1.1 summary reports written by AI or by fixed templates, and what monthly model budget is acceptable for v1.2? | v1.1 and v1.2 design, AI contracts, evals, cost | **Fixed templates for v1.1** (deterministic, no model cost); budget set before v1.2 starts |
| Q-08 | Stack and hosting | Phase 2 | **TypeScript on Node.js**, to match the avengertech repo and share tooling; hosting after Q-05, in a region whose IP addresses Binance does not block (D-08) |
| Q-09 | Success criteria: how will we know v1 works? | Acceptance | — |
| Q-10 | Which audits besides A-1 (D-02)? | Audit plan after v1 | **Re-audit the affected area before each scope expansion** (AI per Q-07, users beyond the PO per Q-05, a broker, or a link to `ai-trading` per Q-06); **periodic audit every N features or every quarter, PO to set N**; Mode C (runtime) only once Stark is hosted, authorised each time |
| Q-11 | (from D-09) How is email sent: a mailbox's SMTP or an email-sending service? And if LINE's free monthly message quota runs out, is a paid LINE plan acceptable? | Phase 2 (email), alert volume (LINE) | **Decide the email method in Phase 2**; **for LINE, stop LINE sends at the free quota and tell the PO**, so nothing is spent without approval (`CLAUDE.md` §6) |

## 6. Decisions

| ID | Decision | Who | When | Why |
|---|---|---|---|---|
| D-01 | Start Stark with the Phase 0 engineering package, no code | PO ("เริ่มวางโครงสร้าง repo stark ได้เลย") | 2026-10-03 | Standard §2.2 |
| D-02 | Stark audits follow MASTER SYSTEM AUDIT PROTOCOL (MSAP) V1.0. The first full audit, A-1, runs at the end of Phase 6 (market data → rule → alert works end to end on fakes), Modes A + B, before the first real alert is sent; Stark does not go live until A-1 passes its Stop Gate. No MSAP audit before then: there is no system to reconstruct (MSAP §10) | PO | 2026-10-03 | Audit the real system before it acts on real channels |
| D-03 | The MSAP source file lives in `AvengerTechLab/avengertech` beside the engineering standard; Stark refers to it and keeps no copy | PO | 2026-10-03 | One source of truth for platform standards |
| D-04 | During an audit, its outputs are written outside the repository (no commit, MSAP §3). After the Stop Gate passes they are committed separately to `AUDIT/<audit-id>/` (MSAP §25 file set), documentation only | PO | 2026-10-03 | Keeps the audit read-only and the record in the repo |
| D-05 | Claude asks the PO before starting any audit | PO ("ก่อนเริ่ม audit ถามผมอีกครั้ง") | 2026-10-03 | Starting an audit freezes the repository (MSAP §4) |
| D-06 | (Q-01) v1 covers price tracking, rule alerts, summary reports and news analysis, delivered in stages: v1.0 price tracking and rule alerts with no AI, v1.1 summary reports, v1.2 news analysis with AI. Audit A-1 (D-02) covers v1.0 | PO (chose all four, then "ทยอยส่ง") | 2026-10-03 | Gets alerts working sooner and keeps AI cost and risk out of the first release (standard §2.3) |
| D-07 | (Q-02) The v1 market is crypto | PO | 2026-10-03 | Not stated |
| D-08 | (Q-03) v1.0 reads two sources: THB prices from Bitkub and USDT prices from Binance. The user chooses THB, USDT or both for each alert. Both are used through their free public market-data APIs, with no API key; a paid plan is considered only when a real limit is hit | PO (chose "บาท และ/หรือ USDT", "สองแห่งตั้งแต่ v1.0", "ฟรีก่อน", Bitkub, Binance) | 2026-10-03 | Bitkub is the largest Thai exchange; Binance is the reference USDT price. Facts and caveats in `ARCHITECTURE.md` §2.1 |
| D-09 | (Q-04) v1.0 sends alerts to all four channels: Telegram, LINE, Discord and email. Each channel can be switched on or off for the whole system, and each alert chooses its channels; a channel switched off system-wide sends nothing | PO (chose all four with on/off switches, "ครบ 4 ช่องทางใน v1.0", "ทั้งระบบ + รายแจ้งเตือน") | 2026-10-03 | The PO wants every channel available from the first release. Facts and caveats in `ARCHITECTURE.md` §2.2 |

## 7. Constraints

- Follow the AvengerTech engineering standard and the `engineering-playbook` rules (`CLAUDE.md`).
- No fabricated market data or performance figures (`CLAUDE.md` §3).
- Financial actions require human approval (standard §21).
- Stark goes live only after audit A-1 passes (D-02).

## 8. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Scope overlaps with `ai-trading` | Two systems doing the same job, diverging data | Answer Q-06 before Phase 2 |
| Data provider terms forbid redistribution or storage | Legal exposure; may block alerts to others | Read Bitkub's and Binance's terms before Phase 2 (`TASKS.md` Discovered Work) |
| LINE's free monthly message quota runs out | LINE alerts stop, or sending more costs money | Q-11; count LINE sends and stop at the quota |
| Binance refuses requests from the hosting region (HTTP 451) | No USDT prices, so USDT alerts fail | Choose hosting with Q-08 accordingly; test reachability from the chosen host before Phase 5 |
| An alert is read as investment advice | Legal and trust risk | Wording decided by the PO; disclaimer if the audience is beyond the PO |
| Missed or late alerts | The core promise fails silently | Observability and alerting on Stark itself, defined in Phase 2 |

## 9. Success criteria

*PO to confirm* (Q-09).
