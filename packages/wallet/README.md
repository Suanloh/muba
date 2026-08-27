# @mova/wallet — Sui Ownership & Safety Boundary

Framework-agnostic core for MOVA's wallet layer (Phase 1). The React app
(`apps/web`) adapts `@mysten/dapp-kit` onto the `MovaWalletProvider` interface.

## What lives here

| Module | Responsibility |
| --- | --- |
| `types.ts` | Wallet connection state, network state, ownership model types |
| `network.ts` | Wallet chain id ↔ MOVA `Network` mapping + boundary resolution |
| `ownership.ts` | Ownership anchor, ownership proof, `PaymentAuthz`, records, receipts (deterministic) |
| `gate.ts` | `WalletExecutionGate` — the safety boundary (deterministic, fail-closed) |
| `provider.ts` | `MovaWalletProvider` abstraction implemented by adapters |
| `verify.ts` | `isValidPersonalMessageSignature`-based ownership proof verification |

## Safety boundary (non-negotiable)

The wallet layer never auto-executes arbitrary (AI-generated) transactions.
Every transaction passes through:

```
Intent → Validation → Approval → Wallet authz → Execution
```

`WalletExecutionGate.check()` is the enforcement point: an adapter may sign or
submit only when the verdict is `PASS`. Missing validation, missing human
approval, missing/expired/mismatched authz, wrong owner, or network mismatch all
fail closed.

## Tests

```bash
npm run test -w @mova/wallet
npm run typecheck -w @mova/wallet
```
