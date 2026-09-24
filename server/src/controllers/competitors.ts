import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "../db/db.js";
import { readJson, send } from "../http/respond.js";
import type { LiveHub } from "../live/hub.js";
import type { Poller } from "../services/poller.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COMPETITOR_PATH = /^\/api\/competitors\/([^/]+)$/;
const SNAPSHOTS_PATH = /^\/api\/competitors\/([^/]+)\/snapshots$/;

export type CompetitorsDeps = {
  db: Db;
  poller: Poller;
  live: LiveHub;
  knownIds: readonly string[];
  maxAttempts: number;
};

/** Handles /api/competitors routes. Returns false when the request is not one of them. */
export async function handleCompetitors(
  deps: CompetitorsDeps,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === "/api/competitors") {
    if (req.method === "GET") {
      send(res, 200, await deps.db.listCompetitors());
      return true;
    }
    if (req.method === "POST") {
      await addCompetitor(deps, req, res);
      return true;
    }
  }

  const competitor = pathname.match(COMPETITOR_PATH);
  if (competitor && req.method === "DELETE") {
    await removeCompetitor(deps, res, decodeURIComponent(competitor[1]));
    return true;
  }

  const snapshots = pathname.match(SNAPSHOTS_PATH);
  if (snapshots && req.method === "GET") {
    await listSnapshots(deps, res, decodeURIComponent(snapshots[1]));
    return true;
  }

  return false;
}

async function addCompetitor(deps: CompetitorsDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!ID_PATTERN.test(id)) {
    send(res, 400, { error: "Competitor id must be a lowercase slug, for example acme-crm" });
    return;
  }
  if (!deps.knownIds.includes(id)) {
    send(res, 400, { error: `Unknown competitor. Known ids: ${deps.knownIds.join(", ")}` });
    return;
  }
  if (!(await deps.db.addCompetitor(id))) {
    send(res, 409, { error: "Competitor is already tracked" });
    return;
  }
  await deps.poller.pollOne(id);
  await deps.live.pushCompetitors();
  send(res, 201, { id });
}

async function removeCompetitor(deps: CompetitorsDeps, res: ServerResponse, id: string): Promise<void> {
  if (!(await deps.db.removeCompetitor(id))) {
    send(res, 404, { error: "Competitor not found" });
    return;
  }
  deps.live.dropCompetitor(id);
  await deps.live.pushCompetitors();
  send(res, 204);
}

async function listSnapshots(deps: CompetitorsDeps, res: ServerResponse, id: string): Promise<void> {
  if (!(await deps.db.hasCompetitor(id))) {
    send(res, 404, { error: "Competitor not found" });
    return;
  }
  send(res, 200, await deps.db.listSnapshots(id, deps.maxAttempts));
}
