// Exact decimal arithmetic for prices and percentages (EVENTS.md §1, playbook §6 items 1–4).
// Values are kept as integers scaled by a power of ten (bigint), never as binary floats,
// and comparisons are rearranged so that no division is needed.

const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;
const SIGNED = /^-?[0-9]+(\.[0-9]+)?$/;

interface Scaled {
  readonly units: bigint;
  readonly scale: number;
}

/** True for the contract's Decimal: digits, an optional fraction, no sign or exponent. */
export function isDecimal(text: string): boolean {
  return DECIMAL.test(text);
}

function toScaled(text: string, pattern: RegExp): Scaled {
  if (!pattern.test(text)) throw new Error(`not a decimal: ${JSON.stringify(text)}`);
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  const [whole = "", fraction = ""] = digits.split(".");
  const units = BigInt(whole + fraction);
  return { units: negative ? -units : units, scale: fraction.length };
}

/** Parses a contract Decimal; throws on anything else. */
export function parseDecimal(text: string): Scaled {
  return toScaled(text, DECIMAL);
}

function rescale(value: Scaled, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

function align(...values: Scaled[]): { readonly scale: number; readonly units: bigint[] } {
  const scale = Math.max(...values.map((v) => v.scale));
  return { scale, units: values.map((v) => rescale(v, scale)) };
}

/** -1, 0 or 1 as a is less than, equal to or greater than b. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const [x = 0n, y = 0n] = align(parseDecimal(a), parseDecimal(b)).units;
  return x < y ? -1 : x > y ? 1 : 0;
}

function changeTerms(price: string, reference: string, threshold: string) {
  const { scale, units } = align(parseDecimal(price), parseDecimal(reference), toScaled(threshold, SIGNED));
  const [p = 0n, r = 0n, t = 0n] = units;
  if (r <= 0n) throw new Error("reference price must be greater than 0");
  // (p - r) / r * 100 compared with t / 10^scale, multiplied through by r * 10^scale (r > 0).
  return { change: (p - r) * 100n * 10n ** BigInt(scale), threshold: t * r };
}

/** True when the change from reference to price, in percent, is at least the (signed) threshold. */
export function changePercentAtLeast(price: string, reference: string, threshold: string): boolean {
  const { change, threshold: limit } = changeTerms(price, reference, threshold);
  return change >= limit;
}

/** True when the change from reference to price, in percent, is at most the (signed) threshold. */
export function changePercentAtMost(price: string, reference: string, threshold: string): boolean {
  const { change, threshold: limit } = changeTerms(price, reference, threshold);
  return change <= limit;
}

/** The change in percent for display: 2 decimals, half rounded away from zero (EVENTS.md §2.2). */
export function changePercentDisplay(price: string, reference: string): string {
  const [p = 0n, r = 0n] = align(parseDecimal(price), parseDecimal(reference)).units;
  if (r <= 0n) throw new Error("reference price must be greater than 0");
  const hundredths = (p - r) * 10_000n; // percent × 100, before dividing by r
  const negative = hundredths < 0n;
  const magnitude = negative ? -hundredths : hundredths;
  let rounded = magnitude / r;
  if ((magnitude % r) * 2n >= r) rounded += 1n;
  const whole = rounded / 100n;
  const cents = (rounded % 100n).toString().padStart(2, "0");
  return `${negative && rounded !== 0n ? "-" : ""}${whole}.${cents}`;
}
