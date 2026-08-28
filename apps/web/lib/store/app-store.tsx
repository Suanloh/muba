"use client";
/**
 * MOVA app store — client-side state for the Phase 1 shell.
 *
 * Holds payment records, receipts, an append-only in-memory audit log, and
 * notifications. Wires the deterministic demo pipeline to the wallet context.
 * The UI stays thin; all flow decisions live in `lib/pipeline/demo-pipeline.ts`
 * and `@mova/wallet`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { failureUserMessage } from "@mova/core";
import { MovaError, ErrorCode } from "@mova/logger";
import type { AuditEvent, ExecutionFailureInfo, Network } from "@mova/types";
import type {
  GateVerdict,
  PaymentReceipt,
  PaymentRecord,
  SuiAddress,
} from "@mova/wallet";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { EXPECTED_NETWORK, WEB_SETTLEMENT_MODE } from "@/lib/wallet/networks";
import { buildTransferTransaction } from "@/lib/pipeline/real-settlement";
import { hasSufficientBalance, querySuiBalance } from "@/lib/pipeline/balance";
import { buildPaymentPlan, type PaymentPlan } from "@/lib/pipeline/execution-engine";
import {
  approveFlow,
  createFlow,
  executeFlow,
  failFlow,
  rejectFlow,
  runToAwaitingApproval,
  simulateAiAutoExecute,
  type RealSettlementAttempt,
} from "@/lib/pipeline/demo-pipeline";
import { type RiskView } from "@/lib/pipeline/risk-recommendation";

export interface AppNotification {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  at: number;
  /** Record the notification belongs to (payment notifs only). */
  recordId?: string;
}

interface AppStoreValue {
  records: PaymentRecord[];
  receipts: PaymentReceipt[];
  notifications: AppNotification[];
  /** Persistent per-payment notification feed (approval / executing / done / failed). */
  notificationFeed: AppNotification[];
  audit: AuditEvent[];
  activeRecordId: string | null;
  /** recordId -> deterministic risk + hedge recommendation (Phase 6 view). */
  riskViews: Record<string, RiskView>;
  /** recordId -> Phase 7 plan (payment preview + signed transaction spec). */
  plans: Record<string, PaymentPlan>;
  /** recordId -> the user acknowledged the preview ("I understand"). */
  acknowledged: Record<string, boolean>;
  setActiveRecordId: (id: string | null) => void;
  setAcknowledged: (recordId: string, value: boolean) => void;
  submitIntent: (rawText: string) => Promise<PaymentRecord>;
  approve: (recordId: string) => Promise<PaymentRecord>;
  reject: (recordId: string) => Promise<PaymentRecord>;
  execute: (recordId: string) => Promise<PaymentRecord>;
  attemptAiAutoExecute: (recordId: string) => GateVerdict;
  dismissNotification: (id: string) => void;
  clearAll: () => void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const { connection, network, provider, executeTransaction } = useMovaWallet();
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationFeed, setNotificationFeed] = useState<AppNotification[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [riskViews, setRiskViews] = useState<Record<string, RiskView>>({});
  const [plans, setPlans] = useState<Record<string, PaymentPlan>>({});
  const [acknowledged, setAcknowledgedState] = useState<Record<string, boolean>>({});
  const auditRef = useRef<AuditEvent[]>([]);
  /** RecordIds currently executing — prevents concurrent double-execution. */
  const executingRef = useRef<Set<string>>(new Set());

  const ownerAddress: SuiAddress | null =
    connection.status === "connected" ? connection.account?.address ?? null : null;

  const appendAudit = useCallback((events: AuditEvent[]) => {
    if (events.length === 0) return;
    auditRef.current = [...auditRef.current, ...events];
    setAudit([...auditRef.current]);
  }, []);

  const notify = useCallback(
    (kind: AppNotification["kind"], title: string, message: string, recordId?: string) => {
      const n: AppNotification = {
        id: crypto.randomUUID(),
        kind,
        title,
        message,
        at: Date.now(),
        ...(recordId ? { recordId } : {}),
      };
      setNotifications((prev) => [...prev.slice(-8), n]);
      // Persistent feed — the per-payment notif history (never auto-cleared).
      setNotificationFeed((prev) => [n, ...prev].slice(0, 200));
    },
    [],
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const updateRecord = useCallback((record: PaymentRecord) => {
    setRecords((prev) => prev.map((r) => (r.id === record.id ? record : r)));
  }, []);

  const addReceipt = useCallback((receipt: PaymentReceipt) => {
    setReceipts((prev) => [receipt, ...prev]);
  }, []);

  const setAcknowledged = useCallback((recordId: string, value: boolean) => {
    setAcknowledgedState((prev) => ({ ...prev, [recordId]: value }));
  }, []);

  const submitIntent = useCallback(
    async (rawText: string): Promise<PaymentRecord> => {
      if (!ownerAddress) {
        const err = new MovaError(ErrorCode.WALLET_NOT_CONNECTED, "Connect a wallet before creating a payment.");
        notify("error", "Wallet required", err.message);
        throw err;
      }
      const networkName: Network = EXPECTED_NETWORK;
      const { record, parsed, events } = createFlow(rawText, ownerAddress, networkName);
      appendAudit(events);
      setRecords((prev) => [record, ...prev]);
      setActiveRecordId(record.id);

      if (!parsed.validated) {
        notify("warning", "Intent needs attention", parsed.errors.join(" "));
        return record;
      }

      // Phase 7 — run the deterministic pipe and build the signed spec + preview.
      let plan: PaymentPlan;
      try {
        plan = await buildPaymentPlan(record, {
          sender: ownerAddress,
          expectedSettlement: WEB_SETTLEMENT_MODE === "real" ? "REAL" : "SIMULATED",
        });
      } catch (err) {
        // Engine failure (integration unavailable / no route / compliance
        // blocked) — fail closed and record the structured failure.
        const failure = classifyEngineFailure(err, record);
        const failed = failFlow(record, failure);
        appendAudit(failed.events);
        updateRecord(failed.record);
        notify("error", "Payment blocked", failureUserMessage(failure));
        return failed.record;
      }

      // Seed the record's execution/idempotency state from the signed spec.
      const seeded: PaymentRecord = {
        ...record,
        execution: {
          clientRequestId: plan.spec.clientRequestId,
          specDigest: plan.spec.planDigest,
          attempts: 0,
          lastAttemptAt: null,
          executedAt: null,
          failure: null,
          settlement: null,
        },
      };
      setRecords((prev) => prev.map((r) => (r.id === record.id ? seeded : r)));
      setPlans((prev) => ({ ...prev, [record.id]: plan }));
      setRiskViews((prev) => ({
        ...prev,
        [record.id]: { recommendation: plan.recommendation, comparisons: plan.comparisons },
      }));

      // Fail-closed: a BLOCK verdict never reaches human approval.
      const preview = plan.preview;
      const blocked =
        preview.compliance.decision === "BLOCK" || preview.risk.decision === "BLOCK";
      if (blocked) {
        const reason =
          preview.compliance.decision === "BLOCK"
            ? preview.compliance.explanation
            : `Risk decision ${preview.risk.decision}: ${preview.risk.explanation}`;
        const failure: ExecutionFailureInfo = {
          code: "INTEGRATION_UNAVAILABLE",
          stage: preview.compliance.decision === "BLOCK" ? "COMPLIANCE" : "RISK_HEDGE",
          message: reason,
          userActionable: false,
          retryable: false,
          at: Date.now(),
        };
        const failed = failFlow(seeded, failure);
        appendAudit(failed.events);
        updateRecord(failed.record);
        notify("error", "Payment blocked", failureUserMessage(failure));
        return failed.record;
      }

      // Advance the flow to AWAITING_APPROVAL (deterministic stages) — the
      // plan is attached so each audit event carries the real decision data.
      const staged = runToAwaitingApproval(seeded, plan);
      appendAudit(staged.events);
      if (!staged.ok) {
        notify("error", "Pipeline stalled", staged.reason ?? "could not advance the flow", record.id);
        return staged.record;
      }
      setRecords((prev) => prev.map((r) => (r.id === record.id ? staged.record : r)));
      notify(
        "info",
        "Approval required",
        `${preview.action} ${preview.amount.amount} ${preview.amount.asset} to ${preview.suiDestination} — review the preview and approve to continue.`,
        record.id,
      );

      // Advisory REVIEW/hedge notification (REVIEW may proceed, but flagged).
      const rec = plan.recommendation;
      if (preview.compliance.decision === "REVIEW" || preview.risk.decision === "REVIEW") {
        notify("warning", "Review required", "Compliance or risk flagged this payment for review — proceed at your own discretion.", record.id);
      } else if (rec.hedged) {
        notify("info", "Hedge recommended", `MOVA suggests a ${rec.hedge.strategy} via ${rec.hedge.dataSource} (risk ${rec.risk.band}, ${rec.risk.score}/100).`, record.id);
      }
      return staged.record;
    },
    [ownerAddress, appendAudit, notify, updateRecord],
  );

  const approve = useCallback(
    async (recordId: string): Promise<PaymentRecord> => {
      const record = records.find((r) => r.id === recordId);
      if (!record) throw new MovaError(ErrorCode.NOT_FOUND, "record not found");
      if (!ownerAddress) {
        const err = new MovaError(ErrorCode.WALLET_NOT_CONNECTED, "Connect a wallet to approve.");
        notify("error", "Wallet required", err.message);
        throw err;
      }
      const plan = plans[recordId];
      if (!plan) {
        const err = new MovaError(ErrorCode.EXECUTION_GATE_BLOCKED, "No payment preview exists — build the plan before approving.");
        notify("error", "Preview required", err.message);
        throw err;
      }
      // The human approves EXACTLY the spec digest shown in the preview.
      const res = approveFlow(record, ownerAddress, {
        specDigest: plan.spec.planDigest,
        clientRequestId: plan.spec.clientRequestId,
      });
      updateRecord(res.record);
      appendAudit(res.events);
      notify("success", "Approved", `Payment ${record.id.slice(0, 12)}… approved. Authz bound to plan ${plan.spec.planDigest.slice(0, 12)}….`, record.id);
      return res.record;
    },
    [records, plans, ownerAddress, updateRecord, appendAudit, notify],
  );

  const reject = useCallback(
    async (recordId: string): Promise<PaymentRecord> => {
      const record = records.find((r) => r.id === recordId);
      if (!record) throw new MovaError(ErrorCode.NOT_FOUND, "record not found");
      if (!ownerAddress) {
        const err = new MovaError(ErrorCode.WALLET_NOT_CONNECTED, "Connect a wallet to reject.");
        notify("error", "Wallet required", err.message);
        throw err;
      }
      const res = rejectFlow(record, ownerAddress);
      updateRecord(res.record);
      appendAudit(res.events);
      notify("warning", "Payment failed", `Payment ${record.id.slice(0, 12)}… was rejected.`, record.id);
      return res.record;
    },
    [records, ownerAddress, updateRecord, appendAudit, notify],
  );

  const execute = useCallback(
    async (recordId: string): Promise<PaymentRecord> => {
      const record = records.find((r) => r.id === recordId);
      if (!record) throw new MovaError(ErrorCode.NOT_FOUND, "record not found");
      if (!provider) {
        const err = new MovaError(ErrorCode.WALLET_NOT_CONNECTED, "Wallet provider unavailable.");
        notify("error", "Wallet required", err.message);
        throw err;
      }
      const plan = plans[recordId];
      if (!plan) {
        const err = new MovaError(ErrorCode.EXECUTION_GATE_BLOCKED, "No signed payment plan exists for this record.");
        notify("error", "Plan required", err.message);
        throw err;
      }
      // UI-layer idempotency: refuse concurrent/re-entrant execution of the
      // same record (defense-in-depth on top of the state machine + guard).
      if (executingRef.current.has(recordId)) {
        const err = new MovaError(ErrorCode.IDEMPOTENCY_VIOLATION, "This payment is already being executed.");
        notify("error", "Already executing", err.message);
        throw err;
      }
      executingRef.current.add(recordId);
      const networkMatches = network.matches;
      if (!networkMatches) {
        executingRef.current.delete(recordId);
        const err = new MovaError(ErrorCode.WALLET_NETWORK_MISMATCH, "Wallet network does not match the MOVA expected network.");
        notify("error", "Network mismatch", err.message);
        throw err;
      }

      try {
        // Real settlement: build the PTB from the SIGNED SPEC (never from raw
        // LLM/record fields) and submit through the connected wallet (gated).
        // Falls back to simulated with an honest note when the wallet can't submit.
        const realSubmit =
          WEB_SETTLEMENT_MODE === "real"
            ? async (spec: typeof plan.spec, rec: PaymentRecord): Promise<RealSettlementAttempt> => {
                try {
                  // Deterministic txn construction from the approved spec.
                  const tx = buildTransferTransaction(
                    { ...rec, amount: spec.amount, recipient: { ...rec.recipient, value: spec.recipient } },
                    spec.sender,
                  );
                  const res = await executeTransaction(tx);
                  if (res.ok && res.digest) return { digest: res.digest, error: null };
                  return { digest: null, error: res.error ?? "wallet could not execute the transaction" };
                } catch (err) {
                  return { digest: null, error: err instanceof Error ? err.message : String(err) };
                }
              }
            : undefined;

        // Best-effort balance pre-flight — fail honestly BEFORE the wallet signs
        // when the payer cannot cover amount + gas.
        const preflightBalance = async () => {
          const balance = await querySuiBalance(record.ownerAddress);
          if (!hasSufficientBalance(balance, plan.spec.amount.amount)) {
            return {
              ok: false,
              message: `Wallet balance ${balance === null ? "unreadable" : balance.toString()} is below ${plan.spec.amount.amount} ${plan.spec.amount.asset} + gas.`,
            };
          }
          return { ok: true, message: "" };
        };

        // Payment executing — wallet authz signature is about to be requested
        // and the transaction submitted. Emitted before the gated tail runs.
        notify("info", "Payment executing", `Record ${record.id.slice(0, 12)}… authorizing wallet signature and settling (${WEB_SETTLEMENT_MODE}).`, record.id);

        const res = await executeFlow(record, provider, plan.spec, {
          networkMatches,
          preflightBalance: WEB_SETTLEMENT_MODE === "real" ? preflightBalance : undefined,
          submitReal: realSubmit,
        });
        updateRecord(res.record);
        appendAudit(res.events);
        if (res.receipt) addReceipt(res.receipt);

        // Structured failure surfaced to the user (never swallowed).
        if (res.failure) {
          notify("error", "Payment failed", failureUserMessage(res.failure), record.id);
          return res.record;
        }

        const settled = res.record.settlement;
        if (settled?.simulated === false) {
          notify(
            "success",
            "Payment completed (real testnet)",
            `Record ${record.id.slice(0, 12)}… settled on-chain. Digest ${settled.txDigest?.slice(0, 14)}….`,
            record.id,
          );
        } else if (settled?.error) {
          notify("warning", "Payment completed (simulated fallback)", settled.error, record.id);
        } else {
          notify("success", "Payment completed", `Record ${record.id.slice(0, 12)}… settled via wallet authz. No real value moved.`, record.id);
        }
        return res.record;
      } finally {
        executingRef.current.delete(recordId);
      }
    },
    [records, plans, provider, network.matches, executeTransaction, updateRecord, appendAudit, addReceipt, notify],
  );

  const attemptAiAutoExecute = useCallback(
    (recordId: string): GateVerdict => {
      const record = records.find((r) => r.id === recordId);
      if (!record) return { allowed: false, code: "NOT_APPROVED", reason: "record not found" };
      return simulateAiAutoExecute(record, network.matches);
    },
    [records, network.matches],
  );

  const clearAll = useCallback(() => {
    setRecords([]);
    setReceipts([]);
    setNotifications([]);
    setNotificationFeed([]);
    auditRef.current = [];
    setAudit([]);
    setRiskViews({});
    setPlans({});
    setAcknowledgedState({});
    setActiveRecordId(null);
  }, []);

  const value = useMemo<AppStoreValue>(
    () => ({
      records,
      receipts,
      notifications,
      notificationFeed,
      audit,
      activeRecordId,
      riskViews,
      plans,
      acknowledged,
      setActiveRecordId,
      setAcknowledged,
      submitIntent,
      approve,
      reject,
      execute,
      attemptAiAutoExecute,
      dismissNotification,
      clearAll,
    }),
    [
      records,
      receipts,
      notifications,
      notificationFeed,
      audit,
      activeRecordId,
      riskViews,
      plans,
      acknowledged,
      setActiveRecordId,
      setAcknowledged,
      submitIntent,
      approve,
      reject,
      execute,
      attemptAiAutoExecute,
      dismissNotification,
      clearAll,
    ],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) {
    throw new Error("useAppStore must be used within AppStoreProvider");
  }
  return ctx;
}

/** Classify a plan-build failure into a structured ExecutionFailureInfo. */
function classifyEngineFailure(err: unknown, _record: PaymentRecord): ExecutionFailureInfo {
  const code =
    err instanceof MovaError
      ? err.code === "ERR_COMPLIANCE_BLOCKED" || err.code === "ERR_COMPLIANCE_UNAVAILABLE" || err.code === "ERR_ROUTING_FAILED"
        ? "INTEGRATION_UNAVAILABLE"
        : "UNKNOWN"
      : "UNKNOWN";
  return {
    code,
    stage: "ROUTE_DISCOVERY",
    message: err instanceof Error ? err.message : String(err),
    userActionable: false,
    retryable: false,
    at: Date.now(),
  };
}
