// Free disk for the health monitor's `disk_low` check (SECURITY.md T-23), from the file system that
// holds `path` (the PostgreSQL data directory on the host).

import { statfs } from "node:fs/promises";

/** Share of the file system that is free to ordinary users, 0 to 1. */
export async function diskFreeShare(path: string): Promise<number> {
  const stats = await statfs(path);
  return stats.blocks === 0 ? 0 : stats.bavail / stats.blocks;
}
