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
import { MovaError, ErrorCode } from "@mova/logger";
import type { AuditEvent, Network } from "@mova/types";
import type {
  GateVerdict,
  PaymentReceipt,
  PaymentRecord,
  SuiAddress,
} from "@mova/wallet";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { EXPECTED_NETWORK, WEB_SETTLEMENT_MODE } from "@/lib/wallet/networks";
import { buildTransferTransaction } from "@/lib/pipeline/real-settlement";
import {
  approveFlow,
  checkGateForRecord,
  createFlow,
  executeFlow,
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
}

interface AppStoreValue {
  records: PaymentRecord[];
  receipts: PaymentReceipt[];
  notifications: AppNotification[];
  audit: AuditEvent[];
  activeRecordId: string | null;
  setActiveRecordId: (id: string | null) => void;
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
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const auditRef = useRef<AuditEvent[]>([]);

  const ownerAddress: SuiAddress | null =
    connection.status === "connected" ? connection.account?.address ?? null : null;

  const appendAudit = useCallback((events: AuditEvent[]) => {
    if (events.length === 0) return;
    auditRef.current = [...auditRef.current, ...events];
    setAudit([...auditRef.current]);
  }, []);

  const notify = useCallback((kind: AppNotification["kind"], title: string, message: string) => {
    const n: AppNotification = { id: crypto.randomUUID(), kind, title, message, at: Date.now() };
    setNotifications((prev) => [...prev.slice(-8), n]);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const updateRecord = useCallback((record: PaymentRecord) => {
    setRecords((prev) => prev.map((r) => (r.id === record.id ? record : r)));
  }, []);

  const addReceipt = useCallback((receipt: PaymentReceipt) => {
    setReceipts((prev) => [receipt, ...prev]);
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

      const staged = runToAwaitingApproval(record);
      appendAudit(staged.events);
      if (!staged.ok) {
        notify("error", "Pipeline stalled", staged.reason ?? "could not advance the flow");
        return staged.record;
      }
      setRecords((prev) => prev.map((r) => (r.id === record.id ? staged.record : r)));
      notify("info", "Awaiting approval", `${parsed.action} ${parsed.amount.amount} ${parsed.amount.asset} to ${parsed.recipient.value}`);
      return staged.record;
    },
    [ownerAddress, appendAudit, notify],
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
      const res = approveFlow(record, ownerAddress);
      updateRecord(res.record);
      appendAudit(res.events);
      notify("success", "Approved", `Payment ${record.id.slice(0, 12)}… approved. Payment authz issued to ${ownerAddress.slice(0, 10)}….`);
      return res.record;
    },
    [records, ownerAddress, updateRecord, appendAudit, notify],
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
      notify("warning", "Rejected", `Payment ${record.id.slice(0, 12)}… was rejected.`);
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
      const networkMatches = network.matches;
      if (!networkMatches) {
        const err = new MovaError(ErrorCode.WALLET_NETWORK_MISMATCH, "Wallet network does not match the MOVA expected network.");
        notify("error", "Network mismatch", err.message);
        throw err;
      }
      // Defense in depth: the gate must pass before touching the wallet.
      const verdict = checkGateForRecord(record, {
        connected: true,
        ownerAddress: record.ownerAddress,
        networkMatches,
      });
      if (!verdict.allowed) {
        const err = new MovaError(ErrorCode.EXECUTION_GATE_BLOCKED, `Execution refused: ${verdict.reason}`, {
          details: { code: verdict.code },
        });
        notify("error", "Gate blocked", err.message);
        throw err;
      }

      // Real settlement: build a native-SUI transfer PTB from the validated
      // record and submit through the connected wallet (gated). Falls back to
      // simulated with an honest note when the wallet can't submit.
      const realSubmit =
        WEB_SETTLEMENT_MODE === "real"
          ? async (rec: PaymentRecord): Promise<RealSettlementAttempt> => {
              try {
                const tx = buildTransferTransaction(rec, rec.ownerAddress);
                const res = await executeTransaction(tx);
                if (res.ok && res.digest) return { digest: res.digest, error: null };
                return { digest: null, error: res.error ?? "wallet could not execute the transaction" };
              } catch (err) {
                return { digest: null, error: err instanceof Error ? err.message : String(err) };
              }
            }
          : undefined;

      const res = await executeFlow(record, provider, { networkMatches, submitReal: realSubmit });
      updateRecord(res.record);
      appendAudit(res.events);
      if (res.receipt) addReceipt(res.receipt);

      const settled = res.record.settlement;
      if (settled?.simulated === false) {
        notify(
          "success",
          "Settled (real testnet)",
          `Record ${record.id.slice(0, 12)}… settled on-chain. Digest ${settled.txDigest?.slice(0, 14)}….`,
        );
      } else if (settled?.error) {
        notify("warning", "Settled (simulated fallback)", settled.error);
      } else {
        notify("success", "Settled (simulated)", `Record ${record.id.slice(0, 12)}… settled via wallet authz. No real value moved.`);
      }
      return res.record;
    },
    [records, provider, network.matches, executeTransaction, updateRecord, appendAudit, addReceipt, notify],
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
    auditRef.current = [];
    setAudit([]);
    setActiveRecordId(null);
  }, []);

  const value = useMemo<AppStoreValue>(
    () => ({
      records,
      receipts,
      notifications,
      audit,
      activeRecordId,
      setActiveRecordId,
      submitIntent,
      approve,
      reject,
      execute,
      attemptAiAutoExecute,
      dismissNotification,
      clearAll,
    }),
    [records, receipts, notifications, audit, activeRecordId, submitIntent, approve, reject, execute, attemptAiAutoExecute, dismissNotification, clearAll],
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
