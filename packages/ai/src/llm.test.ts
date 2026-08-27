/**
 * LLM structured-output tests — schema guard, no-executable-instructions, retry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IntentParserContext, RecipientRef } from "@mova/types";
import {
  buildExtractionSchema,
  isLlmExtraction,
  parseWithLlm,
} from "./llm.js";

const addr = (prefix: string) => `0x${prefix.padEnd(64, "0")}`;

const CONTACTS: Record<string, RecipientRef> = {
  alice: { type: "ADDRESS", value: addr("a11ce"), name: "Alice" },
};

const ctx: IntentParserContext = {
  userId: "u1",
  walletId: "w1",
  network: "SUI_TESTNET",
  resolveRecipient: (n) => CONTACTS[n] ?? null,
};

function fakeFetch(body: unknown, ok = true) {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "ERR",
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }),
  })) as unknown as typeof fetch;
}

test("schema has no executable instruction fields", () => {
  const schema = buildExtractionSchema() as { properties: Record<string, unknown>; required: string[] };
  const keys = Object.keys(schema.properties);
  for (const forbidden of ["bytes", "payload", "instructions", "calls", "gas", "transaction", "data"]) {
    assert.ok(!keys.some((k) => k.toLowerCase().includes(forbidden)), `${forbidden} must not appear in the schema`);
  }
  assert.ok(schema.required.includes("needsClarification"));
});

test("isLlmExtraction guards shape", () => {
  assert.equal(isLlmExtraction({ action: "PAY", amountRaw: "200", currencyInput: "USDC", needsClarification: false }), true);
  assert.equal(isLlmExtraction({ action: "EXECUTE_TX", bytes: "0x…" }), false);
  assert.equal(isLlmExtraction("nonsense"), false);
});

test("parseWithLlm maps structured output into a normalized proposal", async () => {
  const p = await parseWithLlm("Pay Alice 200 USDC", ctx, {
    apiKey: "test-key",
    fetchImpl: fakeFetch({
      action: "PAY",
      amountRaw: "200",
      currencyInput: "USDC",
      recipient: { type: "NAME", value: "alice", name: "Alice" },
      needsClarification: false,
    }),
  });
  assert.ok(p);
  assert.equal(p.amountRaw, "200");
  assert.equal(p.currencyInput, "USDC");
  assert.equal(p.recipient.name, "Alice");
  assert.equal(p.recipient.type, "ADDRESS"); // resolved via contact book
  assert.deepEqual(p.rawLlmOutput, {
    action: "PAY",
    amountRaw: "200",
    currencyInput: "USDC",
    recipient: { type: "NAME", value: "alice", name: "Alice" },
    needsClarification: false,
  });
});

test("no api key -> null (caller falls back to deterministic)", async () => {
  const p = await parseWithLlm("Pay Alice 200 USDC", ctx, { apiKey: "" });
  assert.equal(p, null);
});

test("invalid structured output after retry throws", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"action":"EXECUTE_TX"}' }] } }] }),
    };
  }) as unknown as typeof fetch;

  await assert.rejects(
    parseWithLlm("Pay Alice 200 USDC", ctx, { apiKey: "k", fetchImpl }),
    /invalid structured output/,
  );
  assert.equal(calls, 2); // retried once
});
