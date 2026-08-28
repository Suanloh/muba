"use client";
/**
 * MOVA natural-language payment interface (Phase 2).
 *
 * A conversational composer: the user describes a payment, MOVA extracts it
 * into a structured intent, validates it deterministically, EXPLAINS what it
 * understood, and only then lets the user confirm. On confirmation the intent
 * is handed to the existing payment pipeline (approval → wallet authz →
 * simulated settlement).
 *
 * Safety: MOVA is a parser and assistant. It never executes, never approves,
 * and never bypasses compliance. Confirmation is an explicit human gate.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPaymentConversation,
  processTurn,
} from "@mova/ai";
import type {
  IntentExplanation,
  PaymentConversation,
  ValidatedStructuredIntent,
} from "@mova/types";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { useAppStore } from "@/lib/store/app-store";
import { EXPECTED_NETWORK } from "@/lib/wallet/networks";
import {
  buildPipelineText,
  canConfirmIntent,
  intentSummary,
  nlParserContext,
} from "@/lib/pipeline/nl-payment";
import { shortAddress } from "@/lib/pipeline/format";
import { Badge, Button, Card } from "./ui";

const EXAMPLES = [
  "Pay RM200 to this merchant.",
  "Pay Alice $200 USDC.",
  "Send RM100 to Bob.",
  "Send 50 USDC to this wallet on Sui.",
  "Pay 10 SUI to @treasury for payroll by Friday",
];

const FOLLOW_UP_CHIPS = ["make it 300", "send to Bob instead", "by Friday", "max fee 1 SUI", "cancel"];

interface Draft {
  validated: ValidatedStructuredIntent;
  explanation: IntentExplanation;
}

export function ChatPaymentInterface() {
  const { connection } = useMovaWallet();
  const { submitIntent } = useAppStore();

  const connected = connection.status === "connected";
  const ownerAddress = connection.account?.address ?? null;

  const [conversation, setConversation] = useState<PaymentConversation>(() => createPaymentConversation());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const ctx = useMemo(
    () =>
      nlParserContext({
        userId: ownerAddress ?? "anonymous",
        walletId: ownerAddress ?? "wallet",
        network: EXPECTED_NETWORK,
      }),
    [ownerAddress],
  );

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation.turns.length]);

  /** Hand the confirmed intent to the payment pipeline (never auto-executes). */
  const submitConfirmed = async (validated: ValidatedStructuredIntent) => {
    if (submittedRef.current) return;
    const text = buildPipelineText(validated);
    if (!text) {
      setError("This intent needs a settleable token amount (SUI/USDC/MOV) before it can be confirmed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const record = await submitIntent(text);
      submittedRef.current = record.id;
      setConversation((prev) =>
        appendLocalTurn(
          appendLocalTurn(prev, "mova", `Created — ${intentSummary(validated)}. Review and approve it in the flow below.`),
          "mova",
          `Record ${record.id.slice(0, 12)}… is awaiting your approval.`,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setInput("");
    setError(null);

    const { conversation: next, result } = processTurn(conversation, text, ctx);
    setConversation(next);

    if (result.meta === "none") {
      if (result.validated && result.explanation) {
        setDraft({ validated: result.validated, explanation: result.explanation });
      }
      return;
    }

    if (result.meta === "confirm") {
      if (next.confirmed && next.workingIntent && canConfirmIntent(next.workingIntent)) {
        await submitConfirmed(next.workingIntent);
      }
    }
    if (result.meta === "cancel") {
      setDraft(null);
      submittedRef.current = null;
    }
  };

  const handleConfirm = async () => {
    if (!draft || !canConfirmIntent(draft.validated)) return;
    // Route through the conversation so MOVA records the confirmation turn.
    const { conversation: next } = processTurn(conversation, "yes", ctx);
    setConversation(next);
    if (next.confirmed && next.workingIntent) {
      await submitConfirmed(next.workingIntent);
    }
  };

  const handleReset = () => {
    setConversation(createPaymentConversation());
    setDraft(null);
    setError(null);
    submittedRef.current = null;
  };

  const canConfirm = !!draft && canConfirmIntent(draft.validated) && connected && !busy;

  return (
    <Card
      title="Pay by chat"
      subtitle="Describe a payment in your own words. MOVA extracts, validates, and explains what it understood — then you confirm."
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone="violet">AI parser · proposal only</Badge>
          <Badge tone="slate">Deterministic validation</Badge>
          <Badge tone="blue">{EXPECTED_NETWORK}</Badge>
        </div>

        {/* Chat thread */}
        <div
          ref={threadRef}
          className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3"
        >
          {conversation.turns.length === 0 && (
            <p className="text-xs text-slate-500">
              Try one of the examples below — e.g. <span className="font-medium">“Pay Alice $200 USDC.”</span>
            </p>
          )}
          {conversation.turns.map((t) => (
            <div key={t.id} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                  t.role === "user"
                    ? "bg-sky-600 text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
              >
                {t.role === "mova" && <span className="mr-1 font-semibold text-violet-600">MOVA</span>}
                {t.text}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400">
                Working…
              </div>
            </div>
          )}
        </div>

        {/* Structured intent card */}
        {draft && <IntentCard draft={draft} submittedId={submittedRef.current} />}

        {!connected && (
          <p className="text-xs text-slate-500">
            Connect a wallet to confirm — the connected address becomes the owner of the payment.
          </p>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}

        {/* Input */}
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder='Try "Pay Alice $200 USDC." or "Send 50 USDC to this wallet on Sui."'
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
          />
          <Button onClick={() => void send(input)} disabled={input.trim() === "" || busy}>
            Send
          </Button>
        </div>

        {/* Examples + follow-ups */}
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setInput(ex)}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
            >
              {ex.length > 34 ? `${ex.slice(0, 34)}…` : ex}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-1.5">
            {draft &&
              FOLLOW_UP_CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => void send(c)}
                  className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700 hover:bg-violet-100"
                >
                  {c}
                </button>
              ))}
          </div>
          <div className="flex items-center gap-2">
            {draft && (
              <Button variant="ghost" onClick={handleReset} disabled={busy}>
                Clear
              </Button>
            )}
            <Button onClick={() => void handleConfirm()} disabled={!canConfirm}>
              {busy ? "Submitting…" : submittedRef.current ? "Submitted" : "Confirm payment"}
            </Button>
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          MOVA is a payment assistant — it can’t execute, approve, or bypass compliance. Confirm only
          when you’re sure the interpretation above is right.
        </p>
      </div>
    </Card>
  );
}

function appendLocalTurn(
  conv: PaymentConversation,
  role: "user" | "mova",
  text: string,
): PaymentConversation {
  return {
    ...conv,
    turns: [...conv.turns, { id: crypto.randomUUID(), role, text, at: Date.now() }],
  };
}

// ---------------------------------------------------------------------------
// Structured intent card
// ---------------------------------------------------------------------------

function IntentCard({ draft, submittedId }: { draft: Draft; submittedId: string | null }) {
  const { validated, explanation } = draft;
  const ok = validated.ok;
  const needsConversion = validated.ok && validated.canonicalAmount === null;
  const ambiguousRecipient = validated.proposal?.recipient?.ambiguous === true;
  const fiatAmount = validated.canonicalAmount === null && validated.proposal?.amountRaw != null;

  return (
    <div
      className={`rounded-lg border p-3 ${
        ok ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-600">What MOVA understood</p>
        <div className="flex items-center gap-1.5">
          {submittedId ? (
            <Badge tone="green">SUBMITTED</Badge>
          ) : ok ? (
            <Badge tone="green">READY TO CONFIRM</Badge>
          ) : (
            <Badge tone="amber">NEEDS DETAIL</Badge>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm font-medium text-slate-800">{explanation.summary}</p>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {explanation.details.map((d) => (
          <div key={d.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-slate-500">{d.label}</dt>
            <dd className="text-right text-slate-800">
              {d.value}
              {d.source === "inferred" && (
                <span className="ml-1 text-[10px] text-sky-600">(from context)</span>
              )}
              {d.source === "missing" && <span className="ml-1 text-[10px] text-amber-600">(missing)</span>}
            </dd>
          </div>
        ))}
      </dl>

      {explanation.notes.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-amber-700">
          {explanation.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {!ok && validated.errors.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-rose-600">
          {validated.errors.map((e) => (
            <li key={e.code}>{e.message}</li>
          ))}
        </ul>
      )}

      {ambiguousRecipient && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          <span className="font-semibold">Merchant not resolved.</span> Scan the merchant’s QR below to
          confirm the exact recipient {fiatAmount ? "and settle the fiat amount in a Sui token (USDC/SUI/MOV)" : "in a Sui token"}.
        </p>
      )}
      {needsConversion && (
        <p className="mt-2 text-xs text-amber-700">
          Fiat amount — settle it in a Sui token (USDC/SUI/MOV) via the QR scanner below, or type the
          token amount instead (e.g. “Pay 200 USDC”).
        </p>
      )}

      {validated.proposal && (
        <p className="mt-2 truncate text-[11px] text-slate-400">
          To: {validated.proposal.recipient.value}
        </p>
      )}

      {submittedId && (
        <p className="mt-2 text-xs text-emerald-700">
          ✓ Handed to the payment pipeline as {shortAddress(submittedId, 10, 0)} — approve it in the
          “Approval &amp; execution” panel below. The AI can’t execute this; only you can.
        </p>
      )}
    </div>
  );
}
