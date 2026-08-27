# Blockchain Skills

> Theme file extracted from the Reusable Skill Pack. These skills cover wallet
> connectivity, value movement on-chain, and safe interaction with deployed contracts.

## 2.1 `wallet-integration`

**Short description.** Connecting wallets (EOA, smart/contract wallets, MPC, custodial) to an application for signing and transaction submission.

**When to use.** Any feature that needs to sign or submit transactions, read balances,
connect a user wallet, or manage keys.

**Why it exists / problem solved.** Wallet interaction is a hard boundary with many
providers and key models. A clean abstraction isolates key custody and signing from business logic.

**Core concepts.** EOA vs smart wallet vs MPC vs custodial; provider/signer; account
abstraction; transaction request vs signed raw tx; key custody and secret handling;
network/chain IDs; nonce management; gas estimation.

**Architecture / pattern.**
- Define a `WalletProvider` interface (connect, sign, send, estimate) with multiple backends.
- Keep private keys out of app code; prefer environment-stored keys, KMS/HSM, or user-side signing.
- Route through a single `TransactionService` so all sends share one code path.

**Implementation guidance.**
- Use battle-tested libraries (`ethers.js`, `viem`, `web3.js`) rather than hand-rolled RLP/ABI code.
- Store only what is needed to sign; never log keys or mnemonics.
- Test with a local node (Hardhat/Anvil) before any testnet.

**Common failure modes.** Hard-coding a chain ID; mismatched provider/network; reusing
nonces; exposing keys in client bundles; signing on behalf of users without consent.

**Security/compliance considerations.** Private keys are secrets — treat them as such.
Separation of custody: prefer smart wallets with policies so value cannot move on a single stolen key.

**Example AI-agent instruction.** "Implement a `sendTransaction` service that takes a
validated transaction request, estimates gas, and submits via the configured signer. Never
log or return private keys. Reject requests whose chain ID does not match the configured network."

**Related skills.** `digital-asset-transfers`, `smart-contract-execution`, `compliance-gate`.

---

## 2.2 `digital-asset-transfers`

**Short description.** Correctly building and executing token transfers (native coin, ERC-20 stablecoins such as USDC/USDT) across networks.

**When to use.** Features that move value on-chain: payments, payouts, swaps, treasury disbursements.

**Why it exists / problem solved.** Token transfers have subtle pitfalls — decimals,
native vs ERC-20, allowance/approve, network selection, fee payment — that silently lose or lock funds when wrong.

**Core concepts.** Native currency vs ERC-20; `transfer`/`transferFrom`; decimals and
unit conversion; `approve` + allowance; token contract addresses per network; gas token vs
token being sent; transfer lifecycle (pending → confirmed → reverted); fee estimation.

**Architecture / pattern.**
- Centralize token metadata (address, decimals, symbol) per chain in one registry — never inline.
- A single `TransferService` computes amounts in smallest units and builds raw requests.
- Simulate before broadcast, then track the transaction hash through confirmation.

**Implementation guidance.**
- Always convert human amounts → smallest units using the token's decimals.
- For ERC-20, check allowance before `transferFrom`; use `approve` only to the needed amount.
- On multichain systems, make chain selection explicit and validated against a supported list.

**Common failure modes.** Wrong decimals; sending ERC-20 to a contract without approve;
sending to a contract address that cannot accept tokens; using the wrong token address on a
different network; ignoring revert reason from simulation.

**Security/compliance considerations.** Transfers are value movement — they must pass the
policy engine and approval gate. Cap amounts; whitelist supported assets and networks; log
every transfer to the audit trail.

**Example AI-agent instruction.** "Build a transfer request for `{amount, asset, recipient,
network}`. Look up decimals and token address from the registry, convert to smallest units,
and return the raw request plus a simulation result. Fail if the asset or network is not whitelisted."

**Related skills.** `wallet-integration`, `smart-contract-execution`, `policy-engine`, `audit-trail`.

---

## 2.3 `smart-contract-execution`

**Short description.** Interacting with deployed contracts safely — encoding calls, simulating, estimating gas, and handling reversions.

**When to use.** Any feature that calls a contract function (wallet execute, vault
deposit/withdraw, router swap, proxy calls).

**Why it exists / problem solved.** Contract calls are irreversible and error-prone.
Simulation and correct ABI encoding prevent most fund-losing mistakes before broadcast.

**Core concepts.** ABI encoding/decoding; `eth_call` simulation; gas estimation vs gas
limit; revert reasons; state overrides; transaction receipt and event decoding; testnet-first flow.

**Architecture / pattern.**
- Keep a typed contract interface layer (from ABI) — no stringly-typed calls.
- Always `eth_call` simulate first, inspect success/revert, then submit.
- Decode events/logs to confirm the intended effect rather than trusting a submitted tx.

**Implementation guidance.**
- Generate types from ABIs; call through the typed interface.
- Add a small gas buffer to the estimate; never hard-code gas limits.
- On revert, surface the decoded reason to the caller and abort (do not auto-retry).

**Common failure modes.** Skipping simulation; ignoring revert reasons; decoding the wrong
event; wrong function selector via string names; broadcasting a tx that already reverted locally.

**Security/compliance considerations.** A simulation is not a guarantee (state can change
before inclusion). Enforce policies before broadcast; keep a human approval step for
irreversible value movement.

**Example AI-agent instruction.** "For this contract call, simulate with `eth_call` first.
If it reverts, return the decoded reason and stop. If it succeeds, estimate gas with a 20%
buffer and submit, then return the receipt and decoded events."

**Related skills.** `wallet-integration`, `digital-asset-transfers`, `transaction-monitoring`.
