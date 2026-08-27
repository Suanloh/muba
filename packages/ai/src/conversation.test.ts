/**
 * Conversation context tests — lightweight session, follow-ups, confirm/cancel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IntentParserContext, RecipientRef } from "@mova/types";
import { createPaymentConversation, detectMetaIntent, processTurn } from "./conversation.js";

const addr = (prefix: string) => `0x${prefix.padEnd(64, "0")}`;

const CONTACTS: Record<string, RecipientRef> = {
  alice: { type: "ADDRESS", value: addr("a11ce"), name: "Alice" },
  bob: { type: "ADDRESS", value: addr("b0b0"), name: "Bob" },
};

const ctx: IntentParserContext = {
  userId: "u1",
  walletId: "w1",
  network: "SUI_TESTNET",
  resolveRecipient: (n) => CONTACTS[n] ?? null,
};

test("detectMetaIntent: confirm / cancel / none", () => {
  assert.equal(detectMetaIntent("yes"), "confirm");
  assert.equal(detectMetaIntent("confirm"), "confirm");
  assert.equal(detectMetaIntent("send it"), "confirm");
  assert.equal(detectMetaIntent("cancel"), "cancel");
  assert.equal(detectMetaIntent("no"), "cancel");
  assert.equal(detectMetaIntent("Pay 10 SUI to Alice"), "none");
});

test("first turn parses + validates a complete intent", () => {
  const conv = createPaymentConversation();
  const { conversation, result } = processTurn(conv, "Pay Alice 200 USDC", ctx);
  assert.equal(result.validated?.ok, true);
  assert.equal(result.validated?.canonicalAmount?.amount, "200000000");
  assert.equal(conversation.workingIntent?.ok, true);
  assert.equal(conversation.turns.length, 2);
});

test("follow-up completes a missing field from context", () => {
  let conv = createPaymentConversation();
  ({ conversation: conv } = processTurn(conv, "Pay 200 to Alice", ctx));
  assert.equal(conv.workingIntent?.ok, false); // no currency yet

  ({ conversation: conv } = processTurn(conv, "in USDC", ctx));
  const v = conv.workingIntent;
  assert.equal(v?.ok, true);
  assert.equal(v?.canonicalAmount?.asset, "USDC");
  assert.equal(v?.canonicalAmount?.amount, "200000000");
});

test("correction marker updates amount without conflict", () => {
  let conv = createPaymentConversation();
  ({ conversation: conv } = processTurn(conv, "Pay Alice 200 USDC", ctx));
  ({ conversation: conv } = processTurn(conv, "actually make it 300", ctx));
  const v = conv.workingIntent;
  assert.equal(v?.ok, true);
  assert.equal(v?.canonicalAmount?.amount, "300000000");
  assert.ok(!v?.errors.some((e) => e.code === "CONFLICTING_INSTRUCTIONS"));
  // context-filled follow-ups must not inherit a stale clarification
  assert.equal(v?.needsClarification, false);
  assert.equal(v?.clarificationQuestion, null);
});

test("uncorrected differing amount -> cross-turn conflict (warning path is error)", () => {
  let conv = createPaymentConversation();
  ({ conversation: conv } = processTurn(conv, "Pay Alice 200 USDC", ctx));
  ({ conversation: conv } = processTurn(conv, "send 300 to Bob", ctx));
  const v = conv.workingIntent;
  assert.equal(v?.ok, false);
  assert.ok(v?.errors.some((e) => e.code === "CONFLICTING_INSTRUCTIONS"));
});

test("recipient change with 'instead' is a clean correction", () => {
  let conv = createPaymentConversation();
  ({ conversation: conv } = processTurn(conv, "Pay Alice 200 USDC", ctx));
  ({ conversation: conv } = processTurn(conv, "send to Bob instead", ctx));
  const v = conv.workingIntent;
  assert.equal(v?.ok, true);
  assert.equal(v?.proposal?.recipient.name, "Bob");
});

test("confirm sets confirmed only when a valid intent exists", () => {
  let conv = createPaymentConversation();
  ({ conversation: conv } = processTurn(conv, "Pay Alice 200 USDC", ctx));
  ({ conversation: conv } = processTurn(conv, "yes", ctx));
  assert.equal(conv.confirmed, true);
});

test("confirm without a valid draft is refused", () => {
  let conv = createPaymentConversation();
  ({ conversation: conv } = processTurn(conv, "yes", ctx));
  assert.equal(conv.confirmed, false);
  assert.equal(conv.workingIntent, null);
});

test("cancel resets the working intent", () => {
  let conv = createPaymentConversation();
  ({ conversation: conv } = processTurn(conv, "Pay Alice 200 USDC", ctx));
  assert.equal(conv.workingIntent?.ok, true);
  ({ conversation: conv } = processTurn(conv, "cancel", ctx));
  assert.equal(conv.workingIntent, null);
  assert.equal(conv.confirmed, false);
});

test("turns are appended (lightweight, session-scoped)", () => {
  let conv = createPaymentConversation();
  ({ conversation: conv } = processTurn(conv, "Pay Alice 200 USDC", ctx));
  ({ conversation: conv } = processTurn(conv, "yes", ctx));
  const roles = conv.turns.map((t) => t.role);
  assert.deepEqual(roles, ["user", "mova", "user", "mova"]);
});
