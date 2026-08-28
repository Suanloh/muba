/**
 * Phase 4 routing engine tests — discovery, scoring, comparison, savings.
 *
 * All money assertions are in smallest units (decimal strings). Every expected
 * number here was derived by hand with integer math so the tests document the
 * engine's deterministic behaviour.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Money,
  ParsedIntent,
  PaymentIntent,
  RouteCandidate,
  RouteCostBreakdown,
  RouteLeg,
} from "@mova/types";
import { MockMarketDataProvider } from "@mova/integrations";
import {
  RouteDiscoveryEngine,
  RouteEngine,
  RouteOptimizerEngine,
} from "./routing/index.js";
import {
  fromQuote,
  priceToInt,
  spreadBps,
  subMoney,
  sumMoney,
  toDecimal,
  toQuote,
} from "./routing/money.js";

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

const USDC_100: Money = { asset: "USDC", amount: "100000000" }; // 100 USDC

/** Hand-built candidate for optimizer-only tests (cost/time tradeoffs). */
function candidate(opts: {
  routeNo: number;
  costUsdc: string;
  timeMs: number;
  risk?: number;
  reliability?: number;
  liquidity?: number;
}): RouteCandidate {
  const risk = opts.risk ?? 0.05;
  const reliability = opts.reliability ?? 0.97;
  const liquidity = opts.liquidity ?? 0.9;
  const amount: Money = USDC_100;
  const legs: RouteLeg[] = [
    {
      kind: "ONCHAIN",
      from: "USDC",
      to: "USDC",
      asset: "USDC",
      amount,
      provider: "SUI_CHAIN",
      fee: { asset: "USDC", amount: "0" },
      estimatedTimeMs: 2500,
      reliability: 0.99,
      liquidity: 1,
      riskFactor: 0.01,
      note: "on-chain",
    },
    {
      kind: "SETTLEMENT",
      from: "USDC",
      to: "USDC",
      asset: "USDC",
      amount,
      provider: "SUI_SETTLEMENT",
      fee: { asset: "USDC", amount: "0" },
      estimatedTimeMs: 500,
      reliability: 0.99,
      liquidity: 1,
      riskFactor: 0.01,
      note: "settle",
    },
  ];
  const cost: RouteCostBreakdown = {
    quoteAsset: "USDC",
    paymentFees: { asset: "USDC", amount: opts.costUsdc },
    conversionCost: { asset: "USDC", amount: "0" },
    slippage: { asset: "USDC", amount: "0" },
    other: { asset: "USDC", amount: "0" },
    total: { asset: "USDC", amount: opts.costUsdc },
  };
  return {
    routeNo: opts.routeNo,
    legs,
    summary: {
      sourceAsset: "USDC",
      destinationAsset: "USDC",
      hasConversion: false,
      conversionCount: 0,
      hasOffchainLeg: false,
      hasOnchainLeg: true,
      settleOnSui: true,
      legOrder: ["ONCHAIN", "SETTLEMENT"],
    },
    cost,
    totalFee: cost.paymentFees,
    totalEstimatedCost: cost.total,
    estimatedTimeMs: opts.timeMs,
    reliability,
    liquidity,
    risk: { score: risk, factors: [] },
  };
}

// ---------------------------------------------------------------------------
// Money math
// ---------------------------------------------------------------------------

test("toQuote converts SUI -> USDC at 1.0 (10^9 vs 10^6 scales)", () => {
  assert.deepEqual(toQuote({ asset: "SUI", amount: "1000000000" }, "USDC", "1.000000"), {
    asset: "USDC",
    amount: "1000000",
  });
});

test("toQuote USDC -> USDC is identity", () => {
  assert.deepEqual(toQuote(USDC_100, "USDC", "1.000000"), USDC_100);
});

test("fromQuote converts USDC -> SUI at 1.0", () => {
  assert.deepEqual(fromQuote({ asset: "USDC", amount: "1000000" }, "SUI", "1.000000"), {
    asset: "SUI",
    amount: "1000000000",
  });
});

test("priceToInt parses 6-decimal prices", () => {
  assert.equal(priceToInt("1.000000"), 1000000n);
  assert.equal(priceToInt("0.400000"), 400000n);
});

test("spreadBps derives the bid/ask spread (provider integer bid/ask)", () => {
  assert.equal(spreadBps("999500", "1000500", "1.000000"), 10);
});

test("sumMoney and subMoney stay in smallest units", () => {
  const a = { asset: "USDC", amount: "1000" };
  const b = { asset: "USDC", amount: "2500" };
  assert.deepEqual(sumMoney([a, b]), { asset: "USDC", amount: "3500" });
  assert.deepEqual(subMoney(b, a), { asset: "USDC", amount: "1500" });
});

test("toDecimal renders without floats", () => {
  assert.equal(toDecimal({ asset: "USDC", amount: "1000000" }), "1");
  assert.equal(toDecimal({ asset: "USDC", amount: "1234567" }), "1.234567");
  assert.equal(toDecimal({ asset: "SUI", amount: "1000000000" }), "1");
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test("direct route: source == settlement token, on-chain + settlement legs only", async () => {
  const engine = new RouteDiscoveryEngine(marketData(), { availableAssets: ["USDC"] });
  const routes = await engine.discover(paymentIntent(), parsedIntent(USDC_100));
  assert.equal(routes.length, 1);
  const r = routes[0]!;
  assert.equal(r.routeNo, 1);
  assert.deepEqual(r.summary.legOrder, ["ONCHAIN", "SETTLEMENT"]);
  assert.equal(r.summary.hasConversion, false);
  assert.equal(r.summary.hasOffchainLeg, false);
  assert.equal(r.summary.settleOnSui, true);
  // Cost = gas only: 0.001 SUI at 1.0 = 0.001 USDC = 1000 smallest units.
  assert.deepEqual(r.totalEstimatedCost, { asset: "USDC", amount: "1000" });
  assert.deepEqual(r.cost.slippage, { asset: "USDC", amount: "0" });
  assert.deepEqual(r.cost.conversionCost, { asset: "USDC", amount: "0" });
  assert.equal(r.estimatedTimeMs, 3000);
  assert.equal(r.reliability, 0.98); // 0.99 * 0.99
  assert.equal(r.liquidity, 1);
});

test("conversion route: token source != settlement adds CONVERSION leg + costs", async () => {
  const engine = new RouteDiscoveryEngine(marketData(), { availableAssets: ["SUI"] });
  const routes = await engine.discover(paymentIntent(), parsedIntent(USDC_100));
  assert.equal(routes.length, 1);
  const r = routes[0]!;
  assert.deepEqual(r.summary.legOrder, ["CONVERSION", "ONCHAIN", "SETTLEMENT"]);
  assert.equal(r.summary.hasConversion, true);
  assert.equal(r.summary.sourceAsset, "SUI");
  assert.equal(r.legs[0]!.provider, "MOVA_DEX");
  // 100 USDC notional: 20bp swap fee (200000) + 10bp spread (100000) + gas (1000)
  // + 30bp slippage (300000) → total 601000.
  assert.deepEqual(r.totalEstimatedCost, { asset: "USDC", amount: "601000" });
  assert.deepEqual(r.cost.conversionCost, { asset: "USDC", amount: "300000" });
  assert.deepEqual(r.cost.slippage, { asset: "USDC", amount: "300000" });
});

test("multi-source discovery returns ranked candidates 1..N", async () => {
  const engine = new RouteDiscoveryEngine(marketData(), {
    availableAssets: ["USDC", "SUI", "MOV"],
  });
  const routes = await engine.discover(paymentIntent(), parsedIntent(USDC_100));
  assert.equal(routes.length, 3);
  assert.deepEqual(routes.map((r) => r.routeNo), [1, 2, 3]);
  assert.deepEqual(routes.map((r) => r.summary.sourceAsset), ["USDC", "SUI", "MOV"]);
});

test("unpriceable sources are skipped, never guessed", async () => {
  const engine = new RouteDiscoveryEngine(marketData(), {
    availableAssets: ["USDC", "ETH", "DOGE"],
  });
  const routes = await engine.discover(paymentIntent(), parsedIntent(USDC_100));
  assert.equal(routes.length, 1); // only USDC priced
  assert.equal(routes[0]!.summary.sourceAsset, "USDC");
});

test("fiat route adds OFFCHAIN leg + on-ramp conversion", async () => {
  const engine = new RouteDiscoveryEngine(marketData(), { availableAssets: ["MYR"] });
  const routes = await engine.discover(paymentIntent(), parsedIntent(USDC_100));
  assert.equal(routes.length, 1);
  const r = routes[0]!;
  assert.deepEqual(r.summary.legOrder, ["OFFCHAIN", "CONVERSION", "ONCHAIN", "SETTLEMENT"]);
  assert.equal(r.summary.hasOffchainLeg, true);
  assert.equal(r.summary.conversionCount, 1);
  assert.equal(r.legs[0]!.provider, "MOVA_FIAT_RAIL");
  assert.equal(r.legs[1]!.provider, "MOVA_ONRAMP");
  // 100 USDC notional: on-ramp 150bp (1500000) + fiat rail 100bp (1000000) + gas (1000)
  // + on-ramp slippage 20bp (200000) → total 2701000.
  assert.deepEqual(r.totalEstimatedCost, { asset: "USDC", amount: "2701000" });
});

test("default source assets fall back to the settlement token", async () => {
  const engine = new RouteDiscoveryEngine(marketData());
  const routes = await engine.discover(paymentIntent(), parsedIntent(USDC_100));
  assert.equal(routes.length, 1);
  assert.equal(routes[0]!.summary.sourceAsset, "USDC");
});

// ---------------------------------------------------------------------------
// Optimizer: scoring, comparison, savings
// ---------------------------------------------------------------------------

const OPTIMIZER = new RouteOptimizerEngine();

test("COST criterion selects the cheapest route with transparent scores", () => {
  const candidates = [
    candidate({ routeNo: 1, costUsdc: "1000", timeMs: 3000 }),
    candidate({ routeNo: 2, costUsdc: "601000", timeMs: 9000 }),
    candidate({ routeNo: 3, costUsdc: "676000", timeMs: 9000 }),
  ];
  const res = OPTIMIZER.optimize(candidates, "COST");
  assert.equal(res.selected?.routeNo, 1);
  assert.equal(res.routes.length, 3);
  assert.equal(res.selected!.selectionScore, 1);
  assert.equal(res.routes[0]!.status, "SELECTED");
  assert.equal(res.routes[1]!.status, "REJECTED");
  // Direct route is 1.0 on every factor (it is best on all five here).
  assert.deepEqual(res.routes[0]!.factorScores, {
    cost: 1,
    speed: 1,
    risk: 1,
    reliability: 1,
    liquidity: 1,
  });
  assert.ok(res.selected!.selectionReason.includes("cost(1.000)"));
  assert.ok(res.selected!.selectionReason.includes("0.5·cost"));
});

test("SPEED criterion prefers the faster route over the cheaper one", () => {
  // Route 1: cheapest but slow. Route 2: fastest but pricier.
  const candidates = [
    candidate({ routeNo: 1, costUsdc: "1000", timeMs: 900000 }),
    candidate({ routeNo: 2, costUsdc: "601000", timeMs: 3000 }),
  ];
  const byCost = OPTIMIZER.optimize(candidates, "COST");
  assert.equal(byCost.selected?.routeNo, 1);
  const bySpeed = OPTIMIZER.optimize(candidates, "SPEED");
  assert.equal(bySpeed.selected?.routeNo, 2);
});

test("user preference weights override the criterion profile", () => {
  const candidates = [
    candidate({ routeNo: 1, costUsdc: "1000", timeMs: 900000 }),
    candidate({ routeNo: 2, costUsdc: "601000", timeMs: 3000 }),
  ];
  const res = OPTIMIZER.optimize(candidates, "COST", {
    weights: { cost: 0, speed: 1, reliability: 0, risk: 0, liquidity: 0 },
  });
  assert.equal(res.selected?.routeNo, 2);
  // The returned weights are the normalized (here unchanged) user weights.
  assert.deepEqual(res.weights, {
    cost: 0,
    speed: 1,
    reliability: 0,
    risk: 0,
    liquidity: 0,
  });
});

test("invalid weights are rejected", () => {
  assert.throws(() =>
    OPTIMIZER.optimize([candidate({ routeNo: 1, costUsdc: "1", timeMs: 1 })], "COST", {
      weights: { cost: 0, speed: 0, reliability: 0, risk: 0, liquidity: 0 },
    }),
  );
});

test("empty candidates return an empty, non-crashing result", () => {
  const res = OPTIMIZER.optimize([], "COST");
  assert.equal(res.selected, null);
  assert.equal(res.routes.length, 0);
  assert.equal(res.savings, null);
  assert.equal(res.comparison.length, 0);
});

test("comparison table is ordered by routeNo and carries factor data", () => {
  const candidates = [
    candidate({ routeNo: 2, costUsdc: "601000", timeMs: 9000 }),
    candidate({ routeNo: 1, costUsdc: "1000", timeMs: 3000 }),
  ];
  const res = OPTIMIZER.optimize(candidates, "COST");
  assert.deepEqual(res.comparison.map((c) => c.routeNo), [1, 2]);
  assert.equal(res.comparison[0]!.selectionScore, 1);
});

test("savings: selected == cheapest → premium 0, savings vs worst > 0", () => {
  const candidates = [
    candidate({ routeNo: 1, costUsdc: "1000", timeMs: 3000 }),
    candidate({ routeNo: 2, costUsdc: "601000", timeMs: 9000 }),
    candidate({ routeNo: 3, costUsdc: "676000", timeMs: 9000 }),
  ];
  const res = OPTIMIZER.optimize(candidates, "COST");
  const s = res.savings!;
  assert.equal(s.cheapestRouteNo, 1);
  assert.equal(s.selectedRouteNo, 1);
  assert.equal(s.selectedIsCheapest, true);
  assert.deepEqual(s.premiumVsCheapest, { asset: "USDC", amount: "0" });
  assert.deepEqual(s.estimatedSavings, { asset: "USDC", amount: "675000" });
  assert.equal(s.mostExpensiveRouteNo, 3);
  assert.ok(s.explanation.includes("saves 0.675 USDC"));
});

test("savings: selected != cheapest exposes the premium paid", () => {
  const candidates = [
    candidate({ routeNo: 1, costUsdc: "1000", timeMs: 900000 }),
    candidate({ routeNo: 2, costUsdc: "601000", timeMs: 3000 }),
  ];
  const res = OPTIMIZER.optimize(candidates, "SPEED");
  const s = res.savings!;
  assert.equal(s.selectedRouteNo, 2);
  assert.equal(s.selectedIsCheapest, false);
  assert.deepEqual(s.premiumVsCheapest, { asset: "USDC", amount: "600000" });
  assert.deepEqual(s.estimatedSavings, { asset: "USDC", amount: "0" });
  assert.ok(s.explanation.includes("premium"));
});

test("optimizer is deterministic for identical input", () => {
  const candidates = [
    candidate({ routeNo: 1, costUsdc: "1000", timeMs: 3000 }),
    candidate({ routeNo: 2, costUsdc: "601000", timeMs: 9000 }),
  ];
  const a = OPTIMIZER.optimize(candidates, "COST", { now: 0 });
  const b = OPTIMIZER.optimize(candidates, "COST", { now: 0 });
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// RouteEngine facade (end to end)
// ---------------------------------------------------------------------------

test("RouteEngine.compute returns ranked routes + comparison + savings", async () => {
  const engine = new RouteEngine(marketData(), {
    availableAssets: ["USDC", "SUI", "MOV"],
  });
  const res = await engine.compute(paymentIntent(), parsedIntent(USDC_100), "COST", {
    paymentIntentId: "pay1",
    now: 0,
  });
  assert.equal(res.routes.length, 3);
  assert.equal(res.selected?.routeNo, 1); // direct USDC is cheapest
  assert.equal(res.selected!.paymentIntentId, "pay1");
  assert.ok(res.selected!.id.startsWith("route-pay1-"));
  assert.equal(res.comparison.length, 3);
  assert.equal(res.savings!.cheapestRouteNo, 1);
  assert.equal(res.engineVersion.length > 0, true);
  // The selection reason must contain the transparent math.
  assert.ok(res.selected!.selectionReason.includes("score 1.000"));
});
