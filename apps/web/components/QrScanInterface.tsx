"use client";
/**
 * MOVA QR payment interface (Phase 3).
 *
 * Complements the natural-language composer with a real-world payment-QR
 * input: scan an EMVCo merchant-presented QR with the device camera (decoded
 * locally with `jsQR` — no third-party QR API, no network), or paste the raw
 * payload manually. MOVA decodes it deterministically (`@mova/qr`), validates
 * it with the SAME validator the chat path uses, and shows the merchant,
 * amount, currency, parsed details and any missing/ambiguous info before the
 * user confirms. On confirmation the QR intent enters the common payment pipe
 * as an `@handle` recipient settled in the user-chosen Sui token.
 *
 * Safety: MOVA is a parser and assistant. It never executes, never approves,
 * and never bypasses compliance. A QR with a failing CRC is blocked outright.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import jsQR from "jsqr";
import type { QrValidationResult } from "@mova/qr";
import { currencyLabel } from "@mova/qr";
import type { SupportedToken } from "@mova/types";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { useAppStore } from "@/lib/store/app-store";
import { EXPECTED_NETWORK } from "@/lib/wallet/networks";
import {
  buildQrPipelineText,
  canConfirmQrIntent,
  decodeQrPayload,
  qrParserContext,
  QR_TOKEN_OPTIONS,
} from "@/lib/pipeline/qr-payment";
import { scrollToPlanReview } from "@/lib/pipeline/scroll-to-review";
import { shortAddress } from "@/lib/pipeline/format";
import { Badge, Button, Card } from "./ui";

type CameraState = "idle" | "starting" | "active" | "error" | "unsupported";
type ScanState = "idle" | "scanning" | "detected" | "error";

const SCAN_COOLDOWN_MS = 1500;

/** Map camera failures to honest, actionable messages (falls back to manual). */
function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
        return "Camera access was denied. Allow camera permission for this site and try again — or paste the QR payload below.";
      case "NotFoundError":
        return "No camera was found on this device. Paste the QR payload below instead.";
      case "NotReadableError":
        return "The camera is in use by another application. Close it and try again, or paste the QR payload below.";
      case "OverconstrainedError":
        return "No camera matches the requested constraints on this device. Paste the QR payload below instead.";
      default:
        return `Camera error (${err.name}). Paste the QR payload below instead.`;
    }
  }
  return "Could not start the camera. Paste the QR payload below instead.";
}

export function QrScanInterface() {
  const { connection } = useMovaWallet();
  const { submitIntent, resetVersion } = useAppStore();

  const connected = connection.status === "connected";
  const ownerAddress = connection.account?.address ?? null;

  const [camera, setCamera] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [result, setResult] = useState<QrValidationResult | null>(null);
  const [manualText, setManualText] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [token, setToken] = useState<SupportedToken>("USDC");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectRef = useRef(0);

  const ctx = useMemo(
    () =>
      qrParserContext({
        userId: ownerAddress ?? "anonymous",
        walletId: ownerAddress ?? "wallet",
        network: EXPECTED_NETWORK,
      }),
    [ownerAddress],
  );
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // -------------------------------------------------------------------------
  // Camera lifecycle
  // -------------------------------------------------------------------------

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera((prev) => (prev === "active" || prev === "starting" ? "idle" : prev));
  }, []);

  /** Process one decoded string: decode → validate → present (then stop). */
  const handleDecoded = useCallback(
    (payload: string) => {
      const now = Date.now();
      if (now - lastDetectRef.current < SCAN_COOLDOWN_MS) return;
      lastDetectRef.current = now;
      try {
        const v = decodeQrPayload(payload, ctxRef.current);
        setResult(v);
        setScanState(v.ok ? "detected" : "error");
      } catch (err) {
        setResult(null);
        setScanState("error");
        setSubmitError(err instanceof Error ? err.message : String(err));
      }
      stopCamera();
    },
    [stopCamera],
  );

  const handleDecodedRef = useRef(handleDecoded);
  handleDecodedRef.current = handleDecoded;

  /** rAF loop: draw the video frame and run jsQR locally on the ImageData. */
  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx2d) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (code?.data) {
            handleDecodedRef.current(code.data);
            return;
          }
        } catch {
          // Frame read failed — keep scanning on the next tick.
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setScanState("scanning");
    setCamera("starting");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCamera("unsupported");
      setCameraError(
        "Camera scanning requires a secure context (HTTPS or localhost). You can still paste a QR payload below.",
      );
      setScanState("idle");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCamera("active");
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setCamera("error");
      setCameraError(cameraErrorMessage(err));
      setScanState("idle");
    }
  }, [tick]);

  // Attach the stream once the <video> element is mounted.
  useEffect(() => {
    if (camera === "active" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [camera]);

  // Cleanup on unmount.
  useEffect(() => stopCamera, [stopCamera]);

  // -------------------------------------------------------------------------
  // Manual fallback + confirm
  // -------------------------------------------------------------------------

  const handleManualDecode = () => {
    setManualError(null);
    const payload = manualText.trim();
    if (!payload) {
      setManualError("Paste an EMVCo QR payload (or the raw scanned string) to decode it.");
      return;
    }
    try {
      const v = decodeQrPayload(payload, ctxRef.current);
      setResult(v);
      setScanState(v.ok ? "detected" : "error");
    } catch (err) {
      setManualError(err instanceof Error ? err.message : String(err));
    }
  };

  const resetScan = () => {
    setResult(null);
    setScanState("idle");
    setSubmittedId(null);
    setSubmitError(null);
    setManualError(null);
    setCameraError(null);
  };

  // "Reset demo" (store clearAll) bumps resetVersion — clear the decoded QR
  // result + any camera state so a stale scan can't be re-confirmed.
  useEffect(() => {
    resetScan();
    stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional full reset
  }, [resetVersion]);

  const handleConfirm = async () => {
    if (!result || !canConfirmQrIntent(result)) return;
    const text = buildQrPipelineText(result, token);
    if (!text) {
      setSubmitError("This QR can’t be confirmed yet — check the missing fields above.");
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const record = await submitIntent(text);
      setSubmittedId(record.id);
      // Reveal the plan review so the user can confirm the preview + approve.
      scrollToPlanReview();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canConfirm = !!result && canConfirmQrIntent(result) && connected && !busy;

  return (
    <Card
      title="Pay by QR"
      subtitle="Scan a merchant EMVCo QR — decoded locally on-device (no third-party QR API) into the same validated intent as chat."
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone="violet">Local EMVCo decode</Badge>
          <Badge tone="slate">Deterministic validation</Badge>
          <Badge tone="blue">{EXPECTED_NETWORK}</Badge>
        </div>

        {/* Camera view */}
        {(camera === "starting" || camera === "active") && (
          <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="aspect-[4/3] w-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
            {/* Scan reticle */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-40 w-40 rounded-xl border-2 border-dashed transition-colors ${
                  scanState === "detected" ? "border-emerald-400" : "border-white/70"
                }`}
              />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
              <span className="text-xs text-white/90">
                {scanState === "detected" ? "✓ Code found — decoding…" : "Point the camera at a payment QR"}
              </span>
              <button
                onClick={stopCamera}
                className="rounded bg-white/20 px-2 py-1 text-xs text-white hover:bg-white/30"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Camera error / unsupported */}
        {(camera === "error" || camera === "unsupported") && cameraError && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5">
            <p className="text-xs text-rose-700">{cameraError}</p>
            <button onClick={() => setCamera("idle")} className="text-xs text-rose-500 underline">
              OK
            </button>
          </div>
        )}

        {/* Start camera */}
        {camera === "idle" && scanState !== "detected" && (
          <div className="flex items-center gap-2">
            <Button onClick={() => void startCamera()}>Start camera</Button>
            <span className="text-xs text-slate-400">or paste a payload below</span>
          </div>
        )}

        {/* Manual fallback */}
        <div className="space-y-1.5">
          <label htmlFor="qr-manual" className="text-xs font-medium text-slate-600">
            Manual payload <span className="font-normal text-slate-400">(EMVCo string)</span>
          </label>
          <textarea
            id="qr-manual"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="0002010102112658…6304ABCD"
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={handleManualDecode}>
              Decode payload
            </Button>
            {result && (
              <Button variant="ghost" onClick={resetScan} disabled={busy}>
                Scan another
              </Button>
            )}
          </div>
          {manualError && <p className="text-xs text-rose-600">{manualError}</p>}
        </div>

        {/* Result card */}
        {result && (
          <QrResultCard
            result={result}
            token={token}
            onTokenChange={setToken}
            onConfirm={() => void handleConfirm()}
            canConfirm={canConfirm}
            connected={connected}
            busy={busy}
            submittedId={submittedId}
            submitError={submitError}
          />
        )}

        <p className="text-[11px] text-slate-400">
          MOVA decodes QR payloads locally and deterministically — it can’t execute, approve, or
          bypass compliance. QR amounts are fiat; pick a Sui token (USDC/SUI/MOV) before confirming.
          Confirm only when the details above are right.
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Scanned QR result card
// ---------------------------------------------------------------------------

function QrResultCard({
  result,
  token,
  onTokenChange,
  onConfirm,
  canConfirm,
  connected,
  busy,
  submittedId,
  submitError,
}: {
  result: QrValidationResult;
  token: SupportedToken;
  onTokenChange: (t: SupportedToken) => void;
  onConfirm: () => void;
  canConfirm: boolean;
  connected: boolean;
  busy: boolean;
  submittedId: string | null;
  submitError: string | null;
}) {
  const ok = result.ok;
  const p = result.proposal;
  const d = result.decoded;
  const currency = d.currencyCode
    ? currencyLabel(result.proposal?.currencyInput ?? d.currencyCode)
    : "not stated";

  const details: Array<{ label: string; value: string; missing?: boolean }> = [
    {
      label: "Merchant",
      value: p?.recipient.name ?? "—",
      missing: !p?.recipient.name,
    },
    {
      label: "Recipient",
      value: p?.recipient.value ?? "—",
      missing: !p?.recipient.value,
    },
    {
      label: "Amount",
      value: p?.amountRaw ? `${p.amountRaw} ${currency}` : "—",
      missing: !p?.amountRaw,
    },
    { label: "Currency", value: currency, missing: !d.currencyCode },
    { label: "City", value: d.merchantCity ?? "—" },
    { label: "Country", value: d.countryCode ?? "—" },
    { label: "Category", value: d.categoryCode ?? "—" },
    { label: "Reference", value: d.reference ?? d.billNumber ?? "—" },
    { label: "Payload", value: d.payloadFormat ? `EMVCo ${d.payloadFormat}` : "—" },
  ];

  return (
    <div
      className={`rounded-lg border p-3 ${
        ok ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-600">What MOVA decoded</p>
        <div className="flex items-center gap-1.5">
          {submittedId ? (
            <Badge tone="green">SUBMITTED</Badge>
          ) : ok ? (
            <Badge tone="green">VALIDATED</Badge>
          ) : (
            <Badge tone="red">BLOCKED</Badge>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm font-medium text-slate-800">{result.summary}</p>

      {/* QR integrity errors (fail-closed) */}
      {result.qrErrors.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-rose-700">
          {result.qrErrors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {/* Field-level errors (missing / ambiguous). QR-integrity errors are
          already shown in their own fail-closed block above — excluding them
          here prevents the CRC mismatch from being rendered twice. */}
      {!ok && result.errors.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-rose-600">
          {result.errors
            .filter((e) => !result.qrErrors.includes(e.message))
            .map((e, i) => (
              <li key={`${e.code}-${i}`}>{e.message}</li>
            ))}
        </ul>
      )}

      {/* Parsed details */}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {details.map((dRow) => (
          <div key={dRow.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-slate-500">{dRow.label}</dt>
            <dd className="max-w-[60%] truncate text-right text-slate-800">
              {dRow.value}
              {dRow.missing && <span className="ml-1 text-[10px] text-amber-600">(missing)</span>}
            </dd>
          </div>
        ))}
      </dl>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-amber-700">
          {result.warnings.map((w) => (
            <li key={w.code}>{w.message}</li>
          ))}
        </ul>
      )}

      {result.needsTokenConversion && ok && (
        <p className="mt-2 text-xs text-amber-700">
          Fiat amount — choose a Sui token (USDC/SUI/MOV) so it can be confirmed and settled.
        </p>
      )}

      {/* Confirm controls */}
      {ok && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-600">Settle as</label>
            <select
              value={token}
              onChange={(e) => onTokenChange(e.target.value as SupportedToken)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none"
            >
              {QR_TOKEN_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="ml-auto">
              <Button onClick={onConfirm} disabled={!canConfirm}>
                {busy ? "Submitting…" : submittedId ? "Submitted" : "Confirm payment"}
              </Button>
            </div>
          </div>
          {!connected && (
            <p className="text-xs text-slate-500">
              Connect a wallet to confirm — the connected address becomes the owner of the payment.
            </p>
          )}
          {submitError && <p className="text-xs text-rose-600">{submitError}</p>}
          {submittedId && (
            <p className="text-xs text-emerald-700">
              ✓ Handed to the payment pipeline as {shortAddress(submittedId, 10, 0)} — approve it in
              the “Approval &amp; execution” panel below. The AI can’t execute this; only you can.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
