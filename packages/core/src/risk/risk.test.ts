/**
 * Phase 6 risk tests — RiskEngine, HedgingEngine, HedgedRouteEngine.
 *
 * Covers: risk band/decision mapping, deterministic scoring, FX exposure on
 * conversion routes, volatility-data gaps, hedge need/cost-effectiveness rules,
 * the honest UNAVAILABLE fallback, and the final payment recommendation
 * (route vs route+hedge).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MovaError, ErrorCode } from "@mova/logger";
import {
  MockMarketDataProvider,
  StaticThetanutsHedgingProvider,
  StaticVolatilityProvider,
  ThetanutsHedgingProvider,
  type VolatilityProvider,
} from "@mova/integrations";
import type {
  Money,
  ParsedIntent,
  PaymentIntent,
  RouteCandidate,
} from "@mova/types";
import { RouteEngine } from "../routing/index.js";
import { toBigInt, toDecimal, toQuote, ONE_PRICE } from "../routing/money.js";
import { valueAtRisk } from "./volatility.js";
import { RiskEngine } from "./risk-engine.js";
import { HedgingEngine } from "./hedging-engine.js";
import { HedgedRouteEngine } from "./recommendation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRICES = {
  SUI: "1.000000",
  USDC: "1.000000",
  MOV: "0.400000",
  MYR: "0.240000",
};

function marketData() {
  return new MockMarketDataProvider({ allowed: true, prices: PRICES, spreadBps: 5 });
}

function staticVolatility() {
  return new StaticVolatilityProvider({ allowed: true });
}

function staticHedging(premiumBps?: { PUT_OPTION?: number }) {
  return new StaticThetanutsHedgingProvider({ allowed: true, premiumBps });
}

function parsedIntent(amount: Money): ParsedIntent {
  return {
    id: "pi1",
    paymentIntentId: "pay1",
    action: "PAY",
    amount,
    recipient: {
      type: "ADDRESS",
      value: "0x1111111111111111111111111111111111111111111111111111111111111111",
      name: null,
    },
    network: "SUI_TESTNET",
    scheduleAt: null,
    memo: null,
    confidence: 1,
    needsClarification: false,
    clarificationQuestion: null,
    rawLlmOutput: null,
    validationStatus: "VALIDATED",
    validatorNotes: [],
    canonicalAmount: amount,
    createdAt: 0,
  };
}

function paymentIntent(): PaymentIntent {
  return {
    id: "pay1",
    correlationId: "corr1",
    intentRef: "PAY-2026-0001",
    userId: "u1",
    walletId: "w1",
    source: "CHAT",
    rawText: "Pay 100 USDC",
    network: "SUI_TESTNET",
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Discover a route from `sourceAsset` for `amount` (default 100 USDC). */
async function routeFrom(
  sourceAsset: string,
  amount: Money = { asset: "USDC", amount: "100000000" },
  availableAssets: string[] = [sourceAsset],
): Promise<RouteCandidate> {
  const engine = new RouteEngine(marketData(), { availableAssets });
  const candidates = await engine.discover(paymentIntent(), parsedIntent(amount));
  const route = candidates.find((r) => r.summary.sourceAsset === sourceAsset);
  assert.ok(route, `expected a route from ${sourceAsset}`);
  return route;
}

const NOTIONAL_USDC = 100_000_000n; // 100 USDC (6-dec)

// ---------------------------------------------------------------------------
// RiskEngine
// ---------------------------------------------------------------------------

test("RiskEngine: direct USDC payment is LOW risk and PROCEEDS", async () => {
  const engine = new RiskEngine({
    marketData: marketData(),
    volatility: staticVolatility(),
    horizonDays: 7,
    now: 0,
  });
  const route = await routeFrom("USDC");
  const risk = await engine.assess(paymentIntent(), route);
  assert.equal(risk.band, "LOW");
  assert.equal(risk.decision, "PROCEED");
  assert.ok(risk.score < 25, `score ${risk.score} should be < 25`);
  const fx = risk.signals.find((s) => s.signalId === "FX_EXPOSURE")!;
  assert.equal(fx.contribution, 0, "no conversion leg → no FX exposure");
});

test("RiskEngine: SUI→USDC conversion is MEDIUM, dominated by FX exposure", async () => {
  const engine = new RiskEngine({
    marketData: marketData(),
    volatility: staticVolatility(),
    horizonDays: 7,
    now: 0,
  });
  const route = await routeFrom("SUI", { asset: "USDC", amount: "100000000" }, ["SUI"]);
  const risk = await engine.assess(paymentIntent(), route);
  assert.equal(risk.band, "MEDIUM");
  assert.equal(risk.decision, "PROCEED");
  assert.ok(risk.score >= 20 && risk.score <= 40, `score ${risk.score}`);
  const assetVol = risk.signals.find((s) => s.signalId === "ASSET_VOLATILITY")!;
  const fx = risk.signals.find((s) => s.signalId === "FX_EXPOSURE")!;
  // Settlement token (USDC) is stable; the conversion leg (SUI) carries the risk.
  assert.ok(assetVol.contribution < 20, `USDC should be low vol, got ${assetVol.contribution}`);
  assert.ok(fx.contribution > 90, `SUI conversion should dominate, got ${fx.contribution}`);
});

test("RiskEngine: MOV settlement funded by SUI is HIGH risk and goes to REVIEW", async () => {
  const engine = new RiskEngine({
    marketData: marketData(),
    volatility: staticVolatility(),
    horizonDays: 7,
    now: 0,
  });
  // 250 MOV @ 0.40 USDC = 100 USDC notional; funded from volatile SUI.
  const route = await routeFrom("SUI", { asset: "MOV", amount: "25000000000" }, ["SUI"]);
  const risk = await engine.assess(paymentIntent(), route);
  assert.equal(risk.band, "HIGH");
  assert.equal(risk.decision, "REVIEW");
  assert.ok(risk.score >= 45 && risk.score <= 65, `score ${risk.score}`);
});

test("RiskEngine: SUI conversion over 1d is MEDIUM and still PROCEEDS", async () => {
  const engine = new RiskEngine({
    marketData: marketData(),
    volatility: staticVolatility(),
    horizonDays: 1,
    now: 0,
  });
  const route = await routeFrom("SUI", { asset: "USDC", amount: "100000000" }, ["SUI"]);
  const risk = await engine.assess(paymentIntent(), route);
  assert.equal(risk.band, "MEDIUM");
  assert.equal(risk.decision, "PROCEED");
});

test("RiskEngine: scoring is deterministic", async () => {
  const engine = new RiskEngine({
    marketData: marketData(),
    volatility: staticVolatility(),
    horizonDays: 7,
    now: 0,
  });
  const route = await routeFrom("SUI", { asset: "USDC", amount: "100000000" }, ["SUI"]);
  const a = await engine.assess(paymentIntent(), route);
  const b = await engine.assess(paymentIntent(), route);
  assert.equal(a.score, b.score);
  assert.deepEqual(
    a.signals.map((s) => s.contribution),
    b.signals.map((s) => s.contribution),
  );
});

test("RiskEngine: explicit weights override the defaults", async () => {
  const base = new RiskEngine({
    marketData: marketData(),
    volatility: staticVolatility(),
    horizonDays: 7,
    now: 0,
  });
  const fxHeavy = new RiskEngine({
    marketData: marketData(),
    volatility: staticVolatility(),
    horizonDays: 7,
    now: 0,
    weights: { assetVolatility: 0.05, fxExposure: 0.8, routeRisk: 0.05, liquidityRisk: 0.05, settlementRisk: 0.05 },
  });
  const route = await routeFrom("SUI", { asset: "USDC", amount: "100000000" }, ["SUI"]);
  const a = await base.assess(paymentIntent(), route);
  const b = await fxHeavy.assess(paymentIntent(), route);
  assert.ok(b.score > a.score, "heavier FX weight should raise the score for a conversion");
});

test("RiskEngine: missing volatility data is a recorded gap, not a guess", async () => {
  const gapProvider: VolatilityProvider = {
    descriptor: { kind: "REAL", name: "GAP", network: null },
    async getVolatility() {
      throw new MovaError(ErrorCode.INTEGRATION_UNAVAILABLE, "no data for thetanuts-unsupported asset");
    },
  };
  const engine = new RiskEngine({
    marketData: marketData(),
    volatility: gapProvider,
    horizonDays: 7,
    now: 0,
  });
  const route = await routeFrom("SUI", { asset: "USDC", amount: "100000000" }, ["SUI"]);
  const risk = await engine.assess(paymentIntent(), route);
  const assetVol = risk.signals.find((s) => s.signalId === "ASSET_VOLATILITY")!;
  assert.equal(assetVol.contribution, 0);
  assert.ok((assetVol.note ?? "").includes("unavailable"));
  assert.equal(risk.band, "LOW", "no vol data → no fabricated risk from vol");
});

// ---------------------------------------------------------------------------
// HedgingEngine
// ---------------------------------------------------------------------------

function hedgingEngine(
  hedgingProvider: import("@mova/integrations").HedgingProvider = staticHedging(),
  horizonDays = 7,
): HedgingEngine {
  return new HedgingEngine({
    marketData: marketData(),
    hedgingProvider,
    volatility: staticVolatility(),
    horizonDays,
    now: 0,
  });
}

test("HedgingEngine: recommends a PUT hedge for a volatile SUI→USDC conversion", async () => {
  const riskEngine = new RiskEngine({ marketData: marketData(), volatility: staticVolatility(), horizonDays: 7, now: 0 });
  const route = await routeFrom("SUI", { asset: "USDC", amount: "100000000" }, ["SUI"]);
  const risk = await riskEngine.assess(paymentIntent(), route);
  const ev = await hedgingEngine().evaluate(paymentIntent(), route, risk);

  assert.equal(ev.comparison.hedgeDecision, "HEDGE");
  assert.equal(ev.comparison.recommended, true);
  assert.equal(ev.comparison.strategy, "PUT_OPTION");
  assert.equal(ev.comparison.dataSource, "STATIC_DEV");
  assert.equal(ev.plan.recommended, true);
  assert.equal(ev.plan.provider, "THETANUTS_STATIC_DEV");

  // Premium = 150bp of 100 USDC notional = 1.50 USDC (1_500_000 @ 6-dec).
  assert.equal(toDecimal(ev.impact.hedgeCost), "1.5");

  // Exposure reduction = VaR × coverage(0.5) — must exceed the premium.
  const suidaily = 0.55 / Math.sqrt(365);
  const varMoney = valueAtRisk(NOTIONAL_USDC, suidaily, 7, 0.95);
  const expectedReduction = (varMoney * 50n) / 100n;
  assert.equal(toBigInt(ev.impact.exposureReduction), expectedReduction);
  assert.ok(expectedReduction > toBigInt(ev.impact.hedgeCost), "hedge must cost less than the risk it removes");

  // Route cost with hedge = route cost + premium.
  const without = toBigInt(ev.impact.routeCostWithoutHedge);
  assert.equal(toBigInt(ev.impact.routeCostWithHedge), without + toBigInt(ev.impact.hedgeCost));
  assert.equal(toBigInt(ev.comparison.delta), toBigInt(ev.impact.hedgeCost));
});

test("HedgingEngine: no hedge for a low-risk direct stablecoin route", async () => {
  const riskEngine = new RiskEngine({ marketData: marketData(), volatility: staticVolatility(), horizonDays: 7, now: 0 });
  const route = await routeFrom("USDC");
  const risk = await riskEngine.assess(paymentIntent(), route);
  const ev = await hedgingEngine().evaluate(paymentIntent(), route, risk);

  assert.equal(ev.comparison.hedgeDecision, "NO_HEDGE");
  assert.equal(ev.comparison.recommended, false);
  assert.equal(ev.comparison.strategy, "NONE");
  assert.equal(ev.plan.recommended, false);
  assert.ok(/not needed/.test(ev.comparison.reason));
});

test("HedgingEngine: hedge is rejected when it costs more than the risk it removes", async () => {
  const riskEngine = new RiskEngine({ marketData: marketData(), volatility: staticVolatility(), horizonDays: 7, now: 0 });
  const route = await routeFrom("SUI", { asset: "USDC", amount: "100000000" }, ["SUI"]);
  const risk = await riskEngine.assess(paymentIntent(), route);
  // 10000bp = 100% of notional premium — never cost-effective.
  const ev = await hedgingEngine(staticHedging({ PUT_OPTION: 10000 })).evaluate(paymentIntent(), route, risk);

  assert.equal(ev.comparison.hedgeDecision, "NO_HEDGE");
  assert.equal(ev.plan.recommended, false);
  assert.ok(/not cost-effective/.test(ev.comparison.reason));
});

test("HedgingEngine: live integration unavailable → honest UNAVAILABLE, no fake hedge", async () => {
  const riskEngine = new RiskEngine({ marketData: marketData(), volatility: staticVolatility(), horizonDays: 7, now: 0 });
  const route = await routeFrom("SUI", { asset: "USDC", amount: "100000000" }, ["SUI"]);
  const risk = await riskEngine.assess(paymentIntent(), route);

  // Live Thetanuts provider has no book for SUI — must report UNAVAILABLE.
  const live = new ThetanutsHedgingProvider({ chainId: 8453, rpcUrl: "https://mainnet.base.org" });
  const ev = await hedgingEngine(live).evaluate(paymentIntent(), route, risk);

  assert.equal(ev.comparison.dataSource, "UNAVAILABLE");
  assert.equal(ev.comparison.hedgeDecision, "NO_HEDGE");
  assert.equal(ev.comparison.recommended, false);
  assert.equal(ev.plan.recommended, false);
  assert.ok(/integration gap|unavailable/i.test(ev.comparison.reason));
  assert.equal(ev.impact.hedgeCost.amount, "0", "no premium is assumed when unavailable");
});

// ---------------------------------------------------------------------------
// HedgedRouteEngine (final recommendation)
// ---------------------------------------------------------------------------

test("HedgedRouteEngine: volatile SUI conversion yields a hedged recommendation", async () => {
  const engine = new HedgedRouteEngine(
    marketData(),
    staticHedging(),
    staticVolatility(),
    { availableAssets: ["SUI"], horizonDays: 7, now: 0 },
  );
  const result = await engine.compute(paymentIntent(), parsedIntent({ asset: "USDC", amount: "100000000" }), "COST");

  assert.ok(result.optimization.selected, "routing produced a selected route");
  const rec = result.recommendation;
  assert.ok(rec.hedged, "high-FX route should carry a hedge");
  assert.equal(rec.hedge.hedgeDecision, "HEDGE");
  assert.equal(rec.hedge.strategy, "PUT_OPTION");
  assert.equal(rec.decision, "PROCEED");
  assert.equal(rec.totalCost.asset, "USDC");
  assert.equal(toBigInt(rec.totalCost), toBigInt(rec.hedge.withHedge));
  assert.ok(rec.explanation.includes("route"), "explanation is human-readable");
  // One comparison row per route (route vs route+hedge).
  assert.equal(result.comparisons.length, result.optimization.routes.length);
});

test("HedgedRouteEngine: high-risk MOV settlement goes to REVIEW with a hedge", async () => {
  const engine = new HedgedRouteEngine(
    marketData(),
    staticHedging(),
    staticVolatility(),
    { availableAssets: ["SUI"], horizonDays: 7, now: 0 },
  );
  const result = await engine.compute(paymentIntent(), parsedIntent({ asset: "MOV", amount: "25000000000" }), "COST");
  const rec = result.recommendation;
  assert.equal(rec.decision, "REVIEW");
  assert.equal(rec.hedge.hedgeDecision, "HEDGE");
});

test("HedgedRouteEngine: direct USDC yields an unhedged recommendation", async () => {
  const engine = new HedgedRouteEngine(
    marketData(),
    staticHedging(),
    staticVolatility(),
    { availableAssets: ["USDC"], horizonDays: 7, now: 0 },
  );
  const result = await engine.compute(paymentIntent(), parsedIntent({ asset: "USDC", amount: "100000000" }), "COST");

  const rec = result.recommendation;
  assert.equal(rec.hedged, false);
  assert.equal(rec.hedge.hedgeDecision, "NO_HEDGE");
  assert.equal(rec.decision, "PROCEED");
  assert.equal(toBigInt(rec.totalCost), toBigInt(rec.hedge.withoutHedge));
});

test("HedgedRouteEngine: deterministic across runs", async () => {
  const mk = () =>
    new HedgedRouteEngine(marketData(), staticHedging(), staticVolatility(), {
      availableAssets: ["USDC", "SUI", "MOV", "MYR"],
      horizonDays: 7,
      now: 0,
    });
  const a = await mk().compute(paymentIntent(), parsedIntent({ asset: "USDC", amount: "100000000" }), "COST");
  const b = await mk().compute(paymentIntent(), parsedIntent({ asset: "USDC", amount: "100000000" }), "COST");

  assert.equal(a.recommendation.hedged, b.recommendation.hedged);
  assert.equal(a.recommendation.hedge.hedgeDecision, b.recommendation.hedge.hedgeDecision);
  assert.equal(a.recommendation.totalCost.amount, b.recommendation.totalCost.amount);
  assert.deepEqual(
    a.comparisons.map((c) => c.hedgeDecision),
    b.comparisons.map((c) => c.hedgeDecision),
  );
});

// Reference: ONE_PRICE is used by the money helpers (guards against drift).
test("money helpers still treat USDC as identity priced", () => {
  assert.equal(ONE_PRICE, "1.000000");
  const q = toQuote({ asset: "USDC", amount: "100000000" }, "USDC", ONE_PRICE);
  assert.equal(q.amount, "100000000");
});
