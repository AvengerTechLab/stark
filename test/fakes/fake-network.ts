// Fakes for the network and the clock under the feed adapters (CLAUDE.md §5): no test opens a real
// socket or sends a real HTTP request, and time moves only when a test says so.

import type { Connect, HttpGet, HttpResponse, SocketHandlers, Timers } from "../../src/feeds/stream-feed.js";

export class FakeClock implements Timers {
  private time: number;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 0;

  constructor(start: Date) {
    this.time = start.getTime();
  }

  now = (): Date => new Date(this.time);

  set(ms: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.queue.push({ at: this.time + ms, fn, id });
    return () => {
      this.queue = this.queue.filter((t) => t.id !== id);
    };
  }

  /** Moves time forward, running each timer that falls due, in order, and letting promises settle. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    await settle();
    for (;;) {
      const due = this.queue.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.queue = this.queue.filter((t) => t.id !== due.id);
      this.time = due.at;
      due.fn();
      await settle();
    }
    this.time = end;
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

export interface FakeSocket {
  readonly url: string;
  closed: boolean;
  open(): void;
  message(text: string): void;
  /** The server ends the connection. */
  drop(): void;
}

export class FakeSockets {
  readonly sockets: FakeSocket[] = [];

  connect: Connect = (url: string, handlers: SocketHandlers) => {
    const socket: FakeSocket = {
      url,
      closed: false,
      open: () => handlers.onOpen(),
      message: (text) => handlers.onMessage(text),
      drop: () => {
        socket.closed = true;
        handlers.onClose();
      },
    };
    this.sockets.push(socket);
    return {
      close: () => {
        if (socket.closed) return;
        socket.closed = true;
        handlers.onClose();
      },
    };
  };

  get last(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (socket === undefined) throw new Error("no socket opened");
    return socket;
  }
}

export class FakeHttp {
  readonly requests: string[] = [];
  private readonly scripted: (HttpResponse | Promise<HttpResponse>)[] = [];

  constructor(private readonly fallback: HttpResponse) {}

  /** Responses for the next requests, in order; after that every request gets the fallback. */
  willReturn(...responses: (HttpResponse | Promise<HttpResponse>)[]): this {
    this.scripted.push(...responses);
    return this;
  }

  get: HttpGet = async (url: string) => {
    this.requests.push(url);
    return this.scripted.shift() ?? this.fallback;
  };
}
