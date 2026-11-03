// Entry point of the daily backup, run once by deploy/stark-backup.service (SPEC.md D-58). It exits 0
// when every step succeeded and 1 otherwise, so systemd and the Healthchecks check both see a failure.

import { ConfigError, type Env } from "../config.js";
import { fetchGet } from "../feeds/node-network.js";
import { createLogger } from "../logger.js";
import { backupSecrets, loadBackupConfig, runBackup, type BackupConfig } from "./backup.js";
import { nodeRun, removeFile } from "./node-run.js";

export async function main(env: Env): Promise<number> {
  let config: BackupConfig;
  try {
    config = loadBackupConfig(env);
  } catch (error) {
    const logger = createLogger({ level: "error", secrets: backupSecrets(env) });
    if (error instanceof ConfigError) logger.error("backup.config_invalid", { missing: error.missing, invalid: error.invalid });
    else logger.error("backup.config_invalid", { error });
    return 1;
  }
  const logger = createLogger({ level: config.logLevel, secrets: backupSecrets(env) });
  try {
    return (await runBackup(config, { run: nodeRun, get: fetchGet, removeFile, logger })) ? 0 : 1;
  } catch (error) {
    logger.error("backup.failed", { error });
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.env).then((code) => {
    process.exitCode = code;
  });
}
