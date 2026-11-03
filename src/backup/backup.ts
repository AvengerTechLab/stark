// The daily off-host backup (SPEC.md D-40, D-58): pg_dump writes the database to a file, restic encrypts
// it on this host and stores it in Cloudflare R2, snapshots older than 35 days are pruned, and the
// repository is checked. A second Healthchecks check hears about each run, so a missed or failed backup
// reaches the PO. pg_dump, restic and HTTP are passed in, so the steps are tested on fakes.
//
// restic reads RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE and the AWS_* keys from the environment itself;
// they are checked here only so a missing one fails at start, by name (CLAUDE.md §5).

import { ConfigError, type Env, type LogLevel } from "../config.js";
import type { HttpGet } from "../feeds/stream-feed.js";
import type { Logger } from "../logger.js";

/** Snapshots older than this, counted from the newest, are removed (D-40). */
export const KEEP_WITHIN = "35d";
const TAG = "stark-db";
const STDERR_LOGGED = 500;

export interface BackupConfig {
  readonly database: string;
  /** Where the dump is written before restic reads it; removed after every run. */
  readonly dumpFile: string;
  readonly heartbeatUrl?: string;
  readonly logLevel: LogLevel;
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command without a shell; with `stdoutFile`, its output goes to that file instead of `stdout`. */
export type RunCommand = (
  command: string,
  args: readonly string[],
  options?: { readonly stdoutFile?: string },
) => Promise<CommandResult>;

export interface BackupDeps {
  readonly run: RunCommand;
  readonly get: HttpGet;
  readonly removeFile: (path: string) => Promise<void>;
  readonly logger: Logger;
}

const REQUIRED = ["RESTIC_REPOSITORY", "RESTIC_PASSWORD_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const;
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const value = (env: Env, name: string): string | undefined => {
  const raw = env[name]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
};

export function loadBackupConfig(env: Env): BackupConfig {
  const missing = REQUIRED.filter((name) => value(env, name) === undefined);
  const invalid: string[] = [];
  const repository = value(env, "RESTIC_REPOSITORY");
  if (repository !== undefined && !repository.startsWith("s3:https://")) invalid.push("RESTIC_REPOSITORY");
  const heartbeatUrl = value(env, "BACKUP_HEARTBEAT_URL");
  if (heartbeatUrl !== undefined && !heartbeatUrl.startsWith("https://")) invalid.push("BACKUP_HEARTBEAT_URL");
  const rawLevel = value(env, "LOG_LEVEL") ?? "info";
  const logLevel = LOG_LEVELS.find((level) => level === rawLevel);
  if (logLevel === undefined) invalid.push("LOG_LEVEL");
  if (missing.length > 0 || invalid.length > 0) throw new ConfigError(missing, invalid);
  return {
    database: value(env, "BACKUP_DATABASE") ?? "stark",
    dumpFile: value(env, "BACKUP_DUMP_FILE") ?? "/var/lib/stark-backup/stark.sql",
    ...(heartbeatUrl !== undefined && { heartbeatUrl }),
    logLevel: logLevel ?? "info",
  };
}

/** The values the logger must never print. */
export function backupSecrets(env: Env): string[] {
  return ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "BACKUP_HEARTBEAT_URL"]
    .map((name) => value(env, name))
    .filter((v): v is string => v !== undefined);
}

interface Summary {
  readonly snapshot_id?: string;
  readonly total_bytes_processed?: number;
  readonly data_added?: number;
  readonly data_added_packed?: number;
}

/** restic's last `--json` line on a successful backup (restic docs, "Scripting", backup summary). */
function summaryOf(stdout: string): Summary | undefined {
  for (const line of stdout.split("\n").reverse()) {
    try {
      const message = JSON.parse(line) as { message_type?: unknown };
      if (message.message_type === "summary") return message as Summary;
    } catch {
      // Not a JSON line.
    }
  }
  return undefined;
}

/** Runs one backup; true when every step succeeded. */
export async function runBackup(config: BackupConfig, deps: BackupDeps): Promise<boolean> {
  const { run, logger } = deps;
  const started = Date.now();

  const step = async (name: string, command: string, args: readonly string[], stdoutFile?: string) => {
    const result = await run(command, args, stdoutFile === undefined ? undefined : { stdoutFile });
    if (result.code !== 0) {
      logger.error("backup.step_failed", { step: name, code: result.code, stderr: result.stderr.slice(-STDERR_LOGGED) });
    }
    return result;
  };

  let ok = false;
  try {
    logger.info("backup.started", { database: config.database });
    const dump = await step("dump", "runuser", ["-u", "postgres", "--", "pg_dump", config.database], config.dumpFile);
    if (dump.code !== 0) return false;

    const backup = await step("backup", "restic", ["backup", "--json", "--host", "stark", "--tag", TAG, config.dumpFile]);
    if (backup.code !== 0) return false;
    const summary = summaryOf(backup.stdout);
    if (summary === undefined) {
      logger.error("backup.step_failed", { step: "backup", reason: "no_summary" });
      return false;
    }

    const forget = await step("forget", "restic", ["forget", "--tag", TAG, "--keep-within", KEEP_WITHIN, "--prune"]);
    const check = await step("check", "restic", ["check"]);
    ok = forget.code === 0 && check.code === 0;
    logger.info("backup.completed", {
      snapshotId: summary.snapshot_id,
      bytesProcessed: summary.total_bytes_processed,
      bytesAdded: summary.data_added,
      bytesAddedPacked: summary.data_added_packed,
      pruned: forget.code === 0,
      checked: check.code === 0,
      durationMs: Date.now() - started,
    });
    return ok;
  } finally {
    await deps.removeFile(config.dumpFile).catch((error: unknown) => logger.warn("backup.cleanup_failed", { error }));
    await ping(config, deps, ok);
  }
}

/** Tells the backup's Healthchecks check how the run went; `/fail` signals a failure at once. */
async function ping(config: BackupConfig, deps: BackupDeps, ok: boolean): Promise<void> {
  if (config.heartbeatUrl === undefined) return;
  try {
    const response = await deps.get(ok ? config.heartbeatUrl : `${config.heartbeatUrl}/fail`);
    if (response.status < 200 || response.status > 299) deps.logger.warn("backup.heartbeat_failed", { status: response.status });
  } catch {
    deps.logger.warn("backup.heartbeat_failed", { reason: "network_error" });
  }
}
