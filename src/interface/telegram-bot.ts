// Telegram bot commands (API.md §2, SPEC.md D-21). Updates come by long polling (getUpdates), so no
// inbound port is needed (D-38). Only a private chat whose ID is the PO's is obeyed; anything else gets
// no reply and is logged (SECURITY.md T-06, T-24). Commands are parsed by fixed code, never a model, and
// go through the same OwnerService as the web page, so validation and records match.

import type { Logger } from "../logger.js";
import type { ChannelName } from "../ports/channel.js";
import type { DeliveryLog } from "../ports/storage.js";
import type { HealthSnapshot } from "../app/health.js";
import type { PriceBoard } from "../app/price-board.js";
import { channelOverview, type OwnerService, type RuleResult } from "../app/owner-service.js";
import type { Rule } from "../domain/rules.js";
import { formatNumber } from "../domain/message.js";
import type { RuleInputError } from "../domain/rule-input.js";
import { jsonBody, type HttpPost } from "../channels/http.js";
import { telegramChannel } from "../channels/telegram.js";
import type { Timers } from "../feeds/stream-feed.js";

/** Long-poll wait Telegram holds a getUpdates request open for, in seconds. */
export const POLL_TIMEOUT_SECONDS = 50;
/** A yes to /delete counts only within this time of the question (API.md §2). */
export const CONFIRM_MS = 60_000;
const RETRY_MS = 5000;

const EXCHANGE_NAMES = { bitkub: "Bitkub", binance: "Binance" } as const;
const DIRECTION_WORDS = { up: "ขึ้น", down: "ลง", either: "ขึ้นหรือลง" } as const;
const ERROR_TEXT: Readonly<Record<string, string>> = {
  pair: "ไม่รู้จักคู่เหรียญนี้",
  level: "ราคาต้องเป็นตัวเลขมากกว่า 0",
  percent: "เปอร์เซ็นต์ต้องมากกว่า 0 ไม่เกิน 100 ทศนิยมไม่เกิน 2 ตำแหน่ง",
  windowMinutes: "นาทีต้องเป็นจำนวนเต็ม 1 ถึง 1440",
  direction: "ทิศทางต้องเป็น up, down หรือ either",
  channels: "ไม่มีช่องทางที่เปิดอยู่",
};
const HELP = [
  "คำสั่งของ Stark",
  "/prices ราคาล่าสุด",
  "/rules กฎทั้งหมด",
  "/above BTC/THB 3500000",
  "/below BTC/USDT 60000",
  "/change BTC/USDT 5 60 up (เปอร์เซ็นต์ นาที up|down|either)",
  "/off ID, /on ID, /delete ID",
  "/channel line on|off",
  "/status",
].join("\n");

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: { readonly message_id: number; readonly chat: { readonly id: number; readonly type: string }; readonly text?: string };
}

export interface BotDeps {
  readonly botToken: string;
  readonly ownerChatId: string;
  readonly post: HttpPost;
  readonly service: OwnerService;
  readonly deliveries: Pick<DeliveryLog, "usage">;
  readonly configured: readonly ChannelName[];
  readonly prices: PriceBoard;
  readonly health: () => HealthSnapshot;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly logger: Logger;
}

const shortId = (rule: Rule) => rule.id.slice(0, 8);

function condition(rule: Rule): string {
  if (rule.kind === "change") {
    return `${DIRECTION_WORDS[rule.direction]} ≥ ${formatNumber(rule.percent)}% ใน ${rule.windowMinutes} นาที`;
  }
  return `ราคา ${rule.kind === "above" ? "≥" : "≤"} ${formatNumber(rule.level)}`;
}

function errorsText(errors: readonly RuleInputError[]): string {
  return ["เพิ่มกฎไม่ได้", ...errors.map((e) => `- ${ERROR_TEXT[e.field] ?? "ข้อมูลไม่ถูกต้อง"}`)].join("\n");
}

export class TelegramBot {
  private offset = 0;
  private pendingDelete: { ruleId: string; askedAt: number } | undefined;
  private running = false;
  private cancel: () => void = () => undefined;
  private readonly reply;

  constructor(private readonly deps: BotDeps) {
    this.reply = telegramChannel({ botToken: deps.botToken, chatId: deps.ownerChatId }, deps.post);
  }

  /** Fetches and handles one batch of updates. */
  async pollOnce(): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number | undefined }> {
    let response;
    try {
      response = await this.deps.post(`https://api.telegram.org/bot${this.deps.botToken}/getUpdates`, {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offset: this.offset, timeout: POLL_TIMEOUT_SECONDS, allowed_updates: ["message"] }),
        timeoutMs: (POLL_TIMEOUT_SECONDS + 10) * 1000,
      });
    } catch {
      this.deps.logger.warn("telegram.poll_failed", { reason: "network_error" });
      return { ok: false, retryAfterSeconds: undefined };
    }
    const reply = jsonBody(response.body) as { ok?: unknown; result?: unknown; parameters?: { retry_after?: unknown } } | undefined;
    if (response.status !== 200 || reply?.ok !== true || !Array.isArray(reply.result)) {
      const wait = reply?.parameters?.retry_after;
      this.deps.logger.warn("telegram.poll_failed", { status: response.status });
      return { ok: false, retryAfterSeconds: typeof wait === "number" && wait > 0 ? wait : undefined };
    }
    for (const update of reply.result as TelegramUpdate[]) {
      if (typeof update.update_id !== "number") continue;
      this.offset = Math.max(this.offset, update.update_id + 1);
      await this.handleUpdate(update);
    }
    return { ok: true };
  }

  /** Polls until stopped; waits after a failure, never earlier than Telegram asks. */
  start(timers: Timers): void {
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      const result = await this.pollOnce();
      if (!this.running) return;
      const wait = result.ok ? 0 : Math.max(RETRY_MS, (result.retryAfterSeconds ?? 0) * 1000);
      this.cancel = timers.set(wait, () => void loop());
    };
    this.cancel = timers.set(0, () => void loop());
  }

  stop(): void {
    this.running = false;
    this.cancel();
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (message === undefined || typeof message.text !== "string") return;
    if (message.chat.type !== "private" || String(message.chat.id) !== this.deps.ownerChatId) {
      this.deps.logger.warn("telegram.command_rejected", { chatType: message.chat.type });
      return;
    }
    try {
      await this.say(await this.answer(message.text.trim()));
    } catch (error) {
      this.deps.logger.error("telegram.command_failed", { error });
      await this.say("เกิดข้อผิดพลาด ลองใหม่อีกครั้ง").catch(() => undefined);
    }
  }

  private async say(text: string): Promise<void> {
    const result = await this.reply.send({ alertId: this.deps.newId(), text });
    if (result.status !== "delivered") this.deps.logger.warn("telegram.reply_failed", { reason: result.reason });
  }

  private async answer(text: string): Promise<string> {
    const pending = this.pendingDelete;
    this.pendingDelete = undefined;
    const [head = "", ...args] = text.split(/\s+/);
    if (!head.startsWith("/")) {
      if (pending !== undefined && /^(yes|ใช่)$/i.test(head) && args.length === 0) return this.confirmDelete(pending);
      return HELP;
    }
    const command = head.slice(1).split("@")[0]?.toLowerCase() ?? "";
    switch (command) {
      case "prices":
        return this.prices();
      case "rules":
        return this.rules();
      case "above":
      case "below":
        if (args.length !== 2) return `ใช้แบบนี้: /${command} ${command === "above" ? "BTC/THB 3500000" : "BTC/USDT 60000"}`;
        return this.create({ kind: command, pair: args[0], level: args[1] });
      case "change": {
        if (args.length !== 4) return "ใช้แบบนี้: /change BTC/USDT 5 60 up";
        const minutes = args[2] ?? "";
        return this.create({
          kind: "change",
          pair: args[0],
          percent: args[1],
          windowMinutes: /^\d{1,5}$/.test(minutes) ? Number(minutes) : minutes,
          direction: args[3],
        });
      }
      case "off":
      case "on":
        return this.switchRule(args[0], command === "on");
      case "delete":
        return this.askDelete(args[0]);
      case "channel":
        return this.channel(args);
      case "status":
        return this.status();
      default:
        return HELP;
    }
  }

  private prices(): string {
    const list = this.deps.prices.list(this.deps.now());
    if (list.length === 0) return "ยังไม่มีราคา";
    return list
      .map((p) => `${p.pair} ${formatNumber(p.price)} ${p.pair.split("/")[1] ?? ""} (${EXCHANGE_NAMES[p.exchange]}) ${p.ageSeconds} วินาทีที่แล้ว`)
      .join("\n");
  }

  private async rules(): Promise<string> {
    const rules = await this.deps.service.listRules();
    if (rules.length === 0) return "ยังไม่มีกฎ";
    return rules
      .map((r) => `${shortId(r)} ${r.pair} ${condition(r)} · ${r.channels.join(", ")} · ${r.enabled ? "เปิด" : "ปิด"}`)
      .join("\n");
  }

  /** New rules from Telegram go to every channel that is configured, switched on and not dead (API.md §2). */
  private async create(fields: Record<string, unknown>): Promise<string> {
    const overview = await channelOverview(this.deps.service, this.deps.deliveries, this.deps.configured, this.deps.now());
    const channels = overview.filter((c) => c.configured && c.enabled && c.deadSince === null).map((c) => c.name);
    const result: RuleResult = await this.deps.service.createRule({ ...fields, channels }, "telegram");
    if (result.ok) return `เพิ่มกฎแล้ว ${shortId(result.rule)}: ${result.rule.pair} ${condition(result.rule)} (${result.rule.channels.join(", ")})`;
    return "errors" in result ? errorsText(result.errors) : "ไม่พบกฎ";
  }

  private async find(id: string | undefined): Promise<Rule | string> {
    if (id === undefined) return "ใส่ ID ของกฎด้วย ดูได้จาก /rules";
    const found = await this.deps.service.findByShortId(id);
    if ("ambiguous" in found) return "ID นี้ตรงกับหลายกฎ ใส่ให้ยาวขึ้น";
    if ("notFound" in found) return `ไม่พบกฎ ${id}`;
    return found.rule;
  }

  private async switchRule(id: string | undefined, enabled: boolean): Promise<string> {
    const rule = await this.find(id);
    if (typeof rule === "string") return rule;
    const result = await this.deps.service.updateRule(rule.id, { enabled }, "telegram");
    if (!result.ok) return `ไม่พบกฎ ${id ?? ""}`;
    return `${enabled ? "เปิด" : "ปิด"}กฎ ${shortId(rule)} แล้ว`;
  }

  private async askDelete(id: string | undefined): Promise<string> {
    const rule = await this.find(id);
    if (typeof rule === "string") return rule;
    this.pendingDelete = { ruleId: rule.id, askedAt: this.deps.now().getTime() };
    return `ลบกฎ ${shortId(rule)} (${rule.pair} ${condition(rule)}) ใช่ไหม? ตอบ yes ภายใน 60 วินาที`;
  }

  private async confirmDelete(pending: { ruleId: string; askedAt: number }): Promise<string> {
    if (this.deps.now().getTime() - pending.askedAt > CONFIRM_MS) return "หมดเวลา ไม่ได้ลบกฎ";
    const deleted = await this.deps.service.deleteRule(pending.ruleId, "telegram");
    return deleted ? `ลบกฎ ${pending.ruleId.slice(0, 8)} แล้ว` : "ไม่พบกฎนี้แล้ว";
  }

  private async channel(args: readonly string[]): Promise<string> {
    const [name = "", state = ""] = args;
    if (args.length !== 2 || (state !== "on" && state !== "off")) return "ใช้แบบนี้: /channel line on หรือ /channel line off";
    const ok = await this.deps.service.setChannel(name.toLowerCase(), state === "on", "telegram");
    if (!ok) return "ใช้แบบนี้: /channel line on หรือ /channel line off";
    return `${state === "on" ? "เปิด" : "ปิด"}ช่องทาง ${name.toLowerCase()} แล้ว`;
  }

  private async status(): Promise<string> {
    const health = this.deps.health();
    const overview = await channelOverview(this.deps.service, this.deps.deliveries, this.deps.configured, this.deps.now());
    const lines = [`สถานะ Stark: ${health.degraded ? "มีปัญหา" : "ปกติ"}`];
    for (const feed of health.feeds) lines.push(`ราคา ${EXCHANGE_NAMES[feed.exchange]}: ${feed.stale ? "ไม่เข้ามา" : "ปกติ"}`);
    for (const c of overview) {
      if (!c.configured) {
        lines.push(`${c.name}: ยังไม่ได้ตั้งค่า`);
        continue;
      }
      const state = c.deadSince !== null ? "ใช้ไม่ได้แล้ว" : c.enabled ? "เปิด" : "ปิด";
      lines.push(`${c.name}: ${state}${c.usage === null ? "" : ` · ใช้ไป ${c.usage.sent}/${c.usage.limit}`}`);
    }
    return lines.join("\n");
  }
}
