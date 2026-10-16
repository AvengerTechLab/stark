import { describe, expect, it } from "vitest";
import {
  compareDecimal,
  changePercentAtLeast,
  changePercentAtMost,
  changePercentDisplay,
  isDecimal,
  parseDecimal,
} from "../../src/domain/decimal.js";

// All values are demo numbers, not market data.

describe("parseDecimal", () => {
  it.each(["0", "7", "100", "100.00", "0.0001", "123456789012345678901234567890.123456789"])("accepts %s", (s) => {
    expect(isDecimal(s)).toBe(true);
    expect(() => parseDecimal(s)).not.toThrow();
  });

  it.each(["", " 1", "1 ", "-1", "+1", "1.", ".5", "1e3", "1E3", "Infinity", "NaN", "0x10", "1,000", "١٢"])(
    "rejects %j",
    (s) => {
      expect(isDecimal(s)).toBe(false);
      expect(() => parseDecimal(s)).toThrow(/not a decimal/);
    },
  );
});

describe("compareDecimal", () => {
  it("compares exactly across different scales", () => {
    expect(compareDecimal("100", "100.00")).toBe(0);
    expect(compareDecimal("100.01", "100")).toBe(1);
    expect(compareDecimal("99.999", "100")).toBe(-1);
  });

  it("is exact where binary floats are not", () => {
    // 0.1 + 0.2 !== 0.3 in floats; these strings must still compare exactly.
    expect(compareDecimal("0.30000000000000001", "0.3")).toBe(1);
    expect(compareDecimal("0.3", "0.30000000000000000")).toBe(0);
  });

  it("handles values beyond float precision", () => {
    expect(compareDecimal("9007199254740993", "9007199254740992")).toBe(1);
  });
});

describe("percentage change", () => {
  it("counts an exact 5 % rise as reaching 5 %", () => {
    expect(changePercentAtLeast("105", "100", "5")).toBe(true);
    expect(changePercentAtLeast("104.99", "100", "5")).toBe(false);
  });

  it("compares falls against a negative threshold", () => {
    expect(changePercentAtMost("95", "100", "-5")).toBe(true);
    expect(changePercentAtMost("95.01", "100", "-5")).toBe(false);
  });

  it("stays exact for thresholds that are not representable as floats", () => {
    // (100.1 - 100) / 100 * 100 = 0.1 exactly.
    expect(changePercentAtLeast("100.1", "100", "0.1")).toBe(true);
    expect(changePercentAtMost("100.1", "100", "0.1")).toBe(true);
  });

  it("rounds the display value half up to 2 decimals, away from zero for falls", () => {
    expect(changePercentDisplay("105", "100")).toBe("5.00");
    expect(changePercentDisplay("100.005", "100")).toBe("0.01"); // 0.005 -> 0.01
    expect(changePercentDisplay("100.004", "100")).toBe("0.00");
    expect(changePercentDisplay("94.995", "100")).toBe("-5.01"); // -5.005 -> -5.01
    expect(changePercentDisplay("1", "3")).toBe("-66.67");
    expect(changePercentDisplay("100", "100")).toBe("0.00");
  });

  it("refuses a zero reference price", () => {
    expect(() => changePercentAtLeast("1", "0", "5")).toThrow(/reference/);
    expect(() => changePercentDisplay("1", "0")).toThrow(/reference/);
  });
});
