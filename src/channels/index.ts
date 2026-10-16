// Builds the channel adapters that are configured (src/config.ts): Telegram always, LINE, Discord
// and Gmail when their settings are present (D-09).

import type { Config } from "../config.js";
import type { AlertChannel } from "../ports/channel.js";
import { discordChannel } from "./discord.js";
import { gmailChannel } from "./gmail.js";
import type { HttpPost } from "./http.js";
import { lineChannel } from "./line.js";
import { telegramChannel } from "./telegram.js";

export function createChannels(config: Config, post: HttpPost, now: () => Date): AlertChannel[] {
  const channels = [telegramChannel({ botToken: config.telegram.botToken, chatId: config.telegram.ownerChatId }, post)];
  if (config.line !== undefined) channels.push(lineChannel(config.line, post));
  if (config.discord !== undefined) channels.push(discordChannel(config.discord, post));
  if (config.gmail !== undefined) channels.push(gmailChannel(config.gmail, post, now));
  return channels;
}
