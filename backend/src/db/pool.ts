import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

function needsSsl(connectionString: string): boolean {
  return (
    connectionString.includes("neon.tech") ||
    connectionString.includes("sslmode=require") ||
    connectionString.includes("sslmode=verify-full")
  );
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  // Neon (and most hosted Postgres) require TLS
  ssl: needsSsl(env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
