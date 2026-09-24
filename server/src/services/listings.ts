import fs from "node:fs";
import type { Db } from "../db/db.js";
import type { Listing } from "../types.js";

export function readListings(file: string): Record<string, Listing[]> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Listings file ${file} must be an object keyed by competitor id`);
  }
  return parsed as Record<string, Listing[]>;
}

/** Next canned listing for this competitor. The last version repeats once the sequence ends. */
export async function nextListing(
  db: Db,
  sequences: Record<string, Listing[]>,
  competitorId: string,
): Promise<Listing | null> {
  const sequence = sequences[competitorId];
  if (!sequence?.length) return null;
  const index = await db.cursor(competitorId);
  const listing = sequence[Math.min(index, sequence.length - 1)];
  await db.setCursor(competitorId, Math.min(index + 1, sequence.length));
  return { ...listing };
}
