// Audit MSAP-2026-11-09-01, dimension 7: builds Stark's schema in a throwaway database (stark_volume)
// with the audited code's own migrations and partitions. Demo data only.
import pg from "pg";
import { migrate, ensurePartitions } from "../build/storage/postgres.js";
const pool = new pg.Pool({ connectionString: "postgres://postgres@127.0.0.1:54329/stark_volume" });
await migrate(pool);
const now = new Date("2026-11-09T00:00:00Z");
await ensurePartitions(pool, new Date(now.getTime() - 35 * 86400000), 37);
const { rows } = await pool.query("SELECT count(*)::int n FROM pg_tables WHERE tablename LIKE 'price_ticks_%'");
console.log("partitions", rows[0].n);
await pool.end();
