import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.ts";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  // Log fatal pool errors; allow process to die so the supervisor restarts.
  console.error("[pg-pool] unexpected error", err);
  process.exit(1);
});

export const db = drizzle(pool);
export type Db = typeof db;
