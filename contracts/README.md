# MOVA — Sui Move Contracts

**Phase 0 placeholder.** The Move package lands in **Phase 2**
(see `docs/roadmap.md`).

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
