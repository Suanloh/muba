# MOVA — Sui Move Contracts

## Phase 1: ownership blueprint (`contracts/mova`)

`contracts/mova/sources/mova_owned.move` defines MOVA's Sui ownership model as
Sui-owned objects (see [`docs/ownership.md`](../docs/ownership.md)):

- `MovaPaymentAuthz` — wallet-scoped, human-approved payment authorization
- `OwnedPaymentRecord` — deterministic payment record (state-machine mirror)
- `MovaReceipt` — settlement receipt, minted only after `SETTLED`

Every object is transferred to the user's Sui address, making ownership central
to MOVA's architecture. This is a **Phase 1 blueprint, not yet deployed**, but
it now **compiles and unit-tests cleanly** with the installed Sui CLI
(`sui 1.78.1`, prebuilt Windows binary in `~/.mova-tools/sui`):

```bash
cd contracts/mova
sui move build   # exit 0 — module bytecode in build/mova/bytecode_modules/
sui move test    # exit 0
```

Deploying to a network (`sui client publish`) is the remaining step and needs a
`suicli` account (import the key from `.env`) plus testnet gas — see
`docs/roadmap.md` (Phase 2).

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
