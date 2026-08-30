"use client";
/**
 * MOVA MemWal panel — the payment-memory store on Walrus (Sui's decentralized
 * blob storage).
 *
 * Every settled payment's memory (audit trail + settlement facts) is snapshotted
 * to Walrus with a blobId. This panel lists the stored memories and can read a
 * blob back to prove the round trip. Default is the static/demo store
 * (simulated blobIds, clearly labelled); set NEXT_PUBLIC_WALRUS_ENABLED=true
 * to store on real Walrus testnet.
 */
import { useState } from "react";
import { memWalStore } from "@/lib/pipeline/memwal";
import { useAppStore } from "@/lib/store/app-store";
import { shortAddress } from "@/lib/pipeline/format";
import { Badge, Button, Card } from "../ui";

export function MemWalPanel() {
  const { memWal, records } = useAppStore();
  const [readIds, setReadIds] = useState<Record<string, string | null>>({});
  const [readText, setReadText] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const entries = Object.entries(memWal).sort((a, b) => {
    const ta = a[1].storedAt;
    const tb = b[1].storedAt;
    return tb - ta;
  });

  const readBack = async (recordId: string, blobId: string) => {
    setBusyId(recordId);
    try {
      const res = await memWalStore.read(blobId);
      setReadIds((prev) => ({ ...prev, [recordId]: blobId }));
      setReadText((prev) => ({ ...prev, [recordId]: res.text }));
    } catch (err) {
      setReadText((prev) => ({
        ...prev,
        [recordId]: `Could not read blob: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card
      title="MemWal — payment memory on Walrus"
      subtitle="Immutable snapshots of each settled payment, stored on Sui's decentralized blob store."
    >
      {entries.length === 0 ? (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">
            When a payment settles, MOVA snapshots its audit trail + settlement facts to Walrus
            (the “MemWal”). No memories stored yet — settle a payment to create one.
          </p>
          <p className="text-xs text-muted">
            Default: static demo store (simulated blobIds). Set{" "}
            <code className="rounded bg-surface-2 px-1 font-mono text-[10px]">NEXT_PUBLIC_WALRUS_ENABLED=true</code>{" "}
            to persist on real Walrus testnet.
          </p>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">
            {entries.length} stored memory {entries.length === 1 ? "blob" : "blobs"} ·{" "}
            {records.length} payment record{records.length === 1 ? "" : "s"}.
          </p>
          <div className="space-y-2">
            {entries.map(([recordId, entry]) => (
              <div
                key={recordId}
                className="rounded-lg border border-hairline bg-surface-2 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-ink">{shortAddress(recordId, 14)}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                      blob {entry.blobId}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={entry.simulated ? "amber" : "green"}>
                      {entry.simulated ? "simulated" : "real walrus"}
                    </Badge>
                    <Button
                      variant="ghost"
                      className="!px-2 !py-0.5 text-[11px]"
                      disabled={busyId === recordId}
                      onClick={() => void readBack(recordId, entry.blobId)}
                    >
                      {busyId === recordId ? "Reading…" : readIds[recordId] === entry.blobId ? "Re-read" : "Read back"}
                    </Button>
                  </div>
                </div>

                {entry.error && (
                  <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                    {entry.error}
                  </p>
                )}
                {entry.url && (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-[11px] text-signal underline decoration-dotted"
                  >
                    Read on Walrus aggregator ↗
                  </a>
                )}
                {readIds[recordId] === entry.blobId && readText[recordId] && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded border border-hairline bg-code p-2 font-mono text-[10px] leading-relaxed text-code-text">
                    {readText[recordId]}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
