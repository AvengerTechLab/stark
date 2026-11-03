// S6-15: the daily backup (SPEC.md D-40, D-58). pg_dump, restic and the uptime monitor are fakes; no test
// touches a database, Cloudflare R2 or Healthchecks (CLAUDE.md §5). Every credential below is made up.

import { describe, expect, it } from "vitest";
import {
  KEEP_WITHIN,
  backupSecrets,
  loadBackupConfig,
  runBackup,
  type BackupConfig,
  type CommandResult,
  type RunCommand,
} from "../../src/backup/backup.js";
import { ConfigError } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";

const ENV_WITHOUT_HEARTBEAT = {
  RESTIC_REPOSITORY: "s3:https://0000.r2.cloudflarestorage.com/stark-backup",
  RESTIC_PASSWORD_FILE: "/etc/stark/restic-password",
  AWS_ACCESS_KEY_ID: "FAKE-access-key-id",
  AWS_SECRET_ACCESS_KEY: "FAKE-secret-access-key",
};
const ENV = { ...ENV_WITHOUT_HEARTBEAT, BACKUP_HEARTBEAT_URL: "https://hc-ping.example/FAKE-backup-check" };

const SUMMARY = JSON.stringify({
  message_type: "summary",
  data_added: 2048,
  data_added_packed: 900,
  total_bytes_processed: 123456,
  snapshot_id: "abc123",
});

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdoutFile?: string;
}

/** Records every command; answers from `results` by the command's step (pg_dump, or restic's sub-command). */
function fakeRun(results: Partial<Record<string, CommandResult>> = {}) {
  const calls: Call[] = [];
  const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });
  const run: RunCommand = async (command, args, options) => {
    calls.push({ command, args, ...(options?.stdoutFile !== undefined && { stdoutFile: options.stdoutFile }) });
    const step = command === "restic" ? (args[0] ?? "") : "dump";
    return results[step] ?? ok(step === "backup" ? `{"message_type":"status"}\n${SUMMARY}\n` : "");
  };
  return { run, calls };
}

function setup(results?: Partial<Record<string, CommandResult>>, env: Record<string, string> = ENV) {
  const config: BackupConfig = loadBackupConfig(env);
  const { run, calls } = fakeRun(results);
  const gets: string[] = [];
  const removed: string[] = [];
  const lines: string[] = [];
  const deps = {
    run,
    get: async (url: string) => {
      gets.push(url);
      return { status: 200, retryAfter: null, body: "OK" };
    },
    removeFile: async (path: string) => {
      removed.push(path);
    },
    logger: createLogger({ level: "debug", secrets: backupSecrets(env), write: (l) => lines.push(l) }),
  };
  return { config, deps, calls, gets, removed, lines };
}

const fail = (stderr: string): CommandResult => ({ code: 1, stdout: "", stderr });

describe("loadBackupConfig", () => {
  it("names every missing variable and never a value", () => {
    let error: unknown;
    try {
      loadBackupConfig({ AWS_SECRET_ACCESS_KEY: "FAKE-secret-access-key" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).missing).toEqual(["RESTIC_REPOSITORY", "RESTIC_PASSWORD_FILE", "AWS_ACCESS_KEY_ID"]);
    expect((error as Error).message).not.toContain("FAKE-secret-access-key");
  });

  it("accepts only an S3 repository over HTTPS and an HTTPS heartbeat", () => {
    expect(() => loadBackupConfig({ ...ENV, RESTIC_REPOSITORY: "/srv/restic" })).toThrow("invalid: RESTIC_REPOSITORY");
    expect(() => loadBackupConfig({ ...ENV, RESTIC_REPOSITORY: "s3:http://x/stark-backup" })).toThrow("RESTIC_REPOSITORY");
    expect(() => loadBackupConfig({ ...ENV, BACKUP_HEARTBEAT_URL: "http://hc-ping.example/x" })).toThrow(
      "invalid: BACKUP_HEARTBEAT_URL",
    );
  });

  it("defaults the database and dump file, and the heartbeat is optional", () => {
    expect(loadBackupConfig(ENV_WITHOUT_HEARTBEAT)).toEqual({
      database: "stark",
      dumpFile: "/var/lib/stark-backup/stark.sql",
      logLevel: "info",
    });
  });
});

describe("runBackup", () => {
  it("dumps the database to a file, backs it up, prunes to 35 days, checks the repository, then pings", async () => {
    const { config, deps, calls, gets, removed } = setup();
    expect(await runBackup(config, deps)).toBe(true);
    expect(calls).toEqual([
      {
        command: "runuser",
        args: ["-u", "postgres", "--", "pg_dump", "stark"],
        stdoutFile: "/var/lib/stark-backup/stark.sql",
      },
      { command: "restic", args: ["backup", "--json", "--host", "stark", "--tag", "stark-db", "/var/lib/stark-backup/stark.sql"] },
      { command: "restic", args: ["forget", "--tag", "stark-db", "--keep-within", "35d", "--prune"] },
      { command: "restic", args: ["check"] },
    ]);
    expect(KEEP_WITHIN).toBe("35d");
    expect(gets).toEqual(["https://hc-ping.example/FAKE-backup-check"]);
    expect(removed).toEqual(["/var/lib/stark-backup/stark.sql"]);
  });

  it("logs the size restic reports, so the real backup size is known (D-58)", async () => {
    const { config, deps, lines } = setup();
    await runBackup(config, deps);
    const done = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === "backup.completed");
    expect(done).toMatchObject({ snapshotId: "abc123", bytesProcessed: 123456, bytesAdded: 2048, bytesAddedPacked: 900 });
  });

  it("never backs up a dump that failed, and reports the failure", async () => {
    const { config, deps, calls, gets, removed } = setup({ dump: fail("pg_dump: error: connection failed") });
    expect(await runBackup(config, deps)).toBe(false);
    expect(calls.map((c) => c.command)).toEqual(["runuser"]);
    expect(gets).toEqual(["https://hc-ping.example/FAKE-backup-check/fail"]);
    expect(removed).toEqual(["/var/lib/stark-backup/stark.sql"]);
  });

  it("does not prune when the backup failed, even when restic still printed a summary", async () => {
    // Exit code 3: restic made a snapshot but could not read some source data (restic docs, "Exit codes").
    for (const backup of [fail("Fatal: unable to open repository"), { code: 3, stdout: `${SUMMARY}\n`, stderr: "" }]) {
      const { config, deps, calls, gets } = setup({ backup });
      expect(await runBackup(config, deps)).toBe(false);
      expect(calls.map((c) => c.args[0])).toEqual(["-u", "backup"]);
      expect(gets).toEqual(["https://hc-ping.example/FAKE-backup-check/fail"]);
    }
  });

  it("reports a failed prune or check even though the backup itself was made", async () => {
    for (const step of ["forget", "check"]) {
      const { config, deps, gets, lines } = setup({ [step]: fail("Fatal: something broke") });
      expect(await runBackup(config, deps)).toBe(false);
      expect(gets).toEqual(["https://hc-ping.example/FAKE-backup-check/fail"]);
      expect(lines.some((l) => l.includes('"event":"backup.step_failed"') && l.includes(`"step":"${step}"`))).toBe(true);
    }
  });

  it("treats a backup with no summary as failed", async () => {
    const { config, deps, gets } = setup({ backup: { code: 0, stdout: '{"message_type":"status"}\n', stderr: "" } });
    expect(await runBackup(config, deps)).toBe(false);
    expect(gets).toEqual(["https://hc-ping.example/FAKE-backup-check/fail"]);
  });

  it("works without a heartbeat, and a failed ping does not change the result", async () => {
    const quiet = setup(undefined, ENV_WITHOUT_HEARTBEAT);
    expect(await runBackup(quiet.config, quiet.deps)).toBe(true);
    expect(quiet.gets).toEqual([]);

    const down = setup();
    const deps = { ...down.deps, get: () => Promise.reject(new Error("network down")) };
    expect(await runBackup(down.config, deps)).toBe(true);
    expect(down.lines.some((l) => l.includes('"event":"backup.heartbeat_failed"'))).toBe(true);
  });

  it("never logs a credential or the heartbeat URL, even when restic prints them", async () => {
    const leak = fail(`Fatal: FAKE-access-key-id FAKE-secret-access-key https://hc-ping.example/FAKE-backup-check`);
    const { config, deps, lines } = setup({ backup: leak });
    await runBackup(config, { ...deps, get: () => Promise.reject(new Error("https://hc-ping.example/FAKE-backup-check")) });
    const text = lines.join("\n");
    expect(text).toContain('"event":"backup.step_failed"');
    for (const secret of ["FAKE-access-key-id", "FAKE-secret-access-key", "FAKE-backup-check"]) expect(text).not.toContain(secret);
  });
});
