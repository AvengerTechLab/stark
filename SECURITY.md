# Stark — Threat Model and Security Baseline

Status: **Phase 4 draft** (2026-10-14). A design review of v1.0 as written in `ARCHITECTURE.md`, `EVENTS.md`,
`API.md` and `DATABASE.md`, against the decisions in `SPEC.md` §6 up to D-36. There is still no code, so every
control here is a requirement; each names where it is specified and, from Phase 5, the file that implements it.
Choices not already in `SPEC.md` §6 are **proposed**; the ones that change what the PO sees or pays for are marked
**PO to confirm** and listed in `SPEC.md` §5 (Q-26 to Q-29).

Method: assets (§2), actors (§3), trust boundaries (§4), then threats per boundary using STRIDE (§5), with the
control, where it is specified, and what is left (§6–7). This is not an MSAP audit (§9).

---

## 1. System in scope

v1.0 only (`SPEC.md` D-06): price tracking and rule alerts, no AI. One Node.js process and PostgreSQL on one
always-on host; the database accepts no connections from the internet (D-25). The host is not chosen yet (D-26,
`TASKS.md` S3-4), so host controls in §6.7 are written for any provider.

What Stark does **not** do, and this model relies on:

- It places, changes or cancels no orders, and holds no broker or exchange account credentials. Market data is read
  from Bitkub's and Binance's public APIs with no API key (D-08). There is no MT5 connection, no broker MCP server
  and no model in v1.0 (`SPEC.md` §3 non-goals, `CLAUDE.md` §4).
- It shares no data, calls and machine with `ai-trading` (D-11, D-26). A compromise of Stark therefore reaches no
  trading account, and a compromise of `ai-trading` reaches no Stark secret. Any link between them needs its own
  contract, a re-audit (D-16) and, for orders, the PO's written approval and a human approval step (`CLAUDE.md` §4).
- It has one user, the PO (D-10). There are no accounts, sign-up or roles.

## 2. Assets

| ID | Asset | Why it matters | Where it lives |
|---|---|---|---|
| AS-01 | Telegram bot token | Whoever holds it can read the bot's updates (including the PO's commands) and send messages as the bot, so they can send fake alerts | Host environment variable |
| AS-02 | LINE channel access token | Sends pushes as the PO's Official Account and spends its 300-a-month free quota (`ARCHITECTURE.md` §2.2) | Host environment variable |
| AS-03 | Discord webhook URL | The URL is the credential: anyone with it can post to the PO's channel | Host environment variable |
| AS-04 | Gmail OAuth client secret and refresh token (D-28) | Sends mail as the PO; with SMTP the token's scope is the whole mailbox (§6.4, Q-26) | Host environment variable |
| AS-05 | PostgreSQL password | Full read and write of every table | Host environment variable |
| AS-06 | Owner password hash (Argon2id) and live session IDs | A session is full control of rules and channels (`API.md` §1.1) | Hash in an environment variable; session ID hashes in `owner_sessions` |
| AS-07 | The PO's Telegram chat ID | Decides whose bot commands are obeyed (D-21). Not a secret, but changing it hands the bot to someone else | Host environment variable |
| AS-08 | Rules and channel settings | Tampering silences alerts or makes false ones | `rules`, `rule_channels`, `channel_settings` |
| AS-09 | Price log, alert decisions, delivery attempts | The evidence for SC-2 (no missed or false alerts) and the reference prices for percentage rules | `price_ticks`, `alert_decisions`, `delivery_attempts` |
| AS-10 | Channel quotas: LINE 300 a month, Gmail 500 a day (`ARCHITECTURE.md` §2.2) | Spent quota means no alerts on that channel, or paid sends (D-17) | Counted in `channel_usage` |
| AS-11 | Availability of the alert path | The core promise: alerts within 10 s (SC-1), none missed (SC-2), failures reported within 15 min (SC-3) | The process, its feeds and channels |
| AS-12 | Market data held under Bitkub's and Binance's terms | Personal, non-commercial use only (`ARCHITECTURE.md` §2.1); redistribution breaks the terms | Price log, alert messages |

The PO's personal data in Stark is small: their Telegram chat ID, their Gmail address and the rules they set.

## 3. Actors

| Actor | Trust | Can reach |
|---|---|---|
| PO | Trusted; the only user (D-10) | Web page with password, Telegram bot from their own chat |
| Anyone on the internet | Untrusted | Whatever the host exposes: the web page if it is public (Q-28), `GET /healthz`, the bot (anyone can message a Telegram bot) |
| Bitkub, Binance | Trusted for availability only; their data is untrusted input | Stark connects out to them; they never connect in |
| Telegram, LINE, Discord, Google | Trusted to deliver; their responses are untrusted input | Stark connects out; Telegram also delivers the bot's updates (§4, TB-3) |
| Host provider and its staff | Trusted to run the machine; can read disk and memory | Everything on the host |
| Software dependencies (npm packages) | Run with the process's full rights | Everything the process can reach |
| Development agents (Claude Code sessions on this repository) | Trusted for code, never for production | The repository only; they hold no production secret and their tests use fakes (`CLAUDE.md` §5–6) |

## 4. Trust boundaries

```text
                         ┌──────────────────────── host (one machine, D-25) ───────────────────────┐
 PO's browser ──TB-1──►  │  web page + HTTP API ─┐                                                 │
 PO's Telegram ─TB-3──►  │  bot command handler ─┼─► rules / settings ─► rule engine (pure)        │
                         │                       │                          │                      │
 Bitkub / Binance ─TB-2─►│  feed adapters ───────┴─► price log              ▼                      │
                         │                                         dispatcher, health monitor      │
                         │  PostgreSQL (localhost only) ◄──TB-5── all of the above                 │
                         │                                               │                         │
                         └───────────────────────────────────────────────┼─────────────────────────┘
                                                                  TB-4   ▼
                                               Telegram / LINE / Discord / Gmail SMTP ──► PO
 TB-6: host ↔ provider staff, OS, dependencies, operator access (SSH)
 TB-7: repository and CI ↔ production (no production secret crosses it)
```

| ID | Boundary | Direction | Authenticated by |
|---|---|---|---|
| TB-1 | Browser ↔ web page and HTTP API | Inbound | Owner password, session cookie (`API.md` §1.1) |
| TB-2 | Stark ↔ Bitkub, Binance | Outbound only, public data, no key | TLS server certificate only |
| TB-3 | Telegram ↔ bot | Updates fetched by Stark (proposed: long polling, §6.3) | Bot token outbound; PO chat ID check on each command |
| TB-4 | Stark ↔ alert channels | Outbound only | AS-01 to AS-04 |
| TB-5 | Process ↔ PostgreSQL | Local | Database role and password (AS-05) |
| TB-6 | Host ↔ operator, provider, OS, packages | — | SSH keys; provider account |
| TB-7 | Repository and CI ↔ production | — | Nothing crosses it in v1.0 except released code |

## 5. Threats

STRIDE: **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service,
**E**levation of privilege. Likelihood and impact are for one user on one host: H, M or L. "Control" points to §6.

| ID | Boundary | STRIDE | Threat | L | I | Control |
|---|---|---|---|---|---|---|
| T-01 | TB-1 | S | Password guessing against `POST /api/v1/session` | M | H | C-1.1 to C-1.3 |
| T-02 | TB-1 | D | An attacker trips the lockout on purpose so the PO cannot log in | M | L | C-1.3; the bot still works |
| T-03 | TB-1 | S, E | Stolen or fixed session cookie used to change rules or switch channels off | L | H | C-1.4, C-1.5 |
| T-04 | TB-1 | T | Cross-site request forgery: a page the PO visits changes a rule | L | H | C-1.6 |
| T-05 | TB-1 | T, I | Cross-site scripting through values shown on the page (pair names from the providers, error messages) | L | H | C-1.7 |
| T-06 | TB-1 | I | Prices, rules or health details read without a session | L | M | C-1.8 |
| T-07 | TB-1 | T | Malformed or hostile input (JSON numbers as prices, huge bodies, SQL in fields) | M | M | C-1.9, C-5.2 |
| T-08 | TB-1 | I | Traffic read or changed in transit | L | H | C-1.10 |
| T-09 | TB-1 | D | Request flood against the public page or `GET /healthz` slows the process that also evaluates rules (SC-1) | M | M | C-1.11, Q-28 |
| T-10 | TB-2 | S, T | Forged or changed prices through a man in the middle or DNS spoofing | L | H | C-2.1 |
| T-11 | TB-2 | T | A provider sends a wrong, malformed or extreme value (bad tick, symbol renamed) and a false alert fires | M | M | C-2.2, C-2.3 |
| T-12 | TB-2 | D | Feed down, stale, rate-limited (429) or IP-banned (418, 451), so alerts are missed silently | M | H | C-2.4, C-6.1 |
| T-13 | TB-2 | I | Market data redistributed beyond the PO, against the providers' terms | L | M | C-2.5 |
| T-14 | TB-3 | S, E | Someone other than the PO sends bot commands | H | H | C-3.1, C-3.2 |
| T-15 | TB-3 | S | A forged update reaches a bot webhook endpoint | M | H | C-3.3 |
| T-16 | TB-3 | T | A destructive command sent by mistake or replayed | L | M | C-3.4 |
| T-17 | TB-4 | I | A channel secret leaks through logs, error messages, the repository or a backup | M | H | C-4.1 to C-4.3 |
| T-18 | TB-4 | S | A leaked bot token or webhook URL is used to send fake alerts to the PO | L | M | C-4.4 |
| T-19 | TB-4 | T | Injection into an outgoing message: Telegram or Discord markup, `@everyone`, email header injection | L | M | C-4.5 |
| T-20 | TB-4 | D | Alert flood (a price hovering at a level, many rules) spends LINE's or Gmail's quota or hits a rate limit | M | H | C-4.6, Q-27 |
| T-21 | TB-4 | E | The Gmail token is used beyond sending: reading or deleting the PO's mail | L | H | C-4.7, Q-26 |
| T-22 | TB-4 | D | Gmail OAuth refresh token expires or is revoked, so email stops | M | M | C-4.8 |
| T-23 | TB-4 | S | Alerts sent to the wrong recipient | L | M | C-4.9 |
| T-24 | TB-5 | I, T | Database reached from the network, or with a broad role | L | H | C-5.1, C-5.3 |
| T-25 | TB-5 | T | SQL injection | L | H | C-5.2 |
| T-26 | TB-5 | T, R | Price log or decision log changed after the fact, so SC-2 evidence cannot be trusted | L | M | C-5.3, C-5.4 |
| T-27 | TB-5 | R | A rule or channel change made with a stolen session cannot be traced | L | M | C-5.4 |
| T-28 | TB-5 | D | Disk fills (about 30 million price rows over 35 days for 10 pairs, `DATABASE.md` §2) and writes stop | M | H | C-5.5 |
| T-29 | TB-6 | E | Host compromised through SSH, an unpatched service or an open port | L | H | C-7.1 to C-7.3 |
| T-30 | TB-6 | E | Malicious or vulnerable npm dependency | M | H | C-7.4 |
| T-31 | TB-6 | D | Host clock drifts, so ticks look late and are not evaluated (`EVENTS.md` §2.1) | L | M | C-7.5 |
| T-32 | TB-6 | D | The process or host dies; the health monitor runs inside it, so nobody is told (SC-3) | M | H | C-6.2, Q-29 |
| T-33 | TB-7 | I | A production secret in the repository, CI logs or a test fixture | L | H | C-4.1, C-8.1 |
| T-34 | TB-7 | E | A development agent sends a real alert or spends paid credits while working | L | M | C-8.2 |
| T-35 | All | E | Scope grows into trading: an order path, broker credentials or a link to `ai-trading` is added without review | L | H | C-8.3 |

## 6. Controls

"Specified in" names the contract that already says it. **New** means this model adds it; the contract changes are
listed in §7. All are requirements for Phase 5 and 6 and are checked by audit A-1.

### 6.1 Owner web page and HTTP API (TB-1)

| ID | Control | Specified in |
|---|---|---|
| C-1.1 | One owner password, stored only as an Argon2id hash in an environment variable; never logged | `API.md` §1.1 |
| C-1.2 | Password compared through the Argon2id verify function (constant time); the same `401` and timing for every failure | New |
| C-1.3 | After 5 wrong passwords in 15 minutes, logins are refused for 15 minutes and the PO is told on Telegram | `API.md` §1.1 |
| C-1.4 | Session ID: at least 128 random bits from a cryptographic source, stored only as a hash, a new ID on every login, cookie `HttpOnly`, `Secure`, `SameSite=Strict`, 7-day expiry, `DELETE /api/v1/session` revokes it | `API.md` §1.1, `DATABASE.md` §1 (hashes); random length and new-ID-per-login are new |
| C-1.5 | Every successful login is reported to the PO on Telegram, with time and IP address, so a login the PO did not make is seen at once | New (proposed) |
| C-1.6 | CSRF: `SameSite=Strict`, and every state-changing request must be `application/json` with an `Origin` header that matches Stark's own origin, or it is refused | `SameSite` in `API.md` §1.1; the rest is new |
| C-1.7 | XSS: every value is escaped on output, including pair names that come from the providers; a strict `Content-Security-Policy` (no inline script); plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` | New |
| C-1.8 | Every endpoint except `GET /healthz` returns `401` without a valid session; `/healthz` returns only `ok` or `degraded` | `API.md` §1.1–1.2 |
| C-1.9 | Strict validation with error codes; prices and percentages as strings, never JSON numbers; unknown fields refused; request body limited (proposed 16 KB) | `API.md` §1.3; the body limit and unknown fields are new |
| C-1.10 | HTTPS only, HSTS, no plain-HTTP listener except a redirect | `API.md` §1 (HTTPS); HSTS is new |
| C-1.11 | Rate limit per IP on every endpoint (proposed 60 requests a minute), and the HTTP server cannot starve the feed and rule path; best of all, the page is not on the public internet (Q-28) | New; **PO to confirm** Q-28 |

### 6.2 Market data feeds (TB-2)

| ID | Control | Specified in |
|---|---|---|
| C-2.1 | Only `https://` and `wss://` to the providers' documented hosts; TLS certificate checks are never turned off; Binance through its market-data-only hosts | `ARCHITECTURE.md` §2.1; the host allowlist is new |
| C-2.2 | Every incoming price must match `Decimal` (`EVENTS.md` §1) and be greater than 0, or the message is dropped and logged; provider symbols are mapped to `Pair` at the adapter and must match a fixed pattern (proposed `^[A-Z0-9]{1,20}/(THB\|USDT)$`) | `EVENTS.md` §1 (`Decimal`, mapping); the `Pair` pattern is new |
| C-2.3 | A tick more than 10 s after its exchange time is stored but not evaluated; a feed with no tick for 60 s is stale and its rules do not fire on old prices | `EVENTS.md` §2.1, §2.4 |
| C-2.4 | On `429` stop and wait `Retry-After`; never retry blindly (Binance bans the IP after repeated 429s); reconnect Binance streams before 24 hours | `ARCHITECTURE.md` §2.1 |
| C-2.5 | Prices go to the PO only: alerts have fixed recipients (C-4.9) and there is no public price endpoint | `SPEC.md` D-10, `API.md` §1.1 |

Accepted risk: Stark cannot tell a wrong price from a real one when the provider itself sends it. THB and USDT
prices come from different exchanges, so one cannot check the other. A bad tick can cause one false alert; the price
log keeps the evidence (SC-2).

### 6.3 Telegram bot (TB-3)

| ID | Control | Specified in |
|---|---|---|
| C-3.1 | A command is obeyed only when the update's chat is a private chat and its chat ID equals the PO's chat ID from the environment; anything else gets no reply and is logged as `telegram.command_rejected` | `API.md` §2 (chat ID); "private chat only" is new |
| C-3.2 | Commands use the same validation and error codes as the HTTP API | `API.md` §2 |
| C-3.3 | Updates are fetched by long polling (`getUpdates`), so Stark opens no inbound endpoint for Telegram. If a webhook is ever used instead, it must check Telegram's secret-token header on every request | New (proposed) |
| C-3.4 | `/delete` asks yes or no first; a yes counts only for the last question and only for a short time (proposed 60 s); the bot repeats back what each command changed | `API.md` §2 (confirmation); the time limit and echo are new |

### 6.4 Alert channels and secrets (TB-4)

| ID | Control | Specified in |
|---|---|---|
| C-4.1 | Secrets only in environment variables on the host; `.env` ignored by git; `.env.example` names only; nothing secret in the repository, CI or tests | `CLAUDE.md` §5, `.gitignore` |
| C-4.2 | Logs never hold a secret. The structured logger redacts known secret fields, and HTTP client errors are logged without their URL, because Telegram's token is in its API path and Discord's webhook URL is its secret | `CLAUDE.md` §5, playbook §7; the URL redaction is new |
| C-4.3 | Backups, if any, must not contain the environment file; database backups are encrypted (no backup is defined yet, §8) | New |
| C-4.4 | A secret that may have leaked is rotated: new bot token through BotFather, new LINE token, new Discord webhook (the old one deleted), Google token revoked. Rotation steps go in the Phase 5 runbook | New |
| C-4.5 | Messages are sent as plain text: Telegram without a parse mode; Discord with `allowed_mentions` set to none; email subject and headers built only from validated `Pair` values with line breaks refused; the message body is built from typed values, never from raw provider text | New |
| C-4.6 | Quotas are counted in `channel_usage` before each send; LINE stops at the free quota and email before 500 a day, and the PO is told through another channel; retries reuse the alert ID; a `429` waits for `Retry-After`. Whether to add a send cap or a cooldown against flapping is Q-27 | `ARCHITECTURE.md` §2.2, §7; `EVENTS.md` §2.3; `DATABASE.md` §1; `SPEC.md` D-17 |
| C-4.7 | The Google token gets the smallest scope that sends mail. Gmail SMTP with OAuth needs the full-mailbox scope `https://mail.google.com/`; the Gmail API can send with `gmail.send` alone. Recommendation: send through the Gmail API with `gmail.send` (Q-26, **PO to confirm**, as it changes D-28's method) | `SPEC.md` D-28; scope facts from Google's developer documentation, **not yet read from the primary source in this repository**, to verify before Phase 5 |
| C-4.8 | The Google Cloud project's OAuth consent screen is set to "In production", because Google says refresh tokens of an external app left in "Testing" expire after 7 days (same verification note as C-4.7). A failed token refresh is a `channel_failing` health event (SC-3) | `EVENTS.md` §2.4; the rest is new |
| C-4.9 | Recipients are fixed in configuration (the PO's chat, LINE user, Discord webhook, Gmail address), never taken from a rule or a request | New |

### 6.5 Database (TB-5)

| ID | Control | Specified in |
|---|---|---|
| C-5.1 | PostgreSQL listens on localhost (or a local socket) only and the host firewall blocks its port | `SPEC.md` D-25, `ARCHITECTURE.md` §8 |
| C-5.2 | Parameterised queries only; table and column names from one constants module | `DATABASE.md` conventions, playbook §8 |
| C-5.3 | The process connects with its own role, not the superuser. That role can only insert into `price_ticks`, `alert_decisions` and `delivery_attempts`; only the retention job drops old partitions | New (proposed) |
| C-5.4 | Owner actions are logged: each rule or channel change records what changed, when, and whether it came from the web page or the bot, in a new `owner_actions` table; rule changes made from the web page are also echoed to the PO on Telegram | New (proposed); `DATABASE.md` change in §7 |
| C-5.5 | Daily partitions dropped after 35 days; the health monitor warns the PO when free disk falls below a threshold (proposed 20 %) | `DATABASE.md` §1, `SPEC.md` D-34, D-36; the disk warning is new |

### 6.6 Health and availability (SC-3)

| ID | Control | Specified in |
|---|---|---|
| C-6.1 | Feed staleness, channel failures and quota limits are reported within 15 minutes through a channel other than the failing one; recovery is reported once | `EVENTS.md` §2.4, `ARCHITECTURE.md` §7 |
| C-6.2 | A check outside the host notices when Stark itself is down, because a dead process cannot report its own death. Recommendation: Stark sends a heartbeat every few minutes to a monitor outside the host that tells the PO when heartbeats stop (Q-29, **PO to confirm**: it adds an external service) | New |

### 6.7 Host and supply chain (TB-6)

| ID | Control | Specified in |
|---|---|---|
| C-7.1 | Inbound ports: SSH with keys only (no passwords, no root login), and HTTPS only if the page is public (Q-28); everything else closed | New; host chosen later (D-26) |
| C-7.2 | Stark runs as its own unprivileged OS user; the environment file is readable only by that user | New |
| C-7.3 | OS security updates applied automatically or weekly | New |
| C-7.4 | A committed lockfile, installs from it only (`npm ci`), few dependencies, a dependency audit in CI, and every new dependency named in its PR | New; CI arrives in Phase 5 (`TASKS.md`) |
| C-7.5 | Host clock synchronised by NTP; the health monitor reports when received time and exchange time drift apart on every feed at once | New |

### 6.8 Development and scope (TB-7)

| ID | Control | Specified in |
|---|---|---|
| C-8.1 | Tests use fakes for every external system; no test or CI job holds a production secret | `CLAUDE.md` §5 |
| C-8.2 | Sending to a real channel or spending paid credits needs the PO's go-ahead; no real alert before audit A-1 passes | `CLAUDE.md` §6, `SPEC.md` D-02 |
| C-8.3 | No order path, broker credential or link to `ai-trading` without the PO's written approval in `SPEC.md` §6, a human approval step and an audit of the change | `CLAUDE.md` §4, `SPEC.md` D-11, D-16 |

## 7. Contract changes this model asks for

Not applied yet: they follow the PO's review of this model and the answers to Q-26 to Q-29, and land in the
contracts in one change.

| Contract | Change | From |
|---|---|---|
| `EVENTS.md` §1 | `Pair` pattern `^[A-Z0-9]{1,20}/(THB\|USDT)$`; ticks with a non-`Decimal` or zero price are dropped | C-2.2 |
| `API.md` §1.1 | Constant-time verify, new session ID per login, 128-bit IDs, Telegram notice on each login, `Origin` and content-type checks, security headers, HSTS | C-1.2, C-1.4 to C-1.7, C-1.10 |
| `API.md` §1.3 | Unknown fields refused (`FIELD_NOT_ALLOWED`), body size limit (`BODY_INVALID`), rate limit (`429` `RATE_LIMITED`) | C-1.9, C-1.11 |
| `API.md` §2 | Private chat only; confirmation expires; every change is echoed back | C-3.1, C-3.4 |
| `DATABASE.md` §1 | New `owner_actions` table; database roles and grants | C-5.3, C-5.4 |
| `EVENTS.md` §2.4 | New health kinds: `disk_low`, `clock_drift`, `token_refresh_failed` (or folded into `channel_failing`) | C-4.8, C-5.5, C-7.5 |
| `ARCHITECTURE.md` §2.2 | Email method and scope, after Q-26 | C-4.7 |

## 8. Gaps and residual risks

| Gap | Why it is open | Next step |
|---|---|---|
| Whether the web page is public (Q-28) | Hosting is not chosen (D-26) | PO answers Q-28; host picked in S3-4 |
| Gmail scope (Q-26) and the two Google facts in C-4.7 and C-4.8 | Not read from the primary source in this repository | Read Google's documentation; PO answers Q-26 |
| Alert flood cap (Q-27) | D-20 allows one alert per crossing, so a price hovering at a level can alert every few seconds | PO answers Q-27 |
| Stark down with nobody told (Q-29) | The health monitor lives in the process it watches | PO answers Q-29 |
| Backups and restore | Not defined; the price log for SC-2 lives only on one host | Decide with hosting (S3-4) |
| Secret rotation runbook | No secrets exist yet | Phase 5, with `.env.example` |
| Host compromise | One host holds every secret (D-25); accepted for one user | C-7.1 to C-7.4 reduce it; revisit before any second user (D-16) |
| A provider sends a wrong price | Cannot be detected from Stark's side (§6.2) | Accepted; SC-2 evidence kept |

Later releases, assessed before each starts (D-16):

| Release | New threats |
|---|---|
| v1.1 summary reports | None new beyond message size and quota; fixed templates, no AI (D-12) |
| v1.2 news analysis | Prompt injection from news text, model cost abuse, model output presented as advice (`CLAUDE.md` §4). AI contracts come first (`TASKS.md`); the model never decides an alert (`ARCHITECTURE.md` §1) |
| Any user beyond the PO | Accounts, roles, data separation, and the providers' terms (`ARCHITECTURE.md` §2.1) |
| Any link to `ai-trading` or any order path | Broker credentials, financial actions, human approval (C-8.3) |

## 9. Audit

The first security review of the built system is MSAP audit A-1 (`SPEC.md` D-02), MSAP §16, before the first real
alert. It checks each control in §6 against the code. This threat model is a design review, not an MSAP audit.
