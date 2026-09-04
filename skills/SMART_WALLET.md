# Phase 9 — PayMaster Smart Wallet Execution Layer

A simplified **smart wallet** used by PayMaster for **controlled payment execution**.
This is a hackathon MVP: rather than a full ERC-4337 account-abstraction stack,
it demonstrates the security primitives a production stack would build on
(authz, replay protection, reentrancy guard, input validation, safe ERC-20
handling) inside a single auditable contract.

> **Trust boundary — the contract NEVER trusts an LLM.** It only executes
> *explicit, already-validated* transaction parameters supplied by an
> authorized caller. The AI parses intent, the deterministic engines build the
> plan, the human approves — and only then does the contract execute.

## Files

| File | Purpose |
| --- | --- |
| `contracts/contracts/SmartWallet.sol` | The wallet contract |
| `contracts/contracts/mocks/MockERC20.sol` | Mintable USDC-like mock token |
| `contracts/contracts/mocks/ReentrancyAttacker.sol` | Malicious contract used to prove the reentrancy guard works |
| `contracts/test/SmartWallet.test.ts` | 23 unit tests |
| `contracts/scripts/deploySmartWallet.ts` | Deploy wallet + mock token + fund wallet |
| `contracts/scripts/exportAbi.ts` | Export clean ABIs to `contracts/abis/` |
| `contracts/deployments/localhost.json` | Deployment addresses (written by deploy script) |
| `contracts/abis/*.json` | Exported ABIs for the frontend |

## Interface

### Execution

```solidity
// Execute ONE explicit, validated transaction. data == "" + value > 0 => native transfer.
function executeTransaction(address target, uint256 value, bytes calldata data, uint256 _nonce)
    external returns (bool);

// Execute a batch atomically (all-or-nothing). Reverts the ENTIRE batch on any failure.
function batchExecute(Transaction[] calldata txs, uint256 _nonce)
    external returns (bool);

struct Transaction {
    address target;
    uint256 value;
    bytes data;
}
```

### Tokens

```solidity
function approveToken(address token, address spender, uint256 amount, uint256 _nonce) external returns (bool);
function transferToken(address token, address to, uint256 amount, uint256 _nonce) external returns (bool);
```

### Admin

```solidity
function setExecutorAuthorization(address executor, bool status) external; // owner only
function transferOwnership(address newOwner) external;                        // two-step
function acceptOwnership() external;
function getBalance() external view returns (uint256);
function getTokenBalance(address token) external view returns (uint256);
```

### Events

| Event | Meaning |
| --- | --- |
| `TransactionExecuted(target, value, data, nonce)` | Single transaction executed |
| `BatchExecuted(batchId, transactionCount, nonce)` | Batch executed atomically (`batchId = keccak256(abi.encode(txs))`) |
| `TokenApproval(token, spender, amount, caller)` | Allowance set |
| `TokenTransfer(token, to, amount, caller)` | Token moved out of wallet |
| `NativeTransfer(to, value, nonce)` | Native currency moved out of wallet |
| `ExecutorAuthorized(executor, status)` | Executor authorized/deauthorized |
| `OwnershipTransferStarted / OwnershipTransferred` | Two-step ownership handoff |

## Security properties

1. **Owner authz** — every mutative entry point is gated by `onlyAuthorized()`
   (`msg.sender == owner || authorizedExecutors[msg.sender]`). Nothing executes
   without an authorized caller.
2. **Replay protection** — an incrementing `nonce` is consumed by every
   mutative call. Callers must pass the **current** nonce
   (`InvalidNonce(expected, provided)` otherwise). A captured/stale payload can
   never be re-executed. On revert the nonce is **not** consumed (state rolls
   back), so the nonce always matches "number of successful executions".
3. **Reentrancy guard** — `nonReentrant()` on every mutative entry point; the
   `ReentrancyAttacker` test proves a malicious authorized caller cannot drain
   the wallet mid-call.
4. **Input validation** — zero addresses / zero amounts / empty batches revert
   before any side effect.
5. **Safe ERC-20 handling** — `_callOptionalReturn` tolerates non-conforming
   tokens (USDT-style, no return value) and treats non-`true` returns as
   failure, so a token cannot silently swallow a failed call.
6. **Revert bubbling** — inner call failures are decoded and bubbled up
   (`CallFailed(reason)` / `TransferFailed(reason)`), keeping failures atomic
   and auditable.

## Deploy & test

```bash
# compile
npm --prefix contracts run compile

# unit tests (23 passing)
npm --prefix contracts run test
# or just the wallet suite:
npm --prefix contracts run test:wallet

# local node + deploy
npm --prefix contracts run node          # terminal 1: persistent hardhat node (chainId 31337)
npm --prefix contracts run deploy:wallet:local   # terminal 2: deploys to localhost

# standalone (in-process hardhat, no node needed)
npm --prefix contracts run deploy:wallet:standalone

# optional: authorize an executor (e.g. IntentRouter address) at deploy time
$env:SMART_WALLET_EXECUTOR="0x..."  # PowerShell
npm --prefix contracts run deploy:wallet:local

# export ABIs for the frontend
npm --prefix contracts run abi:export
```

The deploy script:
- deploys `SmartWallet` (deployer = owner),
- deploys `MockERC20` (mUSDC, 6 decimals),
- optionally authorizes `SMART_WALLET_EXECUTOR` (set env var),
- funds the wallet (10 ETH + 10,000 mUSDC),
- writes `contracts/deployments/localhost.json`.

## Frontend / backend integration

1. **Get addresses & ABI**
   ```ts
   import { smartWallet } from "../../contracts/deployments/localhost.json"; // or read at build time
   import SmartWalletAbi from "../../contracts/abis/SmartWallet.json";
   ```
2. **Fund the wallet** (send native + mint/transfer mUSDC to `smartWallet`).
3. **Build the explicit params** — the backend serializes a validated plan into
   concrete calls. For a native payment:
   ```ts
   const nonce = await walletContract.nonce();
   await walletContract.connect(signer).executeTransaction(recipient, amountWei, "0x", nonce);
   ```
   For an ERC-20 payment:
   ```ts
   const nonce = await walletContract.nonce();
   await walletContract.connect(signer).transferToken(mUSDC, recipient, amountUnits, nonce);
   ```
4. **Listen for settlement** on `TransactionExecuted` / `TokenTransfer` /
   `BatchExecuted` to mark a plan `COMPLETED`.
5. **Executor model** — the `IntentRouter` (Phase 1 contract) can be authorized
   as an executor: `setExecutorAuthorization(routerAddress, true)`. Then the
   router (which itself only acts on validated intents) can trigger wallet
   execution. Keep the wallet owner as the human signer; never hand the LLM a
   signing key.

### Nonce management (important)

Always read `wallet.nonce()` immediately before building a transaction, and
pass that exact value. Because the nonce increments on every successful
execution, two different payments must use two different nonce values. This is
what makes replay impossible.

## Design notes & limitations (MVP)

- **Not full ERC-4337.** There is no EntryPoint, no UserOp, no signature
  verification inside the contract. In a production build, the owner/executor
  gate would be replaced by ERC-4337 signature verification + a bundler.
- `approveToken` uses set-allowance semantics. For tokens that require it
  (USDT), approve `0` before re-approving a non-zero value.
- `MockERC20.mint` is unrestricted (test helper only) — never ship that to
  production.
- The contract is zero-dependency (no OpenZeppelin import) to keep the MVP
  hermetic; a production build should swap `_callOptionalReturn` for
  OpenZeppelin `SafeERC20` and `nonReentrant` for `ReentrancyGuard`.
