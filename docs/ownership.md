# MOVA — Sui Ownership Model

> **Phase 1 deliverable.** How MOVA represents payment-related state as
> **Sui-owned objects**. Ownership is central to MOVA's architecture: Sui is a
> settlement backend, and the user's Sui address is the root of all MOVA-owned
> state. Payment *execution* itself is deliberately left for later phases; this
> phase establishes connectivity, ownership, and the safety boundary.

## 1. Ownership anchors

| Concept | Phase 1 (this phase) | Phase 2 (Sui-owned object) |
| --- | --- | --- |
| **User ownership** | Connected Sui address (`OwnershipAnchor`) + signature proof | The address itself owns objects |
| **Payment authz** | `PaymentAuthz` token in `@mova/wallet` (deterministic, wallet-scoped, nonce'd) | `MovaPaymentAuthz` object (`contracts/mova`) owned by the address |
| **Payment records** | `PaymentRecord` — deterministic state-machine record anchored to the address | `OwnedPaymentRecord` object owned by the address |
| **Txn receipts** | `PaymentReceipt` — issued only after `SETTLED` | `MovaReceipt` object owned by the address |

In Phase 1 the connected wallet address *is* the ownership anchor, and MOVA's
deterministic in-app records are visibly bound to it. Phase 2 mirrors the same
records as on-chain Sui-owned objects via user-signed programmable transaction
blocks, so users literally own their payment history, authorizations, and
receipts on-chain.

## 2. Ownership proof

A user proves they control an address with a **Sign-In-With-Sui** style
personal-message signature (`OwnershipProof`). It is:

- a real signature from the connected wallet (verified with
  `@mysten/sui/verify` `isValidPersonalMessageSignature`),
- nonce'd and time-boxed (5 min) to prevent replay,
- **non-value-moving** — it proves ownership, it never moves funds.

## 3. The safety boundary (non-negotiable)

The wallet layer must **never** automatically execute arbitrary
(AI-generated) transactions. Every transaction passes through:

```
Intent → Validation → Approval → Wallet authz → Execution
```

`WalletExecutionGate` (`packages/wallet/src/gate.ts`) is the deterministic
enforcement point. An adapter may build, sign, or submit **only** when the gate
returns `PASS`. It fails closed on:

- no connected wallet (`NOT_CONNECTED`),
- intent not deterministically validated (`NO_VALIDATED_INTENT`),
- record not in an executable state (`STATE_NOT_EXECUTABLE`),
- no human approval recorded (`NOT_APPROVED`) — **AI suggestions can never
  authorize execution**,
- missing / expired / owner-mismatched `PaymentAuthz`
  (`AUTHZ_MISSING` / `AUTHZ_EXPIRED` / `AUTHZ_OWNER_MISMATCH`),
- wallet chain ≠ MOVA expected network (`NETWORK_MISMATCH`).

`PaymentAuthz` is issued **only** from an `APPROVE` human decision
(`issuePaymentAuthz` throws otherwise), binds to exactly one payment record +
owner + nonce, and expires.

## 4. What the app demonstrates

- **Connect** a Sui wallet (Sui Wallet, etc. — or the dev-only Demo Wallet).
- **Ownership** — the connected address is the anchor; ownership proof is a
  real wallet signature over a nonce'd challenge.
- **Intent → Validation → Approval → Wallet authz → Execution** — the demo
  pipeline drives the `@mova/types` state machine; approval is required before
  any execution attempt, and the wallet gate visibly blocks a "no-approval"
  auto-execute attempt.
- **Records & receipts** — each settled payment yields a `PaymentRecord` and a
  `PaymentReceipt` bound to the owner address (simulated settlement, no fake
  digests: `txDigest = null`, `simulated = true`).

## 5. Files

| File | Role |
| --- | --- |
| `packages/wallet/src/ownership.ts` | Ownership anchor/proof, authz, records, receipts (deterministic) |
| `packages/wallet/src/gate.ts` | `WalletExecutionGate` — the safety boundary |
| `packages/wallet/src/network.ts` | Chain ↔ network mapping + boundary checks |
| `contracts/mova/sources/mova_owned.move` | Phase 2 Sui-owned objects (blueprint) |
| `apps/web` | Wallet connectivity + ownership-visible shell |
