/**
 * Walrus / MemWal tests — static store determinism, snapshot building,
 * real-provider fail-closed behavior, and the facade fallback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMemorySnapshot,
  MemWalMemoryStore,
  persistMemory,
  simulatedBlobId,
  StaticWalrusStoreProvider,
  WalrusHttpProvider,
} from "./walrus.js";
import { MovaError } from "@mova/logger";

const SAMPLE_INPUT = {
  recordId: "pay_abc123",
  correlationId: "corr-1",
  ownerAddress: "0xaaaa",
  amount: "20000000",
  asset: "USDC",
  recipient: "0xbbbb",
  network: "SUI_TESTNET",
  state: "SETTLED",
  planDigest: "digest123",
  txDigest: "tx999",
  simulated: true,
  createdAt: 1000,
  updatedAt: 2000,
  trail: [{ eventType: "SETTLED" }],
};

test("simulatedBlobId is deterministic per content", () => {
  const id1 = simulatedBlobId("hello world");
  const id2 = simulatedBlobId("hello world");
  const id3 = simulatedBlobId("hello world!");
  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.match(id1, /^mova-static-[0-9a-f]{16}-\d+$/);
});

test("StaticWalrusStoreProvider stores + reads back with simulated: true", async () => {
  const store = new StaticWalrusStoreProvider();
  const data = JSON.stringify({ a: 1 });
  const stored = await store.store(data);
  assert.equal(stored.simulated, true);
  assert.equal(stored.url, null);
  const read = await store.read(stored.blobId);
  assert.equal(read.simulated, true);
  assert.equal(read.text, data);
  // Unknown blob → honest failure (never a fake read).
  await assert.rejects(() => store.read("mova-static-nope"), MovaError);
});

test("buildMemorySnapshot is versioned + deterministic", () => {
  const snap = buildMemorySnapshot(SAMPLE_INPUT);
  assert.equal(snap.schema, "mova.memory.v1");
  assert.equal(snap.recordId, "pay_abc123");
  assert.equal(snap.state, "SETTLED");
  assert.equal(snap.txDigest, "tx999");
  assert.deepEqual(snap.trail, [{ eventType: "SETTLED" }]);
  // Serializable to JSON.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(snap)));
});

test("persistMemory returns a MemWalStoreResult with the snapshot", async () => {
  const store = new StaticWalrusStoreProvider();
  const res = await persistMemory(store, SAMPLE_INPUT);
  assert.equal(res.simulated, true);
  assert.equal(res.snapshot.recordId, "pay_abc123");
  assert.ok(res.blobId.length > 0);
  assert.ok(res.storedAt > 0);
});

test("MemWalMemoryStore defaults to static (honest fallback, no real call)", async () => {
  const memwal = new MemWalMemoryStore();
  assert.equal(memwal.useReal, false);
  const res = await memwal.persist(SAMPLE_INPUT);
  assert.equal(res.simulated, true);
  assert.equal(res.error, null);
  // Static blobs round-trip through read().
  const read = await memwal.read(res.blobId);
  assert.equal(read.text.includes("pay_abc123"), true);
});

test("WalrusHttpProvider is fail-closed on a bad endpoint (never fabricates)", async () => {
  const provider = new WalrusHttpProvider({
    publisherUrl: "https://127.0.0.1:1/nope",
    aggregatorUrl: "https://127.0.0.1:1/agg",
    timeoutMs: 500,
  });
  await assert.rejects(() => provider.store("x"), MovaError);
});

test("MemWalMemoryStore real path falls back to static with an honest error", async () => {
  const memwal = new MemWalMemoryStore({
    useReal: true,
    publisherUrl: "https://127.0.0.1:1/nope",
    aggregatorUrl: "https://127.0.0.1:1/agg",
  });
  const res = await memwal.persist(SAMPLE_INPUT);
  assert.equal(res.simulated, true, "fell back to static");
  assert.ok(res.error && res.error.includes("REAL Walrus unavailable"), "records the real failure");
  assert.ok(res.error && res.error.includes("static demo"), "is honest about the fallback");
});
