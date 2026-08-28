"use client";
import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { shortId } from "@/lib/pipeline/format";
import { Badge, Button, Card } from "./ui";

/**
 * Demonstrates the safety boundary: an AI suggestion that tries to execute a
 * payment WITHOUT going through human approval must be refused by the
 * WalletExecutionGate. This is a compliance incident if it were not.
 */
export function SafetyBoundaryCard() {
  const { records, activeRecordId, attemptAiAutoExecute } = useAppStore();
  const [verdict, setVerdict] = useState<{ allowed: boolean; code: string; reason: string } | null>(null);

  const record = records.find((r) => r.id === activeRecordId) ?? null;

  const run = () => {
    if (!record) return;
    const v = attemptAiAutoExecute(record.id);
    setVerdict({ allowed: v.allowed, code: v.code, reason: v.reason });
  };

  return (
    <Card
      title="Safety boundary demo"
      subtitle="The wallet layer never auto-executes arbitrary AI-generated transactions."
    >
      {!record ? (
        <p className="text-sm text-slate-500">Create a payment first, then try to bypass approval.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">
            This button simulates an AI agent claiming <em>“execute now”</em> on{" "}
            <span className="font-mono">{shortId(record.id)}</span> <em>without</em> a human approval. Every
            transaction must pass: <span className="font-medium">Intent → Validation → Approval → Wallet authz → Execution</span>.
          </p>
          <Button variant="danger" onClick={run}>
            Simulate AI auto-execute (no approval)
          </Button>

          {verdict && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                {verdict.allowed ? <Badge tone="green">ALLOWED</Badge> : <Badge tone="red">BLOCKED (fail closed)</Badge>}
                <span className="font-mono text-[11px] text-slate-500">{verdict.code}</span>
              </div>
              <p className="mt-2 text-xs text-slate-700">{verdict.reason}</p>
              {!verdict.allowed && (
                <p className="mt-2 text-[11px] text-slate-500">
                  ✓ Expected behaviour — an AI suggestion can never authorize value movement. This is the safety
                  property that must hold for every phase.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
