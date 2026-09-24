import { createApp } from "./api.js";
import { config } from "./config.js";
import { Db } from "./db.js";
import { summarizeChange } from "./llm.js";
import { createLiveHub } from "./live.js";
import { Poller } from "./poller.js";
import { readListings } from "./source.js";

const sequences = readListings(config.listingsPath);
const knownIds = Object.keys(sequences).sort();
const db = new Db(config.databasePath, config.migrationsDir);
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
  onUpdate: (competitorId) => live.pushSnapshots([competitorId]),
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
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
