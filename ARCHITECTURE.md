# Stark — Architecture

Status: **Phase 2 draft** (2026-10-03). §1–3 hold the target shape and the decided boundaries. §4–8 are the proposed
design for v1.0; every choice there that is not already in `SPEC.md` §6 is marked **PO to confirm** and listed in
`SPEC.md` §5. The stack is TypeScript on Node.js (D-13).

This file is the "original design" that MSAP audits compare the built system against to find drift (MSAP §18,
`SPEC.md` D-02). Record each boundary and dependency rule here when it is decided.

---

## 1. Layers

From the standard §6. Each layer gets a concrete component in Phase 2.

```text
Market data provider / user / AvengerTech site
        ↓
Interface layer            — API and/or scheduled jobs                     (D-10, D-13)
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
| Stark ↔ alert channels | Telegram, LINE, Discord, email (`SPEC.md` D-09); delivery guarantees, retries, per-channel on/off; facts in §2.2 | Email method: Phase 2; LINE stops at its free quota (`SPEC.md` D-17) |
| Stark ↔ `ai-trading` | None in v1: no calls, no shared data (`SPEC.md` D-11) | — |
| Stark ↔ AvengerTech site | Whether Stark feeds `/api/v1/labs/status` and `/api/v1/activity` (avengertech backlog 3.0); those contracts are fixed in avengertech `src/lib/api/schemas.ts` | Later release |

### 2.1 Data providers (v1.0)

Collected 2026-10-03. "Verified" means read in the provider's own documentation, with the source named; anything
else names its source and must still be checked.

Sources: Bitkub `bitkub/bitkub-official-api-docs` (`rest-v3.md`, `websocket-public.md`, commit `d65eafa`,
2026-09-09); Binance `binance/binance-spot-api-docs` (`rest-api.md`, `web-socket-streams.md`,
`faqs/market_data_only.md`, `CHANGELOG.md`, commit `828ca74`, 2026-09-18).

| | Bitkub (THB) | Binance (USDT) |
|---|---|---|
| Access | Public REST v3 market data, no API key (verified) | Market-data-only hosts need no API key: REST `https://data-api.binance.vision`, streams `wss://data-stream.binance.vision` (verified) |
| Endpoints | `/api/v3/market/symbols`, `ticker`, `bids`, `asks`, `depth`, `trades` (verified) | `GET /api/v3/ticker/price`, `ticker/bookTicker`, `ticker/24hr`, `klines`, `trades`, `exchangeInfo` and others on the market-data host (verified) |
| Rate limit | `ticker`, `symbols`, `trades`: 100 req/sec; `depth`: 10 req/sec; over the limit blocks for 30 s with HTTP 429 (verified) | 6,000 request weight per minute, counted per IP, not per API key (unchanged since 2023-08-25). HTTP 429 when exceeded; continuing after 429 brings an automatic IP ban (HTTP 418) of 2 minutes up to 3 days; `Retry-After` gives the wait. HTTP 403 means a WAF block (verified) |
| Streaming | Public WebSocket, no auth (verified). The `market.trade` stream closed permanently on 2026-05-18 | A connection lasts at most 24 hours, then is closed; server pings every 20 s and expects a pong; at most 5 incoming messages per second per connection, 1,024 streams per connection, 300 connections per 5 minutes per IP (verified) |
| Region | — | Reported to refuse US and many cloud IP ranges with HTTP 451, public endpoints included (web search, several user reports; not in the API docs) |
| Terms of use | Bitkub User Agreement, last updated 2024-08-28 (copy supplied by the PO, 2026-10-03). Clause 4.2.1: prices of digital assets are the Company's Content. 4.2.2: the user may view, download, duplicate, transmit or display Content solely for personal investment or education. 4.2.3: storing, copying or sending Content for commercial purposes or other returns needs prior written consent. 4.1.4: the Public API must not be used in a way that slows or crashes the platform; the Company may limit its use. Stark for the PO alone (`SPEC.md` D-10) fits 4.2.2 | Binance Terms of Use, effective 2026-07-21 (copy supplied by the PO, 2026-10-03; the ADGM Binance entities). Clause 27: licence to use Binance IP only for non-commercial personal or internal business use. Clause 2.1(f): users must not be located in or resident of a jurisdiction where use is illegal or that is on Binance's List of Prohibited Countries; that list is a separate document, not read. Clause 33.11: third-party market data comes with no warranty. Stark for the PO alone fits clause 27; the PO checked that Thailand is not on the list (`SPEC.md` D-27) |

Design notes from the verified facts: reconnect the Binance stream before its 24-hour limit; on any 429 stop and wait
`Retry-After`, never retry blindly (an IP ban would break SC-1 and SC-3); stay on the market-data-only hosts.

### 2.2 Alert channels (v1.0)

Collected 2026-10-03. Each channel sits behind one channel interface so that switching it on or off, retries and
test fakes are the same for all four (`CLAUDE.md` §5).

Sources: Gmail Help on sending limits and app passwords (`support.google.com/mail/answer/22839`, `185833`, read
2026-10-03); Telegram Bot FAQ (`core.telegram.org/bots/faq`, read 2026-10-03); LINE Messaging API pricing
(`developers.line.biz/en/docs/messaging-api/pricing/`, read 2026-10-03); Discord `discord/discord-api-docs`
(`developers/topics/rate-limits.mdx`, commit `c43598d`, 2026-10-02).

| Channel | What Stark needs | Limits and caveats |
|---|---|---|
| Telegram | A bot token and a chat ID | In one chat, avoid more than one message per second; short bursts are allowed, then HTTP 429 (verified). One chat with the PO fits easily |
| LINE | A LINE Official Account with Messaging API (LINE Notify is closed) | Push, multicast, broadcast and narrowcast messages count toward the monthly free quota; reply messages do not; counted per recipient. Past the limit the API returns an error and the message is not sent. The API reports the month's limit and usage (verified). Free quota in Thailand: 300 messages a month on opening an official account (verified: LINE for Business Thailand, `lineforbusiness.com/th/service/line-oa-features/broadcast-message`, read 2026-10-03) |
| Discord | A webhook URL | Global limit 50 requests per second; per-route limits apply per webhook; HTTP 429 with `retry_after`; 10,000 invalid requests (401, 403, 429) per 10 minutes bring a temporary IP ban; a webhook answering 404 must not be used again (verified) |
| Email | The PO's Gmail account over SMTP, signed in with OAuth (`SPEC.md` D-28) | More than 500 recipients in one email or more than 500 emails a day hits the sending limit, which lifts within 1 to 24 hours (verified: Gmail Help, `support.google.com/mail/answer/22839`, read 2026-10-03). Alerts go to one recipient, the PO; the dispatcher counts emails per day and stops before 500, telling the PO through another channel |

Design notes: Stark sends alerts as push messages, so every LINE alert counts toward the quota; the LINE adapter
reads the month's usage from the API to stop at the limit (D-17). A Discord webhook answering 404 is marked dead and
reported (SC-3), not retried.

### 2.3 What the success criteria imply

From `SPEC.md` §9 (D-14), to be designed in Phase 2:

- SC-1 (10 seconds end to end) leaves little room for polling plus four channel sends; Bitkub's public WebSocket
  (§2.1) and Binance's streams are the likely sources, with polling as a fallback.
- SC-2 needs every price update and every alert decision stored, so that a replay can prove nothing was missed.
- SC-3 needs Stark to watch its own data feeds and channels, and to report a failure through a channel other than the
  one that failed.

## 3. Contracts

Written before implementation (standard §7): API, data and event contracts, plus AI contracts
before v1.2 (`SPEC.md` D-06). They go in `API.md` and `DATABASE.md` when Phase 3 starts.

## 4. Components (v1.0, proposed)

One Node.js process on one always-on host for v1.0 (`SPEC.md` D-25): one user (D-10) needs no service split, and one
process keeps SC-1 latency low. Vercel does not fit the core, because its functions end after a time limit and cannot
hold the price streams open. The
boundaries below are module boundaries inside that process, so they can be split later without changing contracts.

| Component | Responsibility | Depends on | Must not depend on |
|---|---|---|---|
| Feed adapters (Bitkub, Binance) | Connect to each provider, turn each message into one normalised `PriceTick`, reconnect, fall back to REST polling | Provider APIs; the `PriceTick` type | Rules, channels, storage |
| Price log | Append every `PriceTick` with exchange time and received time (SC-2 replay) | Storage | Feeds, rules |
| Rule engine | Evaluate each tick against the PO's rules (level above/below, percentage change against the price N minutes earlier: `SPEC.md` D-19) and decide whether an alert fires, once per crossing with re-arm (D-20). Pure, deterministic code with no I/O (`CLAUDE.md` §4); the caller passes in the reference price from the price log | `PriceTick`, `Rule` types only | Anything with I/O |
| Alert dispatcher | Take each alert decision, store it, send to the channels switched on for the whole system and for that rule (D-09), record each delivery result | Channel interface, storage | Provider APIs |
| Channel adapters (Telegram, LINE, Discord, email) | One interface: `send(alert) → delivered / failed(reason)`. LINE counts sends and refuses past the free quota (D-17) | Channel APIs | Rules, feeds |
| Health monitor | Watch feed freshness and delivery failures; tell the PO through a working channel within 15 minutes (SC-3) | Feeds' last-tick times, dispatcher results, channel interface | Rule engine |
| Owner interface | Lets the PO view prices, manage rules and switch channels; only the PO can use it (D-10). Two forms from v1.0 (`SPEC.md` D-21): a web page with a single owner login, and Telegram bot commands accepted only from the PO's chat | Rule store, channel settings, price log | Provider and channel APIs directly |
| Storage | Rules, channel settings, price log, alert decisions, delivery results, in PostgreSQL (`SPEC.md` D-22) | — | — |

Dependency direction: interface and adapters → application (dispatcher, monitor) → domain (rule engine and types).
The domain imports nothing from the layers around it. A test for each adapter uses a fake of the external system
(`CLAUDE.md` §5).

## 5. Data flow

```text
Bitkub / Binance stream ──► feed adapter ──► PriceTick ──► price log (stored)
                                               │
                                               ▼
                                         rule engine (pure)
                                               │ alert decision
                                               ▼
                                   alert decision log (stored)
                                               │
                                               ▼
                         dispatcher ──► each switched-on channel ──► delivery result (stored)
                                               │ failure
                                               ▼
                                         health monitor ──► PO via another channel (SC-3)
```

`PriceTick` (proposed): exchange, symbol, quote currency (THB or USDT), price as a decimal string, exchange time,
received time. Prices are never stored or compared as binary floating point (playbook §6, items 1–4).

Open for Phase 3 contracts: which stored tick counts as "the price N minutes earlier" for a percentage rule
(proposed: the last tick at or before that moment), and what happens when there is no tick that old yet (proposed:
the rule does not fire).

## 6. Timing budget for SC-1 (10 seconds)

| Step | Budget (proposed) | Note |
|---|---|---|
| Provider → Stark | ≤ 2 s | Streams first; REST polling once a second as fallback is well inside Bitkub's 100 req/s (§2.1) |
| Rule evaluation and storage | ≤ 0.5 s | In-process |
| Channel send until the API accepts it | ≤ 7.5 s | Sends to all channels run in parallel; one slow channel does not delay the others |

The budget is checked by measuring each step in tests with fakes and, before A-1, against the real services from the
chosen host.

## 7. Failure handling

| Failure | Behaviour (proposed) |
|---|---|
| Stream drops | Reconnect with backoff; switch to REST polling while down |
| No tick from a provider for 60 s | Mark that feed stale; rules on it do not fire on old prices |
| Feed stale or a channel failing for 15 minutes | Health monitor tells the PO through another working channel (SC-3) |
| Channel send fails | Retry with backoff using the same alert ID, so the channel never gets the same alert twice; record each attempt |
| LINE free quota reached | Stop LINE sends; tell the PO through another channel (D-17) |
| Process restarts | Rules and settings reload from storage; no alert decision is lost because each is stored before it is sent |

The 60-second stale threshold and the retry limits are proposals; they are fixed in Phase 3 contracts.

## 8. Hosting test (D-13)

Before the PO picks hosting, Claude or the PO runs the same read-only checks from each candidate host: Bitkub
`GET /api/v3/market/ticker`, Binance's public ticker, and one WebSocket connection to each, recording the HTTP status
and response time. No API key is used and nothing is sent to any channel. Candidates: the PO's machine and one or two low-cost VPS
providers in Asia (`SPEC.md` D-23); the provider is likely the one `ai-trading` uses, on a
separate machine, and the budget is set later (D-26). PostgreSQL (D-22) runs on the same host and
accepts no connections from the internet (D-25).
