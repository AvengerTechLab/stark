// The real socket, HTTP client and clock behind StreamFeed, using what Node.js 22 has built in
// (global WebSocket and fetch), so the feeds add no dependency (SECURITY.md T-13). Kept thin: all
// behaviour lives in StreamFeed, which is tested on fakes.

import type { Connect, HttpGet, Timers } from "./stream-feed.js";

/** A request that has not answered in this time counts as failed. */
export const HTTP_TIMEOUT_MS = 5000;

export const webSocketConnect: Connect = (url, handlers) => {
  const socket = new WebSocket(url);
  let closed = false;
  socket.addEventListener("open", () => handlers.onOpen());
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") handlers.onMessage(event.data);
  });
  // An error is always followed by close; report the end once.
  socket.addEventListener("close", () => {
    if (closed) return;
    closed = true;
    handlers.onClose();
  });
  return { close: () => socket.close() };
};

export const fetchGet: HttpGet = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  return { status: response.status, retryAfter: response.headers.get("retry-after"), body: await response.text() };
};

export const realTimers: Timers = {
  set(ms, fn) {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};
