// Email adapter: the Gmail API users.messages.send, which accepts the send-only scope gmail.send
// (D-41; Gmail API discovery document, revision 20261012). The access token comes from Google's
// token endpoint (oauth2.googleapis.com/token, from accounts.google.com's OpenID configuration) by
// the stored refresh token, and is reused until a minute before it expires. A refused refresh is a
// failure the health monitor reports (SECURITY.md T-21).

import type { AlertChannel, OutgoingAlert, SendResult } from "../ports/channel.js";
import { JSON_HEADERS, jsonBody, retryAfterSeconds, type HttpPost } from "./http.js";

export interface GmailConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly sender: string;
  readonly recipient: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const REFRESH_MARGIN_MS = 60_000;
/** One plain address: no spaces, angle brackets, commas or line breaks, so it cannot add a header. */
const ADDRESS = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/;

function encodedWord(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function wrap(base64: string): string {
  return base64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/** The RFC 5322 message for one alert. Its first line is the subject (EVENTS.md §2.3). */
export function mimeMessage(config: GmailConfig, alert: OutgoingAlert): string | undefined {
  const subject = alert.text.split("\n")[0] ?? "";
  if (/[\r\n]/.test(subject) || /[^\w-]/.test(alert.alertId)) return undefined;
  return [
    `From: ${config.sender}`,
    `To: ${config.recipient}`,
    `Subject: ${encodedWord(subject)}`,
    `X-Stark-Alert-Id: ${alert.alertId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(alert.text, "utf8").toString("base64")),
  ].join("\r\n");
}

export function gmailChannel(config: GmailConfig, post: HttpPost, now: () => Date): AlertChannel {
  if (!ADDRESS.test(config.sender) || !ADDRESS.test(config.recipient)) {
    throw new Error("GMAIL_SENDER and ALERT_EMAIL_TO must each be one plain email address");
  }
  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string | undefined> {
    if (token !== undefined && token.expiresAt - REFRESH_MARGIN_MS > now().getTime()) return token.value;
    const response = await post(TOKEN_URL, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
      }).toString(),
    });
    const reply = jsonBody(response.body) as { access_token?: unknown; expires_in?: unknown } | undefined;
    if (response.status !== 200 || typeof reply?.access_token !== "string" || typeof reply.expires_in !== "number") {
      token = undefined;
      return undefined;
    }
    token = { value: reply.access_token, expiresAt: now().getTime() + reply.expires_in * 1000 };
    return token.value;
  }

  return {
    name: "email",
    async send(alert: OutgoingAlert): Promise<SendResult> {
      const message = mimeMessage(config, alert);
      if (message === undefined) return { status: "failed", reason: "invalid_message" };
      let response;
      try {
        const bearer = await accessToken();
        if (bearer === undefined) return { status: "failed", reason: "token_refresh_failed" };
        response = await post(SEND_URL, {
          headers: { ...JSON_HEADERS, authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ raw: Buffer.from(message, "utf8").toString("base64url") }),
        });
      } catch {
        return { status: "failed", reason: "network_error" };
      }
      if (response.status === 200) return { status: "delivered" };
      if (response.status === 401) token = undefined;
      const wait = retryAfterSeconds(response.retryAfter);
      return wait === undefined
        ? { status: "failed", reason: `http_${response.status}` }
        : { status: "failed", reason: `http_${response.status}`, retryAfterSeconds: wait };
    },
  };
}
