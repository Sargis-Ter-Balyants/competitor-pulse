import { AsyncLocalStorage } from "node:async_hooks";
import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import type { Listing, Snapshot, SummaryStatus } from "../types.js";
import * as schema from "./schema.js";
import { competitors, listingCursors, snapshots } from "./schema.js";

type Orm = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Orm["transaction"]>[0]>[0];

export type PendingSummary = Listing & {
  id: number;
  competitorId: string;
  summaryAttempts: number;
  previous: Listing;
};

const listingColumns = {
  title: snapshots.title,
  tagline: snapshots.tagline,
  price: snapshots.price,
  description: snapshots.description,
};

export class Db {
  private readonly transactions = new AsyncLocalStorage<Tx>();

  private constructor(
    private readonly pool: pg.Pool,
    private readonly orm: Orm,
  ) {}

  static async open(connectionString: string, migrationsFolder: string, connectTimeoutMs = 15_000): Promise<Db> {
    const pool = new pg.Pool({ connectionString });
    const db = new Db(pool, drizzle(pool, { schema }));
    try {
      await db.waitUntilReachable(connectTimeoutMs);
      await migrate(db.orm, { migrationsFolder });
    } catch (error) {
      await pool.end();
      throw error;
    }
    return db;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Every Db call made inside `fn` joins the same transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.orm.transaction((tx) => this.transactions.run(tx, fn));
  }

  async listCompetitors(): Promise<{ id: string }[]> {
    return this.q
      .select({ id: competitors.id })
      .from(competitors)
      .orderBy(asc(competitors.createdAt), asc(competitors.id));
  }

  async addCompetitor(id: string): Promise<boolean> {
    const inserted = await this.q
      .insert(competitors)
      .values({ id })
      .onConflictDoNothing()
      .returning({ id: competitors.id });
    return inserted.length === 1;
  }

  async removeCompetitor(id: string): Promise<boolean> {
    const deleted = await this.q.delete(competitors).where(eq(competitors.id, id)).returning({ id: competitors.id });
    return deleted.length === 1;
  }

  async hasCompetitor(id: string): Promise<boolean> {
    const rows = await this.q.select({ id: competitors.id }).from(competitors).where(eq(competitors.id, id)).limit(1);
    return rows.length === 1;
  }

  async cursor(competitorId: string): Promise<number> {
    const [row] = await this.q
      .select({ nextIndex: listingCursors.nextIndex })
      .from(listingCursors)
      .where(eq(listingCursors.competitorId, competitorId));
    return row?.nextIndex ?? 0;
  }

  async setCursor(competitorId: string, nextIndex: number): Promise<void> {
    await this.q
      .insert(listingCursors)
      .values({ competitorId, nextIndex })
      .onConflictDoUpdate({ target: listingCursors.competitorId, set: { nextIndex } });
  }

  async latestListing(competitorId: string): Promise<Listing | null> {
    const [row] = await this.q
      .select(listingColumns)
      .from(snapshots)
      .where(eq(snapshots.competitorId, competitorId))
      .orderBy(desc(snapshots.id))
      .limit(1);
    return row ?? null;
  }

  async insertSnapshot(input: { competitorId: string; fetchedAt: Date; listing: Listing; changed: boolean }): Promise<number> {
    const [row] = await this.q
      .insert(snapshots)
      .values({
        competitorId: input.competitorId,
        fetchedAt: input.fetchedAt,
        ...input.listing,
        changed: input.changed,
      })
      .returning({ id: snapshots.id });
    return row.id;
  }

  async listSnapshots(competitorId: string, maxAttempts = 3): Promise<Snapshot[]> {
    const rows = await this.q
      .select()
      .from(snapshots)
      .where(eq(snapshots.competitorId, competitorId))
      .orderBy(desc(snapshots.id));
    return rows.map((row) => ({
      fetchedAt: row.fetchedAt.toISOString(),
      title: row.title,
      tagline: row.tagline,
      price: row.price,
      description: row.description,
      changed: row.changed,
      summary: row.summary,
      summaryStatus: statusOf(row.changed, row.summary, row.summaryAttempts, maxAttempts),
    }));
  }

  /** A changed snapshot that still needs a summary, with the listing it changed from. */
  async snapshotForSummary(id: number): Promise<PendingSummary | null> {
    const [row] = await this.q.select().from(snapshots).where(eq(snapshots.id, id));
    if (!row || !row.changed || row.summary) return null;
    const [previous] = await this.q
      .select(listingColumns)
      .from(snapshots)
      .where(and(eq(snapshots.competitorId, row.competitorId), lt(snapshots.id, id)))
      .orderBy(desc(snapshots.id))
      .limit(1);
    if (!previous) return null;
    return {
      id: row.id,
      competitorId: row.competitorId,
      summaryAttempts: row.summaryAttempts,
      title: row.title,
      tagline: row.tagline,
      price: row.price,
      description: row.description,
      previous,
    };
  }

  async pendingSummaryIds(maxAttempts: number): Promise<number[]> {
    const rows = await this.q
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(and(eq(snapshots.changed, true), isNull(snapshots.summary), lt(snapshots.summaryAttempts, maxAttempts)))
      .orderBy(asc(snapshots.id));
    return rows.map((row) => row.id);
  }

  async saveSummary(id: number, summary: string): Promise<void> {
    await this.q
      .update(snapshots)
      .set({ summary })
      .where(and(eq(snapshots.id, id), isNull(snapshots.summary)));
  }

  async recordSummaryFailure(id: number): Promise<void> {
    await this.q
      .update(snapshots)
      .set({ summaryAttempts: sql`${snapshots.summaryAttempts} + 1` })
      .where(eq(snapshots.id, id));
  }

  private get q(): Orm | Tx {
    return this.transactions.getStore() ?? this.orm;
  }

  /** Postgres may still be starting (Compose, `npm run dev`), so retry the first connection. */
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
}

function statusOf(changed: boolean, summary: string | null, attempts: number, maxAttempts: number): SummaryStatus {
  if (!changed) return "skipped";
  if (summary) return "ready";
  return attempts >= maxAttempts ? "failed" : "pending";
}
