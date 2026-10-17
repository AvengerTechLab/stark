// Health monitor (EVENTS.md §2.4, SC-3): watches the feeds, the channels and the disk, and tells the PO
// through a channel other than the one that failed. Recovery is reported once. Every report is stored
// (DATABASE.md `health_events`). The monitor keeps its state in memory; `check` runs on a timer (S6-11).

import type { Logger } from "../logger.js";
import type { AlertChannel, ChannelName } from "../ports/channel.js";
import type { Exchange } from "../ports/feed.js";
import type { ChannelSettings, HealthKind, HealthLog } from "../ports/storage.js";
import { thaiClock } from "../domain/thai-time.js";
import { DEFAULT_QUOTAS, usagePeriod, type ChannelOutcome } from "./dispatcher.js";

/** A feed with no tick for this long is stale (EVENTS.md §2.4). */
export const STALE_AFTER_MS = 60_000;
/** A condition is reported once it has lasted this long, so a short gap stays quiet (proposed). */
export const REPORT_AFTER_MS = 5 * 60_000;
/** Free disk below this share is `disk_low` (SECURITY.md T-23). */
export const DISK_LOW_SHARE = 0.2;
/** How often `check` should run; the 15-minute SC-3 budget is met with room to spare. */
export const CHECK_INTERVAL_MS = 30_000;
/** Reports go to the first working channel in this order; LINE last, as its sends are counted (D-17). */
const REPORT_ORDER: readonly ChannelName[] = ["telegram", "discord", "email", "line"];

const EXCHANGE_NAMES: Readonly<Record<Exchange, string>> = { bitkub: "Bitkub", binance: "Binance" };
const CHANNEL_NAMES: Readonly<Record<ChannelName, string>> = {
  telegram: "Telegram",
  line: "LINE",
  discord: "Discord",
  email: "อีเมล",
};

export interface HealthOptions {
  readonly exchanges: readonly Exchange[];
  /** The configured channel adapters, used to carry the reports. */
  readonly channels: readonly AlertChannel[];
  readonly settings: ChannelSettings;
  readonly log: HealthLog;
  /** Share of the disk that is free, 0 to 1. */
  readonly diskFree: () => Promise<number>;
  readonly now: () => Date;
  /** Must return a UUID: LINE needs one as its retry key. */
  readonly newId: () => string;
  readonly logger: Logger;
}

export interface HealthCondition {
  readonly kind: "feed_stale" | "channel_failing" | "disk_low";
  readonly subject: string;
  readonly since: Date;
  readonly reported: boolean;
}

export interface HealthSnapshot {
  readonly degraded: boolean;
  readonly feeds: readonly { readonly exchange: Exchange; readonly lastTickAt: Date | null; readonly stale: boolean }[];
  readonly conditions: readonly HealthCondition[];
}

interface Condition {
  readonly since: Date;
  reported: boolean;
  recovered?: Date;
}

interface ChannelCondition extends Condition {
  dead: boolean;
  reason: string | null;
}

export class HealthMonitor {
  private readonly lastTick = new Map<Exchange, Date>();
  private readonly feeds = new Map<Exchange, Condition>();
  private readonly failing = new Map<ChannelName, ChannelCondition>();
  private readonly quotaSeen = new Map<ChannelName, string>();
  private readonly quotaReported = new Map<ChannelName, string>();
  private disk: { since: Date; reported: boolean } | undefined;
  private readonly started: Date;

  constructor(private readonly options: HealthOptions) {
    this.started = options.now();
  }

  /** A tick arrived from this exchange's feed. */
  tickSeen(exchange: Exchange): void {
    const now = this.options.now();
    this.lastTick.set(exchange, now);
    const condition = this.feeds.get(exchange);
    if (condition === undefined) return;
    if (condition.reported) condition.recovered ??= now;
    else this.feeds.delete(exchange);
  }

  /** The dispatcher's final outcome for one alert on one channel. */
  channelOutcome(outcome: ChannelOutcome): void {
    const { channel } = outcome;
    if (outcome.outcome === "quota_reached") {
      const quota = DEFAULT_QUOTAS[channel];
      this.quotaSeen.set(channel, quota === undefined ? "" : usagePeriod(quota.per, outcome.at));
      return;
    }
    const condition = this.failing.get(channel);
    if (outcome.outcome === "delivered") {
      if (condition === undefined) return;
      if (condition.reported && !condition.dead) condition.recovered ??= outcome.at;
      else if (!condition.reported) this.failing.delete(channel);
      return;
    }
    if (condition === undefined) {
      this.failing.set(channel, {
        since: outcome.at,
        reported: false,
        dead: outcome.outcome === "dead",
        reason: outcome.reason,
      });
    } else if (outcome.outcome === "dead") {
      condition.dead = true;
      condition.reason = outcome.reason;
    }
  }

  /** The current state for GET /api/v1/health; `degraded` drives GET /healthz (API.md §1.2). */
  snapshot(): HealthSnapshot {
    const now = this.options.now().getTime();
    const feeds = this.options.exchanges.map((exchange) => {
      const last = this.lastTick.get(exchange);
      return {
        exchange,
        lastTickAt: last ?? null,
        stale: now - (last ?? this.started).getTime() >= STALE_AFTER_MS,
      };
    });
    const conditions: HealthCondition[] = [
      ...[...this.feeds].map(([subject, c]) => ({ kind: "feed_stale" as const, subject, since: c.since, reported: c.reported })),
      ...[...this.failing].map(([subject, c]) => ({ kind: "channel_failing" as const, subject, since: c.since, reported: c.reported })),
      ...(this.disk === undefined ? [] : [{ kind: "disk_low" as const, subject: "disk", since: this.disk.since, reported: this.disk.reported }]),
    ];
    return { degraded: conditions.length > 0 || feeds.some((f) => f.stale), feeds, conditions };
  }

  /** Looks at every condition and sends the reports that are due. */
  async check(): Promise<void> {
    await this.checkFeeds();
    await this.checkChannels();
    await this.checkQuotas();
    await this.checkDisk();
  }

  private async checkFeeds(): Promise<void> {
    const now = this.options.now().getTime();
    for (const exchange of this.options.exchanges) {
      const name = EXCHANGE_NAMES[exchange];
      const condition = this.feeds.get(exchange);
      if (condition?.recovered !== undefined) {
        const text = `[Stark] ราคาจาก ${name} กลับมาแล้ว เวลา ${thaiClock(condition.recovered)} น.`;
        if (await this.report("feed_recovered", exchange, condition.since, text, null)) this.feeds.delete(exchange);
        continue;
      }
      const last = this.lastTick.get(exchange) ?? this.started;
      if (now - last.getTime() < STALE_AFTER_MS) continue;
      const stale = condition ?? { since: last, reported: false };
      this.feeds.set(exchange, stale);
      if (stale.reported || now - stale.since.getTime() < STALE_AFTER_MS + REPORT_AFTER_MS) continue;
      const text = `[Stark] ไม่ได้รับราคาจาก ${name} ตั้งแต่ ${thaiClock(stale.since)} น.\nกฎที่ใช้ราคาจาก ${name} จะไม่ทำงานจนกว่าราคาจะกลับมา`;
      stale.reported = await this.report("feed_stale", exchange, stale.since, text, null);
    }
  }

  private async checkChannels(): Promise<void> {
    const now = this.options.now().getTime();
    for (const [channel, condition] of this.failing) {
      const name = CHANNEL_NAMES[channel];
      if (condition.recovered !== undefined) {
        const text = `[Stark] ส่งแจ้งเตือนทาง ${name} ได้ตามปกติแล้ว`;
        if (await this.report("channel_recovered", channel, condition.since, text, null)) this.failing.delete(channel);
        continue;
      }
      if (condition.reported) continue;
      if (!condition.dead && now - condition.since.getTime() < REPORT_AFTER_MS) continue;
      const text = condition.dead
        ? `[Stark] ช่องทาง ${name} ใช้ไม่ได้แล้ว ต้องตั้งค่าใหม่`
        : condition.reason === "token_refresh_failed"
          ? "[Stark] ส่งอีเมลไม่ได้ เพราะ Google ไม่ต่ออายุการเข้าสู่ระบบ ต้องเชื่อมบัญชี Google ใหม่"
          : `[Stark] ส่งแจ้งเตือนทาง ${name} ไม่สำเร็จตั้งแต่ ${thaiClock(condition.since)} น.`;
      condition.reported = await this.report("channel_failing", channel, condition.since, text, channel);
    }
  }

  private async checkQuotas(): Promise<void> {
    for (const [channel, period] of this.quotaSeen) {
      if (this.quotaReported.get(channel) === period) continue;
      const name = CHANNEL_NAMES[channel];
      const text = `[Stark] ${name} ใช้โควตาของรอบนี้ครบแล้ว หยุดส่งทาง ${name} จนถึงรอบถัดไป`;
      if (await this.report("quota_reached", channel, this.options.now(), text, channel)) {
        this.quotaReported.set(channel, period);
      }
    }
  }

  private async checkDisk(): Promise<void> {
    let share: number;
    try {
      share = await this.options.diskFree();
    } catch (error) {
      this.options.logger.warn("health.disk_check_failed", { error });
      return;
    }
    const percent = Math.floor(share * 100);
    if (share >= DISK_LOW_SHARE) {
      if (this.disk?.reported !== true) {
        this.disk = undefined;
        return;
      }
      const text = `[Stark] พื้นที่ดิสก์บนเครื่องกลับมาเหลือ ${percent}% แล้ว`;
      if (await this.report("disk_recovered", "disk", this.disk.since, text, null)) this.disk = undefined;
      return;
    }
    this.disk ??= { since: this.options.now(), reported: false };
    if (this.disk.reported) return;
    this.disk.reported = await this.report("disk_low", "disk", this.disk.since, `[Stark] พื้นที่ดิสก์บนเครื่องเหลือ ${percent}%`, null);
  }

  /** Sends a report through the first working channel other than `exclude`; records it if one took it. */
  private async report(kind: HealthKind, subject: string, since: Date, text: string, exclude: ChannelName | null): Promise<boolean> {
    const { settings, logger } = this.options;
    const on = await settings.switchedOn();
    for (const name of REPORT_ORDER) {
      const channel = this.options.channels.find((c) => c.name === name);
      if (channel === undefined || name === exclude || !on.has(name) || (await settings.isDead(name))) continue;
      if (this.failing.get(name)?.dead === true) continue;
      let delivered = false;
      try {
        delivered = (await channel.send({ alertId: this.options.newId(), text })).status === "delivered";
      } catch (error) {
        logger.warn("health.report_send_failed", { kind, channel: name, error });
      }
      if (!delivered) continue;
      await this.options.log.record({ id: this.options.newId(), kind, subject, since, reportedAt: this.options.now() });
      logger.info("health.reported", { kind, subject, channel: name });
      return true;
    }
    logger.error("health.report_failed", { kind, subject });
    return false;
  }
}
