// Stateful fake for any alert channel (CLAUDE.md §5: no test calls a real service).
// Script the next results to simulate failures, rate limits (429) and dead webhooks.

import type { AlertChannel, ChannelName, OutgoingAlert, SendResult } from "../../src/ports/channel.js";

export class FakeChannel implements AlertChannel {
  readonly sent: OutgoingAlert[] = [];
  private readonly scripted: SendResult[] = [];

  constructor(readonly name: ChannelName) {}

  /** Results returned by the next sends, in order; after that every send is delivered. */
  willReturn(...results: SendResult[]): this {
    this.scripted.push(...results);
    return this;
  }

  async send(alert: OutgoingAlert): Promise<SendResult> {
    this.sent.push(alert);
    return this.scripted.shift() ?? { status: "delivered" };
  }
}
