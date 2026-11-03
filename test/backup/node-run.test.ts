import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nodeRun, removeFile } from "../../src/backup/node-run.js";

// Runs `node` itself as the child process, so the test needs nothing installed beyond Node.js.
describe("nodeRun", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "stark-backup-test-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("returns the exit code, stdout and stderr", async () => {
    const script = "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)";
    expect(await nodeRun(process.execPath, ["-e", script])).toEqual({ code: 3, stdout: "out", stderr: "err" });
  });

  it("writes stdout to a file only its owner can read", async () => {
    const file = join(dir, "dump.sql");
    const result = await nodeRun(process.execPath, ["-e", "process.stdout.write('SELECT 1;')"], { stdoutFile: file });
    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(await readFile(file, "utf8")).toBe("SELECT 1;");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("reports a command that cannot start as a failure, not a crash", async () => {
    const result = await nodeRun("stark-no-such-command", []);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("ENOENT");
  });

  it("removeFile ignores a file that is already gone", async () => {
    await expect(removeFile(join(dir, "missing.sql"))).resolves.toBeUndefined();
  });
});
