import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { summarizeChange } from "../services/llm.js";
import type { Listing } from "../types.js";

const previous: Listing = { title: "Acme", tagline: "Simple", price: "$29/mo", description: "Leads." };
const next: Listing = { ...previous, price: "$39/mo" };
const realFetch = globalThis.fetch;

function respondWith(status: number, body: unknown): void {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("returns the trimmed completion text", async () => {
  respondWith(200, { choices: [{ message: { content: "  Price rose to $39/mo.  " } }] });
  assert.equal(await summarizeChange(previous, next), "Price rose to $39/mo.");
});

test("sends both listings so the model can compare them", async () => {
  let sent = "";
  globalThis.fetch = async (_url, init) => {
    sent = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  };
  await summarizeChange(previous, next);
  assert.match(sent, /\$29\/mo/);
  assert.match(sent, /\$39\/mo/);
});

test("throws on an HTTP error so the poller can retry", async () => {
  respondWith(500, { error: "boom" });
  await assert.rejects(summarizeChange(previous, next), /HTTP 500/);
});

test("throws when the completion is empty", async () => {
  respondWith(200, { choices: [{ message: { content: "   " } }] });
  await assert.rejects(summarizeChange(previous, next), /did not include a summary/);
});
