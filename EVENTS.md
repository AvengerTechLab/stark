# Stark — Domain and Event Contracts (v1.0)

Status: **Phase 3 draft** (2026-10-03). Defines the data that moves between Stark's components and the exact rules
that decide whether an alert fires. Anything not already in `SPEC.md` §6 is marked **PO to confirm** and listed in
`SPEC.md` §5. Every calculation here is deterministic code, not model output (`CLAUDE.md` §4).

Components and data flow: `ARCHITECTURE.md` §4–5. Storage: `DATABASE.md`. Owner interface: `API.md`.

---

## 1. Basic types

| Type | Definition |
|---|---|
| `Exchange` | `bitkub` or `binance` |
| `Quote` | `THB` (from Bitkub) or `USDT` (from Binance), per `SPEC.md` D-08 |
| `Pair` | Base asset and quote, written `BTC/THB`. Each provider's own symbol (`btc_thb`, `BTCUSDT`) is mapped at the feed adapter and never leaves it |
| `Decimal` | A string matching `^[0-9]+(\.[0-9]+)?$`: no sign, no exponent, no `Infinity`. Converted to an exact decimal type for arithmetic; never a binary float (playbook §6) |
| `Timestamp` | UTC, millisecond precision, ISO 8601 in JSON |
| `Id` | UUID v4 |

## 2. Events

### 2.1 `PriceTick` (feed adapter → price log → rule engine)

| Field | Type | Note |
|---|---|---|
| `id` | `Id` | Assigned on arrival |
| `exchange` | `Exchange` | |
| `pair` | `Pair` | |
| `price` | `Decimal` | Last traded price, not bid or ask (`SPEC.md` D-30) |
| `exchangeTime` | `Timestamp` | Time the provider gives for the price |
| `receivedTime` | `Timestamp` | Time Stark received it |
| `source` | `stream` or `poll` | Polling is the fallback while a stream is down (`ARCHITECTURE.md` §7) |

Rules (proposed):
- At most one tick per pair per second is kept and evaluated: the last one in that second. The price log and the rule
  engine see the same ticks, so a replay (SC-2) gives the same decisions.
- A tick that arrives more than 10 seconds after its `exchangeTime` is stored but not evaluated: it is already outside
  SC-1's budget.

### 2.2 `AlertDecision` (rule engine → decision log → dispatcher)

| Field | Type | Note |
|---|---|---|
| `id` | `Id` | Also the idempotency key for every send of this alert |
| `ruleId` | `Id` | |
| `tickId` | `Id` | The tick that made the condition true |
| `price` | `Decimal` | From the tick |
| `referencePrice` | `Decimal` or null | Percentage rules only (§3.3) |
| `changePercent` | `Decimal` (signed) or null | Percentage rules only, rounded half-up to 2 decimals for display; the comparison uses the exact value |
| `decidedAt` | `Timestamp` | |
| `channels` | list of channel names | The rule's channels that were switched on system-wide at `decidedAt` (D-09) |

The decision is stored before any send, so a restart never loses it (`ARCHITECTURE.md` §7).

### 2.3 `DeliveryAttempt` (dispatcher → delivery log)

| Field | Type | Note |
|---|---|---|
| `alertId` | `Id` | |
| `channel` | `telegram`, `line`, `discord` or `email` | |
| `attempt` | integer, from 1 | |
| `status` | `delivered`, `failed` or `skipped` | `delivered` means the channel's API accepted the message (SC-1, D-15) |
| `reason` | string or null | For `failed`: the channel's error. For `skipped`: `channel_off`, `quota_reached`, `channel_dead` or `cooldown` |
| `at` | `Timestamp` | |

Retries (proposed): up to 3 attempts per channel, 1 s then 2 s apart, all with the same `alertId`. A `429` waits for
the channel's `Retry-After` even past the SC-1 budget; it never retries early (`ARCHITECTURE.md` §2.1–2.2).

Cooldown (`SPEC.md` D-42): a rule sends at most once per channel per 5 minutes, counted from that rule's last
`delivered` attempt on that channel. A decision inside the cooldown is still stored, and each of its channels gets one
`skipped` attempt with reason `cooldown`. SC-2 compares decisions, so a cooldown never counts as a missed alert.

Sending (`SECURITY.md` T-20): the message is plain text built only from typed, validated values. Telegram is sent
without a parse mode; Discord with `allowed_mentions` set to none; the email subject is the message's first line and
must hold no line break.

### 2.4 `HealthEvent` (health monitor → PO)

| Field | Type | Note |
|---|---|---|
| `kind` | `feed_stale`, `feed_recovered`, `channel_failing`, `channel_recovered`, `quota_reached`, `disk_low`, `disk_recovered` | A failed Gmail token refresh is `channel_failing` for `email` (`SECURITY.md` T-21) |
| `subject` | exchange or channel name | |
| `since` | `Timestamp` | When the condition started |

A feed is stale after 60 s with no tick (proposed). The PO is told within 15 minutes of a feed staying stale or a
channel failing (SC-3), through a channel other than the failing one. Recovery is reported once. `disk_low` is raised
when free disk on the host falls below 20 % (proposed, `SECURITY.md` T-23).

Heartbeat (`SPEC.md` D-43): every 5 minutes, while the process runs, Stark sends a heartbeat to an uptime monitor
outside the host. The monitor tells the PO when no heartbeat arrives for 15 minutes (SC-3). The heartbeat carries no
data, and its URL is a secret like a channel credential (proposed timings).

## 3. Rule evaluation

### 3.1 `Rule`

| Field | Type | Note |
|---|---|---|
| `id` | `Id` | |
| `pair` | `Pair` | Its quote decides the exchange (D-08) |
| `kind` | `above`, `below` or `change` | D-19 |
| `level` | `Decimal` | `above` and `below` only; greater than 0 |
| `percent` | `Decimal` | `change` only; greater than 0, at most 100, at most 2 decimals |
| `windowMinutes` | integer | `change` only; 1 to 1,440 (proposed) |
| `direction` | `up`, `down` or `either` | `change` only |
| `channels` | non-empty list of channel names | D-09 |
| `enabled` | boolean | |
| `state` | `armed` or `fired` | D-20 |

A rule watches one quote. Choosing "both THB and USDT" in the owner interface creates two rules, one per quote
(`SPEC.md` D-35).

### 3.2 Level rules

- `above`: the condition is true when `price >= level`.
- `below`: the condition is true when `price <= level`.

Reaching the level counts (`SPEC.md` D-31).

### 3.3 Percentage rules

1. The reference price is the price of the last stored tick for the same exchange and pair whose `exchangeTime` is at
   or before `tick.exchangeTime − windowMinutes`.
2. If no such tick exists (Stark has not been running that long, or there is a gap), the condition is false.
3. `changePercent = (price − referencePrice) ÷ referencePrice × 100`, computed exactly.
4. `up`: true when `changePercent >= percent`. `down`: true when `changePercent <= −percent`. `either`: true when
   either holds.

### 3.4 Crossing and re-arm (D-20)

| State | Condition on this tick | Result |
|---|---|---|
| `armed` | true | Emit one `AlertDecision`; state becomes `fired` |
| `armed` | false | Nothing |
| `fired` | true | Nothing |
| `fired` | false | State becomes `armed` |

A new or re-enabled rule starts `armed`. If its condition is already true on its first tick, it fires at once
(`SPEC.md` D-32). A disabled rule is not evaluated and keeps its state.

### 3.5 Worked examples (demo values, not market data)

| Rule | Ticks | Decisions |
|---|---|---|
| `above` BTC/THB, level 100 | 99 → 100 → 101 → 99 → 100 | Fires at the first 100; re-arms at 99; fires again at the second 100. If the second 100 comes within 5 minutes of the first send, it is stored but its sends are skipped (`cooldown`, D-42) |
| `change` BTC/USDT, 5 %, 60 min, `up`; price 60 min earlier 100 | 104 → 105 → 106 | Fires at 105 (+5.00 %); nothing at 106 |
| `change` as above, Stark started 10 min ago | any | Nothing: no reference price yet |

## 4. Alert message (`SPEC.md` D-33)

One message per alert, the same on every channel, in Thai:

```text
[Stark] BTC/THB สูงกว่า 3,500,000 แล้ว
ราคาล่าสุด 3,512,400 THB (Bitkub) เวลา 14:05:12 น.
กฎ: ราคา ≥ 3,500,000
```

Numbers in the message are formatted for reading only; stored values keep full precision. The example's numbers are
demo values.
