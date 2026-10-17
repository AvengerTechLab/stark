// Heartbeat (SPEC.md D-43, EVENTS.md §2.4): while the process runs, it pings an uptime monitor outside
// the host every 5 minutes; that monitor tells the PO when the pings stop (SECURITY.md T-17). The URL
// is a secret, so a failure is logged by status or a fixed reason, never with the URL or error text.

import type { Logger } from "../logger.js";
import type { HttpGet, Timers } from "../feeds/stream-feed.js";

export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export interface HeartbeatOptions {
  readonly url: string;
  readonly get: HttpGet;
  readonly timers: Timers;
  readonly logger: Logger;
}

/** Starts pinging at once; returns a function that stops it. */
export function startHeartbeat(options: HeartbeatOptions): () => void {
  let cancel: () => void = () => undefined;
  let stopped = false;
  const beat = async () => {
    try {
      const response = await options.get(options.url);
      if (response.status < 200 || response.status > 299) options.logger.warn("heartbeat.failed", { status: response.status });
    } catch {
      options.logger.warn("heartbeat.failed", { reason: "network_error" });
    }
  };
  const loop = () => {
    if (stopped) return;
    cancel = options.timers.set(HEARTBEAT_INTERVAL_MS, loop);
    void beat();
  };
  cancel = options.timers.set(0, loop);
  return () => {
    stopped = true;
    cancel();
  };
}
