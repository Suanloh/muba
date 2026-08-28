/**
 * MOVA NL intent parser (Phase 2).
 *
 * Implements the `IntentParser` contract (`@mova/core`): raw text → structured
 * proposal. Two backends:
 *
 *   1. Deterministic extractor (`extract.ts`) — always available, no secrets.
 *   2. LLM structured output (`llm.ts`) — used when configured (backend only),
 *      schema-constrained, retry-on-invalid, falls back to deterministic.
 *
 * The output is a PROPOSAL. It is validated by `@mova/core` and confirmed by a
 * human before it reaches the payment pipeline. This module never executes,
 * never approves, and never emits transaction instructions.
 */
import type { IntentParserContext, StructuredIntentProposal } from "@mova/types";
import { extractStructuredProposal } from "./extract.js";
import { parseWithLlm, type LlmCallOptions } from "./llm.js";

export interface NlParserOptions {
  /** Optional LLM backend (server-side). Deterministic is used otherwise. */
  llm?: Omit<LlmCallOptions, "apiKey"> & { apiKey: string };
}

export class NlIntentParser {
  constructor(private readonly opts: NlParserOptions = {}) {}

  /** Parse raw text into a structured proposal (suggestion only). */
  async parse(
    rawText: string,
    ctx: IntentParserContext,
  ): Promise<StructuredIntentProposal> {
    if (this.opts.llm) {
      const llmProposal = await parseWithLlm(rawText, ctx, this.opts.llm);
      if (llmProposal) return llmProposal;
    }
    return extractStructuredProposal(rawText, ctx);
  }
}
