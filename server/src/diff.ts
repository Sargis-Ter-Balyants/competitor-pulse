import type { Decision, Listing } from "./types.js";

const fields = ["title", "tagline", "price", "description"] as const;

export function listingsEqual(a: Listing, b: Listing): boolean {
  return fields.every((field) => a[field] === b[field]);
}

/** First observation is not a change. An identical fetch is ignored. */
export function decide(previous: Listing | null, next: Listing): Decision {
  if (!previous) return { action: "store", changed: false };
  if (listingsEqual(previous, next)) return { action: "skip" };
  return { action: "store", changed: true };
}
