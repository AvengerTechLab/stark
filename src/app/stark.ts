// The composition root (ARCHITECTURE.md §4–5): builds every component, joins them, and starts the
// timers. Everything outside the process (sockets, HTTP, storage, the clock) is passed in, so the same
// code runs in production (src/index.ts) and end to end on fakes (test/e2e/).

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { ChannelName } from "../ports/channel.js";
import type { Exchange, FeedTick } from "../ports/feed.js";
import type { AlertQuery, ChannelAdmin, RuleAdmin, SessionStore } from "../ports/owner.js";
import type { ChannelSettings, DeliveryLog, HealthLog, PriceLog, RuleStore } from "../ports/storage.js";
import type { HttpPost } from "../channels/http.js";
import { createChannels } from "../channels/index.js";
import { binanceProvider } from "../feeds/binance.js";
import { bitkubProvider } from "../feeds/bitkub.js";
import { PairCatalog } from "../feeds/pairs.js";
import { StreamFeed, type Connect, type HttpGet, type Timers } from "../feeds/stream-feed.js";
import { ownerHandler } from "../interface/http-server.js";
import { TelegramBot } from "../interface/telegram-bot.js";
import { Dispatcher } from "./dispatcher.js";
import { CHECK_INTERVAL_MS, HealthMonitor } from "./health.js";
import { startHeartbeat } from "./heartbeat.js";
import { OwnerService } from "./owner-service.js";
import { DecisionPipeline } from "./pipeline.js";
import { PriceBoard } from "./price-board.js";

/** How often held ticks are released once their second has ended (EVENTS.md §2.1). */
export const FLUSH_INTERVAL_MS = 250;
export const PAIRS_REFRESH_MS = 60 * 60_000;
export const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60_000;
/** Decisions this recent are resent at start where a channel has not finished them; LINE's retry key lasts 24 h. */
export const SWEEP_WINDOW_MS = 24 * 60 * 60_000;
const SWEEP_LIMIT = 500;

export interface Stores {
  readonly priceLog: PriceLog;
  readonly rules: RuleStore;
  readonly ruleAdmin: RuleAdmin;
  readonly channelSettings: ChannelSettings;
  readonly channelAdmin: ChannelAdmin;
  readonly deliveries: DeliveryLog;
  readonly healthLog: HealthLog;
  readonly sessions: SessionStore;
  readonly alerts: AlertQuery;
}

export interface StarkDeps {
  readonly config: Config;
  readonly stores: Stores;
  /** Storage upkeep: `prepare` at start (migrations, partitions), `daily` once a day (D-34). */
  readonly maintenance?: { prepare(): Promise<void>; daily(now: Date): Promise<void> };
  readonly connect: Connect;
  readonly httpGet: HttpGet;
  readonly httpPost: HttpPost;
  readonly timers: Timers;
  readonly now: () => Date;
  /** Must return UUIDs (DATABASE.md; LINE's retry key). */
  readonly newId: () => string;
  readonly logger: Logger;
  readonly diskFree: () => Promise<number>;
  /** Starts the owner web server with this handler. */
  readonly listen: (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) => Promise<{ close(): Promise<void> }>;
}

export interface StarkHandle {
  stop(): Promise<void>;
}

export async function startStark(deps: StarkDeps): Promise<StarkHandle> {
  const { config, stores, timers, now, newId, logger } = deps;
  const stops: (() => void | Promise<void>)[] = [];

  /** Runs `work` every `ms` until Stark stops; an error is logged and the next run still happens. */
  const every = (ms: number, name: string, work: () => Promise<unknown> | unknown): void => {
    let stopped = false;
    let cancel: () => void = () => undefined;
    const loop = () => {
      if (stopped) return;
      cancel = timers.set(ms, loop);
      Promise.resolve()
        .then(work)
        .catch((error: unknown) => logger.error("app.task_failed", { task: name, error }));
    };
    cancel = timers.set(ms, loop);
    stops.push(() => {
      stopped = true;
      cancel();
    });
  };

  await deps.maintenance?.prepare();

  const catalog = new PairCatalog(deps.httpGet, logger);
  await catalog.refresh();

  const channels = createChannels(config, deps.httpPost, now);
  const configured = channels.map((c) => c.name);
  const health = new HealthMonitor({
    exchanges: [],
    channels,
    settings: stores.channelSettings,
    log: stores.healthLog,
    diskFree: deps.diskFree,
    now,
    newId,
    logger,
  });
  const dispatcher = new Dispatcher({
    channels,
    settings: stores.channelSettings,
    deliveries: stores.deliveries,
    logger,
    now,
    sleep: (ms) => new Promise<void>((resolve) => timers.set(ms, resolve)),
  });
  dispatcher.onOutcome = (outcome) => health.channelOutcome(outcome);
  const pipeline = new DecisionPipeline({
    priceLog: stores.priceLog,
    rules: stores.rules,
    channels: stores.channelSettings,
    logger,
    now,
    newId,
    onDecision: (decision) => dispatcher.dispatch(decision),
  });
  const board = new PriceBoard();

  // Feeds follow the pairs that have rules: one feed per exchange, rebuilt when its pairs change.
  const feeds = new Map<Exchange, { pairs: string; feed: StreamFeed }>();
  const onTick = (tick: FeedTick) => {
    health.tickSeen(tick.exchange);
    board.update(tick, now());
    pipeline.receive(tick);
  };
  const rebuildFeeds = async () => {
    const pairs = [...new Set((await stores.ruleAdmin.list()).map((r) => r.pair))].sort();
    const wanted: Record<Exchange, string[]> = {
      bitkub: pairs.filter((p) => p.endsWith("/THB")),
      binance: pairs.filter((p) => p.endsWith("/USDT")),
    };
    for (const exchange of ["bitkub", "binance"] as const) {
      const key = wanted[exchange].join(",");
      const current = feeds.get(exchange);
      if (current?.pairs === key) continue;
      await current?.feed.stop();
      feeds.delete(exchange);
      if (key === "") continue;
      const provider = exchange === "bitkub" ? bitkubProvider(wanted[exchange]) : binanceProvider(wanted[exchange]);
      const feed = new StreamFeed(provider, { connect: deps.connect, httpGet: deps.httpGet, timers, now, logger });
      feeds.set(exchange, { pairs: key, feed });
      await feed.start(onTick);
      logger.info("app.feed_started", { exchange, pairs: wanted[exchange] });
    }
    health.setExchanges([...feeds.keys()]);
  };
  let feedChain: Promise<void> = Promise.resolve();
  let stopped = false;
  const refreshFeeds = () => {
    feedChain = feedChain
      .then(() => (stopped ? undefined : rebuildFeeds()))
      .catch((error: unknown) => logger.error("app.feeds_failed", { error }));
    return feedChain;
  };
  stops.push(async () => {
    await feedChain;
    await Promise.all([...feeds.values()].map((f) => f.feed.stop()));
    feeds.clear();
  });

  const service = new OwnerService({
    rules: stores.ruleAdmin,
    channels: stores.channelAdmin,
    isListed: catalog.isListed,
    newId,
    now,
    onRulesChanged: () => void refreshFeeds(),
  });
  await refreshFeeds();

  const telegram = channels.find((c) => c.name === "telegram");
  const notifyOwner = async (text: string) => {
    await telegram?.send({ alertId: newId(), text });
  };

  every(FLUSH_INTERVAL_MS, "pipeline.flush", () => pipeline.flush());
  every(CHECK_INTERVAL_MS, "health.check", () => health.check());
  every(PAIRS_REFRESH_MS, "pairs.refresh", () => catalog.refresh());
  const maintenance = deps.maintenance;
  if (maintenance !== undefined) every(MAINTENANCE_INTERVAL_MS, "storage.maintenance", () => maintenance.daily(now()));
  if (config.heartbeatUrl !== undefined) {
    stops.push(startHeartbeat({ url: config.heartbeatUrl, get: deps.httpGet, timers, logger }));
  }

  const server = await deps.listen(
    ownerHandler({
      service,
      sessions: stores.sessions,
      alerts: stores.alerts,
      deliveries: stores.deliveries,
      configured,
      health: () => health.snapshot(),
      prices: board,
      pairs: catalog,
      passwordHash: config.ownerPasswordHash,
      notifyOwner,
      now,
      logger,
    }),
  );
  stops.push(() => server.close());

  const bot = new TelegramBot({
    botToken: config.telegram.botToken,
    ownerChatId: config.telegram.ownerChatId,
    post: deps.httpPost,
    service,
    deliveries: stores.deliveries,
    configured,
    prices: board,
    health: () => health.snapshot(),
    now,
    newId,
    logger,
  });
  bot.start(timers);
  stops.push(() => bot.stop());

  // Restart sweep (ARCHITECTURE.md §7): decisions stored before a restart are sent where a channel has
  // not finished them; the dispatcher's idempotency skips every channel that has.
  const sweep = (async () => {
    const recent = await stores.alerts.decisions(new Date(now().getTime() - SWEEP_WINDOW_MS), now(), SWEEP_LIMIT);
    for (const { decision } of [...recent].reverse()) await dispatcher.dispatch(decision);
  })().catch((error: unknown) => logger.error("app.sweep_failed", { error }));

  logger.info("app.started", { channelsConfigured: configured as ChannelName[] });
  return {
    async stop() {
      stopped = true;
      for (const stop of [...stops].reverse()) await stop();
      await sweep;
      logger.info("app.stopped");
    },
  };
}
