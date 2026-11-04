// One fake for every outside HTTP service Stark calls (CLAUDE.md §5), routed by URL, for the end-to-end
// test: the providers' pair lists, Telegram, LINE, Discord, Google and the uptime monitor. Telegram's
// getUpdates follows the Bot API: updates stay queued until a call carries a higher offset, `limit` caps the
// batch, and a call with a timeout waits until the test queues a message, while `timeout: 0` answers at once.

import type { HttpPost, PostRequest, PostResponse } from "../../src/channels/http.js";
import type { HttpGet, HttpResponse } from "../../src/feeds/stream-feed.js";
import { BINANCE_EXCHANGE_INFO, BITKUB_SYMBOLS } from "../feeds/fixtures.js";

const ok = (body: unknown): PostResponse => ({ status: 200, retryAfter: null, body: typeof body === "string" ? body : JSON.stringify(body) });

export class FakeInternet {
  readonly gets: string[] = [];
  readonly posts: { url: string; request: PostRequest }[] = [];
  private updateId = 0;
  private queued: { update_id: number }[] = [];
  private waiting: { limit: number; resolve: (r: PostResponse) => void } | undefined;
  /** Extra Bitkub pairs on top of the documented BTC_THB example (demo). */
  bitkubSymbols = BITKUB_SYMBOLS;
  /** Status the LINE push API answers with; set to 500 to make LINE fail. */
  lineStatus = 200;

  constructor(private readonly telegramToken: string) {}

  get: HttpGet = async (url): Promise<HttpResponse> => {
    this.gets.push(url);
    if (url === "https://api.bitkub.com/api/v3/market/symbols") return ok(this.bitkubSymbols);
    if (url.startsWith("https://data-api.binance.vision/api/v3/exchangeInfo")) return ok(BINANCE_EXCHANGE_INFO);
    if (url.startsWith("https://uptime.example.com/")) return ok("OK");
    if (url === "https://api.bitkub.com/api/v3/market/ticker") return ok("[]");
    if (url.startsWith("https://data-api.binance.vision/api/v3/ticker/price")) return ok("[]");
    return { status: 404, retryAfter: null, body: "" };
  };

  post: HttpPost = async (url, request) => {
    this.posts.push({ url, request });
    const telegram = `https://api.telegram.org/bot${this.telegramToken}/`;
    if (url === `${telegram}getUpdates`) return this.getUpdates(JSON.parse(request.body) as { offset?: number; timeout?: number; limit?: number });
    if (url === `${telegram}sendMessage`) return ok({ ok: true, result: { message_id: 1 } });
    if (url === "https://api.line.me/v2/bot/message/push") {
      return this.lineStatus === 200 ? ok({ sentMessages: [{ id: "1" }] }) : { status: this.lineStatus, retryAfter: null, body: "{}" };
    }
    if (url.startsWith("https://discord.com/api/webhooks/")) return ok({ id: "1" });
    if (url === "https://oauth2.googleapis.com/token") return ok({ access_token: "access-test", expires_in: 3599 });
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") return ok({ id: "m1" });
    return { status: 404, retryAfter: null, body: "" };
  };

  /** The PO sends `text` to the bot from their private chat. */
  telegramMessage(chatId: number, text: string, type = "private"): void {
    const update = { update_id: ++this.updateId, message: { message_id: this.updateId, chat: { id: chatId, type }, text } };
    this.queued.push(update);
    this.release();
  }

  private getUpdates(params: { offset?: number; timeout?: number; limit?: number }): Promise<PostResponse> {
    const offset = params.offset ?? 0;
    if (offset > 0) this.queued = this.queued.filter((u) => u.update_id >= offset); // confirmed: forgotten
    const limit = params.limit ?? 100;
    if (this.queued.length > 0 || (params.timeout ?? 0) === 0) return Promise.resolve(this.batch(limit));
    return new Promise((resolve) => (this.waiting = { limit, resolve }));
  }

  private release(): void {
    if (this.waiting === undefined) return;
    const { limit, resolve } = this.waiting;
    this.waiting = undefined;
    resolve(this.batch(limit));
  }

  private batch(limit: number): PostResponse {
    return ok({ ok: true, result: this.queued.slice(0, limit) });
  }

  /** Text of every Telegram message Stark sent, in order. */
  telegramTexts(): string[] {
    return this.posts
      .filter((p) => p.url.endsWith("/sendMessage"))
      .map((p) => (JSON.parse(p.request.body) as { text: string }).text);
  }
}
