import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, secretValues, type Env } from "../src/config.js";

// Fake values for tests only; none is a real credential.
const BASE: Env = {
  DATABASE_URL: "postgres://stark:fake-db-pass@localhost:5432/stark",
  OWNER_PASSWORD_HASH: "$argon2id$v=19$m=65536,t=3,p=4$ZmFrZXNhbHQ$ZmFrZWhhc2g",
  TELEGRAM_BOT_TOKEN: "000000:FAKE-telegram-token",
  TELEGRAM_OWNER_CHAT_ID: "123456789",
};

function configError(env: Env): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected ConfigError");
}

describe("loadConfig", () => {
  it("loads the required settings and leaves optional channels unset", () => {
    const config = loadConfig(BASE);
    expect(config.telegram.ownerChatId).toBe("123456789");
    expect(config.logLevel).toBe("info");
    expect(config.line).toBeUndefined();
    expect(config.discord).toBeUndefined();
    expect(config.gmail).toBeUndefined();
  });

  it("lists every missing required variable by name", () => {
    const error = configError({});
    expect(error.missing).toEqual([
      "DATABASE_URL",
      "OWNER_PASSWORD_HASH",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_OWNER_CHAT_ID",
    ]);
  });

  it("treats blank values as missing", () => {
    expect(configError({ ...BASE, TELEGRAM_BOT_TOKEN: "   " }).missing).toEqual(["TELEGRAM_BOT_TOKEN"]);
  });

  it("never puts a value in the error message", () => {
    const error = configError({ ...BASE, DATABASE_URL: "mysql://secret-in-url", TELEGRAM_OWNER_CHAT_ID: "abc" });
    expect(error.invalid).toEqual(["DATABASE_URL", "TELEGRAM_OWNER_CHAT_ID"]);
    expect(error.message).not.toContain("secret-in-url");
    expect(error.message).not.toContain("abc");
  });

  it("rejects a password that is not an Argon2id hash", () => {
    expect(configError({ ...BASE, OWNER_PASSWORD_HASH: "plain-text" }).invalid).toEqual(["OWNER_PASSWORD_HASH"]);
  });

  it("rejects an unknown log level", () => {
    expect(configError({ ...BASE, LOG_LEVEL: "verbose" }).invalid).toEqual(["LOG_LEVEL"]);
  });

  it("enables a channel only when its whole group is set", () => {
    const config = loadConfig({
      ...BASE,
      LINE_CHANNEL_ACCESS_TOKEN: "fake-line-token",
      LINE_OWNER_USER_ID: "Ufake",
      DISCORD_WEBHOOK_URL: "https://discord.example/fake-webhook",
      GMAIL_OAUTH_CLIENT_ID: "fake-client-id",
      GMAIL_OAUTH_CLIENT_SECRET: "fake-client-secret",
      GMAIL_OAUTH_REFRESH_TOKEN: "fake-refresh-token",
      GMAIL_SENDER: "sender@example.com",
      ALERT_EMAIL_TO: "po@example.com",
    });
    expect(config.line?.ownerUserId).toBe("Ufake");
    expect(config.discord?.webhookUrl).toBe("https://discord.example/fake-webhook");
    expect(config.gmail?.recipient).toBe("po@example.com");
  });

  it("reports the missing half of a partly set channel group", () => {
    const error = configError({ ...BASE, GMAIL_OAUTH_CLIENT_ID: "fake-client-id" });
    expect(error.missing).toEqual([
      "GMAIL_OAUTH_CLIENT_SECRET",
      "GMAIL_OAUTH_REFRESH_TOKEN",
      "GMAIL_SENDER",
      "ALERT_EMAIL_TO",
    ]);
  });

  it("rejects a Discord webhook that is not HTTPS", () => {
    expect(configError({ ...BASE, DISCORD_WEBHOOK_URL: "http://discord.example/x" }).invalid).toEqual([
      "DISCORD_WEBHOOK_URL",
    ]);
  });
});

describe("secretValues", () => {
  it("returns every configured credential", () => {
    const secrets = secretValues(
      loadConfig({ ...BASE, DISCORD_WEBHOOK_URL: "https://discord.example/fake-webhook" }),
    );
    expect(secrets).toContain(BASE.TELEGRAM_BOT_TOKEN);
    expect(secrets).toContain(BASE.DATABASE_URL);
    expect(secrets).toContain("https://discord.example/fake-webhook");
  });
});
