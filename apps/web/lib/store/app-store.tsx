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
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { failureUserMessage } from "@mova/core";
import { MovaError, ErrorCode } from "@mova/logger";
import type { AuditEvent, ExecutionFailureInfo, Network, PaymentState } from "@mova/types";
import { movaDb } from "@/lib/supabase/mova-db";
import {
  syncAuditBestEffort,
  syncReceiptBestEffort,
  syncRecordBestEffort,
} from "@/lib/supabase/sync";
import { hydrateHistory } from "@/lib/supabase/hydrate";
import type {
  GateVerdict,
  MovaNetworkState,
  PaymentReceipt,
  PaymentRecord,
  SuiAddress,
} from "@mova/wallet";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { EXPECTED_NETWORK, MOVA_PACKAGE_ID, WEB_SETTLEMENT_MODE } from "@/lib/wallet/networks";
import { playUiSound, setSoundMuted } from "@/components/notifications/Sound";

/** Active top-level view rendered inside the app shell (sidebar / bottom bar). */
export type AppView = "home" | "activity" | "portfolio" | "settings";

/** Live plan-review run state — streamed from the unified pipeline (req 3). */
export type PlanRunStatus = "idle" | "running" | "done" | "failed";
export interface PlanRunState {
  recordId: string | null;
  status: PlanRunStatus;
  entries: LiveRunEntry[];
}
import { buildMovaOwnedTransaction, buildTransferTransaction } from "@/lib/pipeline/real-settlement";
import { hasSufficientBalance, querySuiBalance } from "@/lib/pipeline/balance";
import { buildMemWalInput, memWalStore, type MemWalStoreResult } from "@/lib/pipeline/memwal";
import { type PaymentPlan, type RiskView } from "@/lib/pipeline/execution-engine";
import { runPlanReview, type LiveRunEntry } from "@/lib/pipeline/plan-review";
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

export interface AppNotification {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  at: number;
  /** Record the notification belongs to (payment notifs only). */
  recordId?: string;
}

/**
 * Human-readable, actionable network-mismatch message: tells the user WHICH
 * network the wallet is on vs what MOVA expects (the generic message alone
 * left the user guessing what to fix).
 */
function networkMismatchMessage(network: MovaNetworkState): string {
  if (network.unknown) {
    return `MOVA could not detect the wallet's network — expected ${network.expected}. Switch the wallet or app to ${network.expected} before approving or executing.`;
  }
  return `Wallet is on ${network.detectedNetwork}, but MOVA expects ${network.expected}. Switch the wallet or app to ${network.expected} before approving or executing.`;
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
  /**
   * recordId -> user's hedge preference while making the payment. Overrides
   * the deterministic recommendation: "HEDGE" (use the hedge) or "NO_HEDGE"
   * (skip it). Absent = follow the engine's recommendation.
   */
  hedgeChoice: Record<string, "HEDGE" | "NO_HEDGE">;
  /** recordId -> MemWal (Walrus memory) store result for a settled payment. */
  memWal: Record<string, MemWalStoreResult>;
  setActiveRecordId: (id: string | null) => void;
  setAcknowledged: (recordId: string, value: boolean) => void;
  setHedgeChoice: (recordId: string, choice: "HEDGE" | "NO_HEDGE") => void;
  submitIntent: (rawText: string) => Promise<PaymentRecord>;
  approve: (recordId: string) => Promise<PaymentRecord>;
  reject: (recordId: string) => Promise<PaymentRecord>;
  execute: (recordId: string) => Promise<PaymentRecord>;
  attemptAiAutoExecute: (recordId: string) => GateVerdict;
  dismissNotification: (id: string) => void;
  /** Dismiss a single persistent feed item (notification bell ✕). */
  dismissFeedNotification: (id: string) => void;
  clearAll: () => void;
  /** UI prefs — sound on/off, balance privacy, active nav view. */
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
  privacyHidden: boolean;
  setPrivacyHidden: (v: boolean) => void;
  view: AppView;
  setView: (v: AppView) => void;
  /** Live plan-review run (streamed progress of the unified pipeline). */
  planRun: PlanRunState;
  resetPlanRun: () => void;
  /**
   * Monotonic counter bumped by `clearAll` — UI components with their own
   * local state (chat conversation, QR scan) subscribe to reset themselves on
   * "Reset demo" so stale working intents can't leak into the next payment.
   */
  resetVersion: number;
  /** Supabase data-layer state — connection + best-effort sync counters. */
  supabase: {
    status: "online" | "offline";
    syncedRecords: number;
    syncedAudit: number;
    syncedReceipts: number;
    realtimeEvents: number;
    lastError: string | null;
    /** True once persisted history has been loaded into the store. */
    historyLoaded: boolean;
  };
  /** Re-fetch persisted history from the DB and merge it into the store. */
  refreshHistory: () => Promise<void>;
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
  const [hedgeChoice, setHedgeChoiceState] = useState<Record<string, "HEDGE" | "NO_HEDGE">>({});
  const [memWal, setMemWal] = useState<Record<string, MemWalStoreResult>>({});
  // UI prefs. Persisted; read after mount to avoid SSR hydration mismatch.
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const [privacyHidden, setPrivacyHiddenState] = useState(false);
  const [view, setViewState] = useState<AppView>("home");
  const [planRun, setPlanRunState] = useState<PlanRunState>({ recordId: null, status: "idle", entries: [] });
  const [resetVersion, setResetVersion] = useState(0);

  // --- Supabase data layer ------------------------------------------------
  const [supabaseState, setSupabaseState] = useState<AppStoreValue["supabase"]>({
    status: movaDb.status,
    syncedRecords: 0,
    syncedAudit: 0,
    syncedReceipts: 0,
    realtimeEvents: 0,
    lastError: null,
    historyLoaded: false,
  });
  /** recordId -> last synced state (re-sync only on state transitions). */
  const lastSyncedRecordStateRef = useRef<Map<string, string>>(new Map());
  const syncedAuditRef = useRef<Set<string>>(new Set());
  const syncedReceiptsRef = useRef<Set<string>>(new Set());

  // Best-effort sync to Supabase (via the mova-sync Edge Function). When the
  // data layer is offline this is a no-op that never blocks the payment flow;
  // errors are surfaced in the Settings "Data layer" panel, never thrown.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const record of records) {
        if (lastSyncedRecordStateRef.current.get(record.id) === record.state) continue;
        const res = await syncRecordBestEffort(record);
        if (cancelled) return;
        if (res.ok && !res.offline) {
          lastSyncedRecordStateRef.current.set(record.id, record.state);
          setSupabaseState((p) => ({ ...p, syncedRecords: p.syncedRecords + 1, lastError: null }));
        } else if (res.error) {
          setSupabaseState((p) => ({ ...p, lastError: res.error ?? null }));
        }
      }
      for (const event of audit) {
        if (syncedAuditRef.current.has(event.id)) continue;
        const res = await syncAuditBestEffort(event);
        if (cancelled) return;
        if (res.ok && !res.offline) {
          syncedAuditRef.current.add(event.id);
          setSupabaseState((p) => ({ ...p, syncedAudit: p.syncedAudit + 1, lastError: null }));
        } else if (res.error) {
          setSupabaseState((p) => ({ ...p, lastError: res.error ?? null }));
        }
      }
      for (const receipt of receipts) {
        if (syncedReceiptsRef.current.has(receipt.id)) continue;
        const res = await syncReceiptBestEffort(receipt);
        if (cancelled) return;
        if (res.ok && !res.offline) {
          syncedReceiptsRef.current.add(receipt.id);
          setSupabaseState((p) => ({ ...p, syncedReceipts: p.syncedReceipts + 1, lastError: null }));
        } else if (res.error) {
          setSupabaseState((p) => ({ ...p, lastError: res.error ?? null }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [records, audit, receipts]);

  // Realtime: status changes pushed from Supabase are reconciled into the
  // in-memory store (only for records we already track).
  useEffect(() => {
    const unsub = movaDb.subscribeToStatus((change) => {
      setSupabaseState((p) => ({ ...p, realtimeEvents: p.realtimeEvents + 1, lastError: null }));
      setRecords((prev) =>
        prev.map((r) =>
          r.correlationId === change.correlationId && r.state !== change.status
            ? { ...r, state: change.status as PaymentState, updatedAt: Date.now() }
            : r,
        ),
      );
    });
    return unsub;
  }, []);

  useEffect(() => {
    try {
      const sound = localStorage.getItem("mova-sound");
      const privacy = localStorage.getItem("mova-privacy");
      setSoundEnabledState(sound !== "off");
      setSoundMuted(sound === "off");
      setPrivacyHiddenState(privacy === "hidden");
    } catch {
      /* private mode — defaults apply */
    }
  }, []);

  const setSoundEnabled = useCallback((v: boolean) => {
    setSoundEnabledState(v);
    setSoundMuted(!v);
    try {
      localStorage.setItem("mova-sound", v ? "on" : "off");
    } catch {
      /* ignore */
    }
  }, []);

  const setPrivacyHidden = useCallback((v: boolean) => {
    setPrivacyHiddenState(v);
    try {
      localStorage.setItem("mova-privacy", v ? "hidden" : "visible");
    } catch {
      /* ignore */
    }
  }, []);

  const setView = useCallback((v: AppView) => {
    setViewState(v);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const resetPlanRun = useCallback(() => {
    setPlanRunState({ recordId: null, status: "idle", entries: [] });
  }, []);

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

  // --- History hydration ----------------------------------------------------
  // The Activity view must reflect the WHOLE persisted history, not just the
  // records produced by this browser session. Fetch the DB's intents +
  // receipts + audit trail and merge them into the in-memory store (existing
  // session data wins on id collisions; DB rows are marked already-synced so
  // the write path doesn't re-POST them).
  const hydratingRef = useRef(false);
  const refreshHistory = useCallback(async () => {
    if (hydratingRef.current) return;
    hydratingRef.current = true;
    try {
      const snap = await hydrateHistory();

      setAudit((prev) => {
        const existing = new Set(prev.map((e) => e.id));
        const merged = [...prev];
        for (const e of snap.audit) {
          if (!existing.has(e.id)) {
            merged.push(e);
            existing.add(e.id);
            syncedAuditRef.current.add(e.id);
          }
        }
        merged.sort((a, b) => a.timestamp - b.timestamp);
        auditRef.current = merged;
        return merged;
      });

      setReceipts((prev) => {
        const existing = new Set(prev.map((r) => r.id));
        const merged = [...prev];
        for (const r of snap.receipts) {
          if (!existing.has(r.id)) {
            merged.push(r);
            existing.add(r.id);
            syncedReceiptsRef.current.add(r.id);
          }
        }
        return merged;
      });

      setRecords((prev) => {
        const existing = new Set(prev.map((r) => r.id));
        const merged = [...prev];
        for (const r of snap.records) {
          if (!existing.has(r.id)) {
            merged.push(r);
            existing.add(r.id);
            lastSyncedRecordStateRef.current.set(r.id, r.state);
          }
        }
        merged.sort((a, b) => b.createdAt - a.createdAt);
        return merged;
      });

      setSupabaseState((p) => ({ ...p, historyLoaded: true, lastError: null }));
    } catch (err) {
      setSupabaseState((p) => ({
        ...p,
        historyLoaded: true,
        lastError: err instanceof Error ? err.message : "could not load history",
      }));
    } finally {
      hydratingRef.current = false;
    }
  }, []);

  // Load persisted history once on mount, then again whenever the user opens
  // the Activity view (picks up data synced from other tabs/devices).
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (view === "activity") void refreshHistory();
  }, [view, refreshHistory]);

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
      // Decorative sound — a visual toast always accompanies it.
      playUiSound(kind);
    },
    [],
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const dismissFeedNotification = useCallback((id: string) => {
    setNotificationFeed((prev) => prev.filter((n) => n.id !== id));
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

  const setHedgeChoice = useCallback((recordId: string, choice: "HEDGE" | "NO_HEDGE") => {
    setHedgeChoiceState((prev) => ({ ...prev, [recordId]: choice }));
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

      // Phase 7 — run the unified plan review and build the signed spec +
      // preview. `runPlanReview` streams live-run progress for every stage
      // (strategy → compliance → risk & route → preview) while the engine runs.
      setPlanRunState({
        recordId: record.id,
        status: "running",
        entries: [
          {
            id: crypto.randomUUID(),
            at: Date.now(),
            stage: "strategy",
            kind: "info",
            text: `Unified plan review started — ${record.id.slice(0, 12)}…`,
          },
        ],
      });
      const appendPlanRunEntry = (e: LiveRunEntry) =>
        setPlanRunState((prev) =>
          prev.recordId === record.id ? { ...prev, entries: [...prev.entries, e] } : prev,
        );

      let plan: PaymentPlan;
      try {
        plan = await runPlanReview(record, {
          sender: ownerAddress,
          expectedSettlement: WEB_SETTLEMENT_MODE === "real" ? "REAL" : "SIMULATED",
          onEntry: appendPlanRunEntry,
        });
        setPlanRunState((prev) =>
          prev.recordId === record.id ? { ...prev, status: "done" } : prev,
        );
      } catch (err) {
        // Engine failure (integration unavailable / no route / compliance
        // blocked) — fail closed and record the structured failure.
        setPlanRunState((prev) =>
          prev.recordId === record.id ? { ...prev, status: "failed" } : prev,
        );
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
        const complianceBlocked = preview.compliance.decision === "BLOCK";
        const reason = complianceBlocked
          ? preview.compliance.explanation
          : `Risk decision ${preview.risk.decision}: ${preview.risk.explanation}`;
        const failure: ExecutionFailureInfo = {
          code: complianceBlocked ? "COMPLIANCE_BLOCKED" : "RISK_BLOCKED",
          stage: complianceBlocked ? "COMPLIANCE" : "RISK_HEDGE",
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
      // Approve-time network guard: an authz issued on the wrong network can
      // never execute — refuse BEFORE the human commits to an approval. The
      // plan digest + authz stay bound to the expected network only.
      if (!network.matches) {
        const err = new MovaError(ErrorCode.WALLET_NETWORK_MISMATCH, networkMismatchMessage(network));
        notify("error", "Network mismatch", err.message);
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
    [records, plans, ownerAddress, network, updateRecord, appendAudit, notify],
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
        // Fail the flow with a STRUCTURED failure (not a bare throw) so the
        // audit trail + Activity view honestly record the network mismatch
        // instead of leaving the record stuck in APPROVED forever.
        const failure: ExecutionFailureInfo = {
          code: "NETWORK_FAILURE",
          stage: "WALLET_AUTHZ",
          message: networkMismatchMessage(network),
          userActionable: true,
          retryable: true,
          at: Date.now(),
        };
        const failed = failFlow(record, failure);
        updateRecord(failed.record);
        appendAudit(failed.events);
        notify("error", "Network mismatch", failureUserMessage(failure), record.id);
        return failed.record;
      }

      try {
        // Real settlement: build the PTB from the SIGNED SPEC (never from raw
        // LLM/record fields) and submit through the connected wallet (gated).
        // Falls back to simulated with an honest note when the wallet can't submit.
        const realSubmit =
          WEB_SETTLEMENT_MODE === "real"
            ? async (spec: typeof plan.spec, rec: PaymentRecord): Promise<RealSettlementAttempt> => {
                try {
                  // Deterministic txn construction from the approved spec. When
                  // a MOVA package id resolves, ONE PTB transfers the SUI AND
                  // mints the on-chain OwnedPaymentRecord (atomic payment +
                  // ownership record); otherwise the plain transfer PTB is used.
                  const tx = MOVA_PACKAGE_ID
                    ? buildMovaOwnedTransaction(
                        { ...rec, amount: spec.amount, recipient: { ...rec.recipient, value: spec.recipient } },
                        spec.sender,
                      )
                    : buildTransferTransaction(
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

        // MemWal — snapshot this payment's memory (trail + settlement facts)
        // to Walrus (static/demo by default, real testnet when enabled).
        // Best-effort: never blocks settlement, always honest about fallback.
        if (res.record.state === "SETTLED" || res.record.settlement) {
          try {
            const trail = auditRef.current.filter(
              (e) => e.correlationId === record.correlationId,
            );
            const memWalResult = await memWalStore.persist(
              buildMemWalInput({ record: res.record, plan, trail }),
            );
            setMemWal((prev) => ({ ...prev, [record.id]: memWalResult }));
            appendAudit([
              {
                id: crypto.randomUUID(),
                correlationId: record.correlationId,
                entityType: "PAYMENT_INTENT",
                entityId: record.id,
                eventType: "MEMORY_STORED",
                actor: { type: "SYSTEM", id: "memwal" },
                payload: {
                  blobId: memWalResult.blobId,
                  url: memWalResult.url,
                  simulated: memWalResult.simulated,
                  error: memWalResult.error,
                },
                previousState: "EXECUTING",
                newState: null,
                simulated: memWalResult.simulated,
                timestamp: Date.now(),
              },
            ]);
          } catch (memErr) {
            // MemWal is additive — a failure never fails the payment.
            appendAudit([
              {
                id: crypto.randomUUID(),
                correlationId: record.correlationId,
                entityType: "PAYMENT_INTENT",
                entityId: record.id,
                eventType: "MEMORY_STORE_FAILED",
                actor: { type: "SYSTEM", id: "memwal" },
                payload: { error: memErr instanceof Error ? memErr.message : String(memErr) },
                previousState: "EXECUTING",
                newState: null,
                simulated: true,
                timestamp: Date.now(),
              },
            ]);
          }
        }

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
    setHedgeChoiceState({});
    setMemWal({});
    setActiveRecordId(null);
    setPlanRunState({ recordId: null, status: "idle", entries: [] });
    // Bump so local-state components (chat / QR) reset their working intents.
    setResetVersion((v) => v + 1);
    // Reset the per-id sync watermark so a re-run re-persists fresh records.
    lastSyncedRecordStateRef.current.clear();
    syncedAuditRef.current.clear();
    syncedReceiptsRef.current.clear();
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
      hedgeChoice,
      memWal,
      setActiveRecordId,
      setAcknowledged,
      setHedgeChoice,
      submitIntent,
      approve,
      reject,
      execute,
      attemptAiAutoExecute,
      dismissNotification,
      dismissFeedNotification,
      clearAll,
      soundEnabled,
      setSoundEnabled,
      privacyHidden,
      setPrivacyHidden,
      view,
      setView,
      planRun,
      resetPlanRun,
      resetVersion,
      supabase: supabaseState,
      refreshHistory,
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
      hedgeChoice,
      memWal,
      setActiveRecordId,
      setAcknowledged,
      setHedgeChoice,
      submitIntent,
      approve,
      reject,
      execute,
      attemptAiAutoExecute,
      dismissNotification,
      dismissFeedNotification,
      clearAll,
      soundEnabled,
      setSoundEnabled,
      privacyHidden,
      setPrivacyHidden,
      view,
      setView,
      planRun,
      resetPlanRun,
      resetVersion,
      supabaseState,
      refreshHistory,
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
  let code: ExecutionFailureInfo["code"] = "UNKNOWN";
  let stage: ExecutionFailureInfo["stage"] = "ROUTE_DISCOVERY";
  if (err instanceof MovaError) {
    if (err.code === "ERR_COMPLIANCE_BLOCKED") {
      code = "COMPLIANCE_BLOCKED";
      stage = "COMPLIANCE";
    } else if (err.code === "ERR_RISK_BLOCKED") {
      code = "RISK_BLOCKED";
      stage = "RISK_HEDGE";
    } else if (
      err.code === "ERR_COMPLIANCE_UNAVAILABLE" ||
      err.code === "ERR_ROUTING_FAILED" ||
      err.code === "ERR_INTEGRATION_UNAVAILABLE"
    ) {
      code = "INTEGRATION_UNAVAILABLE";
      stage = err.code === "ERR_COMPLIANCE_UNAVAILABLE" ? "COMPLIANCE" : "ROUTE_DISCOVERY";
    }
  }
  return {
    code,
    stage,
    message: err instanceof Error ? err.message : String(err),
    userActionable: false,
    retryable: code === "INTEGRATION_UNAVAILABLE",
    at: Date.now(),
  };
}
