import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Listing, Snapshot, SummaryStatus } from "./types.js";

type SnapshotRow = Listing & {
  id: number;
  competitor_id: string;
  fetched_at: string;
  changed: number;
  summary: string | null;
  summary_attempts: number;
};

export class Db {
  private readonly db: DatabaseSync;

  constructor(filename: string, migrationsDir: string) {
    if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON");
    if (filename !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate(migrationsDir);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listCompetitors(): { id: string }[] {
    return this.db.prepare("SELECT id FROM competitors ORDER BY created_at, id").all() as { id: string }[];
  }

  addCompetitor(id: string): boolean {
    const result = this.db
      .prepare("INSERT INTO competitors (id, created_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING")
      .run(id, new Date().toISOString());
    return Number(result.changes) === 1;
  }

  removeCompetitor(id: string): boolean {
    const result = this.db.prepare("DELETE FROM competitors WHERE id = ?").run(id);
    return Number(result.changes) === 1;
  }

  hasCompetitor(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM competitors WHERE id = ?").get(id) !== undefined;
  }

  cursor(competitorId: string): number {
    const row = this.db.prepare("SELECT next_index FROM listing_cursors WHERE competitor_id = ?").get(competitorId) as
      | { next_index: number }
      | undefined;
    return row?.next_index ?? 0;
  }

  setCursor(competitorId: string, nextIndex: number): void {
    this.db
      .prepare(
        `INSERT INTO listing_cursors (competitor_id, next_index) VALUES (?, ?)
         ON CONFLICT (competitor_id) DO UPDATE SET next_index = excluded.next_index`,
      )
      .run(competitorId, nextIndex);
  }

  latestListing(competitorId: string): Listing | null {
    const row = this.db
      .prepare(
        `SELECT title, tagline, price, description FROM snapshots
         WHERE competitor_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(competitorId) as Listing | undefined;
    return row ?? null;
  }

  insertSnapshot(input: { competitorId: string; fetchedAt: string; listing: Listing; changed: boolean }): number {
    const result = this.db
      .prepare(
        `INSERT INTO snapshots
          (competitor_id, fetched_at, title, tagline, price, description, changed)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.competitorId,
        input.fetchedAt,
        input.listing.title,
        input.listing.tagline,
        input.listing.price,
        input.listing.description,
        input.changed ? 1 : 0,
      );
    return Number(result.lastInsertRowid);
  }

  listSnapshots(competitorId: string, maxAttempts = 3): Snapshot[] {
    const rows = this.db
      .prepare(
        `SELECT fetched_at, title, tagline, price, description, changed, summary, summary_attempts
         FROM snapshots WHERE competitor_id = ? ORDER BY id DESC`,
      )
      .all(competitorId) as Array<
      Listing & { fetched_at: string; changed: number; summary: string | null; summary_attempts: number }
    >;
    return rows.map((row) => {
      const changed = row.changed === 1;
      return {
        fetchedAt: row.fetched_at,
        title: row.title,
        tagline: row.tagline,
        price: row.price,
        description: row.description,
        changed,
        summary: row.summary,
        summaryStatus: statusOf(changed, row.summary, row.summary_attempts, maxAttempts),
      };
    });
  }

  snapshotForSummary(id: number): (SnapshotRow & { previous: Listing }) | null {
    const row = this.db
      .prepare(
        `SELECT id, competitor_id, fetched_at, title, tagline, price, description, changed, summary, summary_attempts
         FROM snapshots WHERE id = ?`,
      )
      .get(id) as SnapshotRow | undefined;
    if (!row || row.changed !== 1 || row.summary) return null;
    const previous = this.db
      .prepare(
        `SELECT title, tagline, price, description FROM snapshots
         WHERE competitor_id = ? AND id < ? ORDER BY id DESC LIMIT 1`,
      )
      .get(row.competitor_id, id) as Listing | undefined;
    if (!previous) return null;
    return { ...row, previous };
  }

  pendingSummaryIds(maxAttempts: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM snapshots
         WHERE changed = 1 AND summary IS NULL AND summary_attempts < ?
         ORDER BY id`,
      )
      .all(maxAttempts) as { id: number }[];
    return rows.map((row) => row.id);
  }

  saveSummary(id: number, summary: string): void {
    this.db.prepare("UPDATE snapshots SET summary = ? WHERE id = ? AND summary IS NULL").run(summary, id);
  }

  recordSummaryFailure(id: number): void {
    this.db.prepare("UPDATE snapshots SET summary_attempts = summary_attempts + 1 WHERE id = ?").run(id);
  }

  private migrate(dir: string): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`,
    );
    const applied = new Set(
      (this.db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((row) => row.version),
    );
    const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const version = Number(file.slice(0, 3));
      if (!Number.isInteger(version) || applied.has(version)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      this.transaction(() => {
        this.db.exec(sql);
        this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
      });
    }
  }
}

function statusOf(changed: boolean, summary: string | null, attempts: number, maxAttempts: number): SummaryStatus {
  if (!changed) return "skipped";
  if (summary) return "ready";
  return attempts >= maxAttempts ? "failed" : "pending";
}
