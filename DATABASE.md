# Stark — Database Contract (v1.0)

Status: **Phase 3 draft** (2026-10-03). PostgreSQL (`SPEC.md` D-22) on the same host as Stark, not reachable from
the internet (D-25). Types follow `EVENTS.md`. The migration tool is chosen in Phase 5.

Conventions: `snake_case` names; table and column names live in one constants module in code (playbook §8); every
timestamp is `timestamptz` in UTC; every price and percentage is `numeric` (exact), never `float`.

---

## 1. Tables

### `rules`

| Column | Type | Constraint |
|---|---|---|
| `id` | `uuid` | primary key |
| `exchange` | `text` | `bitkub` or `binance` |
| `base`, `quote` | `text` | `quote` is `THB` with `bitkub`, `USDT` with `binance` |
| `kind` | `text` | `above`, `below`, `change` |
| `level` | `numeric` | not null and > 0 for `above`/`below`; null for `change` |
| `percent` | `numeric(5,2)` | not null, > 0, ≤ 100 for `change`; null otherwise |
| `window_minutes` | `integer` | 1–1,440 for `change`; null otherwise |
| `direction` | `text` | `up`, `down`, `either` for `change`; null otherwise |
| `enabled` | `boolean` | not null |
| `state` | `text` | `armed` or `fired` |
| `created_at`, `updated_at` | `timestamptz` | not null |

### `rule_channels`

`rule_id` (`uuid`, references `rules` on delete cascade), `channel` (`text`: `telegram`, `line`, `discord`, `email`);
primary key on both.

### `channel_settings`

`channel` (`text`, primary key), `enabled` (`boolean`), `dead_since` (`timestamptz`, null; set when a Discord webhook
answers 404), `updated_at`.

### `price_ticks`

| Column | Type | Note |
|---|---|---|
| `id` | `uuid` | primary key |
| `exchange`, `base`, `quote` | `text` | |
| `price` | `numeric` | |
| `exchange_time`, `received_time` | `timestamptz` | |
| `source` | `text` | `stream` or `poll` |

Index on `(exchange, base, quote, exchange_time)` for the percentage-rule reference lookup (`EVENTS.md` §3.3) and the
SC-2 replay. Partitioned by day so old days drop cheaply. Retention: **PO to confirm** (Q-23); at least 30 days for
SC-2.

### `alert_decisions`

`id` (`uuid`, primary key), `rule_id` (`uuid`; kept even if the rule is deleted, so history stays complete),
`tick_id` (`uuid`), `price`, `reference_price`, `change_percent` (`numeric`), `channels` (`text[]`), `decided_at`.

### `delivery_attempts`

`alert_id` (`uuid`, references `alert_decisions`), `channel` (`text`), `attempt` (`integer`), `status`, `reason`
(`text`), `at`; primary key `(alert_id, channel, attempt)`. The key makes a duplicate send of the same alert to the
same channel impossible to record twice.

### `channel_usage`

`channel` (`text`), `period` (`date`: first day of the month for LINE, the day for Gmail), `sent` (`integer`);
primary key `(channel, period)`. Incremented in the same transaction as a `delivered` attempt; the dispatcher checks it
before sending (D-17, Gmail's 500 a day).

### `health_events`

`id`, `kind`, `subject`, `since`, `reported_at` (`timestamptz`, null until the PO has been told).

### `owner_sessions` and `login_attempts`

Session ID hashes with expiry, and failed login times for the lockout in `API.md` §1.1. No password is stored here.

## 2. Size estimate

Rows in `price_ticks` ≈ watched pairs × 86,400 per day (at most one tick per pair per second, `EVENTS.md` §2.1). For
example, 10 pairs kept 35 days is about 30 million rows. The real number depends on how many pairs the PO watches
(Q-24).
