/**
 * Phase 4 routing demo — Route Discovery & Mathematical Route Optimization.
 *
 * Run: `npm run routing:demo`
 *
 * Exercises `RouteEngine.compute` end-to-end with the deterministic mock
 * market data provider: discovers candidate routes across rails, scores them
 * with the COST criterion, and prints the ranked routes, the mathematical
 * comparison and the savings analysis.
 */
import { RouteEngine } from "@mova/core";
import { MockMarketDataProvider } from "@mova/integrations";
import type {
  Money,
  ParsedIntent,
  PaymentIntent,
  Route,
} from "@mova/types";
import { toDecimal } from "@mova/core";

const PRICES: Record<string, string> = {
  SUI: "1.000000", // 1 SUI = 1 USDC (demo rate)
  USDC: "1.000000",
  MOV: "0.400000", // 1 MOV = 0.40 USDC
  MYR: "0.240000", // 1 MYR = 0.24 USDC
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

function legOrder(r: Route): string {
  return r.summary.legOrder.join(" → ");
}

function costOf(m: Money): string {
  return `${toDecimal(m)} ${m.asset}`;
}

async function main(): Promise<void> {
  const marketData = new MockMarketDataProvider({ allowed: true, prices: PRICES, spreadBps: 5 });
  const engine = new RouteEngine(marketData, {
    // The payer can source from any of these; MYR demonstrates the fiat rail.
    availableAssets: ["USDC", "SUI", "MOV", "MYR"],
  });

  const intent = paymentIntent();
  const parsed = parsedIntent({ asset: "USDC", amount: "100000000" }); // 100 USDC
  const result = await engine.compute(intent, parsed, "COST", {
    paymentIntentId: "pay-demo",
    now: 0,
  });

  console.log("=== Route Discovery (100 USDC to a Sui address) ===\n");
  for (const r of result.routes) {
    const mark = r.status === "SELECTED" ? "★" : " ";
    console.log(
      `${mark} Route ${r.routeNo}  [${r.summary.sourceAsset} → ${r.summary.destinationAsset}]  ${legOrder(r)}`,
    );
    console.log(`     cost ${costOf(r.totalEstimatedCost)}  ·  time ${(r.estimatedTimeMs / 1000).toFixed(1)}s  ·  risk ${r.risk.score}  ·  reliability ${r.reliability}`);
    for (const leg of r.legs) {
      console.log(`       - ${leg.kind.padEnd(10)} ${leg.provider.padEnd(14)} fee ${costOf(leg.fee)}  ${leg.note}`);
    }
  }

  console.log("\n=== Mathematical Comparison ===\n");
  console.log("  route |   cost (USDC) |  time  | risk | rel | liq | score");
  console.log("  ------|---------------|--------|------|-----|-----|------");
  for (const c of result.comparison) {
    console.log(
      `     ${String(c.routeNo).padEnd(3)} | ${costOf(c.totalCost).padEnd(13)} | ${(c.estimatedTimeMs / 1000).toFixed(1).padEnd(5)}s | ${c.riskScore.toFixed(2).padEnd(4)} | ${c.reliability.toFixed(2)} | ${c.liquidity.toFixed(2)} | ${c.selectionScore.toFixed(3)}`,
    );
  }

  const sel = result.selected!;
  console.log(`\n=== Selected: Route ${sel.routeNo} ===`);
  console.log(sel.selectionReason);

  const s = result.savings!;
  console.log("\n=== Savings ===");
  console.log(s.explanation);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
