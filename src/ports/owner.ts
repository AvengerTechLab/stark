// What the owner interface needs from storage (API.md §1–2, DATABASE.md). PostgreSQL implements these in
// src/storage/postgres.ts; tests use the in-memory fakes in test/fakes/fake-owner-storage.ts.

import type { ChannelName } from "./channel.js";
import type { AlertDecision, DeliveryAttempt } from "./storage.js";
import type { Rule } from "../domain/rules.js";

/** One change the PO made, stored with the change itself (SECURITY.md T-22, DATABASE.md `owner_actions`). */
export interface OwnerAction {
  readonly id: string;
  readonly at: Date;
  readonly source: "web" | "telegram";
  /** For example `rule.created`, `rule.disabled`, `channel.switched_off`. */
  readonly action: string;
  /** Rule ID or channel name. */
  readonly subject: string;
  /** The changed fields; never a secret. */
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface RuleAdmin {
  /** Every rule, oldest first. */
  list(): Promise<readonly Rule[]>;
  get(id: string): Promise<Rule | undefined>;
  /** Stores a new rule and its action in one transaction. */
  create(rule: Rule, action?: OwnerAction): Promise<void>;
  /** Replaces a rule's fields, channels, enabled flag and state, with its action; false if it does not exist. */
  update(rule: Rule, action: OwnerAction): Promise<boolean>;
  /** Deletes a rule, with its action; false if it does not exist. Its decisions stay (DATABASE.md). */
  remove(id: string, action: OwnerAction): Promise<boolean>;
}

export interface ChannelState {
  readonly channel: ChannelName;
  readonly enabled: boolean;
  readonly deadSince: Date | null;
}

export interface ChannelAdmin {
  list(): Promise<readonly ChannelState[]>;
  /** Switches a channel on or off system-wide (D-09), with its action. */
  setEnabled(channel: ChannelName, enabled: boolean, action: OwnerAction): Promise<void>;
}

/** Owner sessions and failed logins (API.md §1.1). Only hashes of session IDs are stored. */
export interface SessionStore {
  create(idHash: string, createdAt: Date, expiresAt: Date): Promise<void>;
  isValid(idHash: string, now: Date): Promise<boolean>;
  remove(idHash: string): Promise<void>;
  recordFailedLogin(at: Date): Promise<void>;
  /** Failed login times at or after `since`, oldest first. */
  failedLoginsSince(since: Date): Promise<readonly Date[]>;
}

export interface DecisionWithAttempts {
  readonly decision: AlertDecision;
  readonly attempts: readonly DeliveryAttempt[];
}

export interface AlertQuery {
  /** Decisions made in [from, to), newest first, at most `limit`, each with its delivery attempts. */
  decisions(from: Date, to: Date, limit: number): Promise<readonly DecisionWithAttempts[]>;
}
