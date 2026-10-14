import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, type LoggerOptions } from "../src/logger.js";

function capture(options: Partial<LoggerOptions> = {}) {
  const lines: string[] = [];
  const logger = createLogger({
    level: "debug",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    write: (line) => lines.push(line),
    ...options,
  });
  const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, parsed };
}

describe("createLogger", () => {
  it("writes one JSON line with time, level, event and fields", () => {
    const { logger, parsed } = capture();
    logger.info("feed.connected", { exchange: "bitkub" });
    expect(parsed()).toEqual([
      { time: "2026-01-01T00:00:00.000Z", level: "info", event: "feed.connected", exchange: "bitkub" },
    ]);
  });

  it("drops events below the configured level", () => {
    const { logger, lines } = capture({ level: "warn" });
    logger.debug("feed.tick_received");
    logger.info("feed.connected");
    logger.warn("feed.stale_detected");
    expect(lines).toHaveLength(1);
  });

  it("rejects event names that are not domain.action_result", () => {
    const { logger } = capture();
    expect(() => logger.info("Started")).toThrow(/domain\.action_result/);
    expect(() => logger.info("app")).toThrow();
  });

  it("masks fields whose names look sensitive, at any depth", () => {
    const { logger, parsed } = capture();
    logger.info("channel.configured", {
      botToken: "x",
      nested: { webhookUrl: "y", password: "z", ok: "kept" },
    });
    expect(parsed()[0]).toMatchObject({
      botToken: REDACTED,
      nested: { webhookUrl: REDACTED, password: REDACTED, ok: "kept" },
    });
  });

  it("replaces known secret values wherever they appear", () => {
    const secret = "000000:FAKE-telegram-token";
    const { logger, lines } = capture({ secrets: [secret] });
    logger.error("channel.send_failed", {
      reason: `POST https://api.telegram.org/bot${secret}/sendMessage failed`,
      list: [secret],
      error: new Error(`token ${secret} rejected`),
    });
    expect(lines.join("\n")).not.toContain(secret);
    expect(lines[0]).toContain(REDACTED);
  });

  it("logs an Error as its name and message only", () => {
    const { logger, parsed } = capture();
    logger.error("app.start_failed", { error: new TypeError("boom") });
    expect(parsed()[0]?.["error"]).toEqual({ name: "TypeError", message: "boom" });
  });
});
