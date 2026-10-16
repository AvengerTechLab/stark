import { describe, expect, it } from "vitest";
import { evaluateRule, referenceCutoff, type Rule, type RuleTick } from "../../src/domain/rules.js";

// Demo rules and prices from EVENTS.md §3.5; not market data.

const base = { id: "r1", channels: ["telegram"] as const, enabled: true, state: "armed" as const };

function aboveRule(level: string): Rule {
  return { ...base, pair: "BTC/THB", kind: "above", level };
}

function belowRule(level: string): Rule {
  return { ...base, pair: "BTC/THB", kind: "below", level };
}

function changeRule(percent: string, direction: "up" | "down" | "either"): Rule {
  return { ...base, pair: "BTC/USDT", kind: "change", percent, windowMinutes: 60, direction };
}

let n = 0;
function tick(pair: string, price: string): RuleTick {
  n += 1;
  return { id: `t${n}`, pair, price, exchangeTime: new Date(Date.UTC(2026, 0, 1, 12, 0, n)) };
}

/** Feeds prices through one rule, carrying state, and returns the prices that fired. */
function run(rule: Rule, prices: string[], reference?: string): string[] {
  let current = rule;
  const fired: string[] = [];
  for (const price of prices) {
    const result = evaluateRule(current, tick(current.pair, price), reference);
    current = { ...current, state: result.state };
    if (result.decision) fired.push(result.decision.price);
  }
  return fired;
}

describe("level rules (EVENTS.md §3.2, D-31)", () => {
  it("fires once per crossing and re-arms after the price falls back (§3.5 example 1, D-20)", () => {
    expect(run(aboveRule("100"), ["99", "100", "101", "99", "100"])).toEqual(["100", "100"]);
  });

  it("counts reaching the level exactly, at any scale", () => {
    expect(run(aboveRule("100"), ["100.00"])).toEqual(["100.00"]);
    expect(run(belowRule("100"), ["100.000"])).toEqual(["100.000"]);
  });

  it("does not fire just below an above level or just above a below level", () => {
    expect(run(aboveRule("100"), ["99.99999999"])).toEqual([]);
    expect(run(belowRule("100"), ["100.00000001"])).toEqual([]);
  });

  it("fires on the first tick when the condition already holds (D-32)", () => {
    expect(run(belowRule("100"), ["90", "80", "70"])).toEqual(["90"]);
  });

  it("puts the tick, rule and price in the decision, with no percentage fields", () => {
    const t = tick("BTC/THB", "150");
    const result = evaluateRule(aboveRule("100"), t, undefined);
    expect(result.state).toBe("fired");
    expect(result.decision).toEqual({
      ruleId: "r1",
      tickId: t.id,
      price: "150",
      referencePrice: null,
      changePercent: null,
    });
  });
});

describe("percentage rules (EVENTS.md §3.3)", () => {
  it("fires at +5.00 % and not again while it stays above (§3.5 example 2)", () => {
    expect(run(changeRule("5", "up"), ["104", "105", "106"], "100")).toEqual(["105"]);
  });

  it("does nothing without a reference price (§3.5 example 3)", () => {
    expect(run(changeRule("5", "up"), ["104", "200", "1000"], undefined)).toEqual([]);
  });

  it("treats a zero reference price as no reference", () => {
    expect(run(changeRule("5", "up"), ["104"], "0")).toEqual([]);
  });

  it("handles down and either directions", () => {
    expect(run(changeRule("5", "down"), ["96", "95", "106"], "100")).toEqual(["95"]);
    expect(run(changeRule("5", "either"), ["95", "100", "105"], "100")).toEqual(["95", "105"]);
  });

  it("puts the reference and the rounded change in the decision", () => {
    const result = evaluateRule(changeRule("5", "down"), tick("BTC/USDT", "94.995"), "100");
    expect(result.decision?.referencePrice).toBe("100");
    expect(result.decision?.changePercent).toBe("-5.01");
  });

  it("finds the reference cutoff windowMinutes before the tick's exchange time", () => {
    const at = new Date("2026-01-01T12:00:00.000Z");
    expect(referenceCutoff(at, 60).toISOString()).toBe("2026-01-01T11:00:00.000Z");
  });
});

describe("rule guards", () => {
  it("does not evaluate a disabled rule and keeps its state", () => {
    const rule: Rule = { ...aboveRule("100"), enabled: false, state: "fired" };
    const result = evaluateRule(rule, tick("BTC/THB", "50"), undefined);
    expect(result).toEqual({ state: "fired", decision: null });
  });

  it("refuses a tick for another pair", () => {
    expect(() => evaluateRule(aboveRule("100"), tick("ETH/THB", "150"), undefined)).toThrow(/pair/);
  });

  it("refuses a malformed price", () => {
    expect(() => evaluateRule(aboveRule("100"), tick("BTC/THB", "1e3"), undefined)).toThrow(/not a decimal/);
  });
});
