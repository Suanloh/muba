/**
 * LLM-backed structured-output extractor (Phase 2, optional).
 *
 * This is the "real" AI path for the backend. It asks an LLM (Google Gemini by
 * default) to fill ONLY extraction slots and returns a schema-constrained JSON
 * object. Hard rules:
 *
 *   - The schema contains NO transaction/execution fields — the LLM can never
 *     return executable instructions (no bytes, no payload, no gas, no calls).
 *   - The LLM reports what it SAW (`amountRaw`, `currencyInput`); money is
 *     still computed deterministically by `@mova/core`.
 *   - Responses are schema-guarded and validated; on invalid JSON the call is
 *     retried once, then fails loudly.
 *   - Missing/ambiguous values become `needsClarification`, never guesses.
 *
 * When no API key is configured the caller falls back to the deterministic
 * extractor (`extract.ts`), so the web demo works with zero secrets.
 */
import {
  canonicalCurrency,
  isValidSuiAddress,
  networkFromAlias,
  normalizeDecimal,
  type IntentParserContext,
  type RecipientRef,
  type StructuredIntentProposal,
  type UserConstraint,
} from "@mova/types";
import { constraintFromRaw, extractTiming, paymentMethodFromString } from "./extract.js";

// ---------------------------------------------------------------------------
// Extraction shape the LLM is allowed to produce
// ---------------------------------------------------------------------------

export interface LlmExtraction {
  action?: "PAY" | "TRANSFER" | "BATCH_PAY" | null;
  /** Decimal amount exactly as stated — the LLM never computes smallest units. */
  amountRaw?: string | null;
  /** Currency/token as stated ("USDC", "RM", "$"). */
  currencyInput?: string | null;
  recipient?: {
    type: "ADDRESS" | "EMAIL" | "HANDLE" | "NAME";
    value: string;
    name?: string | null;
    ambiguous?: boolean;
  } | null;
  networkName?: string | null;
  purpose?: string | null;
  timingRaw?: string | null;
  constraints?: string[] | null;
  paymentMethod?: string | null;
  needsClarification?: boolean | null;
  clarificationQuestion?: string | null;
  warnings?: string[] | null;
}

/** JSON Schema sent to the model — constrains output to the fields above. */
export function buildExtractionSchema() {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["PAY", "TRANSFER", "BATCH_PAY"] },
      amountRaw: { type: "string" },
      currencyInput: { type: "string" },
      recipient: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["ADDRESS", "EMAIL", "HANDLE", "NAME"] },
          value: { type: "string" },
          name: { type: ["string", "null"] },
          ambiguous: { type: "boolean" },
        },
        required: ["type", "value"],
      },
      networkName: { type: "string" },
      purpose: { type: "string" },
      timingRaw: { type: "string" },
      constraints: { type: "array", items: { type: "string" } },
      paymentMethod: { type: "string" },
      needsClarification: { type: "boolean" },
      clarificationQuestion: { type: "string" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["action", "amountRaw", "currencyInput", "recipient", "needsClarification"],
    additionalProperties: false,
  };
}

// ---------------------------------------------------------------------------
// Deterministic guard: is a value a plausible LlmExtraction?
// ---------------------------------------------------------------------------

export function isLlmExtraction(value: unknown): value is LlmExtraction {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.action !== undefined && v.action !== null && !["PAY", "TRANSFER", "BATCH_PAY"].includes(String(v.action))) return false;
  if (v.amountRaw !== undefined && v.amountRaw !== null && typeof v.amountRaw !== "string") return false;
  if (v.currencyInput !== undefined && v.currencyInput !== null && typeof v.currencyInput !== "string") return false;
  if (v.needsClarification !== undefined && v.needsClarification !== null && typeof v.needsClarification !== "boolean") return false;
  if (v.recipient !== undefined && v.recipient !== null) {
    const r = v.recipient as Record<string, unknown>;
    if (!["ADDRESS", "EMAIL", "HANDLE", "NAME"].includes(String(r.type))) return false;
    if (typeof r.value !== "string") return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Normalize the LLM extraction into the shared proposal shape
// ---------------------------------------------------------------------------

export function llmExtractionToProposal(
  rawText: string,
  llm: LlmExtraction,
  ctx: IntentParserContext,
): StructuredIntentProposal {
  const action =
    llm.action && ["PAY", "TRANSFER", "BATCH_PAY"].includes(llm.action)
      ? (llm.action as StructuredIntentProposal["action"])
      : "PAY";

  const amountRaw = normalizeDecimal(llm.amountRaw ?? "") ?? (llm.amountRaw ? llm.amountRaw : null);
  const currencyInput = llm.currencyInput ?? "";

  let recipient: RecipientRef = { type: "ADDRESS", value: "", name: null };
  const r = llm.recipient;
  if (r) {
    if (r.type === "ADDRESS") {
      recipient = { type: "ADDRESS", value: r.value.toLowerCase(), name: r.name ?? null };
    } else if (r.type === "EMAIL") {
      recipient = { type: "EMAIL", value: r.value.toLowerCase(), name: r.name ?? null };
    } else if (r.type === "HANDLE") {
      const resolved = ctx.resolveRecipient?.(r.value.replace(/^@/, "").toLowerCase());
      recipient = resolved
        ? { ...resolved, name: r.name ?? resolved.name, resolved: true }
        : { type: "HANDLE", value: r.value.startsWith("@") ? r.value : `@${r.value}`, name: r.name ?? r.value, resolved: false };
    } else {
      const resolved = ctx.resolveRecipient?.(r.value.toLowerCase());
      recipient = resolved
        ? { ...resolved, name: r.name ?? r.value, resolved: true }
        : { type: "HANDLE", value: `@${r.value.toLowerCase()}`, name: r.value, ambiguous: true };
    }
    if (r.ambiguous) recipient = { ...recipient, ambiguous: true };
  }

  const net = llm.networkName ? networkFromAlias(llm.networkName) : null;
  const network = net && net !== "UNSUPPORTED" ? net : ctx.network;
  const networkMentioned: StructuredIntentProposal["networkMentioned"] =
    net === "UNSUPPORTED" ? "unsupported" : llm.networkName ? "supported" : "none";

  const { scheduleAt, timingLabel } = extractTiming(
    [llm.timingRaw, llm.purpose, rawText].filter(Boolean).join(" "),
    ctx.now ?? Date.now(),
  );

  const constraints: UserConstraint[] = (llm.constraints ?? [])
    .map((c) => constraintFromRaw(c))
    .filter((c): c is UserConstraint => c !== null);

  const paymentMethod = paymentMethodFromString(llm.paymentMethod);

  return {
    action,
    amountRaw,
    currencyInput,
    recipient,
    network,
    networkMentioned,
    conflicts: [],
    purpose: llm.purpose ?? null,
    scheduleAt,
    timingLabel: llm.timingRaw ?? timingLabel,
    constraints,
    paymentMethod,
    confidence: llm.needsClarification ? 0.4 : 0.95,
    needsClarification: llm.needsClarification ?? false,
    clarificationQuestion: llm.clarificationQuestion ?? null,
    warnings: llm.warnings ?? [],
    rawText: rawText.trim(),
    rawLlmOutput: llm,
  };
}

// ---------------------------------------------------------------------------
// Gemini client (injectable fetch for tests)
// ---------------------------------------------------------------------------

export interface LlmCallOptions {
  apiKey: string;
  model?: string;
  /** e.g. https://generativelanguage.googleapis.com/v1beta */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT = `You are MOVA's payment intent extractor.
Extract ONLY structured fields from the user's payment message into the JSON schema.
You are NOT a transaction executor and you must NEVER produce transaction instructions, code, bytes, or execution parameters.
Report amounts as the user typed them (e.g. "200", "100.50") and the currency symbol they used (e.g. "USDC", "RM", "$").
If any required field is missing or ambiguous, set needsClarification=true and provide one precise clarificationQuestion.
Never invent amounts, currencies, addresses, or recipients.`;

async function callGemini(
  rawText: string,
  opts: LlmCallOptions,
): Promise<unknown> {
  const model = opts.model ?? "gemini-2.0-flash";
  const endpoint = opts.endpoint ?? "https://generativelanguage.googleapis.com/v1beta";
  const url = `${endpoint}/models/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: rawText }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: buildExtractionSchema(),
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("LLM returned no content");
  return JSON.parse(text) as unknown;
}

/**
 * Parse with an LLM using structured output. Returns a normalized proposal, or
 * null when the LLM is unavailable / misconfigured (callers fall back).
 * Throws on repeated schema-invalid responses.
 */
export async function parseWithLlm(
  rawText: string,
  ctx: IntentParserContext,
  opts: LlmCallOptions,
): Promise<StructuredIntentProposal | null> {
  if (!opts.apiKey) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;

  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      last = await callGemini(rawText, { ...opts, fetchImpl });
      if (isLlmExtraction(last)) {
        return llmExtractionToProposal(rawText, last, ctx);
      }
    } catch {
      // fall through to retry / null
    }
  }
  if (last !== undefined && !isLlmExtraction(last)) {
    throw new Error("LLM returned invalid structured output after retry");
  }
  return null;
}

// Re-export so the validator's canonical-currency logic is the single source.
export { canonicalCurrency, isValidSuiAddress };
