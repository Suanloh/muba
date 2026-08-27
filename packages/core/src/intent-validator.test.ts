/**
 * Deterministic validator tests — the Phase 2 validation matrix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  IntentParserContext,
  Network,
  StructuredIntentProposal,
} from "@mova/types";
import { validateStructuredProposal } from "./intent-validator.js";

const ctx: IntentParserContext = { userId: "u1", walletId: "w1", network: "SUI_TESTNET" };

function proposal(overrides: Partial<StructuredIntentProposal> = {}): StructuredIntentProposal {
  return {
    action: "PAY",
    amountRaw: "200",
    currencyInput: "USDC",
    recipient: { type: "ADDRESS", value: "0x1111111111111111111111111111111111111111111111111111111111111111", name: null },
    network: "SUI_TESTNET" as Network,
    networkMentioned: "none",
    conflicts: [],
    purpose: null,
    scheduleAt: null,
    timingLabel: null,
    constraints: [],
    paymentMethod: null,
    confidence: 0.9,
    needsClarification: false,
    clarificationQuestion: null,
    warnings: [],
    rawText: "Pay 200 USDC to 0x1111…",
    rawLlmOutput: null,
    ...overrides,
  };
}

test("valid proposal passes with recomputed canonical amount", () => {
  const res = validateStructuredProposal(proposal(), ctx);
  assert.equal(res.ok, true);
  assert.deepEqual(res.canonicalAmount, { asset: "USDC", amount: "200000000" }); // 200 * 10^6
  assert.equal(res.errors.length, 0);
});

test("SUI decimals recomputed (9 places)", () => {
  const res = validateStructuredProposal(proposal({ amountRaw: "1.5", currencyInput: "SUI" }), ctx);
  assert.equal(res.ok, true);
  assert.deepEqual(res.canonicalAmount, { asset: "SUI", amount: "1500000000" });
});

test("missing amount -> MISSING_AMOUNT error + clarification", () => {
  const res = validateStructuredProposal(proposal({ amountRaw: null }), ctx);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "MISSING_AMOUNT"));
  assert.equal(res.needsClarification, true);
  assert.ok(res.clarificationQuestion);
});

test("invalid amount -> INVALID_AMOUNT error", () => {
  const res = validateStructuredProposal(proposal({ amountRaw: "abc" }), ctx);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "INVALID_AMOUNT"));
});

test("zero amount -> INVALID_AMOUNT error", () => {
  const res = validateStructuredProposal(proposal({ amountRaw: "0" }), ctx);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "INVALID_AMOUNT"));
});

test("unsupported currency -> UNSUPPORTED_CURRENCY error", () => {
  const res = validateStructuredProposal(proposal({ currencyInput: "Doge" }), ctx);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "UNSUPPORTED_CURRENCY"));
});

test("fiat currency -> warning, canonical amount null", () => {
  const res = validateStructuredProposal(proposal({ amountRaw: "100", currencyInput: "RM" }), ctx);
  // RM is recognized fiat (MYR): warning, not error; no canonical on-chain amount.
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.code === "UNSUPPORTED_CURRENCY"));
  assert.equal(res.canonicalAmount, null);
});

test("missing currency with an amount -> MISSING_CURRENCY error + clarification", () => {
  const res = validateStructuredProposal(proposal({ currencyInput: "" }), ctx);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "MISSING_CURRENCY"));
  assert.equal(res.needsClarification, true);
  assert.ok(res.clarificationQuestion);
});

test("missing recipient -> MISSING_RECIPIENT error", () => {
  const res = validateStructuredProposal(
    proposal({ recipient: { type: "ADDRESS", value: "", name: null } }),
    ctx,
  );
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "MISSING_RECIPIENT"));
});

test("ambiguous recipient -> AMBIGUOUS_RECIPIENT error + clarification", () => {
  const res = validateStructuredProposal(
    proposal({
      recipient: { type: "HANDLE", value: "@this merchant", name: "this merchant", ambiguous: true },
    }),
    ctx,
  );
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "AMBIGUOUS_RECIPIENT"));
  assert.equal(res.needsClarification, true);
});

test("invalid address -> INVALID_ADDRESS error", () => {
  const res = validateStructuredProposal(
    proposal({ recipient: { type: "ADDRESS", value: "0x12345", name: null } }),
    ctx,
  );
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "INVALID_ADDRESS"));
});

test("valid short address passes", () => {
  const res = validateStructuredProposal(
    proposal({ recipient: { type: "ADDRESS", value: "0x1234567890abcdef", name: null } }),
    ctx,
  );
  assert.equal(res.ok, true);
});

test("unsupported network -> UNSUPPORTED_NETWORK error", () => {
  const res = validateStructuredProposal(proposal({ networkMentioned: "unsupported" }), ctx);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "UNSUPPORTED_NETWORK"));
});

test("conflicting instructions -> CONFLICTING_INSTRUCTIONS error", () => {
  const res = validateStructuredProposal(
    proposal({ conflicts: ["two different amounts (200 and 300)"] }),
    ctx,
  );
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "CONFLICTING_INSTRUCTIONS"));
});

test("unsupported payment method -> warning only", () => {
  const res = validateStructuredProposal(proposal({ paymentMethod: "UNKNOWN" }), ctx);
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.code === "UNSUPPORTED_PAYMENT_METHOD"));
});

test("ok proposal is not flagged needsClarification", () => {
  const res = validateStructuredProposal(proposal(), ctx);
  assert.equal(res.needsClarification, false);
  assert.equal(res.clarificationQuestion, null);
});
