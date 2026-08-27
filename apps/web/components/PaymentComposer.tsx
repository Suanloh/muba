"use client";
import { useState } from "react";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { useAppStore } from "@/lib/store/app-store";
import { parseDemoIntent } from "@/lib/pipeline/demo-pipeline";
import { formatMoney } from "@/lib/pipeline/format";
import { EXPECTED_NETWORK } from "@/lib/wallet/networks";
import { Badge, Button, Card } from "./ui";

const EXAMPLES = [
  "Pay 10 SUI to 0x3a4d2f9c1e8b7a6f5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2",
  "Send 5 USDC to alice@example.com",
  "Transfer 250 SUI to @treasury for payroll",
];

export function PaymentComposer() {
  const { connection } = useMovaWallet();
  const { submitIntent } = useAppStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = connection.status === "connected";
  const parsed = text.trim().length > 0 ? parseDemoIntent(text, EXPECTED_NETWORK) : null;

  const handleSubmit = async () => {
    if (!parsed?.validated) return;
    setBusy(true);
    setError(null);
    try {
      await submitIntent(text);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="New payment"
      subtitle="Natural-language intent → deterministic validation → human approval. The AI never executes anything."
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone="slate">Deterministic validator</Badge>
          <Badge tone="blue">{EXPECTED_NETWORK}</Badge>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Try "Pay 10 SUI to 0x…" or "Send 5 USDC to alice@example.com"'
          rows={3}
          disabled={!connected}
          className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none disabled:bg-slate-50"
        />

        {!connected && (
          <p className="text-xs text-slate-500">Connect a wallet to create a payment — the connected address becomes the owner.</p>
        )}

        {parsed && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-600">Parsed intent</p>
              {parsed.validated ? <Badge tone="green">VALIDATED</Badge> : <Badge tone="red">INVALID</Badge>}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-slate-500">Action</dt>
              <dd className="text-slate-800">{parsed.action}</dd>
              <dt className="text-slate-500">Amount</dt>
              <dd className="text-slate-800">{formatMoney(parsed.amount)}</dd>
              <dt className="text-slate-500">Recipient</dt>
              <dd className="break-all text-slate-800">{parsed.recipient.value}</dd>
              <dt className="text-slate-500">Memo</dt>
              <dd className="text-slate-800">{parsed.memo ?? "—"}</dd>
            </dl>
            {!parsed.validated && (
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-rose-600">
                {parsed.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setText(ex)}
                className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
              >
                {ex.length > 38 ? `${ex.slice(0, 38)}…` : ex}
              </button>
            ))}
          </div>
          <Button onClick={handleSubmit} disabled={!connected || busy || !parsed?.validated}>
            {busy ? "Creating…" : "Create payment"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
