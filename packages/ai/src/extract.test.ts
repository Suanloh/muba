/**
 * Deterministic NL extractor tests — the Phase 2 example inputs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IntentParserContext, RecipientRef } from "@mova/types";
import { extractStructuredProposal } from "./extract.js";

const addr = (prefix: string) => `0x${prefix.padEnd(64, "0")}`;

const CONTACTS: Record<string, RecipientRef> = {
  alice: { type: "ADDRESS", value: addr("a11ce"), name: "Alice" },
  bob: { type: "ADDRESS", value: addr("b0b0"), name: "Bob" },
  treasury: { type: "ADDRESS", value: addr("7c"), name: "Treasury" },
};

const ctx: IntentParserContext = {
  userId: "u1",
  walletId: "w1",
  network: "SUI_TESTNET",
  resolveRecipient: (name) => CONTACTS[name] ?? null,
};

test('"Pay Alice $200 USDC." — amount, token, resolved recipient', () => {
  const p = extractStructuredProposal("Pay Alice $200 USDC.", ctx);
  assert.equal(p.action, "PAY");
  assert.equal(p.amountRaw, "200");
  assert.equal(p.currencyInput, "USDC");
  assert.equal(p.recipient.type, "ADDRESS");
  assert.equal(p.recipient.name, "Alice");
  assert.equal(p.recipient.resolved, true);
  assert.equal(p.needsClarification, false);
});

test('"Send RM100 to Bob." — fiat currency + resolved recipient', () => {
  const p = extractStructuredProposal("Send RM100 to Bob.", ctx);
  assert.equal(p.action, "TRANSFER");
  assert.equal(p.amountRaw, "100");
  assert.equal(p.currencyInput, "RM");
  assert.equal(p.recipient.name, "Bob");
});

test('"Pay this merchant." — ambiguous recipient, missing amount', () => {
  const p = extractStructuredProposal("Pay this merchant.", ctx);
  assert.equal(p.amountRaw, null);
  assert.equal(p.recipient.ambiguous, true);
  assert.equal(p.needsClarification, true);
  assert.ok(p.clarificationQuestion);
});

test('"Send 50 USDC to this wallet on Sui." — ambiguous wallet, expected network', () => {
  const p = extractStructuredProposal("Send 50 USDC to this wallet on Sui.", ctx);
  assert.equal(p.amountRaw, "50");
  assert.equal(p.currencyInput, "USDC");
  assert.equal(p.recipient.ambiguous, true);
  assert.equal(p.network, "SUI_TESTNET"); // bare "Sui" → expected network
  assert.equal(p.networkMentioned, "supported");
});

test("explicit Sui address recipient", () => {
  const p = extractStructuredProposal(
    "Pay 10 SUI to 0x3a4d2f9c1e8b7a6f5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2",
    ctx,
  );
  assert.equal(p.amountRaw, "10");
  assert.equal(p.currencyInput, "SUI");
  assert.equal(p.recipient.type, "ADDRESS");
  assert.equal(p.recipient.value, "0x3a4d2f9c1e8b7a6f5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2");
});

test("email recipient", () => {
  const p = extractStructuredProposal("Send 5 USDC to alice@example.com", ctx);
  assert.equal(p.recipient.type, "EMAIL");
  assert.equal(p.recipient.value, "alice@example.com");
});

test("@handle recipient + purpose", () => {
  const p = extractStructuredProposal("Transfer 250 SUI to @treasury for payroll", ctx);
  assert.equal(p.recipient.type, "ADDRESS"); // resolved via contact book
  assert.equal(p.recipient.name, "Treasury");
  assert.equal(p.purpose, "payroll");
});

test("network: mainnet explicitly", () => {
  const p = extractStructuredProposal("Send 5 USDC to alice@example.com on Sui Mainnet", ctx);
  assert.equal(p.network, "SUI_MAINNET");
});

test("network: unsupported chain -> unsupported", () => {
  const p = extractStructuredProposal("Send 5 USDC to alice@example.com on Solana", ctx);
  assert.equal(p.networkMentioned, "unsupported");
});

test('"$200 USDC" is symbol + token, not a currency conflict', () => {
  const p = extractStructuredProposal("Pay Alice $200 USDC.", ctx);
  assert.equal(p.amountRaw, "200");
  assert.equal(p.currencyInput, "USDC");
  assert.equal(p.conflicts.length, 0);
});

test("conflict: two different amounts", () => {
  const p = extractStructuredProposal("Pay 200 USDC and 300 SUI to Alice", ctx);
  assert.ok(p.conflicts.some((c) => c.includes("two different amounts")));
});

test("timing: by Friday", () => {
  const p = extractStructuredProposal("Pay 200 USDC to Alice by Friday", ctx);
  assert.ok(p.scheduleAt);
  assert.equal(p.timingLabel, "by friday");
});

test("purpose + constraints: for rent, max fee 1 SUI", () => {
  const p = extractStructuredProposal("Pay 200 USDC to Alice for rent, max fee 1 SUI", ctx);
  assert.equal(p.purpose, "rent");
  assert.ok(p.constraints.some((c) => c.kind === "FEE_CAP"));
});

test("unsupported payment method is flagged", () => {
  const p = extractStructuredProposal("Pay 200 USDC to Alice via credit card", ctx);
  assert.equal(p.paymentMethod, "UNKNOWN");
});
