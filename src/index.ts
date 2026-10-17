// Process entry point: reads the configuration, builds the real outside world (PostgreSQL, sockets,
// HTTP, timers) and starts Stark through the same composition root the end-to-end tests use
// (src/app/stark.ts). SIGTERM and SIGINT stop it cleanly.

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import pg from "pg";
import { ConfigError, loadConfig, secretValues, type Config, type Env } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { fetchPost } from "./channels/http.js";
import { fetchGet, realTimers, webSocketConnect } from "./feeds/node-network.js";
import { diskFreeShare } from "./app/disk.js";
import { startStark, type StarkHandle } from "./app/stark.js";
import {
  dropExpiredPartitions,
  ensurePartitions,
  migrate,
  PgAlertQuery,
  PgChannelSettings,
  PgDeliveryLog,
  PgHealthLog,
  PgPriceLog,
  PgRuleStore,
  PgSessionStore,
} from "./storage/postgres.js";

/** Price-log partitions made ahead of time, in days (DATABASE.md). */
const PARTITION_DAYS_AHEAD = 3;

async function start(config: Config, logger: Logger): Promise<{ stark: StarkHandle; pool: pg.Pool }> {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  pool.on("error", (error) => logger.error("db.pool_error", { error }));
  try {
    const rules = new PgRuleStore(pool);
    const channels = new PgChannelSettings(pool);
    const stark = await startStark({
      config,
      stores: {
        priceLog: new PgPriceLog(pool),
        rules,
        ruleAdmin: rules,
        channelSettings: channels,
        channelAdmin: channels,
        deliveries: new PgDeliveryLog(pool),
        healthLog: new PgHealthLog(pool),
        sessions: new PgSessionStore(pool),
        alerts: new PgAlertQuery(pool),
      },
      maintenance: {
        prepare: async () => {
          const applied = await migrate(pool);
          if (applied.length > 0) logger.info("db.migrated", { applied });
          await ensurePartitions(pool, new Date(), PARTITION_DAYS_AHEAD);
        },
        daily: async (now) => {
          await ensurePartitions(pool, now, PARTITION_DAYS_AHEAD);
          const dropped = await dropExpiredPartitions(pool, now);
          if (dropped.length > 0) logger.info("db.partitions_dropped", { dropped });
        },
      },
      connect: webSocketConnect,
      httpGet: fetchGet,
      httpPost: fetchPost,
      timers: realTimers,
      now: () => new Date(),
      newId: randomUUID,
      logger,
      diskFree: () => diskFreeShare("/"),
      listen: async (handler) => {
        const server = createServer((req, res) => void handler(req, res));
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(config.http.port, config.http.host, resolve);
        });
        logger.info("http.listening", { host: config.http.host, port: config.http.port });
        return { close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
      },
    });
    return { stark, pool };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

/** Starts Stark; resolves 1 if it cannot start, 0 once it is running. */
export async function main(env: Env): Promise<number> {
  let config: Config;
  try {
    config = loadConfig(env);
  } catch (error) {
    const logger = createLogger({ level: "error" });
    if (error instanceof ConfigError) logger.error("config.load_failed", { missing: error.missing, invalid: error.invalid });
    else logger.error("app.start_failed", { error });
    return 1;
  }
  const logger = createLogger({ level: config.logLevel, secrets: secretValues(config) });
  try {
    const { stark, pool } = await start(config, logger);
    const shutdown = async (signal: string) => {
      logger.info("app.stopping", { signal });
      await stark.stop();
      await pool.end();
      process.exit(0);
    };
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
    return 0;
  } catch (error) {
    logger.error("app.start_failed", { error });
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.env).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
