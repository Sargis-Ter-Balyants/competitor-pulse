import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../domain/diff.js";
import { Poller } from "../services/poller.js";
import type { Listing } from "../types.js";
import { openTestDb } from "../helpers.js";

const v1: Listing = { title: "Acme", tagline: "Simple", price: "$29/mo", description: "Leads." };
const v2: Listing = { title: "Acme", tagline: "Simple", price: "$39/mo", description: "Leads." };

async function setup(sequences: Record<string, Listing[]>) {
  const { db, close } = await openTestDb();
  const calls: string[] = [];
  let failTimes = 0;
  const poller = new Poller({
    db,
    sequences,
    maxAttempts: 3,
    summarize: async () => {
      calls.push("call");
      if (failTimes > 0) {
        failTimes -= 1;
        throw new Error("injected");
      }
      return "Price changed.";
    },
  });
  return {
    db,
    poller,
    calls,
    failNext(times: number) {
      failTimes = times;
    },
    close,
  };
}

test("the first snapshot is unchanged and an identical fetch is skipped", () => {
  assert.deepEqual(decide(null, v1), { action: "store", changed: false });
  assert.deepEqual(decide(v1, v1), { action: "skip" });
  assert.deepEqual(decide(v1, v2), { action: "store", changed: true });
});

test("polling stores history, calls the LLM only on change, and repeats the last listing", async () => {
  const { db, poller, calls, close } = await setup({ "acme-crm": [v1, v2] });
  await db.addCompetitor("acme-crm");

  await poller.pollAll();
  await poller.drain();
  assert.equal(calls.length, 0);
  assert.equal((await db.listSnapshots("acme-crm"))[0]?.changed, false);
  assert.equal((await db.listSnapshots("acme-crm"))[0]?.summary, null);

  await poller.pollAll();
  await poller.drain();
  const [latest, first] = await db.listSnapshots("acme-crm");
  assert.equal(latest?.changed, true);
  assert.equal(latest?.price, "$39/mo");
  assert.equal(latest?.summary, "Price changed.");
  assert.equal(first?.changed, false);
  assert.equal(calls.length, 1);

  await poller.pollAll();
  await poller.drain();
  assert.equal((await db.listSnapshots("acme-crm")).length, 2);
  assert.equal(calls.length, 1);
  await close();
});

test("a failed summary leaves the snapshot in place and retries later", async () => {
  const { db, poller, calls, failNext, close } = await setup({ "acme-crm": [v1, v2] });
  await db.addCompetitor("acme-crm");
  failNext(1);

  await poller.pollAll();
  await poller.pollAll();
  await poller.drain();
  assert.equal((await db.listSnapshots("acme-crm")).length, 2);
  assert.equal((await db.listSnapshots("acme-crm"))[0]?.summary, null);

  await poller.pollAll();
  await poller.drain();
  assert.equal((await db.listSnapshots("acme-crm"))[0]?.summary, "Price changed.");
  assert.equal(calls.length, 2);
  await close();
});
