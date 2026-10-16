// One price feed for one exchange (ARCHITECTURE.md §4, §7): a stream first, REST polling once a
// second while the stream is down, reconnects with growing waits, and strict obedience to rate
// limits, because an IP ban would stop alerts (ARCHITECTURE.md §2.1, SECURITY.md T-08). The socket,
// HTTP client and clock are passed in, so tests run on fakes (CLAUDE.md §5).

import type { Logger } from "../logger.js";
import type { FeedTick, PriceFeed } from "../ports/feed.js";
import type { FeedProvider } from "./provider.js";

export interface SocketHandlers {
  onOpen(): void;
  onMessage(text: string): void;
  /** Called once when the connection ends, for any reason, including a failed connect. */
  onClose(): void;
}

export type Connect = (url: string, handlers: SocketHandlers) => { close(): void };

export interface HttpResponse {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly body: string;
}

export type HttpGet = (url: string) => Promise<HttpResponse>;

export interface Timers {
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  set(ms: number, fn: () => void): () => void;
}

export interface FeedDeps {
  readonly connect: Connect;
  readonly httpGet: HttpGet;
  readonly timers: Timers;
  readonly now: () => Date;
  readonly logger: Logger;
}

export const POLL_INTERVAL_MS = 1000;
export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 60_000;
/** Pause after a 403 (WAF block) or 451 (region refused) before polling again (proposed). */
export const BLOCKED_MS = 60_000;

const none = () => undefined;

export class StreamFeed implements PriceFeed {
  readonly exchange: FeedProvider["exchange"];
  private onTick: (tick: FeedTick) => void = none;
  private running = false;
  private connected = false;
  private generation = 0;
  private socket: { close(): void } | undefined;
  private failures = 0;
  private cancelReconnect: () => void = none;
  private cancelRotate: () => void = none;
  private cancelPoll: (() => void) | undefined;
  private pollInFlight = false;
  private blockedUntil = 0;

  constructor(
    private readonly provider: FeedProvider,
    private readonly deps: FeedDeps,
  ) {
    this.exchange = provider.exchange;
  }

  async start(onTick: (tick: FeedTick) => void): Promise<void> {
    this.onTick = onTick;
    this.running = true;
    this.open();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.cancelReconnect();
    this.cancelRotate();
    this.stopPolling();
    this.generation++;
    this.socket?.close();
    this.socket = undefined;
  }

  private open(): void {
    const generation = ++this.generation;
    const current = () => this.running && generation === this.generation;
    const handlers: SocketHandlers = {
      onOpen: () => current() && this.opened(),
      onMessage: (text) => current() && this.message(text),
      onClose: () => current() && this.closed(),
    };
    try {
      this.socket = this.deps.connect(this.provider.streamUrl, handlers);
    } catch (error) {
      this.deps.logger.warn("feed.connect_failed", { exchange: this.exchange, error });
      this.closed();
    }
  }

  private opened(): void {
    this.connected = true;
    this.failures = 0;
    this.stopPolling();
    this.deps.logger.info("feed.connected", { exchange: this.exchange });
    const { rotateAfterMs } = this.provider;
    if (rotateAfterMs !== null) {
      this.cancelRotate = this.deps.timers.set(rotateAfterMs, () => {
        this.deps.logger.info("feed.renewing", { exchange: this.exchange });
        this.reconnectNow();
      });
    }
  }

  private message(text: string): void {
    const result = this.provider.parseStream(text, this.deps.now());
    if (result.kind === "ticks") this.emit(result.ticks);
    else if (result.kind === "shutdown") {
      this.deps.logger.info("feed.server_shutdown", { exchange: this.exchange });
      this.reconnectNow();
    } else if (result.kind === "invalid") {
      this.deps.logger.warn("feed.message_invalid", { exchange: this.exchange, reason: result.reason });
    }
  }

  private closed(): void {
    this.connected = false;
    this.socket = undefined;
    this.cancelRotate();
    this.deps.logger.warn("feed.disconnected", { exchange: this.exchange });
    this.startPolling();
    const wait = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.failures);
    this.failures++;
    this.cancelReconnect = this.deps.timers.set(wait, () => this.open());
  }

  /** A planned reconnect (shutdown notice, 24-hour limit): a new connection at once, no backoff. */
  private reconnectNow(): void {
    this.cancelRotate();
    this.connected = false;
    const old = this.socket;
    this.open();
    old?.close();
  }

  private startPolling(): void {
    if (this.cancelPoll !== undefined) return;
    const round = () => {
      this.cancelPoll = this.deps.timers.set(POLL_INTERVAL_MS, round);
      void this.pollOnce();
    };
    this.cancelPoll = this.deps.timers.set(0, round);
  }

  private stopPolling(): void {
    this.cancelPoll?.();
    this.cancelPoll = undefined;
  }

  private async pollOnce(): Promise<void> {
    if (this.connected || !this.running || this.pollInFlight) return;
    if (this.deps.now().getTime() < this.blockedUntil) return;
    const where = { exchange: this.exchange };
    this.pollInFlight = true;
    try {
      const response = await this.deps.httpGet(this.provider.pollUrl);
      if (!this.running) return;
      if (response.status === 200) {
        const result = this.provider.parsePoll(response.body, this.deps.now());
        if (result.kind === "ticks") this.emit(result.ticks);
        else if (result.kind === "invalid") this.deps.logger.warn("feed.message_invalid", { ...where, reason: result.reason });
      } else if (response.status === 429 || response.status === 418) {
        // Never retry early: repeated 429s bring an IP ban (ARCHITECTURE.md §2.1).
        const asked = Number(response.retryAfter);
        const waitMs = Number.isFinite(asked) && asked > 0 ? asked * 1000 : this.provider.defaultBlockMs;
        this.blockedUntil = this.deps.now().getTime() + waitMs;
        this.deps.logger.warn("feed.rate_limited", { ...where, status: response.status, waitSeconds: waitMs / 1000 });
      } else if (response.status === 403 || response.status === 451) {
        this.blockedUntil = this.deps.now().getTime() + BLOCKED_MS;
        this.deps.logger.error("feed.blocked", { ...where, status: response.status });
      } else {
        this.deps.logger.warn("feed.poll_failed", { ...where, status: response.status });
      }
    } catch (error) {
      this.deps.logger.warn("feed.poll_failed", { ...where, error });
    } finally {
      this.pollInFlight = false;
    }
  }

  private emit(ticks: readonly FeedTick[]): void {
    for (const tick of ticks) {
      try {
        this.onTick(tick);
      } catch (error) {
        this.deps.logger.error("feed.tick_handler_failed", { exchange: this.exchange, error });
      }
    }
  }
}
