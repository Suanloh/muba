/**
 * MOVA Phase 7 — Payment Execution module.
 *
 * Deterministic plan construction, payment preview, failure classification,
 * and idempotency for the human-approval execution pipe. Exports the
 * `PaymentExecutionEngine` facade (routing → compliance → risk/hedge → spec →
 * preview) plus the plan/idempotency/failure building blocks.
 */
export * from "./sha256.js";
export * from "./plan.js";
export * from "./preview.js";
export * from "./compliance.js";
export * from "./failure.js";
export * from "./idempotency.js";
export * from "./engine.js";

export const EXECUTION_ENGINE_VERSION = "1.0.0";
