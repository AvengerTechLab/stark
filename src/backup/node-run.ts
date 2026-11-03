// The real command runner and file removal behind runBackup, using Node.js built-ins only
// (SECURITY.md T-13). Commands run without a shell, so no argument is ever parsed by one.

import { spawn } from "node:child_process";
import { open, rm } from "node:fs/promises";
import type { RunCommand } from "./backup.js";

export const nodeRun: RunCommand = async (command, args, options) => {
  // The dump holds every rule and alert: only its owner (root) may read it.
  const file = options?.stdoutFile === undefined ? undefined : await open(options.stdoutFile, "w", 0o600);
  try {
    return await new Promise((resolve) => {
      const child = spawn(command, args, { stdio: ["ignore", file?.fd ?? "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", (error) => resolve({ code: 127, stdout, stderr: stderr + String(error) }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  } finally {
    await file?.close();
  }
};

export const removeFile = (path: string): Promise<void> => rm(path, { force: true });
