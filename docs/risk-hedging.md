# MOVA — Risk Assessment & Thetanuts Hedging (Phase 6)

> MOVA doesn't move money. It manages risk while doing it.
>
> Phase 6 adds a deterministic **financial risk assessment** and **hedge
> evaluation** that feeds MOVA's **final payment recommendation**: the routed
> route, its risk, and whether to add a hedge (and at what cost) — compared
> explicitly as **route vs route + hedge**.
>
> Code: `packages/core/src/risk/` · Providers: `packages/integrations/src/`
> (`thetanuts.ts`, `volatility.ts`) · Types: `packages/types/src/domain.ts` ·
> Entry point: `HedgedRouteEngine.compute(...)`

## 1. The concept

Routing (Phase 4) finds *how* to move money cheapest/safest. Phase 6 answers
the deeper question: **is the money safe to move at all, and is a hedge worth
it?** The deliverable is a `PaymentRecommendation`:

```ts
{
  route,                    // the routed route (Phase 4)
  risk,                     // RiskAssessment (5 signals, band, decision)
  hedge,                    // RouteHedgeComparison (with vs without hedge)
  totalCost,                // route cost + hedge premium when hedged
  hedged,                   // true when a hedge is in the recommendation
  decision,                 // PROCEED | REVIEW | BLOCK (from financial risk)
  explanation,              // deterministic, human-readable math
}
```

Everything is deterministic and explainable — no LLM, no randomness.

## 2. Risk assessment (`RiskEngine`)

Scores a routed payment 0–100 across **five signals** (each 0–100):

| Signal | What it measures | Contribution (0–100) |
| --- | --- | --- |
| `ASSET_VOLATILITY` | Value-at-Risk of the **settlement token** over the horizon | `min(100, varPct / 5% · 100)` |
| `FX_EXPOSURE` | VaR of the **conversion leg** (source asset) when converting | same mapping; 0 when no conversion |
| `ROUTE_RISK` | the route's composite leg-risk factor | `route.risk.score × 100` |
| `LIQUIDITY_RISK` | illiquidity of the least-liquid leg | `(1 − route.liquidity) × 100` |
| `SETTLEMENT_RISK` | unreliability of the final settlement leg | `(1 − settlementLeg.reliability) × 100` |

**VaR model** (`src/risk/volatility.ts`), deterministic, integer-safe for money:

$$\text{dailyVol} = \frac{\text{annualizedVol}}{\sqrt{365}}, \qquad
\text{VaR ratio} = z(\text{confidence}) \cdot \text{dailyVol} \cdot \sqrt{\text{horizonDays}}$$

$$\text{VaR} = \text{notional} \times \lfloor \text{ratio} \times 10^6 \rfloor / 10^6$$

Volatility comes from a `VolatilityProvider` — the live Thetanuts provider
derives it from the V4 Optionbook implied vol (`greeks.iv`) when reachable,
otherwise a static dev table (`STATIC_DEV_TABLE`, `simulated: true`). If
volatility data is missing, the signal is `0` and the **gap is recorded, never
guessed**.

**Composite score** = $\sum_i w_i \cdot \text{contribution}_i$ with default
weights `{ assetVolatility: .25, fxExposure: .25, routeRisk: .20,
liquidityRisk: .15, settlementRisk: .15 }` (user-overridable, normalized to 1).

**Band / decision:**

| Score | Band | Decision |
| --- | --- | --- |
| < 25 | `LOW` | `PROCEED` |
| 25–49 | `MEDIUM` | `PROCEED` |
| 50–74 | `HIGH` | `REVIEW` |
| ≥ 75 | `CRITICAL` | `BLOCK` |

The state machine already refuses to pass `RISK_ASSESSED` when
`riskDecision === "BLOCK"` (fail-closed).

## 3. Hedge evaluation (`HedgingEngine`)

Decides whether a hedge is needed, which instrument, what it costs, and what
it buys — then compares the route **with** vs **without** the hedge.

**Decision rules (deterministic):**

```
hedgeNeeded       = risk.score >= trigger(30)
                    OR material adverse move (asset or FX VaR >= 1%)
strategy          = PUT_OPTION (protection) when there is price exposure
                    else NONE (a payment hedge is protection, not yield)
coverage          = quote.coverage (ATM put ≈ 0.5 of the tail VaR)
exposureReduction = hedgedVaR × coverage          (hedgedVaR = FX VaR when converting)
hedgeWorthIt      = hedgeCost < exposureReduction  (cost < risk removed)
                    AND premium <= 5% of notional   (sanity cap)
decision          = HEDGE iff hedgeNeeded AND hedgeWorthIt AND quote available
                    else NO_HEDGE
```

**Effect on the route cost** is reported two ways:

- `hedgeCost` / `delta` — the premium added to the route cost (e.g. +1.50 USDC).
- `deltaBps` — premium as basis points of the *route cost* (the "effect on
  overall route cost", shown for transparency; the decision uses the
  notional-relative cap because fees are tiny vs notional).

## 4. Route + hedge optimization (`HedgedRouteEngine`)

The facade that feeds MOVA's final recommendation:

```
RouteEngine.discover → RouteEngine.optimize
  → RiskEngine.assess (per route)
  → HedgingEngine.evaluate (per route, route vs route+hedge)
  → PaymentRecommendation (selected route + risk + hedge + total cost)
```

`HedgedRouteResult` exposes:

- `optimization` — the Phase 4 ranked routes + savings.
- `recommendation` — the final `PaymentRecommendation` for the selected route.
- `comparisons` — one `RouteHedgeComparison` per route (the "route vs
  route+hedge" table for the UI).

The decision is deterministic and explainable: `selectionReason` (routing) +
`risk.explanation` + `hedge.reason` (hedging) all spell out the math.

## 5. Thetanuts V4 integration (honest)

Two providers sit behind the same `HedgingProvider` + `VolatilityProvider`
boundaries (`packages/integrations/src/thetanuts.ts`):

### `ThetanutsHedgingProvider` (REAL)

Targets Thetanuts V4 / Optionbook (SDK `@thetanuts-finance/thetanuts-client`,
Base mainnet, underlyings **ETH/BTC**). Read-only quotes via the SDK:

- `client.api.fetchOrders()` / `filterOrders({ isCall: false })` — live PUTs.
- `rawApiData.greeks.iv` → implied volatility for the risk engine.
- `order.price` (price per contract, 8-dec) → live premium reference.

The SDK and `ethers` are **optional runtime dependencies** (dynamically
imported, non-literal specifiers so neither the compiler nor webpack hard-fails
on their absence). Any failure — SDK missing, no orders, unreachable book,
unsupported asset (e.g. SUI), wrong chain — raises `ERR_INTEGRATION_UNAVAILABLE`
with a clear reason. **It never fabricates a live quote.**

> Note: webpack logs a "Critical dependency: the request of a dependency is an
> expression" warning for the optional dynamic imports — expected and harmless;
> the build succeeds and the live provider simply reports UNAVAILABLE at runtime.

### `StaticThetanutsHedgingProvider` (DEV/DEMO)

Serves a cached, versioned reference table (premium bps per strategy, coverage
ratio, implied-vol table). Every quote is `simulated: true`,
`dataSource: "STATIC_DEV"`, and the provider refuses to run outside the
dev/demo boundary (`ERR_MOCK_FORBIDDEN`). This is the honest "cached/static dev
data" path used when live data is unavailable — **never presented as live**.

### Failback rule (task 5)

- Live data available → `dataSource: "LIVE"`, `simulated: false`.
- Live data unavailable → integration identified `UNAVAILABLE`;
  `HedgingEngine` records the gap, `hedgeDecision = NO_HEDGE`,
  `recommended = false`, and explains why. Cached/static dev data is only used
  in dev/demo mode and stays `STATIC_DEV`/`simulated`.

## 6. Usage

```ts
import { HedgedRouteEngine } from "@mova/core";
import {
  MockMarketDataProvider,
  StaticThetanutsHedgingProvider,
  StaticVolatilityProvider,
} from "@mova/integrations";

const marketData = new MockMarketDataProvider({ allowed: true, prices: PRICES, spreadBps: 5 });
const volatility = new StaticVolatilityProvider({ allowed: true });
const hedging = new StaticThetanutsHedgingProvider({ allowed: true });

const engine = new HedgedRouteEngine(marketData, hedging, volatility, {
  availableAssets: ["USDC", "SUI", "MOV", "MYR"],
  horizonDays: 7,
});

const result = await engine.compute(intent, parsed, "COST");

result.recommendation.hedged;        // true when a hedge is recommended
result.recommendation.risk;          // band, score, signals, decision
result.recommendation.totalCost;     // route cost + hedge premium when hedged
result.comparisons;                  // per-route with-vs-without hedge
```

Run the CLI demo: `npm run risk:demo` (`scripts/risk-hedge-demo.ts`).

## 7. Demo walkthrough (`npm run risk:demo`)

**Scenario — pay 100 USDC funded by SUI (7d horizon):**

```
score 28/100  band MEDIUM  decision PROCEED
  ASSET_VOLATILITY    4.56/100   USDC settlement is stable
  FX_EXPOSURE       100.00/100   SUI → USDC conversion VaR = 12.5% of notional
  ROUTE_RISK          2.70/100
  LIQUIDITY_RISK      5.00/100
  SETTLEMENT_RISK     1.00/100

Hedge: HEDGE (PUT_OPTION)
  without hedge 0.601 USDC · with hedge 2.101 USDC
  premium 1.50 USDC removes 6.26 USDC of VaR (6.3% of notional)
```

MOVA's recommendation: "this payment is MEDIUM risk driven by a 12.5% FX VaR;
a 1.5 USDC Thetanuts put removes 6.26 USDC of that exposure." That is the
concept — **MOVA manages the risk while doing it.**

## 8. Files

| File | Purpose |
| --- | --- |
| `packages/core/src/risk/volatility.ts` | VaR/z-score math (deterministic) |
| `packages/core/src/risk/risk-engine.ts` | `RiskEngine` → `RiskAssessment` |
| `packages/core/src/risk/hedging-engine.ts` | `HedgingEngine` → route vs hedge |
| `packages/core/src/risk/recommendation.ts` | `HedgedRouteEngine` facade |
| `packages/integrations/src/thetanuts.ts` | live + static Thetanuts providers |
| `packages/integrations/src/volatility.ts` | `VolatilityProvider` + static table |
| `apps/web/components/RiskAssessmentPanel.tsx` | risk & hedge UI panel |
| `scripts/risk-hedge-demo.ts` | CLI demo (`npm run risk:demo`) |
