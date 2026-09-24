import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { send } from "./respond.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Serves the built SPA. Unknown paths fall back to index.html so client-side routes work. */
export function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  const rootPath = path.resolve(root);
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(rootPath, requested);
  const safe = filePath.startsWith(rootPath + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  const target = safe ? filePath : path.join(rootPath, "index.html");
  if (!fs.existsSync(target)) {
    send(res, 404, { error: "Not found" });
    return;
  }
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(target)] ?? "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
}
