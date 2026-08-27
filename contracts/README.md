# MOVA — Sui Move Contracts

## Phase 1: ownership blueprint (`contracts/mova`)

`contracts/mova/sources/mova_owned.move` defines MOVA's Sui ownership model as
Sui-owned objects (see [`docs/ownership.md`](../docs/ownership.md)):

- `MovaPaymentAuthz` — wallet-scoped, human-approved payment authorization
- `OwnedPaymentRecord` — deterministic payment record (state-machine mirror)
- `MovaReceipt` — settlement receipt, minted only after `SETTLED`

Every object is transferred to the user's Sui address, making ownership central
to MOVA's architecture. This is a **Phase 1 blueprint, not yet deployed**.
The Sui CLI is required to compile/unit-test it (`sui move build` / `sui move
test`) — that happens in Phase 2 against the target network.

## Phase 2: smart-wallet execution package

Planned surface (per `docs/architecture.md` and the legacy security patterns in
`SMART_WALLET.md`):

- A smart-wallet-style Move package (Sui owned objects) with:
  - executor authorization (only authorized callers can move funds),
  - replay protection (nonce / fresh transaction handling on Sui),
  - safe token handling (Sui coin types + `Transfer`/`Payment`),
  - explicit, validated execution params — never LLM output.
- `SuiSettlementProvider` (`packages/integrations`) submits programmable
  transaction blocks built from `SettlementTransaction.payload` and watches for
  confirmation.

Scaffold (when Phase 2 starts):

```bash
sui move new mova_wallet
# + Move unit tests, devnet/testnet deploys
```
