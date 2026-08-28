/**
 * Cryptographic verification for MOVA ownership proofs.
 *
 * Uses @mysten/sui's `isValidPersonalMessageSignature` — a real on-chain
 * verifiable signature from the connected wallet. This is how MOVA proves an
 * address controls a key without moving value.
 */
import { isValidPersonalMessageSignature } from "@mysten/sui/verify";
import type { OwnershipProof } from "./types.js";

/**
 * Verify that `proof.signature` is a valid signature over `proof.message`
 * produced by `proof.address`. Returns false (never throws) for invalid input;
 * environmental failures surface as thrown errors for the caller to handle.
 */
export async function verifyOwnershipProofSignature(
  proof: OwnershipProof,
): Promise<boolean> {
  if (!proof.message || !proof.signature) return false;
  const bytes = new TextEncoder().encode(proof.message);
  return isValidPersonalMessageSignature(bytes, proof.signature, {
    address: proof.address,
  });
}
