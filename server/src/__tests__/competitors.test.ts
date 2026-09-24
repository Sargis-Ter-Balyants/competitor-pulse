import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import type { Db } from "../db/db.js";
import { createApp } from "../http/server.js";
import type { LiveHub } from "../live/hub.js";
import { Poller } from "../services/poller.js";
import type { Listing } from "../types.js";
import { openTestDb } from "./helpers.js";

const v1: Listing = { title: "Acme", tagline: "Simple", price: "$29/mo", description: "Leads." };
const v2: Listing = { title: "Acme", tagline: "Simple", price: "$39/mo", description: "Leads." };

const silentLive: LiveHub = {
  attach: () => {},
  pushCompetitors: async () => {},
  pushSnapshots: async () => {},
  dropCompetitor: () => {},
  close: () => {},
};

let db: Db;
let closeDb: () => Promise<void>;
let baseUrl: string;
let server: ReturnType<typeof createApp>;

before(async () => {
  ({ db, close: closeDb } = await openTestDb());
  const poller = new Poller({ db, sequences: { "acme-crm": [v1, v2] }, maxAttempts: 3, summarize: async () => "Price changed." });
  server = createApp({ db, poller, live: silentLive, knownIds: ["acme-crm"], maxAttempts: 3 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
});

beforeEach(async () => {
  await db.removeCompetitor("acme-crm");
});

function post(id: unknown) {
  return fetch(`${baseUrl}/api/competitors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

test("adding a known competitor stores the first snapshot", async () => {
  const response = await post("acme-crm");
  assert.equal(response.status, 201);

  const snapshots = await (await fetch(`${baseUrl}/api/competitors/acme-crm/snapshots`)).json();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].price, "$29/mo");
  assert.equal(snapshots[0].summaryStatus, "skipped");
});

test("adding rejects malformed, unknown, and duplicate ids", async () => {
  assert.equal((await post("Not A Slug")).status, 400);
  assert.equal((await post("north-analytics")).status, 400);
  assert.equal((await post("acme-crm")).status, 201);
  assert.equal((await post("acme-crm")).status, 409);
});

test("a non-JSON body is a 400, not a 500", async () => {
  const response = await fetch(`${baseUrl}/api/competitors`, { method: "POST", body: "{not json" });
  assert.equal(response.status, 400);
});

test("removing a competitor deletes its history and restarts the sequence", async () => {
  await post("acme-crm");
  assert.equal((await fetch(`${baseUrl}/api/competitors/acme-crm`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${baseUrl}/api/competitors/acme-crm/snapshots`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/competitors/acme-crm`, { method: "DELETE" })).status, 404);

  await post("acme-crm");
  const snapshots = await (await fetch(`${baseUrl}/api/competitors/acme-crm/snapshots`)).json();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].price, "$29/mo");
});
