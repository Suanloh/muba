/**
 * Phase 6 risk & hedging demo — Risk Assessment + Thetanuts Hedge Evaluation.
 *
 * Run: `npm run risk:demo`
 *
 * Demonstrates the concept "MOVA doesn't move money. It manages risk while
 * doing it." End-to-end:
 *
 *   discovery → optimization → risk assessment (5 signals)
 *     → hedge evaluation (route vs route+hedge) → final recommendation
 *
 * Uses the deterministic mock market data + the static/dev Thetanuts fallback
 * (honestly flagged `simulated: true`, `dataSource: STATIC_DEV`). The live
 * Thetanuts V4 Optionbook path is exercised in a separate scenario and reports
 * `UNAVAILABLE` (SDK not installed here) — never a fake live quote.
 */
import {
  HedgedRouteEngine,
  RiskEngine,
  RouteEngine,
  toDecimal,
} from "@mova/core";
import {
  MockMarketDataProvider,
  StaticThetanutsHedgingProvider,
  StaticVolatilityProvider,
  ThetanutsHedgingProvider,
} from "@mova/integrations";
import type {
  Money,
  ParsedIntent,
  PaymentIntent,
} from "@mova/types";

const PRICES: Record<string, string> = {
  SUI: "1.000000",
  USDC: "1.000000",
  MOV: "0.400000",
  MYR: "0.240000",
};

function parsedIntent(amount: Money): ParsedIntent {
  return {
    id: "pi-demo",
    paymentIntentId: "pay-demo",
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
    id: "pay-demo",
    correlationId: "corr-demo",
    intentRef: "PAY-DEMO-0001",
    userId: "u-demo",
    walletId: "w-demo",
    source: "CHAT",
    rawText: "Pay 100 USDC",
    network: "SUI_TESTNET",
    createdAt: 0,
    updatedAt: 0,
  };
}

function costOf(m: Money): string {
  return `${toDecimal(m)} ${m.asset}`;
}

async function scenario(
  title: string,
  intent: PaymentIntent,
  parsed: ParsedIntent,
  availableAssets: string[],
  horizonDays = 7,
): Promise<void> {
  console.log(`\n=== ${title} ===`);

  const marketData = new MockMarketDataProvider({ allowed: true, prices: PRICES, spreadBps: 5 });
  const volatility = new StaticVolatilityProvider({ allowed: true });
  const hedging = new StaticThetanutsHedgingProvider({ allowed: true });

  const engine = new HedgedRouteEngine(marketData, hedging, volatility, {
    availableAssets,
    horizonDays,
    now: 0,
  });
  const result = await engine.compute(intent, parsed, "COST");

  console.log("\n--- Routes (ranked) ---");
  for (const r of result.optimization.routes) {
    const mark = r.status === "SELECTED" ? "★" : " ";
    console.log(`${mark} Route ${r.routeNo}  [${r.summary.sourceAsset} → ${r.summary.destinationAsset}]  ${r.summary.legOrder.join(" → ")}`);
    console.log(`     cost ${costOf(r.totalEstimatedCost)}  ·  time ${(r.estimatedTimeMs / 1000).toFixed(1)}s  ·  risk ${r.risk.score}`);
  }

  console.log("\n--- Risk assessment (selected route) ---");
  const risk = result.recommendation.risk;
  console.log(`score ${risk.score}/100  band ${risk.band}  decision ${risk.decision}`);
  for (const s of risk.signals) {
    console.log(`  ${s.signalId.padEnd(20)} ${String(s.contribution).padStart(6)}/100  ${s.description}`);
  }

  console.log("\n--- Hedge evaluation (route vs route+hedge) ---");
  for (const c of result.comparisons) {
    console.log(`  Route ${c.routeNo}: ${c.hedgeDecision.padEnd(8)} ${c.strategy.padEnd(11)} without ${costOf(c.withoutHedge).padEnd(14)} with ${costOf(c.withHedge).padEnd(14)} reduction ${costOf(c.exposureReduction)}  (${c.dataSource})`);
  }

  const rec = result.recommendation;
  console.log("\n--- MOVA final recommendation ---");
  console.log(`  hedged: ${rec.hedged}  total cost ${costOf(rec.totalCost)}  risk ${risk.band} (${rec.decision})`);
  console.log(rec.explanation);
}

async function liveThetanutsUnavailableScenario(): Promise<void> {
  console.log("\n=== Live Thetanuts V4 Optionbook (honesty check) ===");
  const live = new ThetanutsHedgingProvider({ chainId: 8453, rpcUrl: "https://mainnet.base.org" });
  try {
    await live.quote({ asset: "SUI", amount: { asset: "USDC", amount: "100000000" }, strategy: "PUT_OPTION", durationDays: 7 });
    console.log("  unexpected: live quote returned");
  } catch (err) {
    console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    console.log("  → integration identified as UNAVAILABLE; static dev data is the honest dev fallback.");
  }
}

async function main(): Promise<void> {
  console.log("MOVA Phase 6 — Risk Assessment & Thetanuts Hedging demo");
  console.log("“MOVA doesn't move money. It manages risk while doing it.”\n");

  // 1) Payer holds only SUI, pays 100 USDC (volatile conversion).
  await scenario(
    "Scenario 1: pay 100 USDC funded by SUI (conversion + FX risk)",
    paymentIntent(),
    parsedIntent({ asset: "USDC", amount: "100000000" }),
    ["SUI"],
    7,
  );

  // 2) Payer holds USDC directly (stable, low risk).
  await scenario(
    "Scenario 2: pay 100 USDC funded by USDC (direct stablecoin)",
    paymentIntent(),
    parsedIntent({ asset: "USDC", amount: "100000000" }),
    ["USDC"],
    7,
  );

  // 3) Payer holds USDC/SUI/MOV/MYR — MOVA picks the best route + hedge view.
  await scenario(
    "Scenario 3: multi-asset payer (USDC/SUI/MOV/MYR) — best route + hedge",
    paymentIntent(),
    parsedIntent({ asset: "USDC", amount: "100000000" }),
    ["USDC", "SUI", "MOV", "MYR"],
    1,
  );

  await liveThetanutsUnavailableScenario();

  // 4) Deterministic raw risk engine on a fiat route (reference).
  const marketData = new MockMarketDataProvider({ allowed: true, prices: PRICES, spreadBps: 5 });
  const volatility = new StaticVolatilityProvider({ allowed: true });
  const routeEngine = new RouteEngine(marketData, { availableAssets: ["MYR"] });
  const cands = await routeEngine.discover(paymentIntent(), parsedIntent({ asset: "USDC", amount: "100000000" }));
  const fiatRoute = cands.find((r) => r.summary.sourceAsset === "MYR");
  if (fiatRoute) {
    const riskEngine = new RiskEngine({ marketData, volatility, horizonDays: 7, now: 0 });
    const risk = await riskEngine.assess(paymentIntent(), fiatRoute);
    console.log("\n=== Reference: fiat rail (MYR → USDC) risk ===");
    console.log(`score ${risk.score}/100  band ${risk.band}  decision ${risk.decision}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
