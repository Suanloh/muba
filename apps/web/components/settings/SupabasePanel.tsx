"use client";
/**
 * Supabase data-layer panel (Settings).
 *
 * Honest status of the Supabase wiring: online (Edge Function reachable,
 * records/audit/receipts being persisted, Realtime pushing status changes)
 * or offline (in-memory only — nothing is fabricated as persisted). Includes
 * a live connection probe and the last sync error.
 */
import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { movaDb, SUPABASE_CONFIGURED } from "@/lib/supabase/mova-db";
import { Badge, Button, Card } from "@/components/ui";

export function SupabasePanel() {
  const { supabase } = useAppStore();
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<"ok" | "fail" | null>(null);

  const online = supabase.status === "online";

  const probe = async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const ok = await movaDb.ping();
      setProbeResult(ok ? "ok" : "fail");
    } catch {
      setProbeResult("fail");
    } finally {
      setProbing(false);
    }
  };

  return (
    <Card title="Data layer · Supabase" subtitle="Persistence + Realtime status push.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={online ? "green" : "slate"}>
            {online ? "Supabase online" : "Offline (in-memory)"}
          </Badge>
          {supabase.realtimeEvents > 0 && (
            <Badge tone="blue">{supabase.realtimeEvents} realtime status event{supabase.realtimeEvents === 1 ? "" : "s"}</Badge>
          )}
          <span className="font-mono text-[11px] text-slate-400">
            {SUPABASE_CONFIGURED ? "configured" : "not configured"}
          </span>
        </div>

        {!online && (
          <p className="text-xs leading-relaxed text-slate-500">
            Supabase is not configured, so this session runs fully in-memory — no records are
            persisted and nothing is fabricated as stored. To wire a live backend set{" "}
            <code className="font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{" "}
            <code className="font-mono text-[11px]">apps/web/.env.local</code>, apply{" "}
            <code className="font-mono text-[11px]">supabase/migrations</code> and deploy the{" "}
            <code className="font-mono text-[11px]">mova-sync</code> Edge Function.
          </p>
        )}

        {online && (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Intents" value={supabase.syncedRecords} />
            <Stat label="Audit events" value={supabase.syncedAudit} />
            <Stat label="Receipts" value={supabase.syncedReceipts} />
          </div>
        )}

        {supabase.lastError && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-600">
            Last sync error: {supabase.lastError}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button variant="secondary" className="text-xs" onClick={() => void probe()} disabled={probing || !online}>
            {probing ? "Probing…" : "Test connection"}
          </Button>
          {probeResult === "ok" && <span className="text-xs text-emerald-600">✓ Edge Function reachable</span>}
          {probeResult === "fail" && (
            <span className="text-xs text-rose-600">
              Edge Function unreachable — is <code className="font-mono">mova-sync</code> deployed?
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-hairline bg-surface-2 px-2.5 py-2 text-center">
      <p className="font-display text-lg text-ink">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}
