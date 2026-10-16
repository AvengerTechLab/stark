// Fake HTTP for the channel adapters (CLAUDE.md §5): records each request and answers with
// scripted responses, so no test reaches Telegram, LINE, Discord or Google.

import type { HttpPost, PostRequest, PostResponse } from "../../src/channels/http.js";

export class FakeHttpPost {
  readonly requests: { url: string; request: PostRequest }[] = [];
  private readonly scripted: (PostResponse | Error)[] = [];

  constructor(private readonly fallback: PostResponse = { status: 200, retryAfter: null, body: "{}" }) {}

  willReturn(...responses: (PostResponse | Error)[]): this {
    this.scripted.push(...responses);
    return this;
  }

  post: HttpPost = async (url, request) => {
    this.requests.push({ url, request });
    const next = this.scripted.shift() ?? this.fallback;
    if (next instanceof Error) throw next;
    return next;
  };

  json(index: number): unknown {
    const body = this.requests[index]?.request.body;
    return body === undefined ? undefined : JSON.parse(body);
  }
}

export const response = (status: number, body: unknown = {}, retryAfter: string | null = null): PostResponse => ({
  status,
  retryAfter,
  body: typeof body === "string" ? body : JSON.stringify(body),
});
