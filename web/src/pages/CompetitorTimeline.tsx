import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import type { Snapshot } from "../api/client";
import { useLive } from "../live/LiveProvider";

export function CompetitorTimeline() {
  const { id = "" } = useParams();
  const { watch, snapshotsFor, errorFor } = useLive();
  const snapshots = snapshotsFor(id);
  const error = errorFor(id);

  useEffect(() => {
    watch(id);
    return () => watch(null);
  }, [id, watch]);

  return (
    <section>
      <p>
        <Link to="/">Back to competitors</Link>
      </p>
      <h2>{id}</h2>
      {error ? <p className="error">{error}</p> : null}
      {snapshots === null && !error ? <p className="muted">Loading snapshots…</p> : null}
      {snapshots?.length === 0 ? (
        <p className="card muted">No snapshots yet. The first poll runs as soon as tracking starts.</p>
      ) : null}
      <ol className="timeline">
        {snapshots?.map((snapshot, index) => (
          <li key={`${snapshot.fetchedAt}-${index}`} className="card">
            <div className="row">
              <time dateTime={snapshot.fetchedAt}>{formatTime(snapshot.fetchedAt)}</time>
              <span className={snapshot.changed ? "badge changed" : "badge"}>
                {snapshot.changed ? "Changed" : "No change"}
              </span>
            </div>
            <dl>
              <dt>Title</dt>
              <dd>{snapshot.title}</dd>
              <dt>Tagline</dt>
              <dd>{snapshot.tagline}</dd>
              <dt>Price</dt>
              <dd>{snapshot.price}</dd>
              <dt>Description</dt>
              <dd>{snapshot.description}</dd>
            </dl>
            <p className="summary">{summaryText(snapshot)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function summaryText(snapshot: Snapshot): string {
  if (!snapshot.changed || snapshot.summaryStatus === "skipped") return "No change";
  if (snapshot.summary) return snapshot.summary;
  if (snapshot.summaryStatus === "failed") return "Summary unavailable. The listing snapshot was saved.";
  return "Summary pending…";
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}
