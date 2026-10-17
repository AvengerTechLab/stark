import { describe, expect, it, vi } from "vitest";
import { main } from "../src/index.js";

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
