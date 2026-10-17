import { describe, expect, it } from "vitest";
import { OwnerService } from "../../src/app/owner-service.js";
import type { LevelRule } from "../../src/domain/rules.js";
import { FakeChannelAdmin, FakeRuleAdmin } from "../fakes/fake-owner-storage.js";
import { FakeChannelSettings, FakeRuleStore } from "../fakes/fake-storage.js";

// Demo pairs and levels; not market data.
const listed = new Set(["BTC/THB", "ETH/THB", "BTC/USDT"]);

function setup() {
  const store = new FakeRuleStore();
  const rules = new FakeRuleAdmin(store);
  const settings = new FakeChannelSettings("telegram", "line");
  const channels = new FakeChannelAdmin(settings);
  let next = 0;
  let changes = 0;
  const service = new OwnerService({
    rules,
    channels,
    isListed: (pair) => listed.has(pair),
    newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
    now: () => new Date("2026-10-16T07:00:00.000Z"),
    onRulesChanged: () => changes++,
  });
  return { service, store, rules, channels, settings, changes: () => changes };
}

const above = { kind: "above", pair: "BTC/THB", level: "3500000", channels: ["telegram"] };

describe("OwnerService: rules (API.md §1.2–1.3, shared by the web page and Telegram)", () => {
  it("creates a validated rule, armed and enabled, and records who made it", async () => {
    const { service, rules, changes } = setup();
    const result = await service.createRule(above, "web");
    expect(result).toEqual({
      ok: true,
      rule: { id: "00000000-0000-4000-8000-000000000001", ...above, enabled: true, state: "armed" },
    });
    expect(rules.actions).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000002",
        at: new Date("2026-10-16T07:00:00.000Z"),
        source: "web",
        action: "rule.created",
        subject: "00000000-0000-4000-8000-000000000001",
        detail: above,
      },
    ]);
    expect(changes()).toBe(1);
  });

  it("refuses an invalid rule with the validation codes, storing nothing", async () => {
    const { service, store } = setup();
    const result = await service.createRule({ ...above, level: "0" }, "telegram");
    expect(result.ok).toBe(false);
    expect(!result.ok && "errors" in result && result.errors.map((e) => e.code)).toEqual(["LEVEL_INVALID"]);
    expect(store.rules.size).toBe(0);
  });

  it("updates fields by merging them into the rule, re-validating, and re-arming it", async () => {
    const { service, store } = setup();
    const created = await service.createRule(above, "web");
    const id = created.ok ? created.rule.id : "";
    store.rules.set(id, { ...(store.rules.get(id) as LevelRule), state: "fired" });

    const updated = await service.updateRule(id, { level: "3600000" }, "web");
    expect(updated).toMatchObject({ ok: true, rule: { level: "3600000", state: "armed", channels: ["telegram"] } });

    const bad = await service.updateRule(id, { level: 5 }, "web");
    expect(!bad.ok && "errors" in bad && bad.errors.map((e) => e.code)).toEqual(["LEVEL_INVALID"]);
  });

  it("switches kind cleanly, dropping the old kind's fields", async () => {
    const { service } = setup();
    const created = await service.createRule(above, "web");
    const id = created.ok ? created.rule.id : "";
    const result = await service.updateRule(id, { kind: "change", percent: "5", windowMinutes: 60, direction: "up" }, "web");
    expect(result).toMatchObject({ ok: true, rule: { kind: "change", percent: "5", windowMinutes: 60, direction: "up" } });
    expect(result.ok && "level" in result.rule).toBe(false);
  });

  it("disables and re-enables a rule; a re-enabled rule starts armed (EVENTS.md §3.4)", async () => {
    const { service, store, rules } = setup();
    const created = await service.createRule(above, "web");
    const id = created.ok ? created.rule.id : "";
    store.rules.set(id, { ...(store.rules.get(id) as LevelRule), state: "fired" });
    expect(await service.updateRule(id, { enabled: false }, "telegram")).toMatchObject({ ok: true, rule: { enabled: false, state: "fired" } });
    expect(await service.updateRule(id, { enabled: true }, "telegram")).toMatchObject({ ok: true, rule: { enabled: true, state: "armed" } });
    expect(rules.actions.map((a) => a.action)).toEqual(["rule.created", "rule.disabled", "rule.enabled"]);
  });

  it("refuses an enabled flag that is not a boolean, and reports a rule that does not exist", async () => {
    const { service } = setup();
    const created = await service.createRule(above, "web");
    const id = created.ok ? created.rule.id : "";
    const bad = await service.updateRule(id, { enabled: "yes" }, "web");
    expect(!bad.ok && "errors" in bad && bad.errors).toEqual([expect.objectContaining({ field: "enabled", code: "BODY_INVALID" })]);
    expect(await service.updateRule("00000000-0000-4000-8000-999999999999", { enabled: false }, "web")).toEqual({
      ok: false,
      notFound: true,
    });
    expect(await service.updateRule(id, "not an object", "web")).toMatchObject({ ok: false, errors: [{ field: "body", code: "BODY_INVALID" }] });
  });

  it("deletes a rule once", async () => {
    const { service, rules, changes } = setup();
    const created = await service.createRule(above, "web");
    const id = created.ok ? created.rule.id : "";
    expect(await service.deleteRule(id, "telegram")).toBe(true);
    expect(await service.deleteRule(id, "telegram")).toBe(false);
    expect(rules.actions.at(-1)).toMatchObject({ action: "rule.deleted", subject: id, source: "telegram" });
    expect(changes()).toBe(2);
  });

  it("finds a rule by a short ID prefix of at least 4 characters, only when it is unique (API.md §2)", async () => {
    const { service } = setup();
    await service.createRule(above, "web");
    await service.createRule({ ...above, level: "1" }, "web");
    expect(await service.findByShortId("0000")).toEqual({ ambiguous: true });
    expect(await service.findByShortId("000")).toEqual({ notFound: true });
    expect(await service.findByShortId("00000000-0000-4000-8000-000000000003")).toMatchObject({ rule: { level: "1" } });
  });
});

describe("OwnerService: channels (D-09)", () => {
  it("switches a channel and records the action", async () => {
    const { service, channels, settings } = setup();
    expect(await service.setChannel("line", false, "web")).toBe(true);
    expect(settings.on.has("line")).toBe(false);
    expect(channels.actions).toEqual([expect.objectContaining({ action: "channel.switched_off", subject: "line", source: "web" })]);
    expect(await service.setChannel("sms", true, "web")).toBe(false);
  });
});
