// A throwaway schema in the test PostgreSQL named by STARK_TEST_DATABASE_URL (never a real Stark
// database). Each call gets its own schema, dropped by close(), so test files never share rows.

import { randomUUID } from "node:crypto";
import pg from "pg";

export const TEST_DATABASE_URL = process.env["STARK_TEST_DATABASE_URL"];

export async function testPool(): Promise<{ pool: pg.Pool; close: () => Promise<void> }> {
  if (TEST_DATABASE_URL === undefined) throw new Error("STARK_TEST_DATABASE_URL is not set");
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  return {
    pool,
    close: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
