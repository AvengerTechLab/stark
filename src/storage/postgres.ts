// PostgreSQL implementations of the storage ports (DATABASE.md, SPEC.md D-22). Every value goes in
// as a query parameter, never spliced into SQL. Prices stay `numeric`, read back as strings, so
// nothing passes through a binary float (playbook §6).

import type pg from "pg";
import type { ChannelName } from "../ports/channel.js";
import type { Exchange } from "../ports/feed.js";
import type {
  AlertDecision,
  ChannelSettings,
  DeliveryAttempt,
  DeliveryLog,
  HealthLog,
  HealthRecord,
  PriceLog,
  PriceTick,
  RuleStore,
} from "../ports/storage.js";
import type { Rule, RuleState } from "../domain/rules.js";
import { MIGRATIONS } from "./migrations.js";

/** Table names in one place (playbook §8). */
export const TABLES = {
  migrations: "schema_migrations",
  rules: "rules",
  ruleChannels: "rule_channels",
  channelSettings: "channel_settings",
  priceTicks: "price_ticks",
  alertDecisions: "alert_decisions",
  deliveryAttempts: "delivery_attempts",
  channelUsage: "channel_usage",
  healthEvents: "health_events",
} as const;

/** Price log retention (SPEC.md D-34). */
export const RETENTION_DAYS = 35;

const DAY_MS = 86_400_000;
const CHANNEL_ORDER = "ARRAY['telegram', 'line', 'discord', 'email']";
const PAIR = /^([A-Z0-9]+)\/(THB|USDT)$/;
const EXCHANGE_OF_QUOTE: Readonly<Record<string, Exchange>> = { THB: "bitkub", USDT: "binance" };
/** PostgreSQL's error for a row that fits no partition. */
const NO_PARTITION = "23514";

async function inTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function splitPair(pair: string): { base: string; quote: string } {
  const match = PAIR.exec(pair);
  if (match?.[1] === undefined || match[2] === undefined) throw new Error("pair is not BASE/THB or BASE/USDT");
  return { base: match[1], quote: match[2] };
}

/** Applies every migration not yet recorded, each in its own transaction; returns the versions applied. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.migrations} (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    const done = await inTransaction(pool, async (client) => {
      // One migrator at a time, even if two processes start together.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('stark.migrate'))");
      const seen = await client.query(`SELECT 1 FROM ${TABLES.migrations} WHERE version = $1`, [migration.version]);
      if (seen.rowCount !== 0) return false;
      await client.query(migration.sql);
      await client.query(`INSERT INTO ${TABLES.migrations} (version) VALUES ($1)`, [migration.version]);
      return true;
    });
    if (done) applied.push(migration.version);
  }
  return applied;
}

function partitionName(day: Date): string {
  return `${TABLES.priceTicks}_${day.toISOString().slice(0, 10).replaceAll("-", "")}`;
}

/** Creates the daily price-log partitions (UTC days) for `days` days from `from`'s day. */
export async function ensurePartitions(pool: pg.Pool, from: Date, days: number): Promise<void> {
  const first = Math.floor(from.getTime() / DAY_MS) * DAY_MS;
  for (let i = 0; i < days; i++) {
    const start = new Date(first + i * DAY_MS);
    const end = new Date(first + (i + 1) * DAY_MS);
    // Names and bounds come from dates, never from input, so formatting them in is safe.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${partitionName(start)} PARTITION OF ${TABLES.priceTicks}
       FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
    );
  }
}

/** Drops whole days of the price log older than the retention (D-34); returns the partitions dropped. */
export async function dropExpiredPartitions(pool: pg.Pool, now: Date, keepDays = RETENTION_DAYS): Promise<string[]> {
  const cutoff = now.getTime() - keepDays * DAY_MS;
  const { rows } = await pool.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_inherits i
     JOIN pg_class c ON c.oid = i.inhrelid
     JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = $1 AND p.relnamespace = current_schema()::regnamespace
     ORDER BY c.relname`,
    [TABLES.priceTicks],
  );
  const dropped: string[] = [];
  for (const { name } of rows) {
    const day = /_(\d{4})(\d{2})(\d{2})$/.exec(name);
    if (day === null) continue;
    const end = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])) + DAY_MS;
    if (end > cutoff) continue;
    await pool.query(`DROP TABLE ${name}`);
    dropped.push(name);
  }
  return dropped;
}

export class PgPriceLog implements PriceLog {
  constructor(private readonly pool: pg.Pool) {}

  async append(tick: PriceTick): Promise<void> {
    const { base, quote } = splitPair(tick.pair);
    const insert = () =>
      this.pool.query(
        `INSERT INTO ${TABLES.priceTicks} (id, exchange, base, quote, price, exchange_time, received_time, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tick.id, tick.exchange, base, quote, tick.price, tick.exchangeTime, tick.receivedTime, tick.source],
      );
    try {
      await insert();
    } catch (error) {
      if ((error as { code?: string }).code !== NO_PARTITION) throw error;
      // First tick of a new day: create its partition and write once more.
      await ensurePartitions(this.pool, tick.exchangeTime, 1);
      await insert();
    }
  }

  async priceAtOrBefore(exchange: Exchange, pair: string, time: Date): Promise<string | undefined> {
    const { base, quote } = splitPair(pair);
    const { rows } = await this.pool.query<{ price: string }>(
      `SELECT price FROM ${TABLES.priceTicks}
       WHERE exchange = $1 AND base = $2 AND quote = $3 AND exchange_time <= $4
       ORDER BY exchange_time DESC LIMIT 1`,
      [exchange, base, quote, time],
    );
    return rows[0]?.price;
  }
}

interface RuleRow {
  id: string;
  base: string;
  quote: string;
  kind: Rule["kind"];
  level: string | null;
  percent: string | null;
  window_minutes: number | null;
  direction: "up" | "down" | "either" | null;
  enabled: boolean;
  state: RuleState;
  channels: ChannelName[];
}

function toRule(row: RuleRow): Rule {
  const common = {
    id: row.id,
    pair: `${row.base}/${row.quote}`,
    channels: row.channels,
    enabled: row.enabled,
    state: row.state,
  };
  if (row.kind === "change") {
    if (row.percent === null || row.window_minutes === null || row.direction === null) {
      throw new Error("change rule row is incomplete");
    }
    return { ...common, kind: "change", percent: row.percent, windowMinutes: row.window_minutes, direction: row.direction };
  }
  if (row.level === null) throw new Error("level rule row has no level");
  return { ...common, kind: row.kind, level: row.level };
}

export class PgRuleStore implements RuleStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Stores a new rule with its channels. Validation is `src/domain/rule-input.ts`; the table checks again. */
  async create(rule: Rule): Promise<void> {
    const { base, quote } = splitPair(rule.pair);
    const change = rule.kind === "change" ? rule : null;
    await inTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO ${TABLES.rules}
           (id, exchange, base, quote, kind, level, percent, window_minutes, direction, enabled, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          rule.id,
          EXCHANGE_OF_QUOTE[quote],
          base,
          quote,
          rule.kind,
          rule.kind === "change" ? null : rule.level,
          change?.percent ?? null,
          change?.windowMinutes ?? null,
          change?.direction ?? null,
          rule.enabled,
          rule.state,
        ],
      );
      for (const channel of rule.channels) {
        await client.query(`INSERT INTO ${TABLES.ruleChannels} (rule_id, channel) VALUES ($1, $2)`, [rule.id, channel]);
      }
    });
  }

  async rulesFor(pair: string): Promise<readonly Rule[]> {
    const { base, quote } = splitPair(pair);
    const { rows } = await this.pool.query<RuleRow>(
      `SELECT r.id, r.base, r.quote, r.kind, r.level, r.percent, r.window_minutes, r.direction, r.enabled, r.state,
              coalesce(array_agg(c.channel ORDER BY array_position(${CHANNEL_ORDER}, c.channel))
                       FILTER (WHERE c.channel IS NOT NULL), '{}') AS channels
       FROM ${TABLES.rules} r LEFT JOIN ${TABLES.ruleChannels} c ON c.rule_id = r.id
       WHERE r.base = $1 AND r.quote = $2
       GROUP BY r.id
       ORDER BY r.created_at, r.id`,
      [base, quote],
    );
    return rows.map(toRule);
  }

  async saveResult(ruleId: string, state: RuleState, decision: AlertDecision | null): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await client.query(`UPDATE ${TABLES.rules} SET state = $2, updated_at = now() WHERE id = $1`, [ruleId, state]);
      if (decision === null) return;
      await client.query(
        `INSERT INTO ${TABLES.alertDecisions}
           (id, rule_id, tick_id, price, reference_price, change_percent, channels, message, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          decision.id,
          decision.ruleId,
          decision.tickId,
          decision.price,
          decision.referencePrice,
          decision.changePercent,
          decision.channels,
          decision.message,
          decision.decidedAt,
        ],
      );
    });
  }
}

export class PgChannelSettings implements ChannelSettings {
  constructor(private readonly pool: pg.Pool) {}

  async switchedOn(): Promise<ReadonlySet<ChannelName>> {
    const { rows } = await this.pool.query<{ channel: ChannelName }>(
      `SELECT channel FROM ${TABLES.channelSettings} WHERE enabled`,
    );
    return new Set(rows.map((r) => r.channel));
  }

  /** Switches a channel on or off system-wide (D-09). */
  async setEnabled(channel: ChannelName, enabled: boolean): Promise<void> {
    await this.pool.query(`UPDATE ${TABLES.channelSettings} SET enabled = $2, updated_at = now() WHERE channel = $1`, [
      channel,
      enabled,
    ]);
  }

  async isDead(channel: ChannelName): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM ${TABLES.channelSettings} WHERE channel = $1 AND dead_since IS NOT NULL`,
      [channel],
    );
    return rows.length > 0;
  }

  async markDead(channel: ChannelName, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE ${TABLES.channelSettings} SET dead_since = coalesce(dead_since, $2), updated_at = now() WHERE channel = $1`,
      [channel, at],
    );
  }
}

export class PgDeliveryLog implements DeliveryLog {
  constructor(private readonly pool: pg.Pool) {}

  async attempts(alertId: string, channel: ChannelName): Promise<readonly DeliveryAttempt[]> {
    const { rows } = await this.pool.query<DeliveryAttempt>(
      `SELECT alert_id AS "alertId", channel, attempt, status, reason, at FROM ${TABLES.deliveryAttempts}
       WHERE alert_id = $1 AND channel = $2 ORDER BY attempt`,
      [alertId, channel],
    );
    return rows;
  }

  async lastDelivered(ruleId: string, channel: ChannelName): Promise<Date | undefined> {
    const { rows } = await this.pool.query<{ last: Date | null }>(
      `SELECT max(a.at) AS last FROM ${TABLES.deliveryAttempts} a
       JOIN ${TABLES.alertDecisions} d ON d.id = a.alert_id
       WHERE d.rule_id = $1 AND a.channel = $2 AND a.status = 'delivered'`,
      [ruleId, channel],
    );
    return rows[0]?.last ?? undefined;
  }

  async usage(channel: ChannelName, period: string): Promise<number> {
    const { rows } = await this.pool.query<{ sent: number }>(
      `SELECT sent FROM ${TABLES.channelUsage} WHERE channel = $1 AND period = $2::date`,
      [channel, period],
    );
    return rows[0]?.sent ?? 0;
  }

  async record(attempt: DeliveryAttempt, ruleId: string, usagePeriod: string | null): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO ${TABLES.deliveryAttempts} (alert_id, channel, attempt, status, reason, at)
         SELECT $1, $2, $3, $4, $5, $6
         WHERE EXISTS (SELECT 1 FROM ${TABLES.alertDecisions} WHERE id = $1 AND rule_id = $7)`,
        [attempt.alertId, attempt.channel, attempt.attempt, attempt.status, attempt.reason, attempt.at, ruleId],
      );
      if (inserted.rowCount !== 1) throw new Error("no decision of that rule has this alert ID");
      if (attempt.status !== "delivered" || usagePeriod === null) return;
      await client.query(
        `INSERT INTO ${TABLES.channelUsage} (channel, period, sent) VALUES ($1, $2::date, 1)
         ON CONFLICT (channel, period) DO UPDATE SET sent = ${TABLES.channelUsage}.sent + 1`,
        [attempt.channel, usagePeriod],
      );
    });
  }
}

export class PgHealthLog implements HealthLog {
  constructor(private readonly pool: pg.Pool) {}

  async record(event: HealthRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${TABLES.healthEvents} (id, kind, subject, since, reported_at) VALUES ($1, $2, $3, $4, $5)`,
      [event.id, event.kind, event.subject, event.since, event.reportedAt],
    );
  }
}
