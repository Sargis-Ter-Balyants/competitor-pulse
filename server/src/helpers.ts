import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Db } from "./db/db.js";

const migrationsFolder = path.join(fileURLToPath(new URL(".", import.meta.url)), "../drizzle");
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://pulse:pulse@localhost:5432/competitor_pulse_test";

export async function openTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  try {
    await resetDatabase(testDatabaseUrl);
  } catch (error) {
    throw new Error(`Tests need PostgreSQL at ${testDatabaseUrl}. Start it with \`npm run db:up\`.`, { cause: error });
  }
  const db = await Db.open(testDatabaseUrl, migrationsFolder, 2_000);
  return { db, close: () => db.close() };
}

async function resetDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }
}
