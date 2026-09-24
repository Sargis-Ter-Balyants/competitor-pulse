import { createServer } from "node:http";
import { handleCompetitors, type CompetitorsDeps } from "../controllers/competitors.js";
import { HttpError, send } from "./respond.js";
import { serveStatic } from "./static.js";

export type AppDeps = CompetitorsDeps & { staticDir?: string };

export function createApp(deps: AppDeps) {
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    try {
      if (await handleCompetitors(deps, req, res, pathname)) return;
      if (req.method === "GET" && deps.staticDir && !pathname.startsWith("/api/")) {
        serveStatic(deps.staticDir, pathname, res);
        return;
      }
      send(res, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof HttpError) {
        send(res, error.status, { error: error.message });
        return;
      }
      console.error(error);
      if (!res.headersSent) send(res, 500, { error: "Internal server error" });
    }
  });
}
