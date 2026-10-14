import { describe, expect, it, vi } from "vitest";
import { main } from "../src/index.js";

describe("main", () => {
  it("returns 1 and logs only variable names when configuration is missing", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(main({ TELEGRAM_BOT_TOKEN: "000000:FAKE-telegram-token" })).toBe(1);
      const output = write.mock.calls.map((call) => String(call[0])).join("");
      expect(output).toContain('"event":"config.load_failed"');
      expect(output).toContain("DATABASE_URL");
      expect(output).not.toContain("FAKE-telegram-token");
    } finally {
      write.mockRestore();
    }
  });

  it("returns 0 and logs app.started with the configured channels", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = main({
        DATABASE_URL: "postgres://stark:fake-db-pass@localhost:5432/stark",
        OWNER_PASSWORD_HASH: "$argon2id$v=19$m=65536,t=3,p=4$ZmFrZXNhbHQ$ZmFrZWhhc2g",
        TELEGRAM_BOT_TOKEN: "000000:FAKE-telegram-token",
        TELEGRAM_OWNER_CHAT_ID: "123456789",
        DISCORD_WEBHOOK_URL: "https://discord.example/fake-webhook",
      });
      expect(code).toBe(0);
      const output = write.mock.calls.map((call) => String(call[0])).join("");
      expect(output).toContain('"event":"app.started"');
      expect(output).toContain('"channelsConfigured":["telegram","discord"]');
    } finally {
      write.mockRestore();
    }
  });
});
