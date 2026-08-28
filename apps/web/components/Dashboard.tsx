"use client";
import { WalletConnectButton } from "./WalletConnectButton";
import { NetworkBanner } from "./NetworkBanner";
import { WalletStatusCard } from "./WalletStatusCard";
import { ChatPaymentInterface } from "./ChatPaymentInterface";
import { QrScanInterface } from "./QrScanInterface";
import { TransactionStatusCard } from "./TransactionStatusCard";
import { PaymentPreviewPanel } from "./PaymentPreviewPanel";
import { PaymentExplanationPanel } from "./PaymentExplanationPanel";
import { RiskAssessmentPanel } from "./RiskAssessmentPanel";
import { ApprovalPanel } from "./ApprovalPanel";
import { SafetyBoundaryCard } from "./SafetyBoundaryCard";
import { AuditTrailPanel } from "./AuditTrailPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { TransactionHistory } from "./TransactionHistory";
import { OwnershipPanel } from "./OwnershipPanel";
import { NotificationArea } from "./NotificationArea";
import { useAppStore } from "@/lib/store/app-store";

/**
 * A numbered demo stage — makes the payment hierarchy explicit so a judge can
 * follow the story: understand → decide → approve/settle → verify.
 */
function Stage({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-2.5 border-b border-slate-200 pb-1.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
          {n}
        </span>
        <h2 className="text-sm font-bold tracking-wide text-slate-700">{title}</h2>
        <p className="text-[11px] text-slate-400">{hint}</p>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function Dashboard() {
  const { records, clearAll } = useAppStore();
  const hasRecords = records.length > 0;

  return (
    <div className="min-h-screen">
      <NotificationArea />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white">
              M
            </div>
            <div>
              <p className="text-sm font-bold tracking-wide text-slate-800">MOVA</p>
              <p className="text-[11px] text-slate-500">Autonomous payment agent · Sui</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasRecords && (
              <button
                type="button"
                onClick={() => clearAll()}
                className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
                title="Clear all demo records, receipts, notifications and audit events so you can run the demo again from a clean slate."
              >
                Reset demo
              </button>
            )}
            <WalletConnectButton />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <Stage n={1} title="Say what to pay" hint="describe it, or scan a merchant QR">
            <ChatPaymentInterface />
            <QrScanInterface />
          </Stage>

          <Stage n={2} title="Review the plan" hint="route, cost, compliance, risk & hedge — every decision explained">
            <TransactionStatusCard />
            <PaymentPreviewPanel />
            <PaymentExplanationPanel />
            <RiskAssessmentPanel />
          </Stage>

          <Stage n={3} title="Approve & settle" hint="only a human can authorize the wallet">
            <ApprovalPanel />
          </Stage>

          <Stage n={4} title="Verify the trail" hint="safety demo, notifications, audit & history">
            <SafetyBoundaryCard />
            <AuditTrailPanel />
            <NotificationsPanel />
            <TransactionHistory />
          </Stage>
        </div>
        <aside className="space-y-6">
          <NetworkBanner />
          <WalletStatusCard />
          <OwnershipPanel />
        </aside>
      </main>
    </div>
  );
}
