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
import { ThemeToggle } from "./ThemeToggle";
import { useAppStore } from "@/lib/store/app-store";

/** MOVA brand mark — the ledger check, matching the prototype. */
function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="8" fill="var(--ledger)" />
      <path
        d="M8.5 14.8 12 18.3 19.5 9.8"
        fill="none"
        stroke="var(--bark)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A numbered demo stage — makes the payment hierarchy explicit so a judge can
 * follow the story: understand → decide → approve/settle → verify.
 */
function Stage({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
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

export function Dashboard() {
  const { records, clearAll } = useAppStore();
  const hasRecords = records.length > 0;

  return (
    <div className="min-h-screen bg-page text-ink">
      <NotificationArea />
      <header className="sticky top-0 z-40 border-b border-hairline bg-translucent backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div className="flex items-baseline gap-2">
              <p className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">MOVA</p>
              <p className="font-mono text-[11px] text-faint">AI-native payments on Sui</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasRecords && (
              <button
                type="button"
                onClick={() => clearAll()}
                className="rounded-[12px] border border-hairline px-3 py-1.5 font-mono text-xs text-muted transition hover:border-hairline-strong hover:text-ink"
                title="Clear all demo records, receipts, notifications and audit events so you can run the demo again from a clean slate."
              >
                Reset demo
              </button>
            )}
            <ThemeToggle />
            <WalletConnectButton />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_360px]">
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

      <footer className="border-t border-hairline py-8 text-center">
        <p className="font-mono text-[11px] text-faint">
          MOVA — every route, compliance check, and settlement decision is deterministic and auditable. AI proposes; only a human approves.
        </p>
      </footer>
    </div>
  );
}
