import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

export const config = {
  port: integer("PORT", 3000),
  pollIntervalMs: integer("POLL_INTERVAL_MS", 15_000),
  summaryMaxAttempts: integer("SUMMARY_MAX_ATTEMPTS", 3),
  llmTimeoutMs: integer("LLM_TIMEOUT_MS", 10_000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres",
  listingsPath: process.env.LISTINGS_PATH ?? path.join(repoRoot, "fixtures", "listings.json"),
  migrationsDir: path.join(repoRoot, "server", "migrations"),
  llmBaseUrl: (process.env.LLM_BASE_URL ?? "http://localhost:4001/v1").replace(/\/$/, ""),
  llmApiKey: process.env.LLM_API_KEY ?? "mock",
  llmModel: process.env.LLM_MODEL ?? "mock-llm",
  staticDir: process.env.STATIC_DIR,
};
