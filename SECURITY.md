# Stark — Security

Status: **Phase 4 threat model** (2026-10-14). There is still no code. This file lists what Stark protects, where an
attacker could get in, each threat with its controls, and the gaps. Every control names the contract that specifies
it; Phase 5 and 6 add the file that implements it. Security choices are decided in `SPEC.md` D-38 to D-41. The design reviewed is `ARCHITECTURE.md`, `EVENTS.md`, `API.md` and `DATABASE.md`.

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
| T-02 | Someone guesses or steals the owner password | B1 | High | Argon2id hash only; 5 failures in 15 minutes lock logins for 15 minutes and tell the PO on Telegram; web page reachable only through a private network (D-38); no second factor in v1.0 (D-39) | `API.md` §1.1 |
| T-03 | Session cookie stolen or forged | B1 | High | Random session IDs stored hashed; `HttpOnly`, `Secure`, `SameSite=Strict`; 7-day expiry; logout deletes the session | `API.md` §1.1, `DATABASE.md` |
| T-04 | Cross-site request forgery changes rules | B1 | Medium | `SameSite=Strict`; state-changing requests also require a matching `Origin` header (proposed) | `API.md` §1.1 |
| T-05 | Script injection on the web page through a pair name, error text or provider data | B1, B3 | Medium | All text rendered escaped; strict Content-Security-Policy with no inline script (proposed); pair names checked against the provider's symbol list | `API.md` §1.3 |
| T-06 | Someone other than the PO sends Telegram commands | B2 | High | Bot acts only on the PO's chat ID; others get no reply and are logged `telegram.command_rejected`; commands are parsed by fixed code, never by a model | `API.md` §2 |
| T-07 | A wrong or manipulated price from a provider fires a false alert | B3 | Medium | Only the two official market-data endpoints over TLS; decimal parsing rejects malformed values; every tick stored, so any alert can be traced to its tick. A real but erroneous provider price is accepted as a risk: Stark reports what the exchange published | `EVENTS.md` §1–2, `ARCHITECTURE.md` §2.1 |
| T-08 | Stark gets its IP banned by Binance or Bitkub | B3 | High (stops alerts) | Stop and wait on every `429` until `Retry-After`; never retry blindly; health monitor reports the stale feed within 15 minutes | `ARCHITECTURE.md` §2.1, `EVENTS.md` §2.3–2.4 |
| T-09 | Alert flood exhausts LINE's quota or Gmail's daily limit, or trips Discord's ban | B4 | Medium | One alert per crossing (D-20); usage counters stop LINE at its quota and Gmail before 500 a day; dead Discord webhook not retried | `DATABASE.md` `channel_usage`, `ARCHITECTURE.md` §2.2 |
| T-10 | Gmail OAuth grant allows more than sending | B4 | High | Send-only scope (D-41); refresh token stored as a secret | `SPEC.md` D-28 |
| T-11 | Database reached from outside | B5 | High | PostgreSQL listens on the local host only; its own user with access to Stark's database only; firewall closes its port | `SPEC.md` D-25 |
| T-12 | Host taken over | B6 | High | No inbound ports (D-38); SSH by key only; Stark runs as a non-root user; operating system updates applied | Phase 5 host setup |
| T-13 | Malicious or vulnerable npm dependency | B7 | High | Lockfile committed; dependency audit in CI; few, well-known dependencies | Phase 5 CI |
| T-14 | Host clock drifts, so percentage rules use the wrong reference price and SC-1 timing is wrong | — | Medium | Time synchronised with NTP; ticks keep both exchange and received time | `EVENTS.md` §2.1, §3.3 |
| T-15 | Prompt injection through news text | — | Not in v1.0 | No model in v1.0 or v1.1 (D-06, D-12); designed before v1.2 behind the AI orchestrator shape | `ARCHITECTURE.md` §1 |
| T-16 | Market data redistributed against provider terms | B4 | Low in v1 | Alerts go only to the PO (D-10); any wider use needs Bitkub's written consent and a new review of Binance's terms | `ARCHITECTURE.md` §2.1 |

## 5. Decisions

| ID | Decision |
|---|---|
| `SPEC.md` D-38 | The web page is reachable only through a private network; no inbound port |
| D-39 | No second login factor in v1.0; TOTP first if the page ever becomes public |
| D-40 | Daily encrypted off-host database backups, kept 35 days |
| D-41 | Gmail OAuth with the send-only scope |

## 6. Audit

The first security review of the built system is MSAP audit A-1 (`SPEC.md` D-02), MSAP §16, before the first real
alert. This threat model is a design review, not an MSAP audit; A-1 checks the controls above against the code.

## 7. Gaps

| Gap | Closed by |
|---|---|
| No control is implemented yet | Phase 5 (secrets, logging, CI, host) and Phase 6 (interface and feeds), with tests |
| Host hardening steps depend on the host | S3-4 hosting choice |
