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
| `exchangeTime` | `Timestamp` | Time the provider gives for the price. If it gives none, this is the arrival time: every Bitkub tick, and Binance polled prices (`ARCHITECTURE.md` §2.1) |
| `receivedTime` | `Timestamp` | Time Stark received it |
| `source` | `stream` or `poll` | Polling is the fallback while a stream is down (`ARCHITECTURE.md` §7) |

Rules (proposed):
- At most one tick per pair per second is kept and evaluated: the last one to arrive for that second of
  `exchangeTime`. The price log and the rule engine see the same ticks, so a replay (SC-2) gives the same decisions.
- A kept tick is released when Stark's clock passes the end of its second, or at once when a tick of a later second
  arrives. Holding it adds up to 1 s (`ARCHITECTURE.md` §6). A tick for a second already released, or older than the
  one held, is dropped and logged `pipeline.tick_out_of_order`.
- `id` is assigned and `receivedTime` is the arrival time of the kept tick.
- A tick that arrives more than 10 seconds after its `exchangeTime` is stored but not evaluated: it is already outside
  SC-1's budget. Exactly 10 seconds is still evaluated.
- A tick that cannot be stored is not evaluated either (logged `pipeline.tick_failed`), so the log never lacks a tick
  that drove a decision.
- Ticks are evaluated one at a time, in the order they are released.

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
| `message` | string | The alert text (§4), fixed at `decidedAt`, so every send and every resend after a restart is the same even if the rule is changed later |

The decision is stored before any send, so a restart never loses it (`ARCHITECTURE.md` §7). It is stored in the same
transaction as the rule's new state: if that fails, the rule stays `armed`, nothing is sent, and a condition still
true fires on the next tick. The dispatcher is handed the decision only after it is stored, and is not awaited, so a
slow send never delays the next tick. Implemented in `src/app/pipeline.ts`.

### 2.3 `DeliveryAttempt` (dispatcher → delivery log)

| Field | Type | Note |
|---|---|---|
| `alertId` | `Id` | |
| `channel` | `telegram`, `line`, `discord` or `email` | |
| `attempt` | integer, from 1 | |
| `status` | `delivered`, `failed` or `skipped` | `delivered` means the channel's API accepted the message (SC-1, D-15) |
| `reason` | string or null | For `failed`: the channel's error. For `skipped`: `channel_off`, `quota_reached`, `channel_dead` or `cooldown` |
| `at` | `Timestamp` | |

Retries (proposed): up to 3 attempts per channel, 1 s then 2 s apart, all with the same `alertId`. A `429` counts as a
failed attempt and the next one waits for the channel's `Retry-After` when that is longer, even past the SC-1 budget;
it never retries early (`ARCHITECTURE.md` §2.1–2.2). A send that throws is a failed attempt with reason `send_error`.
A channel that answers it will never accept sends again (a Discord webhook's `404`) gets one `failed` attempt, is
marked dead (`DATABASE.md` `channel_settings.dead_since`) and is not retried. LINE's `409` for a retry key it has
already accepted counts as `delivered`. A Gmail token that cannot be refreshed is a `failed` attempt with reason
`token_refresh_failed` (`ARCHITECTURE.md` §2.2).

Before the first attempt the dispatcher checks, in this order, and records one `skipped` attempt for the first that
holds: `channel_off` (switched off system-wide since the decision, or not configured), `channel_dead`, `cooldown`,
`quota_reached`.

Idempotency: a channel that already has a `delivered` or `skipped` attempt for an alert, or 3 attempts, is never
sent that alert again. After a restart, attempts continue from the last recorded number. Each channel sends one alert
at a time, so the cooldown and the usage counters always see the sends before. Channels run in parallel.

Usage limits (D-17, `SPEC.md` D-47): LINE stops at 300 sends a month, Gmail at 400 a day,
both counted on the Thai calendar (UTC+7). The count rises in the same transaction as the `delivered` attempt.

Cooldown (`SPEC.md` D-42): a rule sends at most once per channel per 5 minutes, counted from that rule's last
`delivered` attempt on that channel; at exactly 5 minutes it sends again. A decision inside the cooldown is still
stored, and each of its channels gets one `skipped` attempt with reason `cooldown`. SC-2 compares decisions, so a
cooldown never counts as a missed alert. Implemented in `src/app/dispatcher.ts`.

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

How the monitor applies this (`src/app/health.ts`; timings decided in `SPEC.md` D-55):

| Condition | Starts when | Reported |
|---|---|---|
| `feed_stale` | No tick for 60 s, counted from the last tick (or from start, if none came yet) | When it has lasted 60 s plus 5 minutes |
| `channel_failing` | The dispatcher gives up on an alert after 3 attempts | After 5 minutes without a delivery on that channel |
| `channel_failing` (dead) | The channel answers it is dead (a Discord `404`) | At the next check |
| `quota_reached` | The dispatcher skips a send for the quota | Once per usage period |
| `disk_low` | Free disk below 20 % | At the next check |
| `*_recovered` | A tick, a delivery, or free disk at 20 % or more, after a reported condition | Once. An unreported condition that clears is forgotten |

Checks run every 30 s. A report goes to the first channel in the order Telegram, Discord, email, LINE that:

- is configured and switched on
- is not dead
- is not the channel the report is about

LINE comes last because its sends are counted (D-17). If that channel does not deliver, the next one is tried. If
no channel delivers, the event is logged `health.report_failed` and tried again at the next check. Each delivered
report is stored in `health_events`. The dispatcher feeds the monitor each channel's final outcome; a cooldown or a
channel switched off says nothing about health, so neither is reported.

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
2. If no such tick exists (Stark has not been running that long, or there is a gap), or its price is 0, the condition
   is false.
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

### 2.5 Health messages (wording decided in `SPEC.md` D-55)

Plain text in Thai, like the alerts (§4). The times are in Thai time.

| Kind | Message |
|---|---|
| `feed_stale` | `[Stark] ไม่ได้รับราคาจาก Bitkub ตั้งแต่ 14:00:00 น.` and, on a second line, `กฎที่ใช้ราคาจาก Bitkub จะไม่ทำงานจนกว่าราคาจะกลับมา` |
| `feed_recovered` | `[Stark] ราคาจาก Bitkub กลับมาแล้ว เวลา 14:07:00 น.` |
| `channel_failing` | `[Stark] ส่งแจ้งเตือนทาง LINE ไม่สำเร็จตั้งแต่ 14:00:00 น.` |
| `channel_failing` (dead) | `[Stark] ช่องทาง Discord ใช้ไม่ได้แล้ว ต้องตั้งค่าใหม่` |
| `channel_failing` (Gmail token) | `[Stark] ส่งอีเมลไม่ได้ เพราะ Google ไม่ต่ออายุการเข้าสู่ระบบ ต้องเชื่อมบัญชี Google ใหม่` |
| `channel_recovered` | `[Stark] ส่งแจ้งเตือนทาง LINE ได้ตามปกติแล้ว` |
| `quota_reached` | `[Stark] LINE ใช้โควตาของรอบนี้ครบแล้ว หยุดส่งทาง LINE จนถึงรอบถัดไป` |
| `disk_low` / `disk_recovered` | `[Stark] พื้นที่ดิสก์บนเครื่องเหลือ 19%` / `[Stark] พื้นที่ดิสก์บนเครื่องกลับมาเหลือ 20% แล้ว` |

The heartbeat (D-43, `src/app/heartbeat.ts`) is a GET to `HEARTBEAT_URL`, at start and then every 5 minutes. A failed
ping is logged by its status alone, never with the URL, which is a secret.

## 4. Alert message (`SPEC.md` D-33)

One message per alert, the same on every channel, in Thai:

```text
[Stark] BTC/THB สูงกว่า 3,500,000 แล้ว
ราคาล่าสุด 3,512,400 THB (Bitkub) เวลา 14:05:12 น.
กฎ: ราคา ≥ 3,500,000
```

Numbers in the message are formatted for reading only; stored values keep full precision. The example's numbers are
demo values.

The other kinds (wording approved in `SPEC.md` D-48, in the style of the D-33 level message above):

```text
[Stark] BTC/USDT ต่ำกว่า 60,000 แล้ว
ราคาล่าสุด 59,999.25 USDT (Binance) เวลา 14:05:12 น.
กฎ: ราคา ≤ 60,000
```

```text
[Stark] BTC/USDT ขึ้น +5.00% ใน 60 นาที
ราคาล่าสุด 105 USDT (Binance) เวลา 14:05:12 น.
ราคาเมื่อ 60 นาทีก่อน 100 USDT
กฎ: ขึ้น ≥ 5% ใน 60 นาที
```

Rules for the text (implemented in `src/domain/message.ts`):

- The first line is also the email subject. It holds no line break.
- An `either` rule writes ขึ้น or ลง from the sign of the change. Its rule line reads `ขึ้นหรือลง`. A `down` rule's
  rule line reads `ลง`.
- Prices group thousands with commas and drop trailing zeros after the point. They are never rounded:
  `0.00001234` stays `0.00001234`.
- The change is the decision's `changePercent`, with a `+` added when it is not negative.
- The time is the tick's `exchangeTime` in Thai time (UTC+7).
- The text is built only from typed values. A pair that is not `BASE/THB` or `BASE/USDT` (letters and digits only)
  is refused, so no markup, mention or line break can enter (`SECURITY.md` T-20).
