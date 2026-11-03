import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/backup/main.js";

// Only the configuration path is run here: a valid configuration would start pg_dump and restic,
// which the runBackup tests cover on fakes. The values are made up.
describe("backup main", () => {
  it("returns 1 and logs only variable names when configuration is missing", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await main({ AWS_SECRET_ACCESS_KEY: "FAKE-secret-access-key" });
      const text = write.mock.calls.map((call) => String(call[0])).join("");
      expect(code).toBe(1);
      expect(text).toContain('"event":"backup.config_invalid"');
      expect(text).toContain("RESTIC_REPOSITORY");
      expect(text).not.toContain("FAKE-secret-access-key");
    } finally {
      write.mockRestore();
    }
  });
});
