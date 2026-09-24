import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { Db } from "./db.js";
import type { LiveHub } from "./live.js";
import type { Poller } from "./poller.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

type App = {
  db: Db;
  poller: Poller;
  knownIds: string[];
  maxAttempts: number;
  live: LiveHub;
  staticDir?: string;
};

export function createApp(app: App) {
  return createServer(async (req, res) => {
    try {
      await route(app, req, res);
    } catch (error) {
      console.error(error);
      send(res, 500, { error: "Internal server error" });
    }
  });
}

async function route(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;

  if (pathname === "/api/competitors" && req.method === "GET") {
    send(res, 200, app.db.listCompetitors());
    return;
  }

  if (pathname === "/api/competitors" && req.method === "POST") {
    const body = await readJson(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!ID_PATTERN.test(id)) {
      send(res, 400, { error: "Competitor id must be a lowercase slug, for example acme-crm" });
      return;
    }
    if (!app.knownIds.includes(id)) {
      send(res, 400, { error: `Unknown competitor. Known ids: ${app.knownIds.join(", ")}` });
      return;
    }
    if (!app.db.addCompetitor(id)) {
      send(res, 409, { error: "Competitor is already tracked" });
      return;
    }
    app.poller.pollOne(id);
    app.live.pushCompetitors();
    send(res, 201, { id });
    return;
  }

  const competitor = pathname.match(/^\/api\/competitors\/([^/]+)$/);
  if (competitor && req.method === "DELETE") {
    const id = decodeURIComponent(competitor[1]);
    if (!app.db.removeCompetitor(id)) {
      send(res, 404, { error: "Competitor not found" });
      return;
    }
    app.live.dropCompetitor(id);
    app.live.pushCompetitors();
    send(res, 204);
    return;
  }

  const snapshots = pathname.match(/^\/api\/competitors\/([^/]+)\/snapshots$/);
  if (snapshots && req.method === "GET") {
    const id = decodeURIComponent(snapshots[1]);
    if (!app.db.hasCompetitor(id)) {
      send(res, 404, { error: "Competitor not found" });
      return;
    }
    send(res, 200, app.db.listSnapshots(id, app.maxAttempts));
    return;
  }

  if (req.method === "GET" && app.staticDir && !pathname.startsWith("/api/")) {
    serveStatic(app.staticDir, pathname, res);
    return;
  }

  send(res, 404, { error: "Not found" });
}

function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  const rootPath = path.resolve(root);
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(rootPath, requested);
  const safe = filePath.startsWith(rootPath + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  const target = safe ? filePath : path.join(rootPath, "index.html");
  if (!fs.existsSync(target)) {
    send(res, 404, { error: "Not found" });
    return;
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  res.writeHead(200, { "Content-Type": types[path.extname(target)] ?? "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<{ id?: unknown }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((size, part) => size + part.length, 0) > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id?: unknown });
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}
