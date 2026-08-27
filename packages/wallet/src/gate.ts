/**
 * Wallet execution gate — the MOVA safety boundary at the wallet layer.
 *
 * The wallet layer must NEVER automatically execute arbitrary (AI-generated)
 * transactions. Every transaction must pass through:
 *
 *     Intent → Validation → Approval → Wallet authz → Execution
 *
 * This gate is the deterministic enforcement point: an adapter may build,
 * sign, or submit a transaction ONLY when `check()` returns
 * `{ allowed: true, code: "PASS" }`. Anything else (missing validation,
 * missing human approval, missing/expired/mismatched authz, wrong owner,
 * wrong network, not connected) fails CLOSED.
 *
 * Pure + deterministic so it can be unit-tested and reused by any adapter.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type { PaymentState } from "@mova/types";
import { addressesEqual, verifyPaymentAuthz } from "./ownership.js";
import type { PaymentAuthz } from "./types.js";

export type GateCheckCode =
  | "PASS"
  | "NOT_CONNECTED"
  | "NO_VALIDATED_INTENT"
  | "STATE_NOT_EXECUTABLE"
  | "NOT_APPROVED"
  | "AUTHZ_MISSING"
  | "AUTHZ_INVALID"
  | "AUTHZ_EXPIRED"
  | "AUTHZ_OWNER_MISMATCH"
  | "NETWORK_MISMATCH";

export interface WalletGateContext {
  connected: boolean;
  ownerAddress: string | null;
  recordId: string;
  state: PaymentState;
  /** Deterministic validator said VALIDATED. */
  validated: boolean;
  /** True once the human approval request reached APPROVED. */
  approved: boolean;
  /** Wallet-scoped payment authorization issued from the approval. */
  authz: PaymentAuthz | null;
  /** Wallet chain matches the MOVA expected network. */
  networkMatches: boolean;
  now?: number;
}

export interface GateVerdict {
  allowed: boolean;
  code: GateCheckCode;
  reason: string;
}

function verdict(allowed: boolean, code: GateCheckCode, reason: string): GateVerdict {
  return { allowed, code, reason };
}

export class WalletExecutionGate {
  /** Deterministic gate — the ONLY path that authorizes wallet execution. */
  check(ctx: WalletGateContext): GateVerdict {
    if (!ctx.connected || !ctx.ownerAddress) {
      return verdict(false, "NOT_CONNECTED", "no wallet connected — execution refused");
    }
    if (!ctx.validated) {
      return verdict(
        false,
        "NO_VALIDATED_INTENT",
        "intent not deterministically validated — execution refused",
      );
    }
    if (ctx.state !== "APPROVED" && ctx.state !== "EXECUTING") {
      return verdict(
        false,
        "STATE_NOT_EXECUTABLE",
        `state ${ctx.state} is not executable (requires APPROVED)`,
      );
    }
    if (!ctx.approved) {
      return verdict(
        false,
        "NOT_APPROVED",
        "no human approval recorded — AI suggestions can never authorize execution",
      );
    }
    const authz = verifyPaymentAuthz({
      authz: ctx.authz,
      paymentRecordId: ctx.recordId,
      ownerAddress: ctx.ownerAddress,
      now: ctx.now,
    });
    if (authz.code === "MISSING") {
      return verdict(false, "AUTHZ_MISSING", "no wallet-scoped payment authz present");
    }
    if (authz.code === "EXPIRED") {
      return verdict(false, "AUTHZ_EXPIRED", authz.reason);
    }
    if (authz.code === "OWNER_MISMATCH") {
      return verdict(false, "AUTHZ_OWNER_MISMATCH", authz.reason);
    }
    if (!authz.ok) {
      return verdict(false, "AUTHZ_INVALID", authz.reason);
    }
    if (ctx.authz && !addressesEqual(ctx.authz.ownerAddress, ctx.ownerAddress)) {
      return verdict(false, "AUTHZ_OWNER_MISMATCH", "authz owner differs from connected wallet");
    }
    if (!ctx.networkMatches) {
      return verdict(
        false,
        "NETWORK_MISMATCH",
        "wallet chain does not match the MOVA expected network — execution refused",
      );
    }
    return verdict(
      true,
      "PASS",
      "gate passed: validated intent + human approval + wallet-scoped authz",
    );
  }
}

/** Throw a typed MovaError when the verdict is not a pass (fail closed). */
export function assertGatePasses(verdictToCheck: GateVerdict): asserts verdictToCheck is {
  allowed: true;
  code: "PASS";
  reason: string;
} {
  if (!verdictToCheck.allowed) {
    throw new MovaError(
      ErrorCode.EXECUTION_GATE_BLOCKED,
      `wallet execution gate blocked: ${verdictToCheck.reason}`,
      { details: { code: verdictToCheck.code } },
    );
  }
}
