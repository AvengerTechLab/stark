// Process entry point. Phase 5 only loads configuration and reports start; components arrive in Phase 6.

import { ConfigError, loadConfig, secretValues, type Env } from "./config.js";
import { createLogger } from "./logger.js";

export function main(env: Env): number {
  try {
    const config = loadConfig(env);
    const logger = createLogger({ level: config.logLevel, secrets: secretValues(config) });
    logger.info("app.started", {
      channelsConfigured: ["telegram", config.line && "line", config.discord && "discord", config.gmail && "email"].filter(
        Boolean,
      ),
    });
    return 0;
  } catch (error) {
    const logger = createLogger({ level: "error" });
    if (error instanceof ConfigError) {
      logger.error("config.load_failed", { missing: error.missing, invalid: error.invalid });
    } else {
      logger.error("app.start_failed", { error });
    }
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.env);
}
