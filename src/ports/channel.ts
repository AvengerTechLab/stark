// The one interface every alert channel implements (ARCHITECTURE.md §2.2, §4).

export type ChannelName = "telegram" | "line" | "discord" | "email";

export interface OutgoingAlert {
  /** AlertDecision id; the idempotency key for every attempt (EVENTS.md §2.2). */
  readonly alertId: string;
  readonly text: string;
}

export type SendResult =
  | { readonly status: "delivered" }
  | { readonly status: "failed"; readonly reason: string; readonly retryAfterSeconds?: number }
  /** The channel will never accept sends again, e.g. a Discord webhook answering 404. */
  | { readonly status: "dead"; readonly reason: string };

export interface AlertChannel {
  readonly name: ChannelName;
  send(alert: OutgoingAlert): Promise<SendResult>;
}
