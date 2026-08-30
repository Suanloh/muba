"use client";
/**
 * Receive — QR + copy-address sheet for the connected Sui address, with a
 * network guardrail. The QR is rendered locally with `qrcode` (no third-party
 * service); it degrades to copy-address if rendering fails.
 */
import { useEffect, useState } from "react";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { shortAddress } from "@/lib/pipeline/format";
import { Button } from "@/components/ui";

export function ReceiveSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connection, appNetwork } = useMovaWallet();
  const address = connection.status === "connected" ? connection.account?.address ?? null : null;
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !address) {
      setQr(null);
      setQrFailed(false);
      return;
    }
    let alive = true;
    setQrFailed(false);
    void import("qrcode")
      .then((mod) => {
        const toDataURL = (mod as unknown as {
          toDataURL?: (t: string, o?: Record<string, unknown>) => Promise<string>;
        }).toDataURL;
        if (!toDataURL) return null;
        return toDataURL(address, {
          margin: 1,
          width: 180,
          color: { dark: "#15110e", light: "#ffffff" },
        });
      })
      .then((url) => {
        if (!alive) return;
        if (url) setQr(url);
        else setQrFailed(true);
      })
      .catch(() => {
        if (alive) setQrFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open, address]);

  if (!open) return null;

  const copy = () => {
    if (!address) return;
    void navigator.clipboard?.writeText(address).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Receive"
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-[18px] border border-hairline bg-surface p-5 shadow-pop">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">Receive</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-muted transition hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col items-center gap-3">
          {qr && !qrFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt="QR code for your Sui address"
              width={180}
              height={180}
              className="rounded-[12px] border border-hairline bg-white p-2"
            />
          ) : qrFailed ? (
            <p className="rounded-[10px] border border-ember-border bg-ember-bg px-3 py-2 text-xs text-ember-text">
              QR rendering unavailable here — copy the address below instead.
            </p>
          ) : (
            <div className="h-[180px] w-[180px] animate-pulse rounded-[12px] bg-surface-2" aria-hidden="true" />
          )}

          <div className="w-full rounded-[12px] border border-hairline bg-surface-2 p-3">
            <p className="break-all text-center font-mono text-xs text-ink">
              {address ? shortAddress(address, 14, 10) : "—"}
            </p>
          </div>

          <div className="flex w-full gap-2">
            <Button variant="primary" className="flex-1" onClick={copy}>
              {copied ? "Copied ✓" : "Copy address"}
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => address && window.open(`https://suiscan.xyz/${appNetwork ?? "testnet"}/account/${address}`, "_blank", "noopener")}
            >
              View on SuiScan
            </Button>
          </div>

          <p className="text-center text-[11px] text-faint">
            Only send <span className="font-mono">SUI · USDC · MOV</span> on{" "}
            <span className="font-mono">Sui {appNetwork ?? "testnet"}</span>. Funds sent on other
            networks may be unrecoverable.
          </p>
        </div>
      </div>
    </div>
  );
}
