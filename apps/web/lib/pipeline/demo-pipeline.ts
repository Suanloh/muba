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
import {
  assertAuthzMatchesSpec,
  assertSpecIntegrity,
  beginExecution,
  classifyExecutionFailure,
  markExecuted,
  markFailed,
} from "@mova/core";
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  AuditEvent,
  ExecutionFailureInfo,
  Money,
  Network,
  PaymentEvent,
  PaymentExecutionInfo,
  PaymentGuardContext,
  PaymentState,
  TransactionSpec,
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
  type SignatureResult,
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
  /** Structured failure when the attempt did not settle (null on success). */
  failure: ExecutionFailureInfo | null;
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

/**
 * Human approval — issues a wallet-scoped PaymentAuthz ONLY on APPROVE. When a
 * `specDigest` is provided the authz is bound to EXACTLY the plan the human
 * saw (execution verifies the rebuilt spec matches), and the record's
 * execution/idempotency state is seeded.
 */
export function approveFlow(
  record: PaymentRecord,
  approverAddress: SuiAddress,
  opts: { specDigest?: string | null; clientRequestId?: string; now?: number } = {},
): { record: PaymentRecord; events: AuditEvent[]; authz: PaymentAuthz | null } {
  const now = opts.now ?? Date.now();
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
    specDigest: opts.specDigest ?? null,
    issuedAt: now,
    ttlMs: 15 * 60 * 1000,
  });

  const approvalView: ApprovalView = {
    status: "APPROVED",
    decision: "APPROVE",
    resolvedAt: now,
    reason: `Approved by owner ${approverAddress.slice(0, 10)}…${opts.specDigest ? ` (plan ${opts.specDigest.slice(0, 12)}…)` : ""}`,
  };

  // Seed the execution/idempotency state so execute() can refuse duplicates.
  const execution: PaymentExecutionInfo | null = opts.specDigest
    ? {
        clientRequestId: opts.clientRequestId ?? `mova-${record.correlationId}`,
        specDigest: opts.specDigest,
        attempts: 0,
        lastAttemptAt: null,
        executedAt: null,
        failure: null,
        settlement: null,
      }
    : record.execution;

  const next = applyTransition(
    { ...record, approval: approvalView, authz, execution },
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
      planDigest: authz.specDigest,
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
  // Record the rejection as a structured, user-actionable execution failure.
  const failure: ExecutionFailureInfo = {
    code: "USER_REJECTED",
    stage: "HUMAN_APPROVAL",
    message: `Rejected by ${approverAddress.slice(0, 10)}…`,
    userActionable: true,
    retryable: true,
    at: Date.now(),
  };
  const execution = record.execution ? markFailed(record.execution, failure) : record.execution;
  const finalRecord = next.ok
    ? { ...next.record, execution }
    : { ...record, state: "FAILED" as PaymentState, execution, updatedAt: Date.now() };
  return {
    record: finalRecord,
    events: [
      audit(record.correlationId, record.id, "APPROVAL_REJECTED", { type: "APPROVER", id: approverAddress }, record.state, "FAILED", false, { decision: "REJECT", failure }),
    ],
  };
}

/**
 * Fail a flow from any non-terminal state (used when a deterministic engine
 * BLOCKs the plan — e.g. compliance or risk). The structured `failure` carries
 * the honest, detailed reason; the state machine uses CANCELLED to reach the
 * terminal FAILED state.
 */
export function failFlow(
  record: PaymentRecord,
  failure: ExecutionFailureInfo,
  now = Date.now(),
): { record: PaymentRecord; events: AuditEvent[] } {
  const sm = new PaymentStateMachine(guardContext(record, "compliance"));
  const outcome = sm.apply(record.state, "CANCELLED");
  const execution: PaymentExecutionInfo | null = record.execution
    ? markFailed(record.execution, failure, now)
    : {
        clientRequestId: `mova-${record.correlationId}`,
        specDigest: "",
        attempts: 0,
        lastAttemptAt: now,
        executedAt: null,
        failure,
        settlement: "FAILED" as const,
      };
  const finalRecord = outcome.ok && outcome.to
    ? { ...record, state: outcome.to, execution, updatedAt: now }
    : { ...record, state: "FAILED" as PaymentState, execution, updatedAt: now };
  return {
    record: finalRecord,
    events: [
      audit(record.correlationId, record.id, "CANCELLED", { type: "SYSTEM", id: "execution-engine" }, record.state, "FAILED", false, { failure }),
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

export interface RealSettlementAttempt {
  digest: string | null;
  error: string | null;
}

export interface ExecuteFlowContext {
  networkMatches: boolean;
  now?: number;
  /**
   * Best-effort balance pre-flight. Return `{ ok: false }` to fail the attempt
   * with INSUFFICIENT_BALANCE before the wallet is asked to sign.
   */
  preflightBalance?: () => Promise<{ ok: boolean; message: string }>;
  /**
   * Real settlement submission. Receives the SPEC (not the raw record) so the
   * on-chain transaction is built from exactly what the human approved.
   */
  submitReal?: (spec: TransactionSpec, record: PaymentRecord) => Promise<RealSettlementAttempt>;
}

/** Move a record to FAILED (state machine) and record the structured failure. */
function failExecution(
  record: PaymentRecord,
  failure: ExecutionFailureInfo,
  events: AuditEvent[],
  now: number,
): FlowResult {
  const event: PaymentEvent = record.state === "EXECUTING" ? "EXECUTION_FAILED" : "EXECUTION_SIMULATION_FAILED";
  const sm = new PaymentStateMachine(guardContext(record, "execution"));
  const outcome = sm.apply(record.state, event);
  const execution = record.execution ? markFailed(record.execution, failure, now) : record.execution;
  const finalRecord =
    outcome.ok && outcome.to
      ? { ...record, state: outcome.to, execution, updatedAt: now }
      : { ...record, state: "FAILED" as PaymentState, execution, updatedAt: now };
  events.push(
    audit(record.correlationId, record.id, "EXECUTION_FAILED", { type: "SYSTEM", id: "execution-engine" }, record.state, "FAILED", false, {
      failure,
    }),
  );
  return { record: finalRecord, events, receipt: null, failure };
}

/**
 * Phase 7 — Gated execution of an APPROVED payment.
 *
 * Runs the wallet-authz → execution → settlement tail of the pipe from the
 * deterministic `TransactionSpec` (NEVER from raw LLM output or mutable record
 * fields):
 *
 *   spec integrity → idempotency (no duplicate) → wallet gate → authz digest
 *   match → balance pre-flight → wallet authz signature → EXECUTING → real-or-
 *   simulated Sui settlement → SETTLED
 *
 * Real settlement is preferred; when the wallet can't fund/submit it falls
 * back to SIMULATED and records the reason honestly (never fabricates a
 * digest). Every failure is classified into a structured ExecutionFailureInfo,
 * recorded on the record, and returned — never swallowed.
 */
export async function executeFlow(
  record: PaymentRecord,
  wallet: Pick<MovaWalletProvider, "signPersonalMessage">,
  spec: TransactionSpec | null,
  ctx: ExecuteFlowContext,
): Promise<FlowResult> {
  const now = ctx.now ?? Date.now();
  const events: AuditEvent[] = [];

  // 0) A deterministic spec is REQUIRED — never construct a txn from raw state.
  if (!spec) {
    return failExecution(
      record,
      classifyExecutionFailure(
        new MovaError(ErrorCode.EXECUTION_SIMULATION_FAILED, "no transaction spec — refusing execution"),
        { stage: "EXECUTION" },
      ),
      events,
      now,
    );
  }

  // 1) Spec integrity — the digest must still match the canonical serialization.
  const integrity = assertSpecIntegrity(spec);
  if (!integrity.ok) {
    return failExecution(
      record,
      classifyExecutionFailure(
        new MovaError(ErrorCode.EXECUTION_GATE_BLOCKED, integrity.reason ?? "spec integrity failed"),
        { stage: "EXECUTION" },
      ),
      events,
      now,
    );
  }

  // 2) Idempotency — refuse duplicate/expired/replayed executions.
  let execution: PaymentExecutionInfo;
  try {
    execution = beginExecution(record.execution, spec, now).state;
  } catch (err) {
    return failExecution(record, classifyExecutionFailure(err, { stage: "EXECUTION" }), events, now);
  }

  // 3) Wallet gate (defense in depth) + the authz must be for THIS spec digest.
  const verdict = checkGateForRecord(record, {
    connected: true,
    ownerAddress: record.ownerAddress,
    networkMatches: ctx.networkMatches,
    now,
  });
  if (!verdict.allowed) {
    return failExecution(
      record,
      classifyExecutionFailure(
        new MovaError(ErrorCode.EXECUTION_GATE_BLOCKED, `execution blocked by wallet gate: ${verdict.reason}`, {
          details: { code: verdict.code },
        }),
        { stage: "EXECUTION" },
      ),
      events,
      now,
    );
  }
  try {
    assertAuthzMatchesSpec(spec, record.authz?.specDigest ?? null);
  } catch (err) {
    return failExecution(record, classifyExecutionFailure(err, { stage: "WALLET_AUTHZ" }), events, now);
  }

  // 4) Balance pre-flight (best-effort — see balance.ts).
  if (ctx.preflightBalance) {
    const bal = await ctx.preflightBalance();
    if (!bal.ok) {
      return failExecution(
        record,
        classifyExecutionFailure(new MovaError(ErrorCode.INSUFFICIENT_BALANCE, bal.message), { stage: "EXECUTION" }),
        events,
        now,
      );
    }
  }

  // 5) Wallet authz — the wallet owner signs an explicit authorization over the SPEC.
  const authzMessage =
    `MOVA payment authorization\n` +
    `Record: ${spec.recordId}\n` +
    `Owner: ${spec.sender}\n` +
    `Amount: ${spec.amount.amount} ${spec.amount.asset}\n` +
    `Recipient: ${spec.recipient}\n` +
    `Network: ${spec.network}\n` +
    `Route: ${spec.routeId}\n` +
    `Total: ${spec.totalCost.amount} ${spec.totalCost.asset}\n` +
    `Plan digest: ${spec.planDigest}\n` +
    `Authz nonce: ${record.authz?.nonce ?? "none"}`;
  let sig: SignatureResult;
  try {
    sig = await wallet.signPersonalMessage(authzMessage);
  } catch (err) {
    return failExecution(record, classifyExecutionFailure(err, { stage: "WALLET_AUTHZ" }), events, now);
  }

  // 6) EXECUTION_STARTED.
  const executing = applyTransition({ ...record, execution }, "EXECUTION_STARTED", "execution");
  if (!executing.ok) {
    return failExecution(
      record,
      classifyExecutionFailure(
        new MovaError(ErrorCode.EXECUTION_SIMULATION_FAILED, executing.reason ?? "execution start failed"),
        { stage: "EXECUTION" },
      ),
      events,
      now,
    );
  }
  events.push(
    audit(record.correlationId, record.id, "EXECUTION_STARTED", { type: "APPROVER", id: record.ownerAddress }, record.state, "EXECUTING", false, {
      signedBy: sig.address,
      walletAuthz: true,
      planDigest: spec.planDigest,
    }),
  );

  // 7) Real settlement attempt from the SPEC (gated + approved + authz done).
  let settlement: PaymentSettlement;
  let realSettled = false;
  let txDigest: string | null = null;
  if (ctx.submitReal) {
    const real = await ctx.submitReal(spec, record);
    txDigest = real.digest;
    if (real.digest) {
      realSettled = true;
      settlement = settlementOutcome({
        status: "CONFIRMED",
        simulated: false,
        txDigest: real.digest,
        error: null,
        signedBy: sig.address,
        signedAt: sig.signedAt,
      });
    } else {
      settlement = settlementOutcome({
        status: "SIMULATED",
        simulated: true,
        txDigest: null, // honest fallback — never fabricate a digest
        error: real.error
          ? `REAL settlement failed (${real.error}) — fell back to SIMULATED`
          : "REAL settlement failed — fell back to SIMULATED",
        signedBy: sig.address,
        signedAt: sig.signedAt,
      });
    }
  } else {
    settlement = settlementOutcome({
      status: "SIMULATED",
      simulated: true,
      txDigest: null, // honest mock — never fabricate a digest
      error: null,
      signedBy: sig.address,
      signedAt: sig.signedAt,
    });
  }

  // 8) SETTLED — the deterministic confirmation gate.
  const settled = applyTransition({ ...executing.record, settlement }, "SETTLED", "settlement");
  if (!settled.ok) {
    return failExecution(
      { ...executing.record, settlement },
      classifyExecutionFailure(
        new MovaError(ErrorCode.SETTLEMENT_UNCONFIRMED, settled.reason ?? "settlement confirmation failed"),
        { stage: "SUI_SETTLEMENT", txDigest },
      ),
      events,
      now,
    );
  }

  // 9) Mark executed (idempotency) after the terminal SETTLED transition.
  let finalRecord: PaymentRecord = settled.record;
  try {
    finalRecord = { ...finalRecord, execution: markExecuted(execution, settlement.status, now) };
  } catch {
    // Already marked executed — still SETTLED; keep state as-is.
  }
  events.push(
    audit(record.correlationId, record.id, "SETTLED", { type: "SYSTEM", id: realSettled ? "sui-settlement" : "simulated-settlement" }, "EXECUTING", "SETTLED", !realSettled, {
      simulated: !realSettled,
      txDigest: settlement.txDigest,
      signedBy: sig.address,
      ...(realSettled ? { real: true } : {}),
    }),
  );

  const receipt = issuePaymentReceipt({
    paymentRecordId: record.id,
    ownerAddress: record.ownerAddress,
    amount: record.amount,
    recipient: record.recipient.value,
    network: record.network,
    state: finalRecord.state,
    txDigest: settlement.txDigest,
    simulated: !realSettled,
  });

  return { record: finalRecord, events, receipt, failure: null };
}
