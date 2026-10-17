import { describe, expect, it } from "vitest";
import { createChannels } from "../../src/channels/index.js";
import { discordChannel } from "../../src/channels/discord.js";
import { gmailChannel } from "../../src/channels/gmail.js";
import { lineChannel } from "../../src/channels/line.js";
import { telegramChannel } from "../../src/channels/telegram.js";
import type { Config } from "../../src/config.js";
import { FakeHttpPost, response } from "../fakes/fake-http-post.js";

// Credentials here are made-up test values, not real secrets. The alert text is demo text.
const TOKEN = "123456:TEST-token-not-real";
const alert = {
  alertId: "3f2a1c4e-0000-4000-8000-000000000001",
  text: "[Stark] BTC/THB สูงกว่า 100 แล้ว\nราคาล่าสุด 100 THB (Bitkub) เวลา 12:00:00 น.\nกฎ: ราคา ≥ 100",
};

describe("Telegram (sendMessage)", () => {
  const setup = () => {
    const http = new FakeHttpPost(response(200, { ok: true, result: { message_id: 1 } }));
    return { http, channel: telegramChannel({ botToken: TOKEN, chatId: "424242" }, http.post) };
  };

  it("sends plain text to the PO's chat, with no parse mode (SECURITY.md T-20)", async () => {
    const { http, channel } = setup();
    expect(await channel.send(alert)).toEqual({ status: "delivered" });
    expect(http.requests[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(http.requests[0]?.request.headers["content-type"]).toBe("application/json");
    expect(http.json(0)).toEqual({ chat_id: "424242", text: alert.text, link_preview_options: { is_disabled: true } });
  });

  it("passes on Telegram's retry_after when it hits flood control", async () => {
    const { http, channel } = setup();
    http.willReturn(response(429, { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } }));
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "http_429", retryAfterSeconds: 7 });
  });

  it("counts a reply without ok as a failure", async () => {
    const { http, channel } = setup();
    http.willReturn(response(200, { ok: false }), response(400, { ok: false, description: "Bad Request: chat not found" }));
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "not_ok" });
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "http_400" });
  });

  it("reports a network error without the error text, which could carry the token in its URL (T-19)", async () => {
    const { http, channel } = setup();
    http.willReturn(new Error(`connect failed https://api.telegram.org/bot${TOKEN}/sendMessage`));
    const result = await channel.send(alert);
    expect(result).toEqual({ status: "failed", reason: "network_error" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe("LINE (push message)", () => {
  const setup = () => {
    const http = new FakeHttpPost(response(200, { sentMessages: [{ id: "1" }] }));
    return { http, channel: lineChannel({ channelAccessToken: "line-test-token", ownerUserId: "U0000" }, http.post) };
  };

  it("pushes a text message with the alert ID as the retry key, so a retry never sends twice", async () => {
    const { http, channel } = setup();
    expect(await channel.send(alert)).toEqual({ status: "delivered" });
    const request = http.requests[0];
    expect(request?.url).toBe("https://api.line.me/v2/bot/message/push");
    expect(request?.request.headers).toMatchObject({
      authorization: "Bearer line-test-token",
      "x-line-retry-key": alert.alertId,
    });
    expect(http.json(0)).toEqual({ to: "U0000", messages: [{ type: "text", text: alert.text }] });
  });

  it("counts a 409 as delivered: LINE already accepted this retry key", async () => {
    const { http, channel } = setup();
    http.willReturn(response(409, { message: "The retry key is already accepted" }));
    expect(await channel.send(alert)).toEqual({ status: "delivered" });
  });

  it("reports a 429 and a server error as failures", async () => {
    const { http, channel } = setup();
    http.willReturn(response(429), response(500));
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "http_429" });
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "http_500" });
  });

  it("refuses an alert ID that is not a UUID, since LINE requires one as the retry key", async () => {
    const { channel } = setup();
    expect(await channel.send({ ...alert, alertId: "a1" })).toEqual({ status: "failed", reason: "invalid_alert_id" });
  });
});

describe("Discord (execute webhook)", () => {
  const WEBHOOK = "https://discord.com/api/webhooks/1/test-not-real";
  const setup = () => {
    const http = new FakeHttpPost(response(200, { id: "1" }));
    return { http, channel: discordChannel({ webhookUrl: WEBHOOK }, http.post) };
  };

  it("posts the text with every mention switched off (SECURITY.md T-20) and waits for confirmation", async () => {
    const { http, channel } = setup();
    expect(await channel.send(alert)).toEqual({ status: "delivered" });
    expect(http.requests[0]?.url).toBe(`${WEBHOOK}?wait=true`);
    expect(http.json(0)).toEqual({ content: alert.text, allowed_mentions: { parse: [] } });
  });

  it("passes on retry_after from a 429 body, or the header when the body has none", async () => {
    const { http, channel } = setup();
    http.willReturn(response(429, { message: "You are being rate limited.", retry_after: 64.57, global: false }), response(429, "", "65"));
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "http_429", retryAfterSeconds: 64.57 });
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "http_429", retryAfterSeconds: 65 });
  });

  it("reports a webhook answering 404 as dead", async () => {
    const { http, channel } = setup();
    http.willReturn(response(404, { message: "Unknown Webhook", code: 10015 }));
    expect(await channel.send(alert)).toEqual({ status: "dead", reason: "http_404" });
  });
});

describe("Gmail (users.messages.send with the send-only scope, D-41)", () => {
  const gmailConfig = {
    clientId: "client-id",
    clientSecret: "client-secret-not-real",
    refreshToken: "refresh-token-not-real",
    sender: "stark.owner@example.com",
    recipient: "owner@example.com",
  };
  const token = (accessToken: string, expiresIn = 3599) =>
    response(200, { access_token: accessToken, expires_in: expiresIn, scope: "https://www.googleapis.com/auth/gmail.send", token_type: "Bearer" });
  const setup = () => {
    const clock = { now: new Date("2026-10-16T07:00:00.000Z") };
    const http = new FakeHttpPost(response(200, { id: "m1", labelIds: ["SENT"] }));
    return { http, clock, channel: gmailChannel(gmailConfig, http.post, () => clock.now) };
  };
  const decodeRaw = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

  it("refreshes an access token, then sends the alert as a plain-text UTF-8 email", async () => {
    const { http, channel } = setup();
    http.willReturn(token("access-1"));
    expect(await channel.send(alert)).toEqual({ status: "delivered" });

    const refresh = http.requests[0];
    expect(refresh?.url).toBe("https://oauth2.googleapis.com/token");
    expect(refresh?.request.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(refresh?.request.body))).toEqual({
      grant_type: "refresh_token",
      client_id: "client-id",
      client_secret: "client-secret-not-real",
      refresh_token: "refresh-token-not-real",
    });

    const send = http.requests[1];
    expect(send?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(send?.request.headers.authorization).toBe("Bearer access-1");
    const mime = decodeRaw((http.json(1) as { raw: string }).raw);
    const [head = "", body = ""] = mime.split("\r\n\r\n");
    expect(head.split("\r\n")).toEqual([
      "From: stark.owner@example.com",
      "To: owner@example.com",
      `Subject: =?UTF-8?B?${Buffer.from("[Stark] BTC/THB สูงกว่า 100 แล้ว").toString("base64")}?=`,
      `X-Stark-Alert-Id: ${alert.alertId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
    ]);
    expect(Buffer.from(body.replaceAll("\r\n", ""), "base64").toString("utf8")).toBe(alert.text);
    expect(body.split("\r\n").every((line) => line.length <= 76)).toBe(true);
  });

  it("reuses the access token until a minute before it expires", async () => {
    const { http, clock, channel } = setup();
    http.willReturn(token("access-1", 3600));
    await channel.send(alert);
    clock.now = new Date(clock.now.getTime() + 3600_000 - 61_000);
    await channel.send(alert);
    expect(http.requests.filter((r) => r.url.includes("oauth2")).length).toBe(1);
    clock.now = new Date(clock.now.getTime() + 2000);
    http.willReturn(token("access-2"));
    await channel.send(alert);
    expect(http.requests.at(-1)?.request.headers.authorization).toBe("Bearer access-2");
  });

  it("reports a refresh token Google refuses as a failure, for the health monitor (SECURITY.md T-21)", async () => {
    const { http, channel } = setup();
    http.willReturn(response(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }));
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "token_refresh_failed" });
    expect(http.requests).toHaveLength(1);
  });

  it("drops the access token on a 401, so the next attempt refreshes it", async () => {
    const { http, channel } = setup();
    http.willReturn(token("access-1"), response(401), token("access-2"));
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "http_401" });
    expect(await channel.send(alert)).toEqual({ status: "delivered" });
    expect(http.requests.at(-1)?.request.headers.authorization).toBe("Bearer access-2");
  });

  it("passes on Retry-After from a 429", async () => {
    const { http, channel } = setup();
    http.willReturn(token("access-1"), response(429, {}, "30"));
    expect(await channel.send(alert)).toEqual({ status: "failed", reason: "http_429", retryAfterSeconds: 30 });
  });

  it("refuses a first line with a line break, so no header can be injected (T-20)", async () => {
    const { http, channel } = setup();
    http.willReturn(token("access-1"));
    expect(await channel.send({ ...alert, text: "subject\rBcc: x@example.com" })).toEqual({
      status: "failed",
      reason: "invalid_message",
    });
    expect(http.requests.filter((r) => r.url.includes("messages/send"))).toHaveLength(0);
  });

  it("refuses an address that could carry a header", () => {
    expect(() => gmailChannel({ ...gmailConfig, recipient: "a@example.com\r\nBcc: b@example.com" }, new FakeHttpPost().post, () => new Date())).toThrow();
  });
});

describe("createChannels", () => {
  const base: Config = {
    databaseUrl: "postgres://localhost/stark",
    ownerPasswordHash: "$argon2id$test",
    logLevel: "info",
    http: { host: "127.0.0.1", port: 8080 },
    telegram: { botToken: TOKEN, ownerChatId: "1" },
  };

  it("builds Telegram always, and the other channels only when configured", () => {
    const post = new FakeHttpPost().post;
    expect(createChannels(base, post, () => new Date()).map((c) => c.name)).toEqual(["telegram"]);
    const all: Config = {
      ...base,
      line: { channelAccessToken: "t", ownerUserId: "U1" },
      discord: { webhookUrl: "https://discord.com/api/webhooks/1/x" },
      gmail: { clientId: "c", clientSecret: "s", refreshToken: "r", sender: "a@example.com", recipient: "b@example.com" },
    };
    expect(createChannels(all, post, () => new Date()).map((c) => c.name)).toEqual(["telegram", "line", "discord", "email"]);
  });
});
