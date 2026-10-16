// Rule input validation (API.md §1.3), shared by the web API and the Telegram commands so both
// refuse the same input with the same codes. Pure: the provider's pair list is passed in.
// Nothing is rounded or coerced; the only normalisation is upper-casing the pair.

import type { ChannelName } from "../ports/channel.js";
import type { ChangeRule, LevelRule } from "./rules.js";
import { compareDecimal, isDecimal } from "./decimal.js";

type Spec<R> = Omit<R, "id" | "enabled" | "state">;

/** A rule as the PO submits it, before it gets an ID, an enabled flag and a state. */
export type RuleSpec = Spec<LevelRule> | Spec<ChangeRule>;

export type RuleInputCode =
  | "BODY_INVALID"
  | "PAIR_UNKNOWN"
  | "LEVEL_INVALID"
  | "PERCENT_INVALID"
  | "WINDOW_INVALID"
  | "CHANNELS_INVALID"
  | "FIELD_NOT_ALLOWED";

export interface RuleInputError {
  readonly field: string;
  readonly code: RuleInputCode;
  /** Fixed text; never contains the submitted value (SECURITY.md T-05). */
  readonly message: string;
}

export type RuleInputResult =
  | { readonly ok: true; readonly value: RuleSpec }
  | { readonly ok: false; readonly errors: readonly RuleInputError[] };

const KINDS = ["above", "below", "change"] as const;
const DIRECTIONS = ["up", "down", "either"] as const;
const CHANNELS: readonly ChannelName[] = ["telegram", "line", "discord", "email"];
const LEVEL_FIELDS = ["level"];
const CHANGE_FIELDS = ["percent", "windowMinutes", "direction"];
const COMMON_FIELDS = ["kind", "pair", "channels"];
const PAIR = /^[A-Z0-9]+\/(THB|USDT)$/;
const MAX_LEVEL_LENGTH = 40;
const MAX_WINDOW_MINUTES = 1440;

const MESSAGES: Record<RuleInputCode, string> = {
  BODY_INVALID: "is missing or not one of the allowed values",
  PAIR_UNKNOWN: "must be a pair the provider lists, written BASE/THB or BASE/USDT",
  LEVEL_INVALID: `must be a decimal string greater than 0, at most ${MAX_LEVEL_LENGTH} characters`,
  PERCENT_INVALID: "must be a decimal string greater than 0, at most 100, with at most 2 decimals",
  WINDOW_INVALID: `must be a whole number of minutes from 1 to ${MAX_WINDOW_MINUTES}`,
  CHANNELS_INVALID: "must be a non-empty list of distinct channels: telegram, line, discord, email",
  FIELD_NOT_ALLOWED: "is not allowed for this kind of rule",
};

function error(field: string, code: RuleInputCode): RuleInputError {
  return { field, code, message: `${field} ${MESSAGES[code]}` };
}

/** An unknown key is submitted text, so its message does not repeat it; only `field` holds it. */
function unknownField(field: string): RuleInputError {
  return { field, code: "BODY_INVALID", message: "unknown field" };
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function validLevel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_LEVEL_LENGTH &&
    isDecimal(value) &&
    compareDecimal(value, "0") > 0
  );
}

function validPercent(value: unknown): value is string {
  if (typeof value !== "string" || !isDecimal(value)) return false;
  const fraction = value.split(".")[1] ?? "";
  return fraction.length <= 2 && compareDecimal(value, "0") > 0 && compareDecimal(value, "100") <= 0;
}

function validWindow(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_WINDOW_MINUTES;
}

function validChannels(value: unknown): value is ChannelName[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((c) => isOneOf(c, CHANNELS)) &&
    new Set(value).size === value.length
  );
}

/** Checks a submitted rule against API.md §1.3 and reports every problem at once. */
export function validateRuleInput(input: unknown, isListed: (pair: string) => boolean): RuleInputResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [error("body", "BODY_INVALID")] };
  }
  const body = input as Record<string, unknown>;
  const kind = body["kind"];
  if (!isOneOf(kind, KINDS)) return { ok: false, errors: [error("kind", "BODY_INVALID")] };

  const errors: RuleInputError[] = [];
  const own = kind === "change" ? CHANGE_FIELDS : LEVEL_FIELDS;
  const other = kind === "change" ? LEVEL_FIELDS : CHANGE_FIELDS;

  const rawPair = body["pair"];
  const pair = typeof rawPair === "string" ? rawPair.toUpperCase() : "";
  if (!PAIR.test(pair) || !isListed(pair)) errors.push(error("pair", "PAIR_UNKNOWN"));

  const { level, percent, windowMinutes, direction, channels } = body;
  if (kind !== "change") {
    if (!validLevel(level)) errors.push(error("level", "LEVEL_INVALID"));
  } else {
    if (!validPercent(percent)) errors.push(error("percent", "PERCENT_INVALID"));
    if (!validWindow(windowMinutes)) errors.push(error("windowMinutes", "WINDOW_INVALID"));
    if (!isOneOf(direction, DIRECTIONS)) errors.push(error("direction", "BODY_INVALID"));
  }
  if (!validChannels(channels)) errors.push(error("channels", "CHANNELS_INVALID"));

  for (const key of Object.keys(body)) {
    if (other.includes(key)) errors.push(error(key, "FIELD_NOT_ALLOWED"));
    else if (!own.includes(key) && !COMMON_FIELDS.includes(key)) errors.push(unknownField(key));
  }

  if (errors.length > 0) return { ok: false, errors };
  const base = { pair, channels: channels as ChannelName[] };
  const value: RuleSpec =
    kind === "change"
      ? {
          kind,
          ...base,
          percent: percent as string,
          windowMinutes: windowMinutes as number,
          direction: direction as ChangeRule["direction"],
        }
      : { kind, ...base, level: level as string };
  return { ok: true, value };
}
