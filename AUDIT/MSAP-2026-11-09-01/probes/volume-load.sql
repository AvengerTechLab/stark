-- Audit MSAP-2026-11-09-01, dimension 7: 35 days of demo ticks, one per second for 4 demo pairs
-- (the rate the pipeline keeps at most). Demo prices, not market data.
\timing on
INSERT INTO price_ticks (id, exchange, base, quote, price, exchange_time, received_time, source)
SELECT gen_random_uuid(), p.exchange, p.base, p.quote,
       round((p.level * (1 + 0.01 * sin(extract(epoch FROM t) / 3600)))::numeric, 2),
       t, t + interval '150 milliseconds', 'stream'
FROM generate_series(timestamptz '2026-10-05 00:00:00+00', timestamptz '2026-11-08 23:59:59+00', interval '1 second') AS t
CROSS JOIN (VALUES ('bitkub','BTC','THB',2600000.0), ('bitkub','ETH','THB',95000.0),
                   ('binance','BTC','USDT',78000.0), ('binance','ETH','USDT',2900.0)) AS p(exchange, base, quote, level);
ANALYZE price_ticks;
SELECT count(*) AS rows FROM price_ticks;
SELECT pg_size_pretty(sum(pg_total_relation_size(inhrelid))) AS total,
       pg_size_pretty(sum(pg_relation_size(inhrelid))) AS heap,
       pg_size_pretty(sum(pg_indexes_size(inhrelid))) AS indexes
FROM pg_inherits WHERE inhparent = 'price_ticks'::regclass;
