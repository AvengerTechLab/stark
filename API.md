# Stark — Owner Interface Contracts (v1.0)

Status: **Phase 3 draft** (2026-10-03). Covers the two ways the PO manages Stark (`SPEC.md` D-21): a web page over an
HTTP API, and Telegram bot commands. Only the PO can use either (D-10). Choices not in `SPEC.md` §6 are proposals,
marked **PO to confirm** where they need the PO.

Types (`Pair`, `Decimal`, `Rule`, …) are defined in `EVENTS.md`.

---

## 1. HTTP API

Base path `/api/v1`, JSON in and out, served by the Stark process on its host over HTTPS only.

### 1.1 Authentication (proposed)

- One owner password. The host stores only its hash (Argon2id) in an environment variable; the password itself is
  never stored or logged (`CLAUDE.md` §5).
- `POST /api/v1/session` with the password returns a session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`,
  expiring after 7 days or on `DELETE /api/v1/session`.
- After 5 wrong passwords in 15 minutes, logins are refused for 15 minutes and the PO is told on Telegram.
- Every other endpoint except `GET /healthz` returns `401` without a valid session.

### 1.2 Endpoints

| Method and path | Purpose | Success |
|---|---|---|
| `GET /api/v1/prices` | Latest tick per watched pair, with each feed's freshness | `200` list |
| `GET /api/v1/pairs?quote=THB` | Pairs the provider lists, for choosing a rule's pair | `200` list |
| `GET /api/v1/rules` | All rules with state | `200` list |
| `POST /api/v1/rules` | Create a rule | `201` rule |
| `PATCH /api/v1/rules/{id}` | Change fields, enable or disable | `200` rule |
| `DELETE /api/v1/rules/{id}` | Delete a rule | `204` |
| `GET /api/v1/channels` | System-wide on/off per channel, LINE quota used this month, Gmail count today | `200` |
| `PATCH /api/v1/channels/{name}` | Switch a channel on or off system-wide | `200` |
| `GET /api/v1/alerts?from=&to=` | Alert decisions with their delivery attempts | `200` list |
| `GET /api/v1/health` | Feed and channel health in detail | `200` |
| `GET /healthz` | Liveness for the host; no details, no auth | `200` `ok` or `503` `degraded` |

### 1.3 Validation

| Field | Rule | Error code |
|---|---|---|
| `pair` | Must be listed by the provider for that quote | `PAIR_UNKNOWN` |
| `level` | `Decimal`, greater than 0 | `LEVEL_INVALID` |
| `percent` | `Decimal`, greater than 0, at most 100, at most 2 decimals | `PERCENT_INVALID` |
| `windowMinutes` | Integer 1 to 1,440 | `WINDOW_INVALID` |
| `channels` | Non-empty; each one of `telegram`, `line`, `discord`, `email` | `CHANNELS_INVALID` |
| Fields for the wrong `kind` | For example `level` on a `change` rule | `FIELD_NOT_ALLOWED` |

Numbers sent as JSON numbers are refused: prices and percentages must be strings (playbook §6, item 1). Nothing is
rounded silently; an invalid value is a `400` with its code (playbook §6, item 4).

### 1.4 Error model

```json
{ "error": { "code": "LEVEL_INVALID", "message": "level must be a decimal greater than 0" } }
```

| Status | Codes |
|---|---|
| `400` | The validation codes in §1.3, `BODY_INVALID` |
| `401` | `UNAUTHENTICATED` |
| `404` | `NOT_FOUND` |
| `429` | `LOGIN_LOCKED` |
| `500` | `INTERNAL` (details only in the server log) |

## 2. Telegram bot commands

The bot acts only on messages from the PO's chat ID, set in an environment variable. Messages from any other chat get
no reply and are logged as `telegram.command_rejected` (`SECURITY.md` §2).

| Command | Example | Effect |
|---|---|---|
| `/prices` | `/prices` | Latest price per watched pair |
| `/rules` | `/rules` | Rules with a short ID, state and channels |
| `/above` | `/above BTC/THB 3500000` | New `above` rule on all switched-on channels |
| `/below` | `/below BTC/USDT 60000` | New `below` rule |
| `/change` | `/change BTC/USDT 5 60 up` | New `change` rule: percent, minutes, `up`, `down` or `either` |
| `/off`, `/on` | `/off 3f2a` | Disable or enable a rule by short ID |
| `/delete` | `/delete 3f2a` | Delete a rule, after a yes/no confirmation |
| `/channel` | `/channel line off` | Switch a channel system-wide |
| `/status` | `/status` | Feed and channel health, LINE quota, Gmail count |

Commands use the same validation and error codes as the HTTP API (§1.3), answered as a short Thai message. Choosing
channels per rule is done on the web page (proposed).

The demo prices in the examples are not market data.
