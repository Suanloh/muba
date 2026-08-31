/**
 * MOVA audit report → PDF renderer.
 *
 * Generates a branded, multi-page PDF from the same report object the
 * AuditTrailPanel exports as JSON: record summary, the lifecycle timeline,
 * the per-phase decision log, and the raw (truncated) decision payloads.
 * Runs fully client-side with `jspdf` + `jspdf-autotable` — no server, no
 * network. The layout mirrors the MOVA design tokens (bark header on vellum).
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { PaymentAuditEntry, PaymentStatusStep } from "@mova/types";

// MOVA brand tokens (globals.css) — the PDF is a light "vellum" document.
const BARK = "#15110e";
const VELLUM = "#f6f1e8";
const INK = "#1f1a16";
const MUTED = "#6b645a";
const SIGNAL = "#4b4fd1";
const LEDGER = "#127a54";
const EMBER = "#9c6512";
const ALARM = "#c23a2d";
const LINE = "#e2d9c9";

export interface AuditReportPhase {
  stage: string;
  label?: string;
  entries: PaymentAuditEntry[];
}

export interface AuditReportData {
  title: string;
  generatedAt: string;
  record: {
    id: string;
    correlationId: string;
    state: string | null;
    amount: { asset: string; amount: string } | null;
    recipient: { type?: string; value: string; name?: string | null } | null;
    createdAt: number;
    updatedAt: number;
    approval?: unknown;
    execution?: unknown;
    settlement?: unknown;
  };
  lifecycle: PaymentStatusStep[];
  phases: AuditReportPhase[];
  currentState: string | null;
  terminal: boolean;
}

const short = (s: string | null | undefined) => (s ? `${s.slice(0, 12)}…` : "—");
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function summary(record: AuditReportData["record"]): Array<[string, string]> {
  const amount = record.amount ? `${record.amount.amount} ${record.amount.asset}` : "—";
  const recipient = record.recipient
    ? `${record.recipient.name ?? ""} ${record.recipient.value}`.trim()
    : "—";
  return [
    ["Record", short(record.id)],
    ["Correlation", short(record.correlationId)],
    ["State", String(record.state ?? "—")],
    ["Amount", amount],
    ["Recipient", recipient],
    ["Created", when(record.createdAt)],
    ["Updated", when(record.updatedAt)],
  ];
}

function outcomeTone(outcome: string): string {
  const o = outcome.toUpperCase();
  if (o === "ALLOW" || o === "PROCEED" || o === "APPROVED" || o === "SETTLED" || o === "CONFIRMED" || o === "HEDGE")
    return LEDGER;
  if (o === "REVIEW" || o === "PENDING" || o === "AWAITING_APPROVAL" || o === "EXECUTING") return EMBER;
  if (o === "BLOCK" || o === "FAILED" || o === "REJECTED") return ALARM;
  return SIGNAL;
}

const truncate = (s: string, max = 140) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** jspdf-autotable sets `doc.lastAutoTable` at runtime but doesn't type it. */
function tableEndY(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
  return last?.finalY ?? fallback;
}

/** Build + download the PDF (client-side). */
export function downloadAuditPdf(report: AuditReportData): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  const contentW = pageW - margin * 2;

  const footer = () => {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(MUTED);
      doc.text(`MOVA · audit report · page ${i} of ${pageCount}`, margin, doc.internal.pageSize.getHeight() - 24);
    }
  };

  // ---- Header band ---------------------------------------------------------
  doc.setFillColor(BARK);
  doc.rect(0, 0, pageW, 92, "F");
  doc.setTextColor(VELLUM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("MOVA — Payment Audit Report", margin, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(200, 195, 186);
  doc.text(`Generated ${new Date(report.generatedAt).toLocaleString()}`, margin, 62);
  doc.text(
    `Record ${short(report.record.id)} · correlation ${short(report.record.correlationId)} · ${
      report.terminal ? (report.record.state === "SETTLED" ? "terminal · SETTLED" : "terminal · FAILED") : `in-flight · ${report.currentState ?? "…"}`
    }`,
    margin,
    78,
  );

  let y = 118;

  // ---- Record summary ------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(INK);
  doc.text("Record summary", margin, y);
  autoTable(doc, {
    startY: y + 8,
    margin: { left: margin, right: margin },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5 },
    headStyles: { fillColor: BARK, textColor: VELLUM, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 110, fontStyle: "bold", textColor: MUTED } },
    body: summary(report.record),
  });
  y = tableEndY(doc, y) + 26;

  // ---- Lifecycle timeline --------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(INK);
  doc.text("Lifecycle timeline", margin, y);
  autoTable(doc, {
    startY: y + 8,
    margin: { left: margin, right: margin },
    theme: "striped",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: INK },
    headStyles: { fillColor: BARK, textColor: VELLUM, fontStyle: "bold" },
    body: report.lifecycle.map((s) => [
      s.label,
      s.state,
      s.actor,
      when(s.at),
      s.simulated ? "simulated" : "",
      s.detail ?? "",
    ]),
    head: [["Step", "State", "Actor", "When", "Mode", "Detail"]],
    columnStyles: { 4: { cellWidth: 62, halign: "center" } },
  });
  y = tableEndY(doc, y) + 26;

  // ---- Decision log (per phase) -------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(INK);
  doc.text("Decision log", margin, y);
  y += 8;

  const visiblePhases = report.phases.filter((p) => p.entries.length > 0);
  if (visiblePhases.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text("No decisions recorded for this payment yet.", margin, y + 10);
  } else {
    for (const phase of visiblePhases) {
      if (y > doc.internal.pageSize.getHeight() - 120) {
        doc.addPage();
        y = 50;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(BARK);
      doc.text(phase.label ?? phase.stage, margin, y);
      autoTable(doc, {
        startY: y + 8,
        margin: { left: margin, right: margin },
        theme: "striped",
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4.5, textColor: INK },
        headStyles: { fillColor: BARK, textColor: VELLUM, fontStyle: "bold" },
        body: phase.entries.map((e) => [
          e.eventType,
          e.outcome,
          `${e.actor.type}:${short(e.actor.id)}`,
          when(e.at),
          e.simulated ? "sim" : "",
          truncate(e.detail, 90),
          e.data !== undefined && e.data !== null ? truncate(JSON.stringify(e.data), 90) : "",
        ]),
        head: [["Event", "Outcome", "Actor", "When", "Mode", "Detail", "Payload"]],
        columnStyles: { 4: { cellWidth: 40, halign: "center" } },
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index === 1) {
            data.cell.styles.textColor = outcomeTone(String(data.cell.raw ?? ""));
            data.cell.styles.fontStyle = "bold";
          }
        },
      });
      y = tableEndY(doc, y) + 22;
    }
  }

  // ---- Footer / signature strip --------------------------------------------
  if (y > doc.internal.pageSize.getHeight() - 90) {
    doc.addPage();
    y = 50;
  }
  doc.setDrawColor(LINE);
  doc.setLineWidth(0.75);
  doc.line(margin, y, pageW - margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(
    "This report is an append-only projection of the immutable MOVA audit trail. Every decision above was emitted by a deterministic engine — the UI never invents one.",
    margin,
    y,
    { maxWidth: contentW },
  );
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(INK);
  doc.text("Signed:", margin, y);
  doc.text("Human approval gate — plan digest bound to the authorized transaction spec.", margin + 52, y);

  footer();
  doc.save(`mova-audit-report-${report.record.id.slice(0, 12)}.pdf`);
}
