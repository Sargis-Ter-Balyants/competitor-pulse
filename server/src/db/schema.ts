import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const competitors = pgTable("competitors", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const snapshots = pgTable(
  "snapshots",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    title: text("title").notNull(),
    tagline: text("tagline").notNull(),
    price: text("price").notNull(),
    description: text("description").notNull(),
    changed: boolean("changed").notNull(),
    summary: text("summary"),
    summaryAttempts: integer("summary_attempts").notNull().default(0),
  },
  (table) => [index("snapshots_competitor_id_idx").on(table.competitorId, table.id.desc())],
);

/** Position in the canned listing sequence, so a restart continues instead of replaying. */
export const listingCursors = pgTable("listing_cursors", {
  competitorId: text("competitor_id")
    .primaryKey()
    .references(() => competitors.id, { onDelete: "cascade" }),
  nextIndex: integer("next_index").notNull(),
});
