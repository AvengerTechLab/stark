# Stark — Security

Status: **Phase 4 threat model** (2026-10-14; T-17 to T-24 added from a second review). There is still no code. This file lists what Stark protects, where an
attacker could get in, each threat with its controls, and the gaps. Every control names the contract that specifies
it; Phase 5 and 6 add the file that implements it. Security choices are decided in `SPEC.md` D-38 to D-43. The design reviewed is `ARCHITECTURE.md`, `EVENTS.md`, `API.md` and `DATABASE.md`.

---

## 1. Rules in force now

| Rule | Where |
|---|---|
| No credential is printed, logged or committed; `.env` files are ignored, `.env.example` holds names only | `.gitignore`, `CLAUDE.md` §5 |
| Tests never call a real data provider, broker, channel or model; fakes only | `CLAUDE.md` §5 |
| No order placement without written PO approval and a human approval step | `CLAUDE.md` §4, standard §21 |
| Sending a real alert or spending paid API credits needs the PO's go-ahead | `CLAUDE.md` §6 |

## 2. Assets

| Asset | Why it matters |
|---|---|
| Channel credentials: Telegram bot token, LINE channel access token, Discord webhook URL, Gmail OAuth client secret and refresh token | Anyone holding one can send messages as Stark, or read the PO's Gmail if the OAuth scope is too wide |
| Owner password hash and session cookies | Control of rules and channels |
| PostgreSQL password and data (rules, price log, alert history) | Rules reveal the PO's price levels; the logs are SC-2's evidence |
| Correct alerts | A missed, late or false alert is the core failure (SC-1, SC-2) |
| The host's IP standing with Binance and Bitkub | An IP ban stops price data (`ARCHITECTURE.md` §2.1) |

## 3. Trust boundaries and entry points

| # | Boundary | Direction | Entry point |
|---|---|---|---|
| B1 | Internet → owner web page | Inbound | HTTPS `/api/v1/*` and the page itself (`API.md` §1) |
| B2 | Telegram → bot | Inbound data, outbound connection | Commands in chat. Stark fetches updates by long polling, so no inbound port is needed (proposed) |
| B3 | Bitkub, Binance → feed adapters | Inbound data, outbound connection | Price messages over WebSocket and REST |
| B4 | Stark → Telegram, LINE, Discord, Gmail | Outbound | Alert sends |
| B5 | Stark → PostgreSQL | Local only | Database connection on the same host (D-25) |
| B6 | Host operating system | — | SSH or other administration access |
| B7 | Build → host | — | npm dependencies and the deploy path (Phase 5) |

No boundary needs an inbound port: the web page is reached only through a private network (`SPEC.md` D-38).

## 4. Threats and controls

Likelihood and impact are design judgements for one user and one host, not measurements.

| ID | Threat | Entry | Impact | Controls | Spec |
|---|---|---|---|---|---|
| T-01 | Channel or database credential leaks through code, logs, error messages or backups | B7, logs | High | Secrets only in environment variables read at start; never logged (structured logger with a redaction list); `.env` ignored; error responses carry no internals (`INTERNAL` only); backups daily, encrypted, off the host (D-40) | `CLAUDE.md` §5, `API.md` §1.4 |
| T-02 | Someone guesses or steals the owner password | B1 | High | Argon2id hash only; 5 failures in 15 minutes lock logins for 15 minutes and tell the PO on Telegram; web page reachable only through a private network (D-38); no second factor in v1.0 (D-39) Built: Argon2id via `hash-wasm` (D-51); the lock and the Telegram notice (`src/interface/http-server.ts`). | `API.md` §1.1 |
| T-03 | Session cookie stolen or forged | B1 | High | Random session IDs stored hashed; `HttpOnly`, `Secure`, `SameSite=Strict`; 7-day expiry; logout deletes the session Built: 256-bit IDs, SHA-256 hashes stored, cookie flags as listed, and logout deletes the session. | `API.md` §1.1, `DATABASE.md` |
| T-04 | Cross-site request forgery changes rules | B1 | Medium | `SameSite=Strict`; state-changing requests also require a matching `Origin` header (proposed) Built: a missing or foreign `Origin` gets `403 ORIGIN_INVALID`. | `API.md` §1.1 |
| T-05 | Script injection on the web page through a pair name, error text or provider data | B1, B3 | Medium | All text rendered escaped; strict Content-Security-Policy with no inline script (proposed); pair names checked against the provider's symbol list Built: the CSP above; the page uses `textContent` only, which a test checks. | `API.md` §1.3 |
| T-06 | Someone other than the PO sends Telegram commands | B2 | High | Bot acts only on the PO's chat ID; others get no reply and are logged `telegram.command_rejected`; commands are parsed by fixed code, never by a model | `API.md` §2 |
| T-07 | A wrong or manipulated price from a provider fires a false alert | B3 | Medium | Only the two official market-data endpoints over TLS; decimal parsing rejects malformed values, zero and negative prices, and pairs Stark did not ask for (`src/feeds/`); every tick stored, so any alert can be traced to its tick. A real but erroneous provider price is accepted as a risk: Stark reports what the exchange published | `EVENTS.md` §1–2, `ARCHITECTURE.md` §2.1 |
| T-08 | Stark gets its IP banned by Binance or Bitkub | B3 | High (stops alerts) | Stop and wait on every `429` or `418` until `Retry-After` (Bitkub's documented 30 s without one); at most one poll in flight, once a second; reconnects back off to 60 s (`src/feeds/stream-feed.ts`); never retry blindly; health monitor reports the stale feed within 15 minutes | `ARCHITECTURE.md` §2.1, `EVENTS.md` §2.3–2.4 |
| T-09 | Alert flood exhausts LINE's quota or Gmail's daily limit, or trips Discord's ban | B4 | Medium | One alert per crossing (D-20); usage counters stop LINE at its quota and Gmail before 500 a day; dead Discord webhook not retried | `DATABASE.md` `channel_usage`, `ARCHITECTURE.md` §2.2 |
| T-10 | Gmail OAuth grant allows more than sending | B4 | High | Send-only scope (D-41); refresh token stored as a secret | `SPEC.md` D-28 |
| T-11 | Database reached from outside | B5 | High | PostgreSQL listens on the local host only; its own user with access to Stark's database only; firewall closes its port. SQL injection: every value is a query parameter, and the only names formatted into SQL are partition names built from dates (`src/storage/postgres.ts`) | `SPEC.md` D-25 |
| T-12 | Host taken over | B6 | High | No inbound ports (D-38); SSH by key only; Stark runs as a non-root user; operating system updates applied | Phase 5 host setup |
| T-13 | Malicious or vulnerable npm dependency | B7 | High | Lockfile committed; dependency audit in CI; few, well-known dependencies, pinned to exact versions at least two weeks old. The only runtime dependency is `pg` 8.23.1 (D-49) | Phase 5 CI |
| T-14 | Host clock drifts, so percentage rules use the wrong reference price and SC-1 timing is wrong | — | Medium | Time synchronised with NTP; ticks keep both exchange and received time | `EVENTS.md` §2.1, §3.3 |
| T-15 | Prompt injection through news text | — | Not in v1.0 | No model in v1.0 or v1.1 (D-06, D-12); designed before v1.2 behind the AI orchestrator shape | `ARCHITECTURE.md` §1 |
| T-16 | Market data redistributed against provider terms | B4 | Low in v1 | Alerts go only to the PO (D-10); any wider use needs Bitkub's written consent and a new review of Binance's terms | `ARCHITECTURE.md` §2.1 |
| T-17 | Stark itself stops (process crash, host down) and nobody is told, because the health monitor runs inside the same process (SC-3) | — | High | A process supervisor restarts Stark on crash (proposed); a heartbeat every 5 minutes to an uptime monitor outside the host, which tells the PO after 15 minutes without one (D-43) The heartbeat is built (`src/app/heartbeat.ts`): a ping at start and every 5 minutes, logged without its URL. | `EVENTS.md` §2.4, `ARCHITECTURE.md` §7 |
| T-18 | A price hovering at a level crosses it again and again: D-20 re-arms on every uncrossing, so at one tick a second a rule can alert every 2 seconds and use LINE's 300 messages a month in minutes | B4 | Medium | Usage counters stop LINE and Gmail at their limits (T-09); each rule sends at most once per channel per 5 minutes; decisions inside the cooldown are still stored for SC-2 (D-42) | `EVENTS.md` §2.3, §3.5 |
| T-19 | A secret leaks through a logged URL: Telegram's bot token is part of its API path and the Discord webhook URL is itself the secret, and HTTP client errors often log the full URL | Logs | High | HTTP errors are logged without their URL; the logger's redaction list covers the token and webhook patterns; channel adapters report failures only as fixed codes, never an error's text, tested with an error carrying the token (`src/channels/`) | `CLAUDE.md` §5 |
| T-20 | Injection into an alert message: Telegram markup, a Discord `@everyone` mention, or a line break in an email header | B4 | Medium | Telegram sent without a parse mode; Discord with `allowed_mentions` set to none; the message and email subject built only from typed, validated values (pair checked against the provider's symbol list); a subject with a line break is refused and each email address must be one plain address (`src/channels/`) | `EVENTS.md` §2.3 |
| T-21 | The Gmail refresh token stops working (revoked by the PO or Google), so email alerts stop | B4 | Medium | A failed token refresh is a `channel_failing` health event, reported through another channel (SC-3); the OAuth consent screen is set to "In production", because Google says refresh tokens of an app left in "Testing" expire after 7 days (**not yet read from Google's own documentation**, S4-5) Built: the health monitor reports a refused Gmail token refresh, asking the PO to reconnect Google. | `EVENTS.md` §2.4, `SPEC.md` D-28 |
| T-22 | A stolen session changes rules or switches channels off, and nothing shows who did it | B1 | Medium | A new session ID on every login; a Telegram notice on each successful login; each rule and channel change logged with time and source (web or bot) in `owner_actions` Built: rule and channel changes are saved together with their `owner_actions` row; every login is reported on Telegram. | `API.md` §1.1, `DATABASE.md` `owner_actions` |
| T-23 | The disk fills (about 30 million price rows over 35 days for 10 pairs, `DATABASE.md` §2), writes stop and alerts with them | B5 | Medium | Daily partitions dropped after 35 days; the health monitor raises `disk_low` when free disk falls below 20 % The health monitor checks free disk every 30 s and reports `disk_low` and its recovery once (`src/app/health.ts`). | `DATABASE.md` §1, `EVENTS.md` §2.4 |
| T-24 | A bot command from a group chat that includes the PO, or a `/delete` confirmation answered long after it was asked | B2 | Low | Commands accepted only from a private chat whose ID is the PO's; a yes counts only for the last question and only within 60 s | `API.md` §2 |

## 5. Decisions

| ID | Decision |
|---|---|
| `SPEC.md` D-38 | The web page is reachable only through a private network; no inbound port |
| D-39 | No second login factor in v1.0; TOTP first if the page ever becomes public |
| D-40 | Daily encrypted off-host database backups, kept 35 days |
| D-41 | Gmail OAuth with the send-only scope |
| D-42 | Each rule sends at most once per channel per 5 minutes; decisions are still stored |
| D-43 | Heartbeat to an uptime monitor outside the host |

## 6. Audit

The first security review of the built system is MSAP audit A-1 (`SPEC.md` D-02), MSAP §16, before the first real
alert. This threat model is a design review, not an MSAP audit; A-1 checks the controls above against the code.

## 7. Gaps

| Gap | Closed by |
|---|---|
| No control is implemented yet | Phase 5 (secrets, logging, CI, host) and Phase 6 (interface and feeds), with tests |
| Host hardening steps depend on the host | S3-4 hosting choice |
| Which uptime monitor receives the heartbeat (D-43) | Chosen with hosting, S4-3 |
| Google's 7-day refresh token rule for apps in "Testing" (T-21) is not read from the primary source | S4-5 |
