/**
 * MOVA Phase 1 demo pipeline (deterministic, framework-agnostic).
 *
 * This is a DEMO of the canonical flow — it drives the `@mova/types` state
 * machine and the `@mova/wallet` execution gate WITHOUT touching a chain:
 *
 *   Intent → Validation → (route/compliance/risk simulated) → Approval
 *   → Wallet authz (signature) → Simulated execution
 *
 * Important:
 * - The parser here is a DETERMINISTIC demo validator, not the Gemini AI.
 *   The real AI parser (Phase 1 backend) is proposal-only anyway.
 * - No real funds move. Simulated settlement never fabricates a digest
 *   (`txDigest = null`, `simulated = true`).
 * - Nothing advances to EXECUTING/SETTLED without a passing
 *   `WalletExecutionGate` verdict (human approval + wallet authz).
 */
import { PaymentStateMachine } from "@mova/core";
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  AuditEvent,
  Money,
  Network,
  PaymentEvent,
  PaymentGuardContext,
  PaymentState,
} from "@mova/types";
import {
  createPaymentRecord,
  issuePaymentAuthz,
  issuePaymentReceipt,
  settlementOutcome,
  WalletExecutionGate,
  type ApprovalView,
  type MovaWalletProvider,
  type PaymentAuthz,
  type PaymentRecord,
  type PaymentReceipt,
  type PaymentSettlement,
  type SuiAddress,
} from "@mova/wallet";

// ---------------------------------------------------------------------------
// Asset registry (smallest-unit math, no floats)
// ---------------------------------------------------------------------------

const ASSET_DECIMALS: Record<string, number> = {
  SUI: 9,
  USDC: 6,
  MOV: 8,
};

export type DemoAction = "PAY" | "TRANSFER";

export interface DemoParsedIntent {
  action: DemoAction;
  amount: Money;
  recipient: { type: "ADDRESS" | "EMAIL" | "HANDLE"; value: string; name: string | null };
  network: Network;
  memo: string | null;
  validated: boolean;
  errors: string[];
}

function toSmallestUnits(value: string, decimals: number): string {
  const [whole = "0", frac = ""] = value.split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${whole}${fracPadded}`).toString();
}

/**
 * Deterministic demo validator — parses natural language into a validated
 * intent. Replaces the AI parser for this phase; all figures are recomputed
 * here (the AI never is).
 */
export function parseDemoIntent(rawText: string, network: Network): DemoParsedIntent {
  const text = rawText.trim();
  const errors: string[] = [];

  const action: DemoAction = /^(pay\b|pay\s)/i.test(text) ? "PAY" : /^(send\b|transfer\b)/i.test(text) ? "TRANSFER" : "PAY";

  const amountMatch = text.match(/(\d+(?:\.\d{1,18})?)\s*(SUI|USDC|MOV)\b/i);
  let amount: Money | null = null;
  if (!amountMatch) {
    errors.push("No amount found (e.g. \"10 SUI\" or \"5 USDC\").");
  } else {
    const [, raw, assetRaw] = amountMatch;
    const asset = assetRaw!.toUpperCase();
    const decimals = ASSET_DECIMALS[asset] ?? 9;
    amount = { asset, amount: toSmallestUnits(raw!, decimals) };
    if (BigInt(amount.amount) <= 0n) errors.push("Amount must be positive.");
  }

  let recipient: DemoParsedIntent["recipient"] | null = null;
  const addrMatch = text.match(/0x[0-9a-fA-F]{8,}/);
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const handleMatch = text.match(/@([\w-]{3,})/);
  if (addrMatch) {
    recipient = { type: "ADDRESS", value: addrMatch[0].toLowerCase(), name: null };
  } else if (emailMatch) {
    recipient = { type: "EMAIL", value: emailMatch[0].toLowerCase(), name: null };
  } else if (handleMatch) {
    recipient = { type: "HANDLE", value: handleMatch[0], name: null };
  } else {
    errors.push("No recipient found (Sui address, email, or @handle).");
  }

  const memoMatch = text.match(/(?:for|memo|note)\s*:?\s*["']?([^"'.]{2,40})["']?/i);
  const memo = memoMatch ? memoMatch[1]?.trim() ?? null : null;

  if (recipient?.type === "ADDRESS" && !/^0x[0-9a-fA-F]{1,64}$/.test(recipient.value)) {
    errors.push("Recipient address is not a valid Sui address.");
  }

  return {
    action,
    amount: amount ?? { asset: "SUI", amount: "0" },
    recipient: recipient ?? { type: "ADDRESS", value: "", name: null },
    network,
    memo,
    validated: errors.length === 0 && amount !== null && recipient !== null,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

function audit(
  correlationId: string,
  entityId: string,
  eventType: string,
  actor: AuditEvent["actor"],
  previousState: string | null,
  newState: string | null,
  simulated: boolean,
  payload: unknown,
): AuditEvent {
  return {
    id: crypto.randomUUID(),
    correlationId,
    entityType: "PAYMENT_INTENT",
    entityId,
    eventType,
    actor,
    payload,
    previousState,
    newState,
    simulated,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Flow helpers
// ---------------------------------------------------------------------------

export interface FlowResult {
  record: PaymentRecord;
  events: AuditEvent[];
  receipt: PaymentReceipt | null;
}

const gate = new WalletExecutionGate();

function guardContext(
  record: PaymentRecord,
  stage: "validation" | "compliance" | "risk" | "approval" | "execution" | "settlement",
): PaymentGuardContext {
  return {
    hasValidatedIntent: record.validated,
    complianceDecision: stage === "compliance" || stage === "risk" || stage === "approval" || stage === "execution" || stage === "settlement" ? "ALLOW" : null,
    riskDecision: stage === "risk" || stage === "approval" || stage === "execution" || stage === "settlement" ? "PROCEED" : null,
    approvalsMet: record.approval?.decision === "APPROVE",
    settlementConfirmed: stage === "settlement",
  };
}

function applyTransition(
  record: PaymentRecord,
  event: PaymentEvent,
  stage: "validation" | "compliance" | "risk" | "approval" | "execution" | "settlement",
): { record: PaymentRecord; ok: boolean; reason: string | null } {
  const sm = new PaymentStateMachine(guardContext(record, stage));
  const outcome = sm.apply(record.state, event);
  if (!outcome.ok || outcome.to === null) {
    return { record, ok: false, reason: outcome.reason };
  }
  return {
    record: { ...record, state: outcome.to, updatedAt: Date.now() },
    ok: true,
    reason: null,
  };
}

/** Create a flow from raw text (deterministic validation included). */
export function createFlow(
  rawText: string,
  ownerAddress: SuiAddress,
  network: Network,
  now = Date.now(),
): { record: PaymentRecord; parsed: DemoParsedIntent; events: AuditEvent[] } {
  const parsed = parseDemoIntent(rawText, network);
  const id = `pay_${crypto.randomUUID()}`;
  const correlationId = crypto.randomUUID();
  const record: PaymentRecord = {
    ...createPaymentRecord({
      id,
      correlationId,
      ownerAddress,
      rawText,
      action: parsed.action,
      amount: parsed.amount,
      recipient: parsed.recipient,
      network,
      memo: parsed.memo,
      state: "CREATED",
      createdAt: now,
    }),
    // The deterministic validator's result is authoritative.
    validated: parsed.validated,
  };
  const events = [
    audit(
      correlationId,
      id,
      "INTENT_CREATED",
      { type: "USER", id: ownerAddress },
      null,
      "CREATED",
      false,
      { rawText, validated: parsed.validated },
    ),
  ];
  return { record, parsed, events };
}

/** Advance a VALIDATED flow through the simulated deterministic stages to AWAITING_APPROVAL. */
export function runToAwaitingApproval(
  record: PaymentRecord,
  now = Date.now(),
): { record: PaymentRecord; events: AuditEvent[]; ok: boolean; reason: string | null } {
  if (!record.validated) {
    return { record, events: [], ok: false, reason: "intent not validated" };
  }
  const events: AuditEvent[] = [];
  let current: PaymentRecord = { ...record, state: "PARSED", updatedAt: now };
  events.push(
    audit(record.correlationId, record.id, "INTENT_PARSED", { type: "SYSTEM", id: "intent-validator" }, "CREATED", "PARSED", false, {
      action: record.action,
      amount: record.amount,
      recipient: record.recipient,
    }),
  );

  const steps: Array<{
    event: PaymentEvent;
    to: PaymentState;
    stage: "validation" | "compliance" | "risk" | "approval";
    name: string;
    simulated: boolean;
  }> = [
    { event: "ROUTE_FOUND", to: "ROUTE_FOUND", stage: "validation", name: "ROUTE_FOUND", simulated: true },
    { event: "COMPLIANCE_CHECKED", to: "COMPLIANCE_CHECKED", stage: "compliance", name: "COMPLIANCE_CHECKED", simulated: true },
    { event: "RISK_ASSESSED", to: "RISK_ASSESSED", stage: "risk", name: "RISK_ASSESSED", simulated: true },
    { event: "APPROVAL_REQUESTED", to: "AWAITING_APPROVAL", stage: "approval", name: "APPROVAL_REQUESTED", simulated: false },
  ];

  for (const step of steps) {
    const next = applyTransition(current, step.event, step.stage);
    if (!next.ok) return { record: current, events, ok: false, reason: next.reason };
    current = next.record;
    events.push(
      audit(record.correlationId, record.id, step.name, { type: "SYSTEM", id: "demo-engine" }, events[events.length - 1]?.newState ?? current.state, step.to, step.simulated, {
        simulated: step.simulated,
        stage: step.name,
      }),
    );
  }

  const approvalView: ApprovalView = {
    status: "PENDING",
    decision: null,
    resolvedAt: null,
    reason: `Owner ${record.ownerAddress.slice(0, 10)}… must approve this payment (threshold-met demo).`,
  };
  current = { ...current, approval: approvalView, updatedAt: now };
  return { record: current, events, ok: true, reason: null };
}

/** Human approval — issues a wallet-scoped PaymentAuthz ONLY on APPROVE. */
export function approveFlow(
  record: PaymentRecord,
  approverAddress: SuiAddress,
  now = Date.now(),
): { record: PaymentRecord; events: AuditEvent[]; authz: PaymentAuthz | null } {
  const decision = "APPROVE" as const;
  const authz = issuePaymentAuthz({
    paymentRecordId: record.id,
    ownerAddress: approverAddress,
    action: record.action,
    amount: record.amount,
    recipient: record.recipient.value,
    network: record.network,
    approvalDecision: decision,
    approvalNonce: crypto.randomUUID(),
    issuedAt: now,
    ttlMs: 15 * 60 * 1000,
  });

  const approvalView: ApprovalView = {
    status: "APPROVED",
    decision: "APPROVE",
    resolvedAt: now,
    reason: `Approved by owner ${approverAddress.slice(0, 10)}…`,
  };

  const next = applyTransition(
    { ...record, approval: approvalView, authz },
    "APPROVED",
    "approval",
  );
  if (!next.ok) throw new MovaError(ErrorCode.APPROVAL_REJECTED, next.reason ?? "approval transition failed");

  const events = [
    audit(record.correlationId, record.id, "APPROVED", { type: "APPROVER", id: approverAddress }, record.state, "APPROVED", false, {
      decision,
      authzId: authz.id,
      nonce: authz.nonce,
      expiresAt: authz.expiresAt,
    }),
  ];
  return { record: next.record, events, authz };
}

export function rejectFlow(
  record: PaymentRecord,
  approverAddress: SuiAddress,
): { record: PaymentRecord; events: AuditEvent[] } {
  const next = applyTransition(
    record,
    "APPROVAL_REJECTED",
    "approval",
  );
  const finalRecord = next.ok ? next.record : { ...record, state: "FAILED" as PaymentState, updatedAt: Date.now() };
  return {
    record: finalRecord,
    events: [
      audit(record.correlationId, record.id, "APPROVAL_REJECTED", { type: "APPROVER", id: approverAddress }, record.state, "FAILED", false, { decision: "REJECT" }),
    ],
  };
}

/** Run the gate against a record; returns the verdict (never throws). */
export function checkGateForRecord(
  record: PaymentRecord,
  ctx: { connected: boolean; ownerAddress: string | null; networkMatches: boolean; now?: number },
): ReturnType<WalletExecutionGate["check"]> {
  return gate.check({
    connected: ctx.connected,
    ownerAddress: ctx.ownerAddress,
    recordId: record.id,
    state: record.state,
    validated: record.validated,
    approved: record.approval?.decision === "APPROVE",
    authz: record.authz,
    networkMatches: ctx.networkMatches,
    now: ctx.now,
  });
}

/**
 * Safety demo — emulates an AI agent trying to execute a payment DIRECTLY,
 * before any human approval. The gate must fail closed (NOT_APPROVED /
 * AUTHZ_MISSING). AI suggestions can never authorize execution.
 */
export function simulateAiAutoExecute(
  record: PaymentRecord,
  networkMatches = true,
): ReturnType<WalletExecutionGate["check"]> {
  return gate.check({
    connected: true,
    ownerAddress: record.ownerAddress,
    recordId: record.id,
    state: record.state,
    validated: record.validated,
    approved: false, // no human approval
    authz: null,     // no wallet-scoped payment authz
    networkMatches,
  });
}

/**
 * Gated execution (Phase 1): gate → wallet authz (signature) → simulated
 * settlement. No real value moves. Returns the settled record + receipt.
 */
export async function executeFlow(
  record: PaymentRecord,
  wallet: Pick<MovaWalletProvider, "signPersonalMessage">,
  ctx: { networkMatches: boolean; now?: number },
): Promise<FlowResult> {
  const now = ctx.now ?? Date.now();
  const verdict = checkGateForRecord(record, {
    connected: true,
    ownerAddress: record.ownerAddress,
    networkMatches: ctx.networkMatches,
    now,
  });
  if (!verdict.allowed) {
    throw new MovaError(ErrorCode.EXECUTION_GATE_BLOCKED, `execution blocked by wallet gate: ${verdict.reason}`, {
      details: { code: verdict.code },
    });
  }

  // Wallet authz — the Phase 1 stand-in for PTB signing. The wallet owner must
  // sign an explicit authorization message.
  const authzMessage =
    `MOVA payment authorization\n` +
    `Record: ${record.id}\n` +
    `Owner: ${record.ownerAddress}\n` +
    `Amount: ${record.amount.amount} ${record.amount.asset}\n` +
    `Recipient: ${record.recipient.value}\n` +
    `Authz nonce: ${record.authz?.nonce ?? "none"}`;
  const sig = await wallet.signPersonalMessage(authzMessage);

  const events: AuditEvent[] = [];
  const executing = applyTransition(record, "EXECUTION_STARTED", "execution");
  if (!executing.ok) throw new MovaError(ErrorCode.EXECUTION_SIMULATION_FAILED, executing.reason ?? "execution start failed");
  events.push(
    audit(record.correlationId, record.id, "EXECUTION_STARTED", { type: "APPROVER", id: record.ownerAddress }, record.state, "EXECUTING", false, {
      signedBy: sig.address,
      walletAuthz: true,
    }),
  );

  const settlement: PaymentSettlement = settlementOutcome({
    status: "SIMULATED",
    simulated: true,
    txDigest: null, // honest mock — never fabricate a digest
    error: null,
    signedBy: sig.address,
    signedAt: sig.signedAt,
  });

  const settled = applyTransition(
    { ...executing.record, settlement },
    "SETTLED",
    "settlement",
  );
  const finalRecord = settled.ok ? settled.record : executing.record;
  events.push(
    audit(record.correlationId, record.id, "SETTLED", { type: "SYSTEM", id: "simulated-settlement" }, "EXECUTING", "SETTLED", true, {
      simulated: true,
      txDigest: null,
      signedBy: sig.address,
    }),
  );

  const receipt = issuePaymentReceipt({
    paymentRecordId: record.id,
    ownerAddress: record.ownerAddress,
    amount: record.amount,
    recipient: record.recipient.value,
    network: record.network,
    state: finalRecord.state,
    txDigest: null,
    simulated: true,
  });

  return { record: finalRecord, events, receipt };
}
