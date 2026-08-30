"use client";
import { NetworkBanner } from "./NetworkBanner";
import { WalletStatusCard } from "./WalletStatusCard";
import { OwnershipPanel } from "./OwnershipPanel";
import { PaymentInputTabs } from "./PaymentInputTabs";
import { LiveRunPanel } from "./LiveRunPanel";
import { TransactionStatusCard } from "./TransactionStatusCard";
import { PaymentPreviewPanel } from "./PaymentPreviewPanel";
import { PaymentExplanationPanel } from "./PaymentExplanationPanel";
import { RiskAssessmentPanel } from "./RiskAssessmentPanel";
import { ApprovalPanel } from "./ApprovalPanel";
import { SafetyBoundaryCard } from "./SafetyBoundaryCard";
import { AuditTrailPanel } from "./AuditTrailPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { NotificationArea } from "./NotificationArea";
import { HeaderBar } from "@/components/chrome/HeaderBar";
import { Sidebar } from "@/components/chrome/Sidebar";
import { BottomBar } from "@/components/chrome/BottomBar";
import { ActivityPanel } from "@/components/activity/ActivityPanel";
import { BalanceCard } from "@/components/portfolio/BalanceCard";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { useAppStore } from "@/lib/store/app-store";

/**
 * A numbered demo stage — makes the payment hierarchy explicit so a judge can
 * follow the story: understand → decide → approve/settle → verify.
 */
function Stage({
  n,
  title,
  hint,
  id,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <div className="flex items-baseline gap-3 border-b border-hairline pb-2">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          {String(n).padStart(2, "0")}
        </span>
        <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        <p className="text-[11px] text-faint">{hint}</p>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function HomeView() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-8">
        <section className="pt-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-faint">
            Say what you want to pay
          </p>
          <h1 className="mt-2 font-display text-[clamp(28px,4vw,38px)] font-semibold leading-[1.08] tracking-[-0.01em] text-ink">
            MOVA finds the route, checks the rules, and settles it on Sui.
          </h1>
          <p className="mt-2 max-w-[52ch] text-[15px] text-muted">
            Nothing moves until you approve it. Follow the story from intent to settlement.
          </p>
        </section>

        <Stage n={1} title="Say what to pay" hint="describe it, or scan a merchant QR">
          <PaymentInputTabs />
        </Stage>

        <Stage
          n={2}
          title="Review the plan"
          hint="txn → risk & hedging → explanation → preview — every decision explained"
          id="plan-review"
        >
          <TransactionStatusCard />
          <RiskAssessmentPanel />
          <PaymentExplanationPanel />
          <PaymentPreviewPanel />
        </Stage>

        <Stage n={3} title="Approve & settle" hint="only a human can authorize the wallet">
          <ApprovalPanel />
        </Stage>
      </div>
      <aside className="space-y-6">
        <NetworkBanner />
        <WalletStatusCard />
        <OwnershipPanel />
        <LiveRunPanel />
      </aside>
    </div>
  );
}

/**
 * Activity view — transaction history plus the "Verify the trail" section
 * (safety boundary demo, immutable audit trail and the per-payment
 * notification feed), moved out of the Home page into Activity (Phase 4).
 */
function ActivityView() {
  return (
    <div className="space-y-8">
      <ActivityPanel />
      <Stage n={4} title="Verify the trail" hint="safety demo, notifications, audit & history">
        <SafetyBoundaryCard />
        <AuditTrailPanel />
        <NotificationsPanel />
      </Stage>
    </div>
  );
}

export function Dashboard() {
  const { view } = useAppStore();

  return (
    <div className="min-h-screen bg-page text-ink">
      <NotificationArea />
      <HeaderBar />

      <div className="mx-auto flex max-w-7xl">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 py-6 lg:py-8">
          {view === "home" && <HomeView />}
          {view === "activity" && <ActivityView />}
          {view === "portfolio" && <BalanceCard />}
          {view === "settings" && <SettingsPanel />}
        </main>
      </div>

      <BottomBar />

      <footer className="border-t border-hairline py-8 text-center">
        <p className="font-mono text-[11px] text-faint">
          MOVA — every route, compliance check, and settlement decision is deterministic and auditable. AI proposes; only a human approves.
        </p>
      </footer>
    </div>
  );
}
