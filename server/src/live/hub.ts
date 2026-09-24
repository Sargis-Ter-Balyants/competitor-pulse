import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { Db } from "../db/db.js";

const LIVE_PATH = "/api/live";

type Client = { socket: WebSocket; watching: string | null };

export type LiveHub = {
  attach(server: Server): void;
  pushCompetitors(): Promise<void>;
  pushSnapshots(competitorIds: readonly string[]): Promise<void>;
  dropCompetitor(competitorId: string): void;
  close(): void;
};

export function createLiveHub(options: {
  db: Db;
  knownIds: string[];
  pollIntervalMs: number;
  maxAttempts: number;
}): LiveHub {
  const clients = new Set<Client>();
  let wss: WebSocketServer | undefined;

  function send(client: Client, body: unknown): void {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(body));
  }

  async function snapshots(competitorId: string) {
    return {
      type: "snapshots",
      competitorId,
      snapshots: await options.db.listSnapshots(competitorId, options.maxAttempts),
    };
  }

  return {
    attach(server) {
      wss = new WebSocketServer({ noServer: true });
      wss.on("connection", (socket) => {
        const client: Client = { socket, watching: null };
        clients.add(client);
        socket.on("message", (raw) => {
          (async () => {
            let message: { type?: string; competitorId?: string };
            try {
              message = JSON.parse(raw.toString()) as { type?: string; competitorId?: string };
            } catch {
              send(client, { type: "error", error: "Message must be JSON" });
              return;
            }
            if (message.type === "unsubscribe") {
              client.watching = null;
              return;
            }
            if (message.type !== "subscribe" || !message.competitorId) return;
            if (!(await options.db.hasCompetitor(message.competitorId))) {
              client.watching = null;
              send(client, {
                type: "error",
                competitorId: message.competitorId,
                error: `Competitor "${message.competitorId}" is not tracked`,
              });
              return;
            }
            client.watching = message.competitorId;
            send(client, await snapshots(message.competitorId));
          })().catch((error: unknown) => {
            console.error("live message failed:", error);
            send(client, { type: "error", error: "Could not load snapshots" });
          });
        });
        socket.on("close", () => clients.delete(client));
        options.db
          .listCompetitors()
          .then((competitors) => {
            send(client, {
              type: "connected",
              pollIntervalMs: options.pollIntervalMs,
              fixtureIds: options.knownIds,
              competitors,
            });
          })
          .catch((error: unknown) => console.error("live connect failed:", error));
      });

      server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname !== LIVE_PATH || !wss) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => wss?.emit("connection", ws, request));
      });
    },
    async pushCompetitors() {
      const body = { type: "competitors", competitors: await options.db.listCompetitors() };
      for (const client of clients) send(client, body);
    },
    async pushSnapshots(competitorIds) {
      for (const competitorId of new Set(competitorIds)) {
        const body = await snapshots(competitorId);
        for (const client of clients) {
          if (client.watching === competitorId) send(client, body);
        }
      }
    },
    dropCompetitor(competitorId) {
      for (const client of clients) {
        if (client.watching !== competitorId) continue;
        client.watching = null;
        send(client, {
          type: "error",
          competitorId,
          error: `Competitor "${competitorId}" is not tracked`,
        });
      }
    },
    close() {
      for (const client of clients) client.socket.close();
      clients.clear();
      wss?.close();
    },
  };
}
