# Stark — Architecture

Status: **not started (Phase 2).** It is written once `SPEC.md` Q-01 to Q-08 are answered. This file holds the
target shape from the engineering standard (§6) so the decisions have a place to land. No technology is chosen.

This file is the "original design" that MSAP audits compare the built system against to find drift (MSAP §18,
`SPEC.md` D-02). Record each boundary and dependency rule here when it is decided.

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

The AI feature approved for v1.2, news analysis (`SPEC.md` D-06), and any later one sit behind the AI orchestrator
shape in the standard §6 (policy/validation → context builder → model → output validator → deterministic business
logic) and never decide an alert or a financial action on their own.

## 2. Boundaries to define

| Boundary | Question | Waits on |
|---|---|---|
| Stark ↔ data providers | Bitkub (THB) and Binance (USDT), decided in `SPEC.md` D-08; facts in §2.1 | Terms of use not yet read |
| Stark ↔ alert channel | Which channel, delivery guarantees, retries | Q-04 |
| Stark ↔ `ai-trading` | Separate, caller, or shared data | Q-06 |
| Stark ↔ AvengerTech site | Whether Stark feeds `/api/v1/labs/status` and `/api/v1/activity` (avengertech backlog 3.0); those contracts are fixed in avengertech `src/lib/api/schemas.ts` | Later release |

### 2.1 Data providers (v1.0)

Collected 2026-10-03. "Verified" means read in the provider's own documentation; anything else names its source and
must be checked before Phase 2.

| | Bitkub (THB) | Binance (USDT) |
|---|---|---|
| Access | Public REST v3 market data, no API key (verified: `bitkub/bitkub-official-api-docs`, `rest-v3.md`, commit `d65eafa`, 2026-09-09) | Public market data, no API key (web search; official docs not reachable from the session that collected this) |
| Endpoints | `/api/v3/market/symbols`, `ticker`, `bids`, `asks`, `depth`, `trades` (verified) | Not yet read |
| Rate limit | `ticker`, `symbols`, `trades`: 100 req/sec; `depth`: 10 req/sec; over the limit blocks for 30 s with HTTP 429 (verified) | 6,000 request weight per minute per IP; HTTP 429 when exceeded (web search) |
| Streaming | Public WebSocket, no auth (verified). The `market.trade` stream closed permanently on 2026-05-18 | Not yet read |
| Region | — | Reported to refuse US and many cloud IP ranges with HTTP 451, public endpoints included (web search, several user reports) |
| Terms of use | Not found yet | Use is under the Binance Terms of Use; redistribution to third parties is not covered by personal use (web search) |



Written before implementation (standard §7): API, data and event contracts, plus AI contracts
before v1.2 (`SPEC.md` D-06). They go in `API.md` and `DATABASE.md` when Phase 3 starts.
