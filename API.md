# Stark — Owner Interface Contracts (v1.0)

Status: **Phase 3 draft** (2026-10-03). Covers the two ways the PO manages Stark (`SPEC.md` D-21): a web page over an
HTTP API, and Telegram bot commands. Only the PO can use either (D-10). Choices not in `SPEC.md` §6 are proposals,
marked **PO to confirm** where they need the PO.

Types (`Pair`, `Decimal`, `Rule`, …) are defined in `EVENTS.md`.

---

## 1. HTTP API

Base path `/api/v1`, JSON in and out, served by the Stark process on its host over HTTPS only, and reachable only
through a private network (`SPEC.md` D-38).

### 1.1 Authentication (proposed)

- One owner password. The host stores only its hash (Argon2id) in an environment variable; the password itself is
  never stored or logged (`CLAUDE.md` §5).
- `POST /api/v1/session` with the password returns a session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`,
  expiring after 7 days or on `DELETE /api/v1/session`. Each login gets a new random session ID of at least 128 bits,
  and the PO is told on Telegram of every successful login (`SECURITY.md` T-22).
- No second factor in v1.0 (D-39); TOTP is added before the page is ever made public.
- After 5 wrong passwords in 15 minutes, logins are refused for 15 minutes and the PO is told on Telegram.
- Every other endpoint except `GET /healthz` returns `401` without a valid session.

As built (`src/interface/http-server.ts`):

- **Login** is `POST /api/v1/session` with `{"password": "..."}`. It answers `204` with the cookie
  `stark_session=<256-bit random ID>; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict`. Only the
  ID's SHA-256 hash is stored (`owner_sessions`). Every login gets a new ID.
- **Logout** is `DELETE /api/v1/session`. It answers `204` and clears the cookie.
- **Lockout:** after 5 wrong passwords within 15 minutes, logins are refused until 15 minutes after the fifth.
- **Telegram notices:** the PO is told on Telegram of every login and of every lockout.
- **Origin check:** every `POST`, `PATCH` and `DELETE` must carry an `Origin` whose host is the request's `Host`.
  Otherwise the answer is `403 ORIGIN_INVALID` (`SECURITY.md` T-04).
- **Request bodies:** JSON only (`Content-Type: application/json`), at most 16 KB.
- **Response headers** on every answer:
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self';
    connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Cache-Control: no-store`
- **HTTPS:** the process serves HTTP. HTTPS comes from the private network or a reverse proxy in front of it, which
  is chosen with hosting (S6-12, **PO to confirm**).

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

Shapes as built:

- **Rules:** a rule is `{id, pair, kind, level | percent + windowMinutes + direction, channels, enabled, state}`.
- **`PATCH /rules/{id}`:** takes `enabled` and any rule field. The fields are merged into the rule and the whole rule
  is validated again. If `kind` changes, the old kind's fields are dropped. A changed or re-enabled rule starts
  `armed`.
- **`GET /channels`:** answers `[{name, configured, enabled, deadSince, usage}]`. `usage` is
  `{period, sent, limit}` for LINE (the month) and Gmail (the day), and null for the others.
- **`GET /alerts`:** takes `from` and `to` as ISO 8601 times. The default is the last 24 hours, and the range is at
  most 31 days. It answers at most 500 decisions, newest first, each with its delivery attempts.
- **`GET /prices`:** answers each pair's latest price and its age in seconds.
- **`GET /health`:** answers the health monitor's snapshot: `degraded`, each feed's last tick, and the open
  conditions.
- **`GET /`, `/app.js`, `/app.css`:** the owner page. It has no inline script or style, and every value is written
  as text, never as HTML (`SECURITY.md` T-05).

### 1.3 Validation

| Field | Rule | Error code |
|---|---|---|
| `kind` | `above`, `below` or `change` | `BODY_INVALID` |
| `pair` | `BASE/THB` or `BASE/USDT` (case-insensitive, stored upper case), listed by the provider for that quote | `PAIR_UNKNOWN` |
| `level` | `Decimal`, greater than 0, at most 40 characters | `LEVEL_INVALID` |
| `percent` | `Decimal`, greater than 0, at most 100, at most 2 decimals | `PERCENT_INVALID` |
| `windowMinutes` | Integer 1 to 1,440 | `WINDOW_INVALID` |
| `direction` | `up`, `down` or `either` | `BODY_INVALID` |
| `channels` | Non-empty; each one of `telegram`, `line`, `discord`, `email`, none repeated | `CHANNELS_INVALID` |
| Fields for the wrong `kind` | For example `level` on a `change` rule | `FIELD_NOT_ALLOWED` |
| Any other field | For example `state` | `BODY_INVALID` |
| A body that is not a JSON object | | `BODY_INVALID` (field `body`) |

Numbers sent as JSON numbers are refused: prices and percentages must be strings (playbook §6, item 1). Nothing is
rounded silently; an invalid value is a `400` with its code (playbook §6, item 4). Every problem is reported at once,
one error per field; when `kind` is invalid, only that error is reported. Error messages are fixed text and never repeat
the submitted value (`SECURITY.md` T-05). Implemented in `src/domain/rule-input.ts`.

### 1.4 Error model

```json
{ "error": { "code": "LEVEL_INVALID", "message": "level must be a decimal greater than 0" } }
```

A rule refused for several reasons carries every one in `details`, and `code` is the first:

```json
{ "error": { "code": "LEVEL_INVALID", "message": "...", "details": [
  { "field": "level", "code": "LEVEL_INVALID", "message": "..." },
  { "field": "channels", "code": "CHANNELS_INVALID", "message": "..." } ] } }
```

| Status | Codes |
|---|---|
| `400` | The validation codes in §1.3, `BODY_INVALID` |
| `401` | `UNAUTHENTICATED` |
| `403` | `ORIGIN_INVALID` |
| `404` | `NOT_FOUND` |
| `429` | `LOGIN_LOCKED` |
| `500` | `INTERNAL` (details only in the server log) |

## 2. Telegram bot commands

The bot fetches updates by long polling, so it needs no inbound port (D-38). It acts only on messages from a private
chat whose ID is the PO's chat ID, set in an environment variable. Messages from any other chat get
no reply and are logged as `telegram.command_rejected` (`SECURITY.md` T-06).

| Command | Example | Effect |
|---|---|---|
| `/prices` | `/prices` | Latest price per watched pair |
| `/rules` | `/rules` | Rules with a short ID, state and channels |
| `/above` | `/above BTC/THB 3500000` | New `above` rule on all switched-on channels |
| `/below` | `/below BTC/USDT 60000` | New `below` rule |
| `/change` | `/change BTC/USDT 5 60 up` | New `change` rule: percent, minutes, `up`, `down` or `either` |
| `/off`, `/on` | `/off 3f2a` | Disable or enable a rule by short ID |
| `/delete` | `/delete 3f2a` | Delete a rule, after a yes/no confirmation; a yes counts only for the last question and only within 60 s |
| `/channel` | `/channel line off` | Switch a channel system-wide |
| `/status` | `/status` | Feed and channel health, LINE quota, Gmail count |

Commands use the same validation and error codes as the HTTP API (§1.3), answered as a short Thai message that repeats
what changed. Choosing
channels per rule is done on the web page (proposed).

The demo prices in the examples are not market data.
