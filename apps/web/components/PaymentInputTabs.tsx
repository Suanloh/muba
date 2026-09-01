"use client";
/**
 * Payment input tabs (requirement 2).
 *
 * Seamless tab switching between the "Chat" and "QR / Scan" payment interfaces
 * — no reloads. Both interfaces stay MOUNTED (hidden via CSS), so each keeps
 * its own state across switches: an in-progress chat conversation and a
 * decoded QR result both survive tab hops. Active tab is tracked in local JS
 * state and mirrored to `aria-selected` for a11y.
 */
import { useState } from "react";
import { MorphIcon } from "morphicons/react";
import { MessageCircle, QrCode } from "lucide"; // data, not components
import { ChatPaymentInterface } from "./ChatPaymentInterface";
import { QrScanInterface } from "./QrScanInterface";

type InputTab = "chat" | "qr";

export function PaymentInputTabs() {
  const [tab, setTab] = useState<InputTab>("chat");

  return (
    <div>
      {/* Segmented control */}
      <div
        role="tablist"
        aria-label="Payment input method"
        className="inline-flex rounded-full border border-hairline bg-surface p-1"
      >
        <TabButton
          id="tab-chat"
          active={tab === "chat"}
          onClick={() => setTab("chat")}
          icon={
            <MorphIcon icon={MessageCircle} size={16} strokeWidth={2} spring="snappy" reducedMotion="user" />
          }
        >
          Chat
        </TabButton>
        <TabButton
          id="tab-qr"
          active={tab === "qr"}
          onClick={() => setTab("qr")}
          icon={
            <MorphIcon icon={QrCode} size={16} strokeWidth={2} spring="snappy" reducedMotion="user" />
          }
        >
          QR / Scan
        </TabButton>
      </div>

      {/* Panes — both stay mounted so internal state (chat thread, QR result,
          camera) persists across tab switches without reloads. */}
      <div hidden={tab !== "chat"} role="tabpanel" aria-labelledby="tab-chat" className="mt-3">
        <ChatPaymentInterface />
      </div>
      <div hidden={tab !== "qr"} role="tabpanel" aria-labelledby="tab-qr" className="mt-3">
        <QrScanInterface />
      </div>
    </div>
  );
}

function TabButton({
  id,
  active,
  onClick,
  icon,
  children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={active ? `panel-${id}` : undefined}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition ${
        active ? "bg-surface-2 text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
