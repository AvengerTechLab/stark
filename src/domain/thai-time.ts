// The Thai calendar and clock (UTC+7, no daylight saving): alert times (EVENTS.md §4) and usage
// periods (DATABASE.md `channel_usage`) are both read in Thai time.

export const THAI_OFFSET_MS = 7 * 60 * 60_000;

/** "YYYY-MM-DDTHH:MM:SS" of `at` in Thai time. */
function thaiIso(at: Date): string {
  return new Date(at.getTime() + THAI_OFFSET_MS).toISOString().slice(0, 19);
}

/** "YYYY-MM-DD" in Thai time. */
export function thaiDate(at: Date): string {
  return thaiIso(at).slice(0, 10);
}

/** "HH:MM:SS" in Thai time. */
export function thaiClock(at: Date): string {
  return thaiIso(at).slice(11, 19);
}
