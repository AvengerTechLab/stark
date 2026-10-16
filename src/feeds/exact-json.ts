// JSON parsing that keeps every number as the exact text the provider sent. Bitkub sends prices as
// JSON numbers; reading them as binary floats could change their digits (playbook §6), so the
// reviver returns each number's source text instead (JSON.parse source text access, Node.js 22).

interface ReviverContext {
  readonly source?: string;
}

/** Parses JSON, with every number as its source text; undefined if the text is not JSON. */
export function parseExactJson(text: string): unknown {
  try {
    return JSON.parse(text, (_key: string, value: unknown, context?: ReviverContext) =>
      typeof value === "number" ? context?.source : value,
    );
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
