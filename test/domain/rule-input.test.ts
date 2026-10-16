import { describe, expect, it } from "vitest";
import { validateRuleInput, type RuleInputResult } from "../../src/domain/rule-input.js";

// Demo pairs and levels; not market data.
const listed = new Set(["BTC/THB", "ETH/THB", "BTC/USDT"]);
const isListed = (pair: string) => listed.has(pair);

function codes(result: RuleInputResult): string[] {
  return result.ok ? [] : result.errors.map((e) => `${e.field}:${e.code}`);
}

const above = { kind: "above", pair: "BTC/THB", level: "3500000", channels: ["telegram"] };
const change = { kind: "change", pair: "BTC/USDT", percent: "5", windowMinutes: 60, direction: "up", channels: ["line"] };

describe("validateRuleInput: valid rules", () => {
  it("accepts a level rule and returns only its own fields", () => {
    expect(validateRuleInput(above, isListed)).toEqual({ ok: true, value: above });
  });

  it("accepts a change rule", () => {
    expect(validateRuleInput(change, isListed)).toEqual({ ok: true, value: change });
  });

  it("normalises the pair to upper case, the only change it makes", () => {
    const result = validateRuleInput({ ...above, pair: "btc/thb" }, isListed);
    expect(result.ok && result.value.pair).toBe("BTC/THB");
  });

  it("accepts the edges: percent 100 and 0.01, window 1 and 1,440", () => {
    for (const [percent, windowMinutes] of [["100", 1], ["0.01", 1440]] as const) {
      expect(validateRuleInput({ ...change, percent, windowMinutes }, isListed).ok).toBe(true);
    }
  });
});

describe("validateRuleInput: errors use API.md §1.3 codes", () => {
  it("refuses a body that is not an object", () => {
    for (const body of [null, "x", 1, []]) {
      expect(codes(validateRuleInput(body, isListed))).toEqual(["body:BODY_INVALID"]);
    }
  });

  it("refuses an unknown kind", () => {
    expect(codes(validateRuleInput({ ...above, kind: "cross" }, isListed))).toEqual(["kind:BODY_INVALID"]);
  });

  it("refuses unlisted or malformed pairs", () => {
    for (const pair of ["DOGE/THB", "BTC/EUR", "BTCTHB", "", 5]) {
      expect(codes(validateRuleInput({ ...above, pair }, isListed))).toEqual(["pair:PAIR_UNKNOWN"]);
    }
  });

  it("refuses a level that is not a positive decimal string, including JSON numbers", () => {
    for (const level of [3500000, "0", "0.000", "-1", "1e6", "", "1".repeat(41)]) {
      expect(codes(validateRuleInput({ ...above, level }, isListed))).toEqual(["level:LEVEL_INVALID"]);
    }
  });

  it("refuses percents outside 0 < p ≤ 100 or with more than 2 decimals, never rounding", () => {
    for (const percent of ["0", "100.01", "5.001", 5, "abc"]) {
      expect(codes(validateRuleInput({ ...change, percent }, isListed))).toEqual(["percent:PERCENT_INVALID"]);
    }
  });

  it("refuses windows that are not whole minutes from 1 to 1,440", () => {
    for (const windowMinutes of [0, 1441, 1.5, "60", -5]) {
      expect(codes(validateRuleInput({ ...change, windowMinutes }, isListed))).toEqual([
        "windowMinutes:WINDOW_INVALID",
      ]);
    }
  });

  it("refuses an unknown direction", () => {
    expect(codes(validateRuleInput({ ...change, direction: "sideways" }, isListed))).toEqual([
      "direction:BODY_INVALID",
    ]);
  });

  it("refuses empty, unknown or repeated channels", () => {
    for (const channels of [[], ["sms"], ["line", "line"], "telegram"]) {
      expect(codes(validateRuleInput({ ...above, channels }, isListed))).toEqual(["channels:CHANNELS_INVALID"]);
    }
  });

  it("refuses fields that belong to the other kind", () => {
    expect(codes(validateRuleInput({ ...above, percent: "5" }, isListed))).toEqual(["percent:FIELD_NOT_ALLOWED"]);
    expect(codes(validateRuleInput({ ...change, level: "100" }, isListed))).toEqual(["level:FIELD_NOT_ALLOWED"]);
  });

  it("refuses unknown fields", () => {
    expect(codes(validateRuleInput({ ...above, state: "fired" }, isListed))).toEqual(["state:BODY_INVALID"]);
  });

  it("reports every problem at once", () => {
    expect(codes(validateRuleInput({ kind: "change", pair: "X", channels: [] }, isListed))).toEqual([
      "pair:PAIR_UNKNOWN",
      "percent:PERCENT_INVALID",
      "windowMinutes:WINDOW_INVALID",
      "direction:BODY_INVALID",
      "channels:CHANNELS_INVALID",
    ]);
  });

  it("never echoes a submitted value in an error message", () => {
    const result = validateRuleInput({ ...above, level: "<script>" }, isListed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).not.toContain("<script>");
    const unknown = validateRuleInput({ ...above, "<b>": 1 }, isListed);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]?.message).not.toContain("<b>");
  });
});
