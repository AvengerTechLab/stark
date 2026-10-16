// Discord adapter: Execute Webhook (discord/discord-api-docs, webhook.mdx and rate-limits.mdx,
// commit c43598d). Every mention is switched off (`allowed_mentions.parse: []`, T-20). A webhook
// answering 404 must not be used again (ARCHITECTURE.md §2.2), so it is reported dead.

import type { AlertChannel, OutgoingAlert, SendResult } from "../ports/channel.js";
import { JSON_HEADERS, jsonBody, retryAfterSeconds, type HttpPost } from "./http.js";

export interface DiscordConfig {
  /** The webhook URL is itself the secret (SECURITY.md T-19). */
  readonly webhookUrl: string;
}

export function discordChannel(config: DiscordConfig, post: HttpPost): AlertChannel {
  const url = `${config.webhookUrl}?wait=true`;
  return {
    name: "discord",
    async send(alert: OutgoingAlert): Promise<SendResult> {
      let response;
      try {
        response = await post(url, {
          headers: JSON_HEADERS,
          body: JSON.stringify({ content: alert.text, allowed_mentions: { parse: [] } }),
        });
      } catch {
        return { status: "failed", reason: "network_error" };
      }
      if (response.status === 200 || response.status === 204) return { status: "delivered" };
      if (response.status === 404) return { status: "dead", reason: "http_404" };
      const fromBody = (jsonBody(response.body) as { retry_after?: unknown } | undefined)?.retry_after;
      const wait = typeof fromBody === "number" && fromBody > 0 ? fromBody : retryAfterSeconds(response.retryAfter);
      return wait === undefined
        ? { status: "failed", reason: `http_${response.status}` }
        : { status: "failed", reason: `http_${response.status}`, retryAfterSeconds: wait };
    },
  };
}
