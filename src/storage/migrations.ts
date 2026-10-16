// Schema migrations, applied in order and recorded in `schema_migrations` (DATABASE.md). Each is
// plain SQL run in one transaction. Never edit a migration once merged; add a new one instead.

export interface Migration {
  readonly version: string;
  readonly sql: string;
}

const CHANNEL = "channel IN ('telegram', 'line', 'discord', 'email')";

export const MIGRATIONS: readonly Migration[] = [
  {
    version: "001_initial",
    sql: `
CREATE TABLE rules (
  id uuid PRIMARY KEY,
  exchange text NOT NULL CHECK (exchange IN ('bitkub', 'binance')),
  base text NOT NULL CHECK (base ~ '^[A-Z0-9]+$'),
  quote text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('above', 'below', 'change')),
  level numeric,
  percent numeric(5,2),
  window_minutes integer,
  direction text,
  enabled boolean NOT NULL,
  state text NOT NULL CHECK (state IN ('armed', 'fired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((exchange = 'bitkub' AND quote = 'THB') OR (exchange = 'binance' AND quote = 'USDT')),
  CHECK (
    (kind IN ('above', 'below') AND level > 0
      AND percent IS NULL AND window_minutes IS NULL AND direction IS NULL)
    OR (kind = 'change' AND level IS NULL
      AND percent > 0 AND percent <= 100
      AND window_minutes BETWEEN 1 AND 1440
      AND direction IN ('up', 'down', 'either'))
  )
);

CREATE TABLE rule_channels (
  rule_id uuid NOT NULL REFERENCES rules (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (${CHANNEL}),
  PRIMARY KEY (rule_id, channel)
);

CREATE TABLE channel_settings (
  channel text PRIMARY KEY CHECK (${CHANNEL}),
  enabled boolean NOT NULL,
  dead_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO channel_settings (channel, enabled)
VALUES ('telegram', true), ('line', true), ('discord', true), ('email', true);

CREATE TABLE price_ticks (
  id uuid NOT NULL,
  exchange text NOT NULL CHECK (exchange IN ('bitkub', 'binance')),
  base text NOT NULL,
  quote text NOT NULL,
  price numeric NOT NULL CHECK (price >= 0),
  exchange_time timestamptz NOT NULL,
  received_time timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('stream', 'poll')),
  PRIMARY KEY (id, exchange_time)
) PARTITION BY RANGE (exchange_time);
CREATE INDEX price_ticks_lookup ON price_ticks (exchange, base, quote, exchange_time);

CREATE TABLE alert_decisions (
  id uuid PRIMARY KEY,
  rule_id uuid NOT NULL,
  tick_id uuid NOT NULL,
  price numeric NOT NULL,
  reference_price numeric,
  change_percent numeric,
  channels text[] NOT NULL,
  message text NOT NULL,
  decided_at timestamptz NOT NULL
);
CREATE INDEX alert_decisions_rule ON alert_decisions (rule_id);
CREATE INDEX alert_decisions_time ON alert_decisions (decided_at);

CREATE TABLE delivery_attempts (
  alert_id uuid NOT NULL REFERENCES alert_decisions (id),
  channel text NOT NULL CHECK (${CHANNEL}),
  attempt integer NOT NULL CHECK (attempt >= 1),
  status text NOT NULL CHECK (status IN ('delivered', 'failed', 'skipped')),
  reason text,
  at timestamptz NOT NULL,
  PRIMARY KEY (alert_id, channel, attempt)
);
CREATE INDEX delivery_attempts_delivered ON delivery_attempts (channel, at) WHERE status = 'delivered';

CREATE TABLE channel_usage (
  channel text NOT NULL CHECK (${CHANNEL}),
  period date NOT NULL,
  sent integer NOT NULL CHECK (sent >= 0),
  PRIMARY KEY (channel, period)
);

CREATE TABLE health_events (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('feed_stale', 'feed_recovered', 'channel_failing', 'channel_recovered',
    'quota_reached', 'disk_low', 'disk_recovered')),
  subject text NOT NULL,
  since timestamptz NOT NULL,
  reported_at timestamptz
);

CREATE TABLE owner_actions (
  id uuid PRIMARY KEY,
  at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('web', 'telegram')),
  action text NOT NULL,
  subject text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE owner_sessions (
  id_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE login_attempts (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL
);
CREATE INDEX login_attempts_time ON login_attempts (at);
`,
  },
];
