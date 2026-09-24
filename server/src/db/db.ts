import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import type { Listing, Snapshot, SummaryStatus } from "../types.js";

const { Pool } = pg;

type SnapshotRow = Listing & {
  id: number;
  competitor_id: string;
  fetched_at: Date | string;
  changed: boolean;
  summary: string | null;
  summary_attempts: number;
};

export class Db {
  private readonly clients = new AsyncLocalStorage<pg.PoolClient>();

  private constructor(private readonly pool: pg.Pool) {}

  static async open(connectionString: string, migrationsDir: string, connectTimeoutMs = 15_000): Promise<Db> {
    const db = new Db(new Pool({ connectionString }));
    try {
      await db.waitUntilReachable(connectTimeoutMs);
      await db.migrate(migrationsDir);
    } catch (error) {
      await db.close();
      throw error;
    }
    return db;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.clients.run(client, fn);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listCompetitors(): Promise<{ id: string }[]> {
    const result = await this.query<{ id: string }>("SELECT id FROM competitors ORDER BY created_at, id");
    return result.rows;
  }

  async addCompetitor(id: string): Promise<boolean> {
    const result = await this.query(
      "INSERT INTO competitors (id, created_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [id, new Date().toISOString()],
    );
    return result.rowCount === 1;
  }

  async removeCompetitor(id: string): Promise<boolean> {
    const result = await this.query("DELETE FROM competitors WHERE id = $1", [id]);
    return result.rowCount === 1;
  }

  async hasCompetitor(id: string): Promise<boolean> {
    const result = await this.query("SELECT 1 FROM competitors WHERE id = $1", [id]);
    return result.rowCount === 1;
  }

  async cursor(competitorId: string): Promise<number> {
    const result = await this.query<{ next_index: number }>(
      "SELECT next_index FROM listing_cursors WHERE competitor_id = $1",
      [competitorId],
    );
    return result.rows[0]?.next_index ?? 0;
  }

  async setCursor(competitorId: string, nextIndex: number): Promise<void> {
    await this.query(
      `INSERT INTO listing_cursors (competitor_id, next_index) VALUES ($1, $2)
       ON CONFLICT (competitor_id) DO UPDATE SET next_index = excluded.next_index`,
      [competitorId, nextIndex],
    );
  }

  async latestListing(competitorId: string): Promise<Listing | null> {
    const result = await this.query<Listing>(
      `SELECT title, tagline, price, description FROM snapshots
       WHERE competitor_id = $1 ORDER BY id DESC LIMIT 1`,
      [competitorId],
    );
    return result.rows[0] ?? null;
  }

  async insertSnapshot(input: {
    competitorId: string;
    fetchedAt: string;
    listing: Listing;
    changed: boolean;
  }): Promise<number> {
    const result = await this.query<{ id: number }>(
      `INSERT INTO snapshots
        (competitor_id, fetched_at, title, tagline, price, description, changed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.competitorId,
        input.fetchedAt,
        input.listing.title,
        input.listing.tagline,
        input.listing.price,
        input.listing.description,
        input.changed,
      ],
    );
    return Number(result.rows[0]?.id);
  }

  async listSnapshots(competitorId: string, maxAttempts = 3): Promise<Snapshot[]> {
    const result = await this.query<
      Listing & { fetched_at: Date | string; changed: boolean; summary: string | null; summary_attempts: number }
    >(
      `SELECT fetched_at, title, tagline, price, description, changed, summary, summary_attempts
       FROM snapshots WHERE competitor_id = $1 ORDER BY id DESC`,
      [competitorId],
    );
    return result.rows.map((row) => ({
      fetchedAt: iso(row.fetched_at),
      title: row.title,
      tagline: row.tagline,
      price: row.price,
      description: row.description,
      changed: row.changed,
      summary: row.summary,
      summaryStatus: statusOf(row.changed, row.summary, row.summary_attempts, maxAttempts),
    }));
  }

  async snapshotForSummary(id: number): Promise<(SnapshotRow & { previous: Listing }) | null> {
    const result = await this.query<SnapshotRow>(
      `SELECT id, competitor_id, fetched_at, title, tagline, price, description, changed, summary, summary_attempts
       FROM snapshots WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row || !row.changed || row.summary) return null;
    const previous = await this.query<Listing>(
      `SELECT title, tagline, price, description FROM snapshots
       WHERE competitor_id = $1 AND id < $2 ORDER BY id DESC LIMIT 1`,
      [row.competitor_id, id],
    );
    const prior = previous.rows[0];
    if (!prior) return null;
    return { ...row, previous: prior };
  }

  async pendingSummaryIds(maxAttempts: number): Promise<number[]> {
    const result = await this.query<{ id: number }>(
      `SELECT id FROM snapshots
       WHERE changed AND summary IS NULL AND summary_attempts < $1
       ORDER BY id`,
      [maxAttempts],
    );
    return result.rows.map((row) => Number(row.id));
  }

  async saveSummary(id: number, summary: string): Promise<void> {
    await this.query("UPDATE snapshots SET summary = $1 WHERE id = $2 AND summary IS NULL", [summary, id]);
  }

  async recordSummaryFailure(id: number): Promise<void> {
    await this.query("UPDATE snapshots SET summary_attempts = summary_attempts + 1 WHERE id = $1", [id]);
  }

  private async query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
    const client = this.clients.getStore() ?? this.pool;
    return client.query<T>(sql, params);
  }

  /** The database may still be starting (Compose, `npm run dev`), so retry the first connection. */
  private async waitUntilReachable(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await this.pool.query("SELECT 1");
        return;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  private async migrate(dir: string): Promise<void> {
    await this.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL
      )`,
    );
    const applied = await this.query<{ version: number }>("SELECT version FROM schema_migrations");
    const versions = new Set(applied.rows.map((row) => row.version));
    const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const version = Number(file.slice(0, 3));
      if (!Number.isInteger(version) || versions.has(version)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      const statements = sql
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
      await this.transaction(async () => {
        for (const statement of statements) await this.query(statement);
        await this.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)", [
          version,
          new Date().toISOString(),
        ]);
      });
    }
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function statusOf(changed: boolean, summary: string | null, attempts: number, maxAttempts: number): SummaryStatus {
  if (!changed) return "skipped";
  if (summary) return "ready";
  return attempts >= maxAttempts ? "failed" : "pending";
}
