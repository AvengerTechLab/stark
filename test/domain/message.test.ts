import { describe, expect, it } from "vitest";
import { formatAlertMessage, formatNumber, type MessageInput } from "../../src/domain/message.js";
import type { ChangeRule, LevelRule } from "../../src/domain/rules.js";

// Demo prices and times; not market data.
const base = { id: "r1", channels: ["telegram"] as const, enabled: true, state: "armed" as const };
const above: LevelRule = { ...base, pair: "BTC/THB", kind: "above", level: "3500000" };
const below: LevelRule = { ...base, pair: "BTC/USDT", kind: "below", level: "60000.5" };
const change: ChangeRule = {
  ...base,
  pair: "BTC/USDT",
  kind: "change",
  percent: "5",
  windowMinutes: 60,
  direction: "up",
};
// 14:05:12 in Thailand (UTC+7).
const time = new Date("2026-10-16T07:05:12.000Z");

function input(rule: MessageInput["rule"], extra: Partial<MessageInput> = {}): MessageInput {
  return {
    rule,
    exchange: rule.pair.endsWith("/THB") ? "bitkub" : "binance",
    price: "3512400",
    exchangeTime: time,
    referencePrice: null,
    changePercent: null,
    ...extra,
  };
}

describe("formatAlertMessage (EVENTS.md §4, D-33)", () => {
  it("writes the level message exactly as the contract's example", () => {
    expect(formatAlertMessage(input(above))).toBe(
      ["[Stark] BTC/THB สูงกว่า 3,500,000 แล้ว", "ราคาล่าสุด 3,512,400 THB (Bitkub) เวลา 14:05:12 น.", "กฎ: ราคา ≥ 3,500,000"].join(
        "\n",
      ),
    );
  });

  it("writes a below rule", () => {
    expect(formatAlertMessage(input(below, { price: "59999.25" }))).toBe(
      ["[Stark] BTC/USDT ต่ำกว่า 60,000.5 แล้ว", "ราคาล่าสุด 59,999.25 USDT (Binance) เวลา 14:05:12 น.", "กฎ: ราคา ≤ 60,000.5"].join(
        "\n",
      ),
    );
  });

  it("writes a change rule with the signed change and the reference price", () => {
    const message = formatAlertMessage(input(change, { price: "105", referencePrice: "100", changePercent: "5.00" }));
    expect(message).toBe(
      [
        "[Stark] BTC/USDT ขึ้น +5.00% ใน 60 นาที",
        "ราคาล่าสุด 105 USDT (Binance) เวลา 14:05:12 น.",
        "ราคาเมื่อ 60 นาทีก่อน 100 USDT",
        "กฎ: ขึ้น ≥ 5% ใน 60 นาที",
      ].join("\n"),
    );
  });

  it("names the direction from the change itself for an `either` rule", () => {
    const rule: ChangeRule = { ...change, direction: "either", percent: "2.5" };
    const message = formatAlertMessage(input(rule, { price: "97.4", referencePrice: "100", changePercent: "-2.60" }));
    expect(message.split("\n")[0]).toBe("[Stark] BTC/USDT ลง -2.60% ใน 60 นาที");
    expect(message.split("\n")[3]).toBe("กฎ: ขึ้นหรือลง ≥ 2.5% ใน 60 นาที");
  });

  it("writes a down rule", () => {
    const rule: ChangeRule = { ...change, direction: "down" };
    const message = formatAlertMessage(input(rule, { price: "95", referencePrice: "100", changePercent: "-5.00" }));
    expect(message.split("\n")[3]).toBe("กฎ: ลง ≥ 5% ใน 60 นาที");
  });

  it("refuses a change rule without its reference price or change", () => {
    expect(() => formatAlertMessage(input(change))).toThrow();
  });

  it("refuses a pair that could carry markup or a line break into the message (SECURITY.md T-20)", () => {
    for (const pair of ["BTC/THB\nBcc: x", "<b>BTC</b>/THB", "@everyone/THB"]) {
      expect(() => formatAlertMessage(input({ ...above, pair }))).toThrow();
    }
  });

  it("keeps the subject line free of line breaks and the text free of markup characters", () => {
    const message = formatAlertMessage(input(change, { price: "105", referencePrice: "100", changePercent: "5.00" }));
    expect(message.split("\n")[0]).not.toMatch(/[\r\n]/);
    expect(message).not.toMatch(/[<>*_`@]/);
  });
});

describe("formatNumber", () => {
  it("groups thousands and keeps every significant decimal, never rounding", () => {
    expect(formatNumber("3512400")).toBe("3,512,400");
    expect(formatNumber("1234567.891011")).toBe("1,234,567.891011");
    expect(formatNumber("0.00001234")).toBe("0.00001234");
    expect(formatNumber("999")).toBe("999");
  });

  it("drops trailing zeros after the point, which changes no value", () => {
    expect(formatNumber("3512400.00")).toBe("3,512,400");
    expect(formatNumber("60000.50")).toBe("60,000.5");
  });

  it("refuses anything that is not a contract Decimal", () => {
    for (const bad of ["1e6", "-1", "", "1,000"]) expect(() => formatNumber(bad)).toThrow();
  });
});
