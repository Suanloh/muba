/**
 * Data-layer tests — Supabase wiring + honest offline fallback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMovaDb, isSupabaseConfigured, MovaEdgeClient } from "./index.js";

const baseIntent = {
  id: "rec-1",
  correlationId: "corr-1",
  intentRef: "PAY-2026-0001",
  source: "CHAT" as const,
  rawText: "Pay Alice 200 USDC",
  network: "SUI_TESTNET",
  status: "AWAITING_APPROVAL",
  failureCode: null,
  walletAddress: "0xabc",
  meta: { amount: { asset: "USDC", amount: "200000000" } },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("isSupabaseConfigured: url+key => online, missing => offline", () => {
  assert.equal(
    isSupabaseConfigured({ url: "https://abc.supabase.co", anonKey: "anon" }),
    true,
  );
  assert.equal(isSupabaseConfigured({ url: "https://abc.supabase.co", anonKey: "" }), false);
  assert.equal(isSupabaseConfigured({ url: "" }), false);
  assert.equal(isSupabaseConfigured({}), false);
});

test("createMovaDb: unconfigured => offline mode reports offline results", async () => {
  const db = createMovaDb({});
  assert.equal(db.status, "offline");
  assert.ok(db.reason?.includes("not configured"));
  const r = await db.syncIntent(baseIntent);
  assert.equal(r.ok, false);
  assert.equal(r.offline, true);
  const rows = await db.listAudit("corr-1");
  assert.deepEqual(rows, []);
  const unsub = db.subscribeToStatus(() => {});
  assert.equal(typeof unsub, "function");
});

test("MovaEdgeClient: pushes intent via the Edge Function (stubbed fetch)", async () => {
  const seen: { captured: { url: string; body: unknown } | null } = { captured: null };
  const fetchImpl = (async (input: unknown, init?: unknown) => {
    const opts = init as { body?: string } | undefined;
    seen.captured = { url: String(input), body: opts?.body ? JSON.parse(opts.body) : null };
    return new Response(JSON.stringify({ ok: true, written: 1 }), { status: 200 });
  }) as typeof fetch;

  const edge = new MovaEdgeClient({
    url: "https://abc.supabase.co",
    anonKey: "anon-key",
    fetchImpl,
  });
  const res = await edge.pushIntent(baseIntent);
  assert.equal(res.ok, true);
  assert.equal(res.written, 1);
  assert.ok(seen.captured?.url.endsWith("/functions/v1/mova-sync"));
  assert.deepEqual((seen.captured?.body as { kind: string }).kind, "intent");
});

test("MovaEdgeClient: audit read decodes { items }", async () => {
  const fetchImpl = (async (input: unknown) => {
    const s = String(input);
    assert.ok(s.includes("kind=audit"));
    assert.ok(s.includes("correlationId=corr-1"));
    return new Response(JSON.stringify({ items: [{ event_type: "SETTLED" }] }), { status: 200 });
  }) as typeof fetch;

  const edge = new MovaEdgeClient({ url: "https://abc.supabase.co", anonKey: "k", fetchImpl });
  const items = await edge.listAudit("corr-1");
  assert.equal(items.length, 1);
  assert.equal((items[0] as { event_type: string }).event_type, "SETTLED");
});

test("MovaEdgeClient: history read decodes { intents, receipts, audit }", async () => {
  const fetchImpl = (async (input: unknown) => {
    assert.ok(String(input).includes("kind=history"));
    return new Response(
      JSON.stringify({
        intents: [{ id: "i1" }],
        receipts: [{ id: "r1" }],
        audit: [{ id: "a1" }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const edge = new MovaEdgeClient({ url: "https://abc.supabase.co", anonKey: "k", fetchImpl });
  const history = await edge.listHistory();
  assert.equal(history.intents.length, 1);
  assert.equal(history.receipts.length, 1);
  assert.equal(history.audit.length, 1);
});

test("MovaEdgeClient: history read on error returns an empty snapshot", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  const edge = new MovaEdgeClient({ url: "https://abc.supabase.co", anonKey: "k", fetchImpl });
  const history = await edge.listHistory();
  assert.deepEqual(history, { intents: [], receipts: [], audit: [] });
});

test("MovaEdgeClient: non-ok response surfaces an honest error", async () => {
  const fetchImpl = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  const edge = new MovaEdgeClient({ url: "https://abc.supabase.co", anonKey: "k", fetchImpl });
  const res = await edge.pushReceipt({
    id: "r1",
    correlationId: "c1",
    ownerAddress: "0x",
    amountAsset: "USDC",
    amountAmount: "1",
    recipient: "0x",
    network: "SUI_TESTNET",
    txDigest: null,
    simulated: true,
    issuedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes("500"));
});

test("createMovaDb: configured => online mode uses the edge client", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ ok: true, written: 2 }), { status: 200 })) as typeof fetch;
  const db = createMovaDb({ url: "https://abc.supabase.co", anonKey: "k", fetchImpl });
  assert.equal(db.status, "online");
  const r = await db.syncAudit({
    id: "a1",
    correlationId: "corr-1",
    entityType: "PAYMENT_INTENT",
    entityId: "rec-1",
    eventType: "SETTLED",
    actorType: "SYSTEM",
    actorId: "state-machine",
    payload: {},
    previousState: "EXECUTING",
    newState: "SETTLED",
    simulated: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(r.ok, true);
  assert.equal(r.written, 2);
});
