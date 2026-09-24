export type Listing = {
  title: string;
  tagline: string;
  price: string;
  description: string;
};

export type SummaryStatus = "skipped" | "pending" | "ready" | "failed";

export type Snapshot = Listing & {
  fetchedAt: string;
  changed: boolean;
  summary: string | null;
  summaryStatus: SummaryStatus;
};

export type Decision =
  | { action: "skip" }
  | { action: "store"; changed: boolean };
