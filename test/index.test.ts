import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installFatalHandlers, main } from "../src/index.js";
import { createLogger } from "../src/logger.js";

// Fake values for tests only; none is a real credential. No test here reaches a real service: the
// database address below refuses connections, so start-up stops before any network call.
const ENV = {
  DATABASE_URL: "postgres://stark:fake-db-pass@127.0.0.1:1/stark",
  OWNER_PASSWORD_HASH: "$argon2id$v=19$m=65536,t=3,p=4$ZmFrZXNhbHQ$ZmFrZWhhc2g",
  TELEGRAM_BOT_TOKEN: "000000:FAKE-telegram-token",
  TELEGRAM_OWNER_CHAT_ID: "123456789",
};

async function output(run: () => Promise<number>): Promise<{ code: number; text: string }> {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const code = await run();
    return { code, text: write.mock.calls.map((call) => String(call[0])).join("") };
  } finally {
    write.mockRestore();
  }
}

describe("main", () => {
  it("returns 1 and logs only variable names when configuration is missing", async () => {
    const { code, text } = await output(() => main({ TELEGRAM_BOT_TOKEN: "000000:FAKE-telegram-token" }));
    expect(code).toBe(1);
    expect(text).toContain('"event":"config.load_failed"');
    expect(text).toContain("DATABASE_URL");
    expect(text).not.toContain("FAKE-telegram-token");
  });

  it("returns 1 when the database cannot be reached, without printing its password or the token", async () => {
    const { code, text } = await output(() => main(ENV));
    expect(code).toBe(1);
    expect(text).toContain('"event":"app.start_failed"');
    expect(text).not.toContain("fake-db-pass");
    expect(text).not.toContain("FAKE-telegram-token");
  });
});

// R-9 (audit MSAP-2026-11-09-01 F-101): an error nothing else caught is logged through Stark's logger, which
// hides secrets, and the process then exits so systemd starts it clean (SPEC.md D-66).
describe("installFatalHandlers", () => {
  it("logs an unhandled rejection or uncaught exception without secrets, then exits with 1", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info", secrets: ["FAKE-telegram-token"], write: (l) => lines.push(l) });
    const target = new EventEmitter();
    const exits: number[] = [];
    installFatalHandlers(target, logger, (code) => exits.push(code));
    target.emit("unhandledRejection", new Error("failed at https://api.telegram.org/botFAKE-telegram-token/x"));
    target.emit("uncaughtException", new TypeError("boom"));
    expect(exits).toEqual([1, 1]);
    expect(lines[0]).toContain('"event":"process.unhandled_rejection"');
    expect(lines[1]).toContain('"event":"process.uncaught_exception"');
    expect(lines.join("")).not.toContain("FAKE-telegram-token");
  });

  it("is installed on the process only when the entry point asks for it", async () => {
    const before = { rejection: process.listeners("unhandledRejection"), exception: process.listeners("uncaughtException") };
    await output(() => main(ENV));
    expect(process.listeners("unhandledRejection")).toEqual(before.rejection);
    await output(() => main(ENV, { processGuards: true }));
    const added = {
      rejection: process.listeners("unhandledRejection").filter((l) => !before.rejection.includes(l)),
      exception: process.listeners("uncaughtException").filter((l) => !before.exception.includes(l)),
    };
    for (const l of added.rejection) process.removeListener("unhandledRejection", l);
    for (const l of added.exception) process.removeListener("uncaughtException", l);
    expect([added.rejection.length, added.exception.length]).toEqual([1, 1]);
  });
});
