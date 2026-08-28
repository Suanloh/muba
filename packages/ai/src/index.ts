/**
 * @mova/ai — MOVA AI layer (Phase 2).
 *
 * Natural-language payment parsing. Converts free text into structured,
 * schema-validated intents (proposal-only). The AI is a parser and assistant —
 * never a transaction executor, compliance authority, or final payment
 * authority. Deterministic validation lives in `@mova/core`.
 */
export * from "./extract.js";
export * from "./llm.js";
export * from "./parser.js";
export * from "./conversation.js";
export * from "./explain.js";
