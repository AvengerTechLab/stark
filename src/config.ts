// Reads settings from the environment once at start. Required values fail fast; optional channel
// groups are all-or-none (playbook §8). Errors name variables, never their values (CLAUDE.md §5).

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  readonly databaseUrl: string;
  readonly ownerPasswordHash: string;
  readonly logLevel: LogLevel;
  readonly telegram: { readonly botToken: string; readonly ownerChatId: string };
  readonly line?: { readonly channelAccessToken: string; readonly ownerUserId: string };
  readonly discord?: { readonly webhookUrl: string };
  readonly gmail?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly refreshToken: string;
    readonly sender: string;
    readonly recipient: string;
  };
}

export type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(
    readonly missing: readonly string[],
    readonly invalid: readonly string[],
  ) {
    super(
      [
        missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
        invalid.length > 0 ? `invalid: ${invalid.join(", ")}` : "",
      ]
        .filter((part) => part !== "")
        .join("; "),
    );
    this.name = "ConfigError";
  }
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const OPTIONAL_GROUPS = {
  line: ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_OWNER_USER_ID"],
  discord: ["DISCORD_WEBHOOK_URL"],
  gmail: [
    "GMAIL_OAUTH_CLIENT_ID",
    "GMAIL_OAUTH_CLIENT_SECRET",
    "GMAIL_OAUTH_REFRESH_TOKEN",
    "GMAIL_SENDER",
    "ALERT_EMAIL_TO",
  ],
} as const;

function value(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function loadConfig(env: Env): Config {
  const missing: string[] = [];
  const invalid: string[] = [];

  const required = (name: string): string => {
    const found = value(env, name);
    if (found === undefined) missing.push(name);
    return found ?? "";
  };

  // A channel group is either fully set (channel available) or fully unset (channel unavailable).
  const group = (names: readonly string[]): string[] | undefined => {
    const found = names.map((name) => value(env, name));
    const setCount = found.filter((v) => v !== undefined).length;
    if (setCount === 0) return undefined;
    if (setCount < names.length) {
      names.forEach((name, i) => {
        if (found[i] === undefined) missing.push(name);
      });
      return undefined;
    }
    return found as string[];
  };

  const databaseUrl = required("DATABASE_URL");
  const ownerPasswordHash = required("OWNER_PASSWORD_HASH");
  const botToken = required("TELEGRAM_BOT_TOKEN");
  const ownerChatId = required("TELEGRAM_OWNER_CHAT_ID");

  if (databaseUrl !== "" && !/^postgres(ql)?:\/\//.test(databaseUrl)) invalid.push("DATABASE_URL");
  if (ownerPasswordHash !== "" && !ownerPasswordHash.startsWith("$argon2id$")) invalid.push("OWNER_PASSWORD_HASH");
  if (ownerChatId !== "" && !/^-?\d+$/.test(ownerChatId)) invalid.push("TELEGRAM_OWNER_CHAT_ID");

  const rawLevel = value(env, "LOG_LEVEL") ?? "info";
  const logLevel = (LOG_LEVELS as readonly string[]).includes(rawLevel) ? (rawLevel as LogLevel) : "info";
  if (rawLevel !== logLevel) invalid.push("LOG_LEVEL");

  const line = group(OPTIONAL_GROUPS.line);
  const discord = group(OPTIONAL_GROUPS.discord);
  const gmail = group(OPTIONAL_GROUPS.gmail);

  if (discord?.[0] !== undefined && !discord[0].startsWith("https://")) invalid.push("DISCORD_WEBHOOK_URL");

  if (missing.length > 0 || invalid.length > 0) throw new ConfigError(missing, invalid);

  return {
    databaseUrl,
    ownerPasswordHash,
    logLevel,
    telegram: { botToken, ownerChatId },
    ...(line && { line: { channelAccessToken: line[0] ?? "", ownerUserId: line[1] ?? "" } }),
    ...(discord && { discord: { webhookUrl: discord[0] ?? "" } }),
    ...(gmail && {
      gmail: {
        clientId: gmail[0] ?? "",
        clientSecret: gmail[1] ?? "",
        refreshToken: gmail[2] ?? "",
        sender: gmail[3] ?? "",
        recipient: gmail[4] ?? "",
      },
    }),
  };
}

/** Every credential in the config, for the logger's redaction list (SECURITY.md T-01). */
export function secretValues(config: Config): string[] {
  return [
    config.databaseUrl,
    config.ownerPasswordHash,
    config.telegram.botToken,
    config.line?.channelAccessToken,
    config.discord?.webhookUrl,
    config.gmail?.clientSecret,
    config.gmail?.refreshToken,
  ].filter((v): v is string => v !== undefined && v !== "");
}
