// LINE adapter: Messaging API push message (line/line-openapi messaging-api.yml, commit fa5577c;
// "Retrying an API request", developers.line.biz, read 2026-10-16). The alert ID is the
// X-Line-Retry-Key, so LINE runs a retried request once; a 409 means it already accepted this key.

import type { AlertChannel, OutgoingAlert, SendResult } from "../ports/channel.js";
import { retryAfterSeconds, type HttpPost } from "./http.js";

export interface LineConfig {
  readonly channelAccessToken: string;
  readonly ownerUserId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lineChannel(config: LineConfig, post: HttpPost): AlertChannel {
  return {
    name: "line",
    async send(alert: OutgoingAlert): Promise<SendResult> {
      if (!UUID.test(alert.alertId)) return { status: "failed", reason: "invalid_alert_id" };
      let response;
      try {
        response = await post("https://api.line.me/v2/bot/message/push", {
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.channelAccessToken}`,
            "x-line-retry-key": alert.alertId,
          },
          body: JSON.stringify({ to: config.ownerUserId, messages: [{ type: "text", text: alert.text }] }),
        });
      } catch {
        return { status: "failed", reason: "network_error" };
      }
      if (response.status === 200 || response.status === 409) return { status: "delivered" };
      const wait = retryAfterSeconds(response.retryAfter);
      return wait === undefined
        ? { status: "failed", reason: `http_${response.status}` }
        : { status: "failed", reason: `http_${response.status}`, retryAfterSeconds: wait };
    },
  };
}
