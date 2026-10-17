# Stark — Specification (Phase 0: Discovery)

Status: **discovery complete** (2026-10-03). Q-16 (hosting provider and budget) is deferred (D-26); Phase 4 questions
are answered. Every decision appears in §6
with who decided and when.
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

Approved by the PO (D-18), drafted in Thai from D-06 to D-17:

> PO ติดตามราคาคริปโตทั้งราคาบาท (Bitkub) และราคา USDT (Binance) และต้องการรู้ทันทีเมื่อราคาเข้าเงื่อนไขที่ตั้งไว้
> ผ่านช่องทางที่ใช้อยู่ ได้แก่ Telegram, LINE, Discord และอีเมล โดยไม่ต้องเฝ้าหน้าจอ เมื่อ Stark ใช้งานได้ PO จะได้รับแจ้งเตือน
> ภายใน 10 วินาที ไม่พลาด และรู้ทันทีถ้าระบบเองมีปัญหา

In English: the PO follows crypto prices in THB (Bitkub) and USDT (Binance) and wants to know at once when a price
meets a condition they set, on the channels they already use (Telegram, LINE, Discord, email), without watching a
screen. When Stark works, the PO gets each alert within 10 seconds, misses none, and learns at once if Stark itself
has a problem.

## 3. Scope and non-goals

v1 capabilities and their release order are decided (D-06). The market is crypto (D-07), with THB prices from Bitkub
and USDT prices from Binance (D-08). Alerts go to Telegram, LINE, Discord and email, each switchable (D-09). The only
user in v1 is the PO (D-10), and Stark is fully separate from `ai-trading` (D-11).

| Release | Delivers | Uses AI |
|---|---|---|
| v1.0 | Price tracking: read and store market data, and let the user view it. Rule alerts: user-defined, deterministic conditions (for example a price crossing a level) that send an alert | No |
| v1.1 | Summary reports (daily or weekly market summary) from fixed templates (D-12) | No |
| v1.2 | News analysis: summarise or classify market news | Yes |

Non-goals, confirmed by the PO (D-18):

| Area | Proposed non-goal |
|---|---|
| Market data | Markets other than crypto, and providers other than Bitkub and Binance, in v1.0 |
| Alerts | AI-generated trade signals; AI deciding whether an alert fires (`CLAUDE.md` §4) |
| Trading | Automated order placement (`CLAUDE.md` §4) |
| AvengerTech site | Feeding the site's Lab status and activity (later, backlog 3.0) |

## 4. Actors

Derived from D-06 to D-11.

| Actor | Kind | Needs from Stark / role |
|---|---|---|
| PO | The only user in v1 (D-10) | View THB and USDT prices; create, change and remove alert rules; switch channels on or off; receive alerts; from v1.1 read summary reports, from v1.2 news analysis |
| Bitkub, Binance | External data sources (D-08) | Supply market data; Stark only reads |
| Telegram, LINE, Discord, email | External alert channels (D-09) | Deliver alerts to the PO |

## 5. Open questions

Each needs a PO answer before the phase it blocks. Answers move to §6.

| ID | Question | Blocks | Options (recommendation in bold) |
|---|---|---|---|
| Q-01 | ~~What must v1 do?~~ Answered: D-06 | — | — |
| Q-02 | ~~Which market(s)?~~ Answered: D-07 | — | — |
| Q-03 | ~~Which data provider, and is a paid plan acceptable?~~ Answered: D-08 | — | — |
| Q-04 | ~~Which alert channel(s)?~~ Answered: D-09 | — | — |
| Q-05 | ~~Who uses v1?~~ Answered: D-10 | — | — |
| Q-06 | ~~What is Stark's boundary with `ai-trading`?~~ Answered: D-11 | — | — |
| Q-07 | ~~Does Stark use AI, and for what?~~ Answered: D-06, D-12 | — | — |
| Q-08 | ~~Stack and hosting~~ Answered: D-13 (hosting is picked in Phase 2 after reachability tests) | — | — |
| Q-09 | ~~Success criteria~~ Answered: D-14, §9 | — | — |
| Q-10 | ~~Which audits besides A-1?~~ Answered: D-16 | — | — |
| Q-11 | ~~How is email sent; what if LINE's free quota runs out?~~ Answered: D-17 | — | — |
| Q-12 | ~~Which rule types does v1.0 need?~~ Answered: D-19 | — | — |
| Q-13 | ~~How often does a rule alert while its condition stays true?~~ Answered: D-20 | — | — |
| Q-14 | ~~How does the PO manage rules and channels?~~ Answered: D-21 | — | — |
| Q-15 | ~~Which storage engine?~~ Answered: D-22 | — | — |
| Q-16 | Which hosting provider, and what monthly budget? Deferred by the PO (D-26) | Hosting choice (D-13) | Decide together with `ai-trading`'s hosting; Stark's machine must still pass the test in `ARCHITECTURE.md` §8 |
| Q-17 | ~~How is email sent?~~ Answered: D-24 | — | — |
| Q-18 | ~~Is Thailand on Binance's List of Prohibited Countries?~~ Answered: D-27 | — | — |
| Q-19 | ~~Which price does a rule compare?~~ Answered: D-30 | — | — |
| Q-20 | ~~Does reaching the level count?~~ Answered: D-31 | — | — |
| Q-21 | ~~Does a rule already true alert at once?~~ Answered: D-32 | — | — |
| Q-22 | ~~Alert message wording and language~~ Answered: D-33 | — | — |
| Q-23 | ~~How long are stored prices kept?~~ Answered: D-34 | — | — |
| Q-24 | ~~About how many pairs?~~ Answered: D-36 | — | — |
| Q-25 | ~~THB and USDT as two rules?~~ Answered: D-35 | — | — |
| Q-26 | ~~Public or private web page?~~ Answered: D-38 | — | — |
| Q-27 | ~~Second login factor?~~ Answered: D-39 | — | — |
| Q-28 | ~~Database backups?~~ Answered: D-40 | — | — |
| Q-29 | ~~Gmail OAuth scope?~~ Answered: D-41 | — | — |
| Q-30 | ~~Alert send cooldown?~~ Answered: D-42 | — | — |
| Q-31 | ~~Who reports Stark itself down?~~ Answered: D-43 | — | — |
| Q-32 | ~~Gmail limit and the calendar for usage counts?~~ Answered: D-47 | — | — |

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
| D-10 | (Q-05) The only user of v1 is the PO: no user accounts or sign-up. Whatever Stark exposes is still protected so that only the PO can use it | PO | 2026-10-03 | Recommendation accepted: smallest security surface; keeps data use within personal use while provider terms are unread (D-08) |
| D-11 | (Q-06) Stark and `ai-trading` are fully separate in v1: neither calls the other and they share no data. A later link needs its own contract and a re-audit first (Q-10) | PO | 2026-10-03 | Recommendation accepted: keeps v1's boundary simple and avoids two systems diverging on shared data |
| D-12 | (Q-07) v1.1 summary reports are built from fixed templates with deterministic figures, no AI. The monthly model budget for v1.2 news analysis is set by the PO before v1.2 starts, from a cost estimate Claude prepares then | PO (accepted both recommendations) | 2026-10-03 | Keeps v1.0 and v1.1 free of model cost and model error; the budget needs real news volumes and current model prices |
| D-13 | (Q-08) The stack is TypeScript on Node.js. Hosting is picked by the PO in Phase 2 after Claude tests that Bitkub and Binance answer from two or three candidate hosts | PO (accepted both recommendations) | 2026-10-03 | Shares tooling with avengertech; Binance's reported region blocks (HTTP 451) make an untested host a risk |
| D-14 | (Q-09) v1.0 success criteria SC-1 to SC-4 in §9: alerts within 10 seconds, 30 days with no missed or false alerts, failures reported within 15 minutes, 4 weeks of real use | PO (chose all four criteria and each number) | 2026-10-03 | Measurable acceptance for v1.0 |
| D-15 | How SC-1 to SC-4 are measured, as written in §9: SC-1 ends when the channel's API accepts the message, and SC-2 replays the stored price log against the rules | PO (accepted the proposal) | 2026-10-03 | Both can be measured automatically from Stark's side |
| D-16 | (Q-10) Besides A-1, an MSAP audit of the affected area runs before each scope expansion: before v1.1, before v1.2 (adds AI), before any user other than the PO (against D-10), and before any link to `ai-trading` (against D-11). A full audit runs every quarter. Mode C (runtime) only once Stark is hosted, authorised each time. Claude asks the PO before every audit (D-05) | PO (accepted the recommendation) | 2026-10-03 | Audit before risk changes, and catch drift that builds up between releases |
| D-17 | (Q-11) The email sending method is chosen in Phase 2. LINE sends stop when the free monthly quota is reached and the PO is told through another channel; a paid LINE plan needs the PO's approval | PO (accepted the recommendation) | 2026-10-03 | No money is spent without approval (`CLAUDE.md` §6) |
| D-18 | The problem statement in §2 and the five non-goals in §3 | PO ("ใช้ร่างตามนั้น และยืนยันทั้ง 5 ข้อ") | 2026-10-03 | Closes Phase 0 discovery (S0-3) |
| D-19 | (Q-12) v1.0 rule types: price above a level, price below a level, and percentage change compared with the price N minutes earlier, upwards, downwards or either way. Each rule names its pair and its quote (THB or USDT) | PO (chose "ระดับ + เปลี่ยนแปลง %", "เทียบราคา N นาทีก่อน") | 2026-10-03 | The PO wants both level and movement alerts from the first release |
| D-20 | (Q-13) A rule alerts once when its condition becomes true (the price crosses the level, or the change crosses the percentage), and re-arms only after the condition has become false again | PO (accepted the recommendation) | 2026-10-03 | A price hovering at the level does not flood the channels |
| D-21 | (Q-14) The PO manages rules and channels through both a small web page with a single owner login and Telegram bot commands, from v1.0. The bot obeys commands only from the PO's own Telegram chat | PO (chose "ทั้งสองตั้งแต่ v1.0") | 2026-10-03 | The PO wants both ways from the first release |
| D-22 | (Q-15) Storage is PostgreSQL | PO (chose PostgreSQL over the recommended SQLite) | 2026-10-03 | Not stated; leaves room to grow beyond one user |
| D-23 | (Q-16, part) Hosting candidates for the test in `ARCHITECTURE.md` §8: the PO's own machine and one or two low-cost VPS providers in Asia. The budget is still open | PO | 2026-10-03 | Not stated |
| D-24 | (Q-17) Email is sent through the SMTP server of a mailbox the PO already has, with an app password (sign-in method replaced by D-28) | PO (accepted the recommendation) | 2026-10-03 | No new account and no cost |
| D-25 | v1 runs on one always-on host: web page, Telegram bot, feeds, rule engine, dispatcher, health monitor and PostgreSQL together, with the database not reachable from the internet. Vercel is not used for v1: its functions cannot hold the 24-hour price streams SC-1 needs. Feeding the AvengerTech site on Vercel stays a later release (§3) | PO (accepted the recommendation after asking whether Vercel fits) | 2026-10-03 | One place to deploy and secure for one user; avengertech already deploys on Vercel, which suits the later status feed |
| D-26 | (Q-16) The hosting budget is set later and can change. Stark will likely use the same hosting provider as `ai-trading` but its own machine, because `ai-trading` needs Windows Server; the OS for Stark's machine is chosen with the host. Sharing a provider shares no data or calls (D-11 holds) | PO ("ปรับทีหลังได้", "อาจจะคนละเครื่องแต่ host เดียวกัน ขึ้นอยู่กับ spec os") | 2026-10-03 | `ai-trading` needs hosting anyway; one provider for both is simpler to manage |
| D-27 | (Q-18) Thailand is not on Binance's List of Prohibited Countries, so Binance stays the USDT source (D-08) | PO (checked the list: "ไม่อยู่") | 2026-10-03 | Binance Terms of Use clause 2.1(f) |
| D-28 | Stark sends email through the PO's Gmail account signed in with OAuth ("Sign in with Google"), not an app password. This replaces the sign-in method in D-24 | PO (chose OAuth after Google's caveats on app passwords) | 2026-10-03 | Google does not recommend app passwords, they need 2-Step Verification, and Google revokes them when the account password changes |
| D-29 | Close Phase 2 and start Phase 3 (contracts). Hosting (S2-4) is decided later with `ai-trading`'s hosting (D-26) and must be settled before Phase 5; the PO tests Bitkub and Binance from their own machine meanwhile | PO ("ทดสอบบนเครื่องของผม", "ปิด Phase 2 ตอนนี้ เริ่ม Phase 3 (contracts) เลย") | 2026-10-03 | Contracts do not depend on the host |
| D-30 | (Q-19) Rules compare the last traded price, not bid or ask | PO ("ตามคำแนะนำ ทั้งหมด ทีเดียว"; accepted the recommendations for Q-19 to Q-23 and Q-25) | 2026-10-13 | Matches what charts and the exchanges' apps show |
| D-31 | (Q-20) Reaching the level counts: `above` is `price >= level`, `below` is `price <= level` | PO ("ตามคำแนะนำ ทั้งหมด ทีเดียว"; accepted the recommendations for Q-19 to Q-23 and Q-25) | 2026-10-13 | An alert at the exact level the PO typed is what they expect |
| D-32 | (Q-21) A new or re-enabled rule whose condition is already true alerts on its first tick | PO ("ตามคำแนะนำ ทั้งหมด ทีเดียว"; accepted the recommendations for Q-19 to Q-23 and Q-25) | 2026-10-13 | The PO learns at once that the condition already holds |
| D-33 | (Q-22) One short alert message in Thai, the same on every channel, with pair, condition, price, exchange and time (`EVENTS.md` §4) | PO ("ตามคำแนะนำ ทั้งหมด ทีเดียว"; accepted the recommendations for Q-19 to Q-23 and Q-25) | 2026-10-13 | Short enough for every channel |
| D-34 | (Q-23) Stored prices are kept 35 days | PO ("ตามคำแนะนำ ทั้งหมด ทีเดียว"; accepted the recommendations for Q-19 to Q-23 and Q-25) | 2026-10-13 | Covers SC-2's 30-day window with margin |
| D-35 | (Q-25) An alert on both THB and USDT is two rules, one per quote | PO ("ตามคำแนะนำ ทั้งหมด ทีเดียว"; accepted the recommendations for Q-19 to Q-23 and Q-25) | 2026-10-13 | Each quote has its own price, state and history |
| D-36 | (Q-24) The PO expects to watch about 10 pairs (a pair is one coin in one quote, so BTC/THB and BTC/USDT are two). Used for sizing only; the PO can add or remove pairs at any time | PO ("ประมาณ 10 คู่") | 2026-10-14 | Sizes the database: about 30 million price rows over 35 days |
| D-37 | Start Phase 4 (security threat model) with hosting (S3-4) still open; it must be settled before Phase 5 | PO ("เริ่ม Phase 4 ได้เลย") | 2026-10-14 | The threat model does not depend on the host, except host hardening |
| D-38 | (Q-26) The owner web page is reachable only through a private network (for example Tailscale or an SSH tunnel); the host opens no inbound port. Telegram commands work from anywhere | PO ("ตามคำแนะนำทั้งหมด ทีเดียว"; accepted the recommendations for Q-26 to Q-29) | 2026-10-14 | Removes most of the exposure in `SECURITY.md` T-02 to T-05 and T-12 |
| D-39 | (Q-27) No second login factor in v1.0, because the page is private (D-38). If the page ever becomes public, TOTP is added first | PO ("ตามคำแนะนำทั้งหมด ทีเดียว"; accepted the recommendations for Q-26 to Q-29) | 2026-10-14 | A password plus lockout is enough behind a private network |
| D-40 | (Q-28) PostgreSQL is backed up daily, encrypted, to storage off the host, and each backup is kept 35 days; where it is stored is decided with hosting (D-26) | PO ("ตามคำแนะนำทั้งหมด ทีเดียว"; accepted the recommendations for Q-26 to Q-29) | 2026-10-14 | Recovery without exposing data; matches the price log retention (D-34) |
| D-41 | (Q-29) The Gmail OAuth grant uses the send-only scope | PO ("ตามคำแนะนำทั้งหมด ทีเดียว"; accepted the recommendations for Q-26 to Q-29) | 2026-10-14 | Stark can send alerts but cannot read the PO's mail |
| D-42 | (Q-30) Rule decisions stay as in D-20, but each rule sends at most once per channel per 5 minutes. A decision inside the cooldown is still stored, and its sends are recorded as skipped (`EVENTS.md` §2.3) | PO ("ทำตามที่คุณแนะนำ"; accepted the recommendations for Q-30 and Q-31) | 2026-10-14 | A price hovering at a level would otherwise use LINE's 300 messages a month in minutes (`SECURITY.md` T-18); SC-2 still sees every decision |
| D-43 | (Q-31) Stark sends a heartbeat to a free uptime monitor outside its host, which tells the PO when heartbeats stop. Which service is chosen with hosting (D-26) | PO ("ทำตามที่คุณแนะนำ"; accepted the recommendations for Q-30 and Q-31) | 2026-10-14 | The health monitor runs inside the process it watches, so it cannot report Stark itself being down (SC-3, `SECURITY.md` T-17) |
| D-44 | Start Phase 5 before hosting is chosen; hosting, and the uptime monitor that goes with it (D-43), must be settled before the first deploy | PO ("เริ่ม Phase 5 ได้เลย", after the recommendation that skeleton, checks and CI do not depend on the host) | 2026-10-14 | Replaces the earlier rule that hosting comes before Phase 5 (D-29, D-37, `TASKS.md` S4-3) |
| D-45 | Tooling: Node.js 22, npm, TypeScript strict, ESLint with typescript-eslint, Vitest, GitHub Actions; no runtime dependencies yet | Claude (developer choice within D-13), **PO to confirm** | 2026-10-14 | Few, widely used tools (`SECURITY.md` T-13); npm ships with Node; Node 22 is the runtime installed and an LTS line |
| D-46 | Start Phase 6 (first feature) with PR #10 not yet merged; build v1.0 test-first until it works end to end on fakes | PO ("เริ่ม Phase 6 ได้เลย") | 2026-10-16 | Foundation is in place and CI is green |
| D-47 | (Q-32) Stark stops Gmail at 400 emails a day, leaving 100 of Google's 500 for the PO's own mail, and stops LINE at 300 a month; both are counted on the Thai calendar (UTC+7) | PO ("ตามคำแนะนำ") | 2026-10-16 | The PO's account shares Google's daily limit with Stark; Thai time is the PO's own day |
| D-48 | The wording of the `below` and `change` alert messages in `EVENTS.md` §4 | PO ("ตามคำแนะนำ") | 2026-10-16 | Extends the D-33 level message in the same style |
| D-49 | PostgreSQL is reached through `pg` (node-postgres) 8.23.1, Stark's first runtime dependency; migrations are plain SQL kept in code (`src/storage/migrations.ts`) with no migration tool | Developer choice, **PO to confirm** (the PO said to go ahead with S6-6) | 2026-10-16 | `pg` is the most widely used PostgreSQL client for Node.js and needs no native build; a migration tool would add dependencies for one small schema (`SECURITY.md` T-13) |
| D-50 | Email alerts go through the Gmail API (`users.messages.send` over HTTPS), not SMTP. The Gmail API accepts the send-only scope `gmail.send` that D-41 chose (Gmail API discovery document, revision 20261012). The access token is refreshed from the stored refresh token (D-28) | Developer choice, **PO to confirm** (the PO said to go ahead with S6-8) | 2026-10-16 | It keeps D-41's send-only grant, uses HTTPS like the other three channels, and needs no SMTP client or new dependency |
| D-51 | The owner password's Argon2id hash is checked with `hash-wasm` 4.12.0 (pure WebAssembly, no dependencies, no native build), Stark's second runtime dependency | Developer choice, **PO to confirm** (the PO said to do S6-10) | 2026-10-17 | Node.js 22 has no Argon2; the other well-known options need native builds (`argon2`: 4 dependencies; `@node-rs/argon2`: 13 platform packages), which widen the supply chain (`SECURITY.md` T-13) |

## 7. Constraints

- Follow the AvengerTech engineering standard and the `engineering-playbook` rules (`CLAUDE.md`).
- No fabricated market data or performance figures (`CLAUDE.md` §3).
- Financial actions require human approval (standard §21).
- Stark goes live only after audit A-1 passes (D-02).

## 8. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Scope overlaps with `ai-trading` | Two systems doing the same job, diverging data | Kept fully separate in v1 (D-11); any later link needs a contract and a re-audit first |
| Data provider terms forbid redistribution or storage | Legal exposure; may block alerts to others | Read 2026-10-03: both allow personal, non-commercial use, which fits D-10 (`ARCHITECTURE.md` §2.1). Any user beyond the PO needs Bitkub's written consent and a new review of Binance's terms |
| The PO's country is on Binance's List of Prohibited Countries | Using Binance may break its terms; USDT prices may have to come from elsewhere | Checked by the PO: Thailand is not on it (D-27). The terms read are the ADGM Binance entities'; recheck if Binance moves Thai users to another entity | ~~Is Thailand on Binance's List of Prohibited Countries?~~ Answered: D-27 | — | — |
| LINE's free monthly message quota runs out | LINE alerts stop, or sending more costs money | Count LINE sends and stop at the free quota, then tell the PO (D-17) |
| Binance refuses requests from the hosting region (HTTP 451) | No USDT prices, so USDT alerts fail | Hosting is picked only after Bitkub and Binance are reached from each candidate host (D-13) |
| An alert is read as investment advice | Legal and trust risk | Wording decided by the PO; disclaimer if the audience is beyond the PO |
| Missed or late alerts | The core promise fails silently | Observability and alerting on Stark itself, defined in Phase 2 |

## 9. Success criteria

v1.0 is accepted when all four hold (D-14). The numbers are the PO's.

| ID | Criterion | Target | How it is measured (D-15) |
|---|---|---|---|
| SC-1 | Alerts are timely | Within **10 seconds** of the price meeting the condition, on every channel | From the timestamp of the price update that meets the condition to the moment the channel's API accepts the message. Email is held to the same target because the PO did not exempt it; delivery after the email service accepts the message is outside Stark's control |
| SC-2 | No missed or false alerts | **30 consecutive days** | Replay the stored price log against the stored rules and compare with the alerts actually sent: zero missing, zero extra |
| SC-3 | Stark reports its own failures | Within **15 minutes** | If prices cannot be read or an alert cannot be sent, the PO is told through another working channel; never silent |
| SC-4 | Real use | **4 consecutive weeks** of the PO using Stark | The PO confirms; may overlap with SC-2 |
