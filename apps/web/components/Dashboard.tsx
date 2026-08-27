"use client";
import { WalletConnectButton } from "./WalletConnectButton";
import { NetworkBanner } from "./NetworkBanner";
import { WalletStatusCard } from "./WalletStatusCard";
import { PaymentComposer } from "./PaymentComposer";
import { PaymentFlowTimeline } from "./PaymentFlowTimeline";
import { ApprovalPanel } from "./ApprovalPanel";
import { SafetyBoundaryCard } from "./SafetyBoundaryCard";
import { TransactionHistory } from "./TransactionHistory";
import { OwnershipPanel } from "./OwnershipPanel";
import { NotificationArea } from "./NotificationArea";

export function Dashboard() {
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
          <WalletConnectButton />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <PaymentComposer />
          <PaymentFlowTimeline />
          <ApprovalPanel />
          <SafetyBoundaryCard />
          <TransactionHistory />
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
