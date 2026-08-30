"use client";
/**
 * Live Run widget (requirement 3).
 *
 * A real-time activity-log stream of the unified plan review. Each entry is
 * streamed from `runPlanReview` as the pipeline progresses (Strategy analysis
 * → Compliance & regulatory check → Risk & route optimization → Preview), with
 * a timestamp, a status glyph and a stage tag. Auto-scrolls as new entries
 * arrive. Idle until a chat/QR payment is confirmed.
 */
import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { STAGE_LABELS, type LiveRunEntry } from "@/lib/pipeline/plan-review";
import { Badge, Card } from "./ui";

const GLYPHS: Record<LiveRunEntry["kind"], { glyph: string; cls: string }> = {
  run: { glyph: "▸", cls: "text-signal-text" },
  ok: { glyph: "✓", cls: "text-ledger-text" },
  warn: { glyph: "!", cls: "text-ember-text" },
  fail: { glyph: "✕", cls: "text-alarm-text" },
  info: { glyph: "·", cls: "text-faint" },
};

type StatusTone = "blue" | "green" | "red" | "slate";
const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  running: { label: "Running", tone: "blue" },
  done: { label: "Done", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  idle: { label: "Idle", tone: "slate" },
};
const IDLE_META: { label: string; tone: StatusTone } = { label: "Idle", tone: "slate" };

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function RunRow({ e }: { e: LiveRunEntry }) {
  const g = GLYPHS[e.kind];
  return (
    <li className="flex items-baseline gap-2 px-3 py-1.5 font-mono text-[12px]">
      <span className="shrink-0 text-[10px] text-faint">{fmtClock(e.at)}</span>
      <span className={`w-3 shrink-0 text-center ${g.cls}`} aria-hidden="true">
        {g.glyph}
      </span>
      <span className="min-w-0 flex-1 text-muted">
        <span className={e.kind === "ok" || e.kind === "fail" ? "text-ink" : ""}>{e.text}</span>
      </span>
      <span className="shrink-0 text-[9px] uppercase tracking-[0.06em] text-faint">
        {STAGE_LABELS[e.stage]}
      </span>
    </li>
  );
}

export function LiveRunPanel() {
  const { planRun } = useAppStore();
  const bodyRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [planRun.entries.length]);

  const meta = STATUS_META[planRun.status] ?? IDLE_META;
  const running = planRun.status === "running";
  const lastStage = planRun.entries[planRun.entries.length - 1]?.stage;

  return (
    <Card
      title="Plan review · Live run"
      subtitle={
        <>
          Single prompt → strategy → compliance → risk & route → preview.{" "}
          {planRun.recordId && <span className="font-mono text-faint">{planRun.recordId.slice(0, 14)}…</span>}
        </>
      }
    >
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          {running && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-signal opacity-60 mova-pulse" />
          )}
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
              running ? "bg-signal" : meta.tone === "green" ? "bg-ledger" : meta.tone === "red" ? "bg-alarm" : "bg-faint"
            }`}
          />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">Live run</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {running && lastStage && (
          <span className="ml-auto font-mono text-[11px] text-muted">
            {STAGE_LABELS[lastStage]}…
          </span>
        )}
        {planRun.status === "done" && (
          <span className="ml-auto font-mono text-[11px] text-ledger-text">
            {planRun.entries.length} events · pipeline complete
          </span>
        )}
      </div>

      {/* Streaming log */}
      {planRun.entries.length === 0 ? (
        <div className="mt-3 rounded-[12px] border border-dashed border-hairline-strong px-4 py-6 text-center">
          <p className="text-sm text-muted">
            No plan review yet. Confirm a chat or QR payment to watch the unified pipeline run
            end-to-end.
          </p>
          <p className="mt-1 font-mono text-[11px] text-faint">strategy → compliance → risk &amp; route → preview</p>
        </div>
      ) : (
        <ol
          ref={bodyRef}
          className="mt-3 max-h-56 space-y-px overflow-y-auto rounded-[12px] border border-hairline bg-surface-2 py-1.5"
        >
          {planRun.entries.map((e) => (
            <RunRow key={e.id} e={e} />
          ))}
          {running && (
            <li className="flex items-center gap-2 px-3 py-1.5 font-mono text-[12px] text-faint">
              <span className="h-3 w-3 animate-spin rounded-full border border-hairline-strong border-t-signal" />
              processing…
            </li>
          )}
        </ol>
      )}

      <p className="mt-3 text-[10px] text-faint">
        Streamed live from the deterministic engine — every verdict above is real, computed data.
      </p>
    </Card>
  );
}
