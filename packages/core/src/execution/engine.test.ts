/**
 * Phase 7 — Payment Execution Engine test (full pipe).
 *
 * Runs the complete deterministic pipe (route → compliance → risk/hedge →
 * spec → preview) with the mock/static provider set and asserts:
 *   - a spec + preview are produced for a valid, cleared payment
 *   - the digest is stable across identical inputs
 *   - blocked compliance refuses to produce an executable plan (fail-closed)
 *   - the preview carries every field the human must understand
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MovaError } from "@mova/logger";
import {
  MockMarketDataProvider,
  MockScreeningProvider,
  StaticThetanutsHedgingProvider,
  StaticVolatilityProvider,
} from "@mova/integrations";
import type { ParsedIntent, PaymentIntent } from "@mova/types";
import { PaymentExecutionEngine } from "./engine.js";

const PRICES: Record<string, string> = {
  SUI: "1.000000",
  USDC: "1.000000",
  MOV: "0.400000",
  MYR: "0.240000",
};
const FUNDED = ["USDC", "SUI", "MOV", "MYR"];

const SENDER = "0xea179fce0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const RECIPIENT = "0x1234567890abcdef1234567890abcdef1234567890";

function intent(id = "pay-1"): { intent: PaymentIntent; parsed: ParsedIntent } {
  const createdAt = 1000;
  const intent: PaymentIntent = {
    id,
    correlationId: `corr-${id}`,
    intentRef: `PAY-${id.slice(-4)}`,
    userId: "demo-user",
    walletId: "demo-wallet",
    source: "CHAT",
    rawText: "Pay 1 SUI to 0x1234…",
    network: "SUI_TESTNET",
    createdAt,
    updatedAt: createdAt,
  };
  const parsed: ParsedIntent = {
    id: `pi-${id}`,
    paymentIntentId: id,
    action: "PAY",
    amount: { asset: "SUI", amount: "1000000000" },
    recipient: { type: "ADDRESS", value: RECIPIENT, name: null },
    network: "SUI_TESTNET",
    scheduleAt: null,
    memo: null,
    confidence: 1,
    needsClarification: false,
    clarificationQuestion: null,
    rawLlmOutput: null,
    validationStatus: "VALIDATED",
    validatorNotes: [],
    canonicalAmount: { asset: "SUI", amount: "1000000000" },
    createdAt,
  };
  return { intent, parsed };
}

function engine(opts: { watchlist?: Array<{ name: string | null; identifier: string | null }> } = {}) {
  return new PaymentExecutionEngine({
    marketData: new MockMarketDataProvider({ allowed: true, prices: PRICES, spreadBps: 5 }),
    screening: new MockScreeningProvider({ allowed: true, watchlist: opts.watchlist }),
    hedging: new StaticThetanutsHedgingProvider({ allowed: true }),
    volatility: new StaticVolatilityProvider({ allowed: true }),
  });
}

function planInput(id = "pay-1") {
  const built = intent(id);
  return {
    intent: built.intent,
    parsed: built.parsed,
    record: {
      id,
      correlationId: `corr-${id}`,
      action: "PAY" as const,
      recipient: { type: "ADDRESS" as const, value: RECIPIENT, name: null as string | null },
      amount: { asset: "SUI", amount: "1000000000" },
    },
    clientRequestId: `cid-${id}`,
    sender: SENDER,
    network: "SUI_TESTNET" as const,
    criterion: "COST" as const,
    expectedSettlement: "REAL" as const,
    now: 1000,
    ttlMs: 60000,
    hedgedRoute: { availableAssets: FUNDED, horizonDays: 7 },
  };
}

describe("PaymentExecutionEngine.buildPlan", () => {
  it("produces a spec + preview for a valid cleared payment", async () => {
    const { preview, spec, recommendation } = await engine().buildPlan(planInput());
    assert.ok(spec.planDigest.length === 64);
    assert.equal(spec.recipient, RECIPIENT);
    assert.equal(spec.sender, SENDER.toLowerCase());
    assert.equal(preview.planDigest, spec.planDigest);
    assert.equal(preview.suiDestination, RECIPIENT);
    assert.equal(preview.expectedSettlement, "REAL");
    assert.equal(preview.compliance.decision, "ALLOW");
    assert.ok(preview.route.routeNo >= 1);
    assert.ok(preview.risk.score >= 0 && preview.risk.score <= 100);
    assert.ok(recommendation.route.status === "SELECTED");
  });

  it("is deterministic — same input, same digest", async () => {
    const a = await engine().buildPlan(planInput());
    const b = await engine().buildPlan(planInput());
    assert.equal(a.spec.planDigest, b.spec.planDigest);
    assert.equal(a.preview.planDigest, b.preview.planDigest);
  });

  it("refuses to build an executable plan when compliance BLOCKS (fail-closed)", async () => {
    const blocking = engine({
      watchlist: [{ name: "SIMULATED SANCTIONED ENTITY", identifier: null }],
    });
    const input = planInput();
    // Screen against the sanctioned name.
    input.record.recipient = { type: "ADDRESS", value: RECIPIENT, name: "SIMULATED SANCTIONED ENTITY" };
    await assert.rejects(() => blocking.buildPlan(input), (err: unknown) => {
      assert.ok(err instanceof MovaError);
      assert.equal(err.code, "ERR_COMPLIANCE_BLOCKED");
      return true;
    });
  });

  it("throws on an invalid recipient (never emits a partial plan)", async () => {
    const input = planInput();
    input.record.recipient = { type: "ADDRESS", value: "0xbad", name: null };
    await assert.rejects(() => engine().buildPlan(input), MovaError);
  });

  it("throws when compliance engine is unavailable — fails closed to REVIEW", async () => {
    const broken = new PaymentExecutionEngine({
      marketData: new MockMarketDataProvider({ allowed: true, prices: PRICES, spreadBps: 5 }),
      screening: {
        descriptor: { kind: "MOCK", name: "BROKEN", network: null },
        screen: async () => {
          throw new Error("screening down");
        },
      },
      hedging: new StaticThetanutsHedgingProvider({ allowed: true }),
      volatility: new StaticVolatilityProvider({ allowed: true }),
    });
    await assert.rejects(() => broken.buildPlan(planInput()), (err: unknown) => {
      assert.ok(err instanceof MovaError);
      assert.equal(err.code, "ERR_COMPLIANCE_UNAVAILABLE");
      return true;
    });
  });
});
