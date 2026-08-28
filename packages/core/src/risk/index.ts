/**
 * MOVA Phase 6 — Risk assessment & Thetanuts hedging (deterministic).
 *
 * Exports:
 *   - `RiskEngine`          → financial risk assessment (score, band, decision)
 *   - `HedgingEngine`       → hedge evaluation (route vs route+hedge)
 *   - `HedgedRouteEngine`   → final payment recommendation facade
 *   - volatility math       → deterministic VaR model
 */
export * from "./volatility.js";
export * from "./risk-engine.js";
export * from "./hedging-engine.js";
export * from "./recommendation.js";
