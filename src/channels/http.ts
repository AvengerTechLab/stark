// The HTTP POST every channel adapter sends through, so tests can replace it (CLAUDE.md §5).
// The real one is Node.js 22's fetch, with a time limit; no dependency is added.

export interface PostRequest {
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface PostResponse {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly body: string;
}

export type HttpPost = (url: string, request: PostRequest) => Promise<PostResponse>;

/** A send that has not answered in this time counts as failed (ARCHITECTURE.md §6: 6.5 s for sends). */
export const SEND_TIMEOUT_MS = 5000;

export const fetchPost: HttpPost = async (url, request) => {
  const response = await fetch(url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  return { status: response.status, retryAfter: response.headers.get("retry-after"), body: await response.text() };
};

/** Seconds from a Retry-After header, if it holds a positive number of seconds. */
export function retryAfterSeconds(header: string | null): number | undefined {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** Parses a JSON body, or returns undefined. Only used to read fields from provider replies. */
export function jsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export const JSON_HEADERS = { "content-type": "application/json" } as const;
