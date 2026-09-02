/**
 * MOVA audit report → PDF renderer.
 *
 * Generates a branded, multi-page PDF from the same report object the
 * AuditTrailPanel exports as JSON: record summary, the lifecycle timeline,
 * the per-phase decision log, and the raw (truncated) decision payloads.
 * Runs fully client-side with `jspdf` — no server, no network.
 *
 * Layout is built from a small set of section renderers (drawHeader,
 * drawStatusBanner, drawSummary, drawLifecycleRail, drawDecisionLog,
 * drawSignatureStrip) that each take the current y-cursor and return the
 * next one — `buildAuditPdf` is just that sequence. The visual language
 * mirrors the live app: a serif for voice (section titles, the one
 * emphasis line), a plain sans for body copy, monospace for anything
 * technical (ids, hashes, timestamps), and the same four status colors
 * used everywhere else in MOVA — ledger/ember/alarm/signal — never a
 * fifth ad hoc color.
 */
import { jsPDF } from "jspdf";
import type { PaymentAuditEntry, PaymentStatusStep } from "@mova/types";

// ---------------------------------------------------------------------------
// Design tokens — same values as globals.css (light theme; the PDF is a
// printed "vellum" document, so it always uses the light palette regardless
// of which theme the app is in when the user clicks Download).
// ---------------------------------------------------------------------------
const BARK = "#15110e";
const VELLUM = "#f6f1e8";
const INK = "#1c1712";
const MUTED = "#6b6459";
const FAINT = "#9a9285";
const LINE = "#e2d9c9";

const SIGNAL = "#4b4fd1";
const LEDGER = "#127a54";
const EMBER = "#9c6512";
const ALARM = "#c23a2d";

// Soft tints of the four status colors, hand-picked to sit on VELLUM the
// same way the app's *-bg tokens sit on its light surfaces. jsPDF has no
// reliable cross-version alpha compositing, so these are precomputed
// solid colors rather than a real opacity blend.
const TONE = {
  ledger: { fg: LEDGER, bg: "#e2f0e8" },
  ember: { fg: EMBER, bg: "#f8ecd6" },
  alarm: { fg: ALARM, bg: "#f9e2de" },
  signal: { fg: SIGNAL, bg: "#e6e7fa" },
} as const;
type Tone = keyof typeof TONE;

// jsPDF ships three fonts with no embedding required. They stand in for
// the app's real type system: a serif for display/voice (Fraunces),
// a plain sans for body (IBM Plex Sans), monospace for data (IBM Plex
// Mono). Swap these for real embedded fonts later via doc.addFont() if
// pixel-exact brand match is worth the extra asset pipeline — the layout
// code below doesn't care which font backs each role.
const FONT = { display: "times", body: "helvetica", mono: "courier" } as const;

const TYPE = { h1: 20, h2: 12.5, h3: 10, body: 9, small: 8, tiny: 7.25 };
const SPACE = { xs: 4, sm: 8, md: 14, lg: 22, xl: 34 };
const PAGE_MARGIN = 40;

// ---------------------------------------------------------------------------
// Public data shape — unchanged from the previous version. Anything that
// constructs an AuditReportData elsewhere in the app keeps working.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
const short = (s: string | null | undefined, len = 12) => (s ? `${s.slice(0, len)}\u2026` : "\u2014");
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const truncate = (s: string, max = 220) => (s.length > max ? `${s.slice(0, max)}\u2026` : s);

const LEDGER_WORDS = new Set(["ALLOW", "PROCEED", "APPROVED", "SETTLED", "CONFIRMED", "HEDGE"]);
const EMBER_WORDS = new Set(["REVIEW", "PENDING", "AWAITING_APPROVAL", "EXECUTING"]);
const ALARM_WORDS = new Set(["BLOCK", "FAILED", "REJECTED"]);

function outcomeTone(outcome: string): Tone {
  const o = outcome.toUpperCase();
  if (LEDGER_WORDS.has(o)) return "ledger";
  if (EMBER_WORDS.has(o)) return "ember";
  if (ALARM_WORDS.has(o)) return "alarm";
  return "signal";
}

// ---------------------------------------------------------------------------
// Drawing primitives — every section renderer below is built from these,
// so the whole document shares one spacing rhythm and one badge shape
// instead of each section inventing its own.
// ---------------------------------------------------------------------------

/** Adds a page and resets y past the top margin if `needed` pt won't fit. */
function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed <= pageH - PAGE_MARGIN) return y;
  doc.addPage();
  return PAGE_MARGIN + SPACE.sm;
}

/** A section title in the display face, with a short accent rule beneath it. */
function sectionHeading(doc: jsPDF, text: string, y: number): number {
  y = ensureSpace(doc, y, TYPE.h2 + SPACE.md);
  doc.setFont(FONT.display, "bold");
  doc.setFontSize(TYPE.h2);
  doc.setTextColor(INK);
  doc.text(text, PAGE_MARGIN, y);
  doc.setDrawColor(LEDGER);
  doc.setLineWidth(1.5);
  doc.line(PAGE_MARGIN, y + 5, PAGE_MARGIN + 22, y + 5);
  return y + SPACE.lg;
}

/** Measures a pill's width without drawing it, so callers can right-align it first. */
function measurePill(doc: jsPDF, text: string): number {
  doc.setFont(FONT.body, "bold");
  doc.setFontSize(TYPE.tiny);
  return doc.getTextWidth(text.toUpperCase()) + SPACE.sm * 2;
}

/** Draws a rounded status pill with its left edge at x, vertically centered on y. */
function drawPill(doc: jsPDF, text: string, x: number, y: number, tone: Tone): number {
  const label = text.toUpperCase();
  doc.setFont(FONT.body, "bold");
  doc.setFontSize(TYPE.tiny);
  const w = doc.getTextWidth(label) + SPACE.sm * 2;
  const h = TYPE.tiny + 7;
  const { fg, bg } = TONE[tone];
  doc.setFillColor(bg);
  doc.roundedRect(x, y - h + 3, w, h, h / 2, h / 2, "F");
  doc.setTextColor(fg);
  doc.text(label, x + SPACE.sm, y);
  return w;
}

/** Greedy word-wrap that also hard-breaks any single token wider than
 *  maxWidth (long URLs, hashes, minified JSON) instead of letting it run
 *  off the page the way splitTextToSize alone would. */
function wrapToWidth(doc: jsPDF, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (doc.getTextWidth(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (doc.getTextWidth(word) <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      if (chunk && doc.getTextWidth(chunk + ch) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Wraps and draws body text, returning the y position just below it. */
function drawWrapped(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  opts: { size?: number; color?: string; font?: string; style?: string; leading?: number } = {},
): number {
  const size = opts.size ?? TYPE.body;
  const leading = opts.leading ?? size + 3;
  doc.setFont(opts.font ?? FONT.body, opts.style ?? "normal");
  doc.setFontSize(size);
  doc.setTextColor(opts.color ?? INK);
  const lines = wrapToWidth(doc, text, maxWidth);
  for (const line of lines) {
    y = ensureSpace(doc, y, leading);
    doc.text(line, x, y);
    y += leading;
  }
  return y;
}

/** A thin full-width hairline, e.g. between decision-log entries. */
function hairline(doc: jsPDF, y: number, x1 = PAGE_MARGIN, x2?: number): void {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setDrawColor(LINE);
  doc.setLineWidth(0.5);
  doc.line(x1, y, x2 ?? pageW - PAGE_MARGIN, y);
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

/** Bark header band: small logomark, title, and a compact meta line. */
function drawHeader(doc: jsPDF, report: AuditReportData): number {
  const pageW = doc.internal.pageSize.getWidth();
  const bandH = 108;

  doc.setFillColor(BARK);
  doc.rect(0, 0, pageW, bandH, "F");

  // Logomark: rounded square in ledger green, dark checkmark — same shape
  // as the app's brand mark, just redrawn with jsPDF's vector primitives.
  const lx = PAGE_MARGIN;
  const ly = 28;
  const ls = 24;
  doc.setFillColor(LEDGER);
  doc.roundedRect(lx, ly, ls, ls, 7, 7, "F");
  doc.setDrawColor(BARK);
  doc.setLineWidth(2.2);
  doc.line(lx + 6, ly + 13, lx + 10, ly + 17);
  doc.line(lx + 10, ly + 17, lx + 18, ly + 7);

  doc.setFont(FONT.display, "bold");
  doc.setFontSize(TYPE.h1);
  doc.setTextColor(VELLUM);
  doc.text("MOVA — Payment Audit Report", lx + ls + 12, 46);

  doc.setFont(FONT.body, "normal");
  doc.setFontSize(TYPE.small);
  doc.setTextColor("#c8c3ba");
  doc.text(`Generated ${new Date(report.generatedAt).toLocaleString()}`, lx, 78);

  doc.setFont(FONT.mono, "normal");
  doc.text(
    `record ${short(report.record.id)}  \u00b7  correlation ${short(report.record.correlationId)}`,
    lx,
    92,
  );

  return bandH + SPACE.xl;
}

/** A large, unmissable status pill — the single most important fact, first. */
function drawStatusBanner(doc: jsPDF, report: AuditReportData, y: number): number {
  const label = report.terminal
    ? report.record.state === "SETTLED"
      ? "SETTLED"
      : (report.record.state ?? "FAILED")
    : (report.currentState ?? "IN PROGRESS");
  const tone = outcomeTone(label);
  const sub = report.terminal ? "Terminal state — this record is closed." : "In flight — this record can still change.";

  doc.setFont(FONT.body, "bold");
  doc.setFontSize(TYPE.h3 + 2);
  const w = doc.getTextWidth(label.replace(/_/g, " ")) + SPACE.md * 2;
  const h = TYPE.h3 + 16;
  const { fg, bg } = TONE[tone];
  doc.setFillColor(bg);
  doc.roundedRect(PAGE_MARGIN, y, w, h, h / 2, h / 2, "F");
  doc.setTextColor(fg);
  doc.text(label.replace(/_/g, " "), PAGE_MARGIN + SPACE.md, y + h / 2 + 4);

  doc.setFont(FONT.body, "normal");
  doc.setFontSize(TYPE.small);
  doc.setTextColor(MUTED);
  doc.text(sub, PAGE_MARGIN + w + SPACE.md, y + h / 2 + 4);

  return y + h + SPACE.xl;
}

/** Record summary as a clean two-column key/value list — no table grid. */
function drawSummary(doc: jsPDF, report: AuditReportData, y: number): number {
  y = sectionHeading(doc, "Record summary", y);

  const amount = report.record.amount ? `${report.record.amount.amount} ${report.record.amount.asset}` : "\u2014";
  const recipient = report.record.recipient
    ? `${report.record.recipient.name ?? ""} ${report.record.recipient.value}`.trim()
    : "\u2014";
  const rows: Array<[string, string, boolean]> = [
    ["Record", short(report.record.id, 20), true],
    ["Correlation", short(report.record.correlationId, 20), true],
    ["Amount", amount, true],
    ["Recipient", recipient, false],
    ["Created", when(report.record.createdAt), false],
    ["Updated", when(report.record.updatedAt), false],
  ];

  const colW = (doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2 - SPACE.xl) / 2;
  const rowH = TYPE.body + 15;
  rows.forEach(([label, value, mono], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = PAGE_MARGIN + col * (colW + SPACE.xl);
    const ry = y + row * rowH;
    doc.setFont(FONT.body, "normal");
    doc.setFontSize(TYPE.tiny);
    doc.setTextColor(FAINT);
    doc.text(label.toUpperCase(), x, ry);
    doc.setFont(mono ? FONT.mono : FONT.body, "normal");
    doc.setFontSize(TYPE.body);
    doc.setTextColor(INK);
    doc.text(doc.splitTextToSize(value, colW)[0] ?? value, x, ry + 13);
  });

  return y + Math.ceil(rows.length / 2) * rowH + SPACE.md;
}

/** Lifecycle as a vertical rail — dot + connecting line — mirroring the live app. */
function drawLifecycleRail(doc: jsPDF, report: AuditReportData, y: number): number {
  if (report.lifecycle.length === 0) return y;
  y = sectionHeading(doc, "Lifecycle", y);

  const dotX = PAGE_MARGIN + 4;
  const textX = PAGE_MARGIN + 20;
  const textW = doc.internal.pageSize.getWidth() - PAGE_MARGIN - textX;
  const dots: Array<{ y: number; page: number; color: string }> = [];

  report.lifecycle.forEach((step) => {
    y = ensureSpace(doc, y, 40);
    const tone = outcomeTone(step.state);
    dots.push({ y: y - 3, page: doc.getCurrentPageInfo().pageNumber, color: TONE[tone].fg });

    doc.setFont(FONT.body, "bold");
    doc.setFontSize(TYPE.body);
    doc.setTextColor(INK);
    doc.text(step.label, textX, y);
    const pillW = measurePill(doc, step.state);
    drawPill(doc, step.state, doc.internal.pageSize.getWidth() - PAGE_MARGIN - pillW, y, tone);

    doc.setFont(FONT.mono, "normal");
    doc.setFontSize(TYPE.tiny);
    doc.setTextColor(FAINT);
    const modeTag = step.simulated ? "  \u00b7  simulated" : "";
    doc.text(`${step.actor}  \u00b7  ${when(step.at)}${modeTag}`, textX, y + 12, {
      maxWidth: textW - pillW - SPACE.sm,
    });
    y += 12;

    if (step.detail) {
      y = drawWrapped(doc, step.detail, textX, y + 12, textW, { size: TYPE.small, color: MUTED });
    } else {
      y += 16;
    }
    y += SPACE.sm;
  });

  // Second pass: now that every entry's true rendered height is known,
  // connect consecutive dots that landed on the same page. Lines first,
  // dots drawn after so they sit on top of the line ends.
  const currentPage = doc.getCurrentPageInfo().pageNumber;
  doc.setDrawColor(LINE);
  doc.setLineWidth(1.2);
  for (let i = 0; i < dots.length - 1; i++) {
    if (dots[i].page === dots[i + 1].page) {
      doc.setPage(dots[i].page);
      doc.line(dotX, dots[i].y + 4, dotX, dots[i + 1].y - 4);
    }
  }
  for (const d of dots) {
    doc.setPage(d.page);
    doc.setFillColor(d.color);
    doc.circle(dotX, d.y, 3.4, "F");
  }
  doc.setPage(currentPage);

  return y + SPACE.sm;
}

/** Decision log: one card per event, grouped by phase — not a dense grid. */
function drawDecisionLog(doc: jsPDF, report: AuditReportData, y: number): number {
  const visiblePhases = report.phases.filter((p) => p.entries.length > 0);
  y = sectionHeading(doc, "Decision log", y);

  if (visiblePhases.length === 0) {
    doc.setFont(FONT.body, "normal");
    doc.setFontSize(TYPE.body);
    doc.setTextColor(MUTED);
    doc.text("No decisions recorded for this payment yet.", PAGE_MARGIN, y);
    return y + SPACE.lg;
  }

  const contentW = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2;

  for (const phase of visiblePhases) {
    y = ensureSpace(doc, y, TYPE.h3 + SPACE.lg);
    doc.setFont(FONT.display, "bold");
    doc.setFontSize(TYPE.h3);
    doc.setTextColor(BARK);
    doc.text(phase.label ?? phase.stage, PAGE_MARGIN, y);
    y += SPACE.lg - 4;

    phase.entries.forEach((entry, i) => {
      y = ensureSpace(doc, y, 40);
      const tone = outcomeTone(entry.outcome);
      const pillW = measurePill(doc, entry.outcome);
      const pillX = doc.internal.pageSize.getWidth() - PAGE_MARGIN - pillW;

      doc.setFont(FONT.body, "bold");
      doc.setFontSize(TYPE.body);
      doc.setTextColor(INK);
      doc.text(entry.eventType, PAGE_MARGIN, y, { maxWidth: pillX - PAGE_MARGIN - SPACE.sm });
      drawPill(doc, entry.outcome, pillX, y, tone);
      y += 13;

      doc.setFont(FONT.mono, "normal");
      doc.setFontSize(TYPE.tiny);
      doc.setTextColor(FAINT);
      const modeTag = entry.simulated ? "  \u00b7  SIMULATED" : "";
      doc.text(`${entry.actor.type}:${short(entry.actor.id)}  \u00b7  ${when(entry.at)}${modeTag}`, PAGE_MARGIN, y);
      y += 13;

      if (entry.detail) {
        y = drawWrapped(doc, entry.detail, PAGE_MARGIN, y, contentW, { size: TYPE.small, color: MUTED });
      }

      if (entry.data !== undefined && entry.data !== null) {
        const payload = truncate(JSON.stringify(entry.data), 260);
        doc.setFont(FONT.mono, "normal");
        doc.setFontSize(TYPE.tiny);
        const lines = wrapToWidth(doc, payload, contentW - SPACE.md * 2);
        const boxH = lines.length * (TYPE.tiny + 3) + SPACE.sm * 2;
        y = ensureSpace(doc, y + SPACE.xs, boxH);
        doc.setFillColor("#efe9db");
        doc.roundedRect(PAGE_MARGIN, y, contentW, boxH, 3, 3, "F");
        doc.setFont(FONT.mono, "normal");
        doc.setFontSize(TYPE.tiny);
        doc.setTextColor(INK);
        let ly = y + SPACE.sm + TYPE.tiny;
        for (const line of lines) {
          doc.text(line, PAGE_MARGIN + SPACE.md, ly);
          ly += TYPE.tiny + 3;
        }
        y += boxH;
      }

      y += SPACE.sm;
      if (i < phase.entries.length - 1) {
        hairline(doc, y);
        y += SPACE.sm;
      }
    });

    y += SPACE.md;
  }

  return y;
}

/** Closing rule, disclaimer, and a compact attestation line. */
function drawSignatureStrip(doc: jsPDF, y: number): number {
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - PAGE_MARGIN * 2;
  y = ensureSpace(doc, y, 90);

  hairline(doc, y);
  y += SPACE.lg;

  y = drawWrapped(
    doc,
    "This report is an append-only projection of the immutable MOVA audit trail. Every decision above was emitted by a deterministic engine \u2014 the UI never invents one.",
    PAGE_MARGIN,
    y,
    contentW,
    { size: TYPE.small, color: MUTED, leading: TYPE.small + 5 },
  );
  y += SPACE.sm;

  doc.setFont(FONT.body, "bold");
  doc.setFontSize(TYPE.small);
  doc.setTextColor(INK);
  doc.text("Signed", PAGE_MARGIN, y);
  const signedW = doc.getTextWidth("Signed");
  doc.setFont(FONT.body, "normal");
  doc.setTextColor(MUTED);
  doc.text(
    "Human approval gate \u2014 plan digest bound to the authorized transaction spec.",
    PAGE_MARGIN + signedW + SPACE.sm,
    y,
  );

  return y + SPACE.md;
}

/** Page numbers on every page, added last once the final count is known. */
function drawPageFooters(doc: jsPDF): void {
  const pageCount = doc.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont(FONT.body, "normal");
    doc.setFontSize(TYPE.tiny);
    doc.setTextColor(FAINT);
    doc.text(`MOVA \u00b7 audit report \u00b7 page ${i} of ${pageCount}`, PAGE_MARGIN, pageH - 24);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Builds the document without triggering a download — reuse this if you
 *  need the raw PDF bytes (e.g. to publish the report as a Walrus blob)
 *  instead of pushing it straight to the browser's download flow. */
export function buildAuditPdf(report: AuditReportData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = drawHeader(doc, report);
  y = drawStatusBanner(doc, report, y);
  y = drawSummary(doc, report, y);
  y = drawLifecycleRail(doc, report, y);
  y = drawDecisionLog(doc, report, y);
  drawSignatureStrip(doc, y);
  drawPageFooters(doc);
  return doc;
}

/** Build + download the PDF (client-side). */
export function downloadAuditPdf(report: AuditReportData): void {
  const doc = buildAuditPdf(report);
  doc.save(`mova-audit-report-${report.record.id.slice(0, 12)}.pdf`);
}
