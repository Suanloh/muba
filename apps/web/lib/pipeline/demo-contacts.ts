/**
 * Demo contact book for the natural-language interface (Phase 2).
 *
 * Bare names ("Pay Alice") and @handles ("@treasury") resolve to these demo
 * Sui addresses so a natural-language payment can be validated and then run
 * through the existing demo pipeline. This is a stand-in for a real address
 * book / handle registry — the resolver is injected via `IntentParserContext`
 * so a backend can swap in a real registry later.
 */
import type { RecipientRef } from "@mova/types";

/** Build a stable 64-hex demo Sui address from a short hex prefix. */
export function demoAddress(prefix: string): string {
  return `0x${prefix.padEnd(64, "0")}`;
}

export interface DemoContact {
  name: string;
  ref: RecipientRef;
}

export const DEMO_CONTACTS: readonly DemoContact[] = [
  { name: "alice", ref: { type: "ADDRESS", value: demoAddress("a11ce"), name: "Alice" } },
  { name: "bob", ref: { type: "ADDRESS", value: demoAddress("b0b0"), name: "Bob" } },
  { name: "treasury", ref: { type: "ADDRESS", value: demoAddress("7c"), name: "Treasury" } },
  { name: "merchant", ref: { type: "ADDRESS", value: demoAddress("cafe"), name: "Merchant" } },
];

/** Resolve a bare name or @handle to a demo recipient (or null). */
export function resolveDemoRecipient(name: string): RecipientRef | null {
  const key = name.trim().toLowerCase().replace(/^@/, "");
  return DEMO_CONTACTS.find((c) => c.name === key)?.ref ?? null;
}
