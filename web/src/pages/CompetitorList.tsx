import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { messageOf } from "../lib/format-error";
import { useLive } from "../live/LiveProvider";

export function CompetitorList() {
  const { competitors, fixtureIds, pollIntervalMs } = useLive();
  const [id, setId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function onAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextId = id.trim();
    if (!nextId) return;
    setPending(true);
    setError(null);
    try {
      await api.addCompetitor(nextId);
      setId("");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  async function onRemove(competitorId: string): Promise<void> {
    setError(null);
    try {
      await api.removeCompetitor(competitorId);
      setConfirmingId(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  const intervalLabel = pollIntervalMs === null ? "on a timer" : `every ${Math.round(pollIntervalMs / 1000)}s`;

  return (
    <section>
      <form className="add-form" onSubmit={(event) => void onAdd(event)}>
        <label htmlFor="competitor-id">Competitor id</label>
        <div className="add-row">
          <input
            id="competitor-id"
            name="id"
            list="known-competitors"
            value={id}
            placeholder="acme-crm"
            autoComplete="off"
            onChange={(event) => setId(event.target.value)}
          />
          <button type="submit" disabled={pending || id.trim() === ""}>
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
        <datalist id="known-competitors">
          {fixtureIds.map((fixtureId) => (
            <option key={fixtureId} value={fixtureId} />
          ))}
        </datalist>
        <p className="muted">
          Known competitors: {fixtureIds.length > 0 ? fixtureIds.join(", ") : "loading…"}. Listings are polled{" "}
          {intervalLabel}.
        </p>
      </form>

      {error ? <p className="error">{error}</p> : null}

      {competitors === null ? (
        <p className="card muted">Loading competitors…</p>
      ) : competitors.length === 0 ? (
        <p className="card muted">No competitors tracked yet.</p>
      ) : (
        <ul className="competitor-list">
          {competitors.map((competitor) => (
            <li key={competitor.id} className="card row">
              <Link to={`/competitors/${encodeURIComponent(competitor.id)}`}>{competitor.id}</Link>
              {confirmingId === competitor.id ? (
                <span className="confirm-actions">
                  <button type="button" onClick={() => void onRemove(competitor.id)}>
                    Confirm remove
                  </button>
                  <button type="button" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmingId(competitor.id)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
