// Structured JSON logger: one line per event, named `domain.action_result` (playbook §7).
// Secrets never reach the output: sensitive keys are masked and known secret values are
// replaced wherever they appear (SECURITY.md T-01).

import type { LogLevel } from "./config.js";

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly secrets?: readonly string[];
  readonly write?: (line: string) => void;
  readonly now?: () => Date;
}

const RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };
const EVENT_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const SENSITIVE_KEY = /token|secret|password|passwd|hash|webhook|authorization|cookie|refresh|api_?key/i;
export const REDACTED = "[REDACTED]";

// Credentials that can appear in URLs the logger was never told about (SECURITY.md T-19).
const SECRET_PATTERNS: readonly [RegExp, string][] = [
  // Telegram Bot API path: /bot<id>:<token>/
  [/(\/bot)\d+:[A-Za-z0-9_-]+/g, `$1${REDACTED}`],
  // Discord webhook URL: the id and token after /webhooks/ are the secret.
  [/(discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/)[^\s"'?]+/g, `$1${REDACTED}`],
];

export function createLogger(options: LoggerOptions): Logger {
  const secrets = (options.secrets ?? []).filter((s) => s.length >= 4);
  const write = options.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const now = options.now ?? (() => new Date());

  const scrubString = (text: string): string =>
    SECRET_PATTERNS.reduce(
      (out, [pattern, replacement]) => out.replace(pattern, replacement),
      secrets.reduce((out, secret) => out.split(secret).join(REDACTED), text),
    );

  const scrub = (input: unknown, depth: number): unknown => {
    if (depth > 8) return "[TRUNCATED]";
    if (typeof input === "string") return scrubString(input);
    if (input instanceof Error) {
      return { name: input.name, message: scrubString(input.message) };
    }
    if (Array.isArray(input)) return input.map((item) => scrub(item, depth + 1));
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input).map(([key, val]) => [
          key,
          SENSITIVE_KEY.test(key) ? REDACTED : scrub(val, depth + 1),
        ]),
      );
    }
    return input;
  };

  const log =
    (level: LogLevel) =>
    (event: string, fields: LogFields = {}): void => {
      if (!EVENT_NAME.test(event)) {
        throw new Error(`log event name must look like domain.action_result: ${event}`);
      }
      if (RANK[level] < RANK[options.level]) return;
      const body = scrub(fields, 0) as Record<string, unknown>;
      write(JSON.stringify({ time: now().toISOString(), level, event, ...body }));
    };

  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}
