import type { Db } from "./db.js";
import { decide } from "./diff.js";
import { nextListing } from "./source.js";
import type { Listing } from "./types.js";

export type PollerDeps = {
  db: Db;
  sequences: Record<string, Listing[]>;
  summarize: (previous: Listing, next: Listing) => Promise<string>;
  maxAttempts: number;
  now?: () => Date;
  onUpdate?: (competitorId: string) => void;
};

export class Poller {
  private readonly inFlight = new Set<number>();
  private readonly tasks = new Set<Promise<void>>();

  constructor(private readonly deps: PollerDeps) {}

  async pollAll(): Promise<void> {
    for (const competitor of this.deps.db.listCompetitors()) this.captureAndNotify(competitor.id);
    for (const id of this.deps.db.pendingSummaryIds(this.deps.maxAttempts)) this.schedule(id);
  }

  pollOne(competitorId: string): void {
    this.captureAndNotify(competitorId);
  }

  private captureAndNotify(competitorId: string): void {
    const snapshotId = this.capture(competitorId);
    if (snapshotId !== null) this.deps.onUpdate?.(competitorId);
    this.schedule(snapshotId);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.tasks]);
  }

  private capture(competitorId: string): number | null {
    return this.deps.db.transaction(() => {
      if (!this.deps.db.hasCompetitor(competitorId)) return null;
      const listing = nextListing(this.deps.db, this.deps.sequences, competitorId);
      if (!listing) return null;
      const decision = decide(this.deps.db.latestListing(competitorId), listing);
      if (decision.action === "skip") return null;
      return this.deps.db.insertSnapshot({
        competitorId,
        fetchedAt: (this.deps.now ?? (() => new Date()))().toISOString(),
        listing,
        changed: decision.changed,
      });
    });
  }

  private schedule(snapshotId: number | null): void {
    if (snapshotId === null || this.inFlight.has(snapshotId)) return;
    this.inFlight.add(snapshotId);
    const task = this.fill(snapshotId).finally(() => {
      this.inFlight.delete(snapshotId);
      this.tasks.delete(task);
    });
    this.tasks.add(task);
  }

  private async fill(snapshotId: number): Promise<void> {
    const row = this.deps.db.snapshotForSummary(snapshotId);
    if (!row || row.summary_attempts >= this.deps.maxAttempts) return;
    try {
      const summary = await this.deps.summarize(row.previous, row);
      this.deps.db.saveSummary(snapshotId, summary);
      this.deps.onUpdate?.(row.competitor_id);
    } catch (error) {
      this.deps.db.recordSummaryFailure(snapshotId);
      this.deps.onUpdate?.(row.competitor_id);
      console.error(`summary failed for snapshot ${snapshotId}:`, error instanceof Error ? error.message : error);
    }
  }
}
