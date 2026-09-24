import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Db } from "./db/db.js";

const migrationsDir = path.join(fileURLToPath(new URL(".", import.meta.url)), "../../migrations");

/** A migrated, throwaway Postgres (PGlite) reached through the real `pg` driver. */
export async function openTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const postgres = await PGlite.create();
  const server = new PGLiteSocketServer({ db: postgres, port: 0, host: "127.0.0.1", maxConnections: 10 });
  await server.start();
  const db = await Db.open(`postgres://postgres:postgres@${server.getServerConn()}/postgres`, migrationsDir);
  return {
    db,
    async close() {
      await db.close();
      await server.stop();
      await postgres.close();
    },
  };
}
