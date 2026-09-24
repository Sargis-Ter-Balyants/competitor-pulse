# CompetitorPulse

Tracks competitor listings over time. When a listing changes, the backend asks an LLM for a short plain-English summary and stores it with the snapshot.

## Run locally

Requires Node.js 22.13+ (built-in `node:sqlite`).

```bash
npm install
npm run dev
```

That starts the mock LLM, the API, and the web app in one process. Stop them with Ctrl+C. To run a piece on its own: `node mock-llm/server.mjs`, `npm run dev:server`, or `npm run dev:web`.

Open http://localhost:5173. Add `acme-crm`, `north-analytics`, or `ferry-pay`. The first snapshot appears immediately; later versions arrive on the poll interval (default 15 seconds).

```bash
npm test
npm run build && STATIC_DIR=web/dist npm start
```

### Docker

```bash
docker compose up --build
```

The app and the mock LLM start together. Open http://localhost:3000.

## LLM

The default client talks to the provided mock server at `http://localhost:4001/v1` (model `mock-llm`, any API key). It speaks the OpenAI Chat Completions API, so a real provider is a config change:

```bash
LLM_BASE_URL=https://api.openai.com/v1 LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini npm run dev:server
```

| Variable | Default |
| --- | --- |
| `PORT` | `3000` |
| `POLL_INTERVAL_MS` | `15000` (use `900000` for every 15 minutes) |
| `DATABASE_PATH` | `data/competitor-pulse.db` |
| `LLM_BASE_URL` | `http://localhost:4001/v1` |
| `LLM_API_KEY` | `mock` |
| `LLM_MODEL` | `mock-llm` |
| `LLM_TIMEOUT_MS` | `10000` |
| `SUMMARY_MAX_ATTEMPTS` | `3` |
| `STATIC_DIR` | unset (set to serve the built frontend) |

## Assumptions

- Only ids present in `fixtures/listings.json` can be tracked. The fixture stub returns the next canned version per id and keeps returning the last one.
- The first snapshot is stored with `changed: false` and no summary. An identical fetch is not stored and does not call the LLM, so polling past the last version does not grow the timeline.
- A changed snapshot is committed before the LLM call. A timeout or HTTP failure leaves `summary: null` and is retried on a later tick, up to `SUMMARY_MAX_ATTEMPTS`. The poll loop does not wait on the model.
- The listing cursor is stored in SQLite, so a restart continues the sequence instead of replaying it.
- Removing a competitor deletes its snapshots and cursor. Adding it again starts at version 1.
- One process owns the scheduler. SQLite is enough for a few hundred competitors every 15 minutes; run a single poller so two instances cannot double-fetch.

## Layout

- `server/` — HTTP API, SQLite migrations, poller, LLM client
- `web/` — React list and timeline
- `fixtures/listings.json` — canned listings
- `mock-llm/` — Node mock LLM (`server.mjs`)
- Live updates use a WebSocket at `/api/live`. The UI subscribes to the open competitor and receives new snapshots without polling.

AI tools used: Cursor, with Grok 4.7.
