"use client";
/**
 * Settings — sound effects toggle, balance-privacy toggle, demo reset, and an
 * ecosystem note. Reached from the sidebar / bottom-bar "Settings" destination.
 */
import { useAppStore } from "@/lib/store/app-store";
import { Button, Card } from "@/components/ui";

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-signal" : "border border-hairline-strong bg-surface-2"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function SettingsPanel() {
  const { soundEnabled, setSoundEnabled, privacyHidden, setPrivacyHidden, records, clearAll } =
    useAppStore();

  return (
    <Card title="Settings" subtitle="Sound, privacy & demo controls.">
      <div className="divide-y divide-hairline">
        <ToggleRow
          label="Sound effects"
          desc="Play a short sound for payment success / failure and approval-required events."
          checked={soundEnabled}
          onChange={setSoundEnabled}
        />
        <ToggleRow
          label="Hide balances"
          desc="Mask all amounts and fiat values across Portfolio and Activity."
          checked={privacyHidden}
          onChange={setPrivacyHidden}
        />
      </div>

      <div className="mt-4 border-t border-hairline pt-4">
        <p className="text-sm font-medium text-ink">Demo</p>
        <p className="mt-0.5 text-xs text-muted">
          Clear all demo records, receipts, notifications and audit events so you can run the demo
          again from a clean slate.
        </p>
        <Button variant="secondary" className="mt-2" disabled={records.length === 0} onClick={clearAll}>
          Reset demo
        </Button>
      </div>

      <div className="mt-4 border-t border-hairline pt-4">
        <p className="text-sm font-medium text-ink">Ecosystems</p>
        <p className="mt-0.5 text-xs text-muted">
          MOVA settles on Sui. EVM wallets (MetaMask, Rabby…) connect read-only — balances and
          signature proof only; no EVM settlement yet.
        </p>
      </div>
    </Card>
  );
}
