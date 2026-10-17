# stark
Market Intelligence &amp; Alerting Platform

Stark is the AvengerTech Lab for market intelligence and alerting.

**Status: Phase 6, first feature.** The rule engine, rule validation, decision pipeline, dispatcher, alert message, PostgreSQL storage, the Bitkub and Binance feeds, the four channel adapters, the health monitor and the owner interface (web page and Telegram commands) are built; the rest of v1.0 follows test-first. Scope, market,
data providers, alert channels and stack are decided in `SPEC.md` §6; the remaining questions are in `SPEC.md` §5.

| Document | Contents |
|---|---|
| [`SPEC.md`](SPEC.md) | What is known, open questions, decisions, risks |
| [`TASKS.md`](TASKS.md) | Current phase and its tasks |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Components, boundaries, data flow, provider and channel facts |
| [`EVENTS.md`](EVENTS.md), [`API.md`](API.md), [`DATABASE.md`](DATABASE.md) | Contracts: rule evaluation and events, owner interface, database |
| [`SECURITY.md`](SECURITY.md) | Rules in force and threats to design for |
| [`CLAUDE.md`](CLAUDE.md) | Rules for AI agents working in this repository |

Engineering standard: `AVENGERTECH_ENGINEERING_INTEGRATION_SYSTEM_V1.md` in `AvengerTechLab/avengertech`.

Development: Node.js 22. `npm ci`, then `npm run check` (lint, typecheck, test, build). Commands are listed in
`CLAUDE.md` §8.
