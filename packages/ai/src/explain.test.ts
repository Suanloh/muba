/**
 * Explanation tests — MOVA states what it understood before confirmation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IntentParserContext, RecipientRef } from "@mova/types";
import { createPaymentConversation, processTurn } from "./conversation.js";
import { explainIntent } from "./explain.js";

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

test("explanation summarizes what MOVA understood", () => {
  const { result } = processTurn(createConversation(), "Pay Alice 200 USDC", ctx);
  const v = result.validated!;
  const p = result.proposal!;
  const ex = explainIntent(v, p);
  assert.match(ex.summary, /200 USDC/);
  assert.match(ex.summary, /Alice/);
  assert.match(ex.summary, /Sui Testnet/);
  const amount = ex.details.find((d) => d.label === "Amount");
  assert.equal(amount?.value, "200 USDC");
});

test("unstated network is marked inferred", () => {
  const { result } = processTurn(createConversation(), "Pay Alice 200 USDC", ctx);
  const ex = explainIntent(result.validated!, result.proposal!);
  const net = ex.details.find((d) => d.label === "Network");
  assert.equal(net?.source, "inferred");
});

test("explicit network is marked parsed", () => {
  const { result } = processTurn(createConversation(), "Pay Alice 200 USDC on Sui Mainnet", ctx);
  const ex = explainIntent(result.validated!, result.proposal!);
  const net = ex.details.find((d) => d.label === "Network");
  assert.equal(net?.source, "parsed");
  assert.match(net?.value ?? "", /Mainnet/);
});

test("missing fields surface in explanation notes + detail", () => {
  const { result } = processTurn(createConversation(), "Pay Alice", ctx);
  const ex = explainIntent(result.validated!, result.proposal!);
  const amount = ex.details.find((d) => d.label === "Amount");
  assert.equal(amount?.source, "missing");
});

test("fiat currency produces a conversion note", () => {
  const { result } = processTurn(createConversation(), "Send RM100 to Alice", ctx);
  const ex = explainIntent(result.validated!, result.proposal!);
  assert.ok(ex.notes.some((n) => /MYR/.test(n) || /fiat/.test(n)));
});

function createConversation() {
  return createPaymentConversation("test-session");
}
