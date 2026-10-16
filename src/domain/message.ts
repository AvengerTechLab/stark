// The alert message (EVENTS.md §4, D-33): one short Thai text, the same on every channel.
// Plain text built only from typed, validated values (SECURITY.md T-20); its first line is the
// email subject, so it never holds a line break. Numbers are formatted for reading only: thousands
// are grouped and trailing zeros dropped, but no digit that carries value is rounded away.

import type { Exchange } from "../ports/feed.js";
import { isDecimal } from "./decimal.js";
import type { Rule } from "./rules.js";
import { thaiClock } from "./thai-time.js";

export interface MessageInput {
  readonly rule: Rule;
  readonly exchange: Exchange;
  readonly price: string;
  readonly exchangeTime: Date;
  readonly referencePrice: string | null;
  /** Signed, 2 decimals, as in the decision (EVENTS.md §2.2). */
  readonly changePercent: string | null;
}

const PAIR = /^([A-Z0-9]+)\/(THB|USDT)$/;
const SIGNED_PERCENT = /^-?[0-9]+\.[0-9]{2}$/;
const EXCHANGE_NAMES: Readonly<Record<Exchange, string>> = { bitkub: "Bitkub", binance: "Binance" };
const DIRECTION_WORDS = { up: "ขึ้น", down: "ลง", either: "ขึ้นหรือลง" } as const;

/** A contract Decimal for reading: "3512400.50" → "3,512,400.5". Throws on anything else. */
export function formatNumber(decimal: string): string {
  if (!isDecimal(decimal)) throw new Error("not a decimal");
  const [whole = "", fraction = ""] = decimal.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const kept = fraction.replace(/0+$/, "");
  return kept === "" ? grouped : `${grouped}.${kept}`;
}

export function formatAlertMessage(input: MessageInput): string {
  const { rule } = input;
  const quote = PAIR.exec(rule.pair)?.[2];
  if (quote === undefined) throw new Error("pair is not BASE/THB or BASE/USDT");
  const latest = `ราคาล่าสุด ${formatNumber(input.price)} ${quote} (${EXCHANGE_NAMES[input.exchange]}) เวลา ${thaiClock(input.exchangeTime)} น.`;

  if (rule.kind !== "change") {
    const level = formatNumber(rule.level);
    const [word, sign] = rule.kind === "above" ? ["สูงกว่า", "≥"] : ["ต่ำกว่า", "≤"];
    return [`[Stark] ${rule.pair} ${word} ${level} แล้ว`, latest, `กฎ: ราคา ${sign} ${level}`].join("\n");
  }

  const { referencePrice, changePercent } = input;
  if (referencePrice === null || changePercent === null || !SIGNED_PERCENT.test(changePercent)) {
    throw new Error("a change rule's message needs its reference price and change");
  }
  const falling = changePercent.startsWith("-");
  const window = `ใน ${rule.windowMinutes} นาที`;
  return [
    `[Stark] ${rule.pair} ${falling ? "ลง" : "ขึ้น"} ${falling ? "" : "+"}${changePercent}% ${window}`,
    latest,
    `ราคาเมื่อ ${rule.windowMinutes} นาทีก่อน ${formatNumber(referencePrice)} ${quote}`,
    `กฎ: ${DIRECTION_WORDS[rule.direction]} ≥ ${formatNumber(rule.percent)}% ${window}`,
  ].join("\n");
}
