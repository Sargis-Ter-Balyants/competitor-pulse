import { config } from "./config.js";
import { Db } from "./db/db.js";
import { createApp } from "./http/server.js";
import { createLiveHub } from "./live/hub.js";
import { readListings } from "./services/listings.js";
import { summarizeChange } from "./services/llm.js";
import { Poller } from "./services/poller.js";

const sequences = readListings(config.listingsPath);
const knownIds = Object.keys(sequences).sort();
const db = await Db.open(config.databaseUrl, config.migrationsDir);
const live = createLiveHub({
  db,
  knownIds,
  pollIntervalMs: config.pollIntervalMs,
  maxAttempts: config.summaryMaxAttempts,
});
const poller = new Poller({
  db,
  sequences,
  summarize: summarizeChange,
  maxAttempts: config.summaryMaxAttempts,
  onUpdate: (competitorId) => {
    live.pushSnapshots([competitorId]).catch((error: unknown) => console.error("live push failed:", error));
  },
});

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await poller.pollAll();
  } catch (error) {
    console.error("poll failed:", error);
  } finally {
    ticking = false;
  }
}

const server = createApp({
  db,
  poller,
  knownIds,
  maxAttempts: config.summaryMaxAttempts,
  live,
  staticDir: config.staticDir,
});
live.attach(server);

server.listen(config.port, () => {
  console.log(`CompetitorPulse listening on :${config.port}`);
  console.log(`Polling every ${config.pollIntervalMs}ms, LLM at ${config.llmBaseUrl}`);
});

const timer = setInterval(() => void tick(), config.pollIntervalMs);
timer.unref();

function shutdown(): void {
  clearInterval(timer);
  live.close();
  server.close();
  void db.close().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
