# MOVA — Payment Routing Engine (Phase 4)

> Deterministic route discovery & mathematical route optimization. The engine
> accepts a **normalized payment intent** (`ParsedIntent` with a validated
> `canonicalAmount`) and returns **ranked routes with transparent
> calculations** — no AI-generated scores anywhere.
>
> Code: `packages/core/src/routing/` · Types: `packages/types/src/domain.ts`
> · Entry point: `RouteEngine.compute(intent, parsed, criterion, options?)`

## 1. Why a routing engine

A payment can move through several rails (on-chain Sui transfer, a Sui DEX
conversion, a fiat on-ramp, an off-chain bank/e-wallet rail). Different rails
cost different amounts, take different times, and carry different risk. MOVA
must **discover** the viable routes and **select** one with a reproducible,
auditable calculation the user can inspect.

## 2. Route model

A **route** is an ordered list of **legs**. Every route ends with an
`ONCHAIN` leg on Sui and a `SETTLEMENT` leg to the recipient — MOVA always
settles on Sui.

| Leg kind | Meaning | Rails |
| --- | --- | --- |
| `ONCHAIN` | On-chain transfer of the settlement token on Sui | `SUI_CHAIN` (gas fee) |
| `SETTLEMENT` | Final delivery to the recipient on Sui | `SUI_SETTLEMENT` |
| `CONVERSION` | Swap/on-ramp into the settlement token | `MOVA_DEX`, `MOVA_ONRAMP` |
| `OFFCHAIN` | Off-chain fiat leg (bank/e-wallet/card) | `MOVA_FIAT_RAIL` |

Each leg carries: `from`, `to`, `asset`, `amount`, `provider`, `fee` (in the
leg's fee asset, e.g. gas in SUI), `estimatedTimeMs`, and deterministic
`reliability` / `liquidity` / `riskFactor` (0..1) plus a human `note`.

### Route families generated

Given the payer's `availableAssets` and the settlement token from the intent:

- **Direct** — source == settlement token:
  `ONCHAIN → SETTLEMENT`
- **Conversion** — token source ≠ settlement token:
  `CONVERSION (MOVA_DEX) → ONCHAIN → SETTLEMENT`
- **Fiat** — fiat source (USD, MYR, …):
  `OFFCHAIN (MOVA_FIAT_RAIL) → CONVERSION (MOVA_ONRAMP) → ONCHAIN → SETTLEMENT`

Routes that cannot be priced (no market quote) are **skipped, never guessed**.
If no route can be priced, the pipeline fails routing (state machine guard).

## 3. Cost calculation

All costs are computed in a common **`quoteAsset`** (default `USDC`) using
**integer (BigInt) math on smallest units** — no floats. Prices come from the
`MarketDataProvider` (`getQuote({ base, quote })`), which returns a mid price
plus bid/ask for spread.

Per route:

```
notionalUsdc   = value of the recipient amount (target token) in quoteAsset
                 = targetAmount_smallest × priceInt / 10^targetDecimals

leg fee        = fixedFee  (e.g. 0.001 SUI gas)   — converted to quoteAsset
               | notionalUsdc × feeBps / 10000     — proportional rail fees

spreadBps      = (ask − bid) / mid × 10000         — from the quote
swap fee       = notionalUsdc × feeBps / 10000     — MOVA_DEX / MOVA_ONRAMP
slippage       = notionalUsdc × slippageBps / 10000

cost.paymentFees    = Σ leg fees (in quoteAsset)
cost.conversionCost = Σ (swap fee + spread) on CONVERSION legs
cost.slippage       = Σ slippage on CONVERSION legs
cost.other          = 0 (reserved)
cost.total          = paymentFees + slippage        == totalEstimatedCost
```

## 4. Scoring — deterministic composite

Each factor is normalized to **1 = best** across the candidate set
(min–max, equal values → all best):

| Factor | Score (1 = best) | Source |
| --- | --- | --- |
| Cost | `1 − (cost − min)/(max − min)` | `totalEstimatedCost` |
| Speed | `1 − (time − min)/(max − min)` | `estimatedTimeMs` |
| Risk | `1 − (risk − min)/(max − min)` | `risk.score` (0..1, lower safer) |
| Reliability | `(rel − min)/(max − min)` | product of leg reliabilities |
| Liquidity | `(liq − min)/(max − min)` | min of leg liquidity |

Composite:

$$\text{selectionScore} = \sum_{f \in \{cost, speed, risk, reliability, liquidity\}} w_f \cdot \text{score}_f, \qquad \sum w_f = 1$$

Weights come from a deterministic **criterion profile** or an explicit
**user preference** — never an AI guess:

| Criterion | cost | speed | risk | reliability | liquidity |
| --- | --- | --- | --- | --- | --- |
| `COST` | 0.50 | 0.10 | 0.15 | 0.20 | 0.05 |
| `SPEED` | 0.10 | 0.50 | 0.15 | 0.20 | 0.05 |
| `RELIABILITY` | 0.15 | 0.10 | 0.15 | 0.50 | 0.10 |

User weights are validated (finite, non-negative, sum > 0) then normalized to
sum to 1. Ties break by lower cost → lower time → lower `routeNo`.

Every route's `selectionReason` spells out the math, e.g.:

```
Selected route 1 — score 1.000 = 0.5·cost(1.000) + 0.1·speed(1.000) + 0.15·risk(1.000) + 0.2·reliability(1.000) + 0.05·liquidity(1.000).
Cost 0.001 USDC, time 3000ms, risk 0.01, reliability 0.98, liquidity 1.
```

## 5. Mathematical comparison

`RouteOptimizationResult.comparison[]` is a table (one row per route) with
`totalCost`, `estimatedTimeMs`, `riskScore`, `reliability`, `liquidity`,
`selectionScore` — the data behind a "Route A vs Route B" UI. The selected
route is `result.selected` (status `SELECTED`); the rest are `REJECTED`.

## 6. Savings

`RouteOptimizationResult.savings` (`RouteSavings`) computes:

- **Cheapest route** — lowest `totalEstimatedCost`.
- **Selected route** — the optimizer's pick.
- **Most expensive route** — highest `totalEstimatedCost` (reference).
- `premiumVsCheapest` = selected cost − cheapest cost (0 when they coincide).
- `estimatedSavings` = most expensive cost − selected cost (money saved vs the
  worst viable option).
- `explanation` — the math in plain text.

## 7. Usage

```ts
import { RouteEngine } from "@mova/core";
import { MockMarketDataProvider } from "@mova/integrations";

const marketData = new MockMarketDataProvider({ allowed: true, prices: PRICES });
const engine = new RouteEngine(marketData, { availableAssets: ["USDC", "SUI", "MOV"] });

const result = await engine.compute(paymentIntent, parsedIntent, "COST", {
  paymentIntentId: "pay1",
  // Optional: override the criterion profile with explicit user weights:
  // weights: { cost: 0.4, speed: 0.3, reliability: 0.2, risk: 0.05, liquidity: 0.05 },
});

result.selected;            // Route | null
result.comparison;          // comparison rows
result.savings;             // cheapest / selected / premium / savings
result.selected!.selectionReason; // the exact scoring math
```

Determinism: for a fixed candidate set, prices, rails and weights, the same
intent produces the same ranked routes and savings. No randomness, no LLM.
