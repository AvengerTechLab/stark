// Telegram adapter: Bot API sendMessage (core.telegram.org/bots/api, Bot API 10.3, read 2026-10-16).
// Plain text only, no parse mode (SECURITY.md T-20). The bot token is part of the URL, so a network
// error is reported by a fixed reason, never by its text, which could carry the URL (T-19).

import type { AlertChannel, OutgoingAlert, SendResult } from "../ports/channel.js";
import { JSON_HEADERS, jsonBody, retryAfterSeconds, type HttpPost } from "./http.js";

export interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
}

export function telegramChannel(config: TelegramConfig, post: HttpPost): AlertChannel {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  return {
    name: "telegram",
    async send(alert: OutgoingAlert): Promise<SendResult> {
      const body = JSON.stringify({ chat_id: config.chatId, text: alert.text, link_preview_options: { is_disabled: true } });
      let response;
      try {
        response = await post(url, { headers: JSON_HEADERS, body });
      } catch {
        return { status: "failed", reason: "network_error" };
      }
      const reply = jsonBody(response.body) as { ok?: unknown; parameters?: { retry_after?: unknown } } | undefined;
      if (response.status === 200) return reply?.ok === true ? { status: "delivered" } : { status: "failed", reason: "not_ok" };
      const fromBody = reply?.parameters?.retry_after;
      const wait = typeof fromBody === "number" && fromBody > 0 ? fromBody : retryAfterSeconds(response.retryAfter);
      return wait === undefined
        ? { status: "failed", reason: `http_${response.status}` }
        : { status: "failed", reason: `http_${response.status}`, retryAfterSeconds: wait };
    },
  };
}
