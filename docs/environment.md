# MOVA — Environment Variables & Runtime Boundaries

> **Phase 0 deliverable.** The canonical list is `.env.example`; the Zod schema
> is `packages/config/src/env.ts`; the network boundary matrix is
> `packages/config/src/networks.ts`. This document explains each variable and
> the dev/testnet/mainnet contract.

## Runtime boundary: `MOVA_ENV`

`MOVA_ENV` selects one of three boundaries. The boundary pins the Sui network,
mock policy, and settlement mode, and is **enforced fail-closed at boot** by
`checkBoundary()`:

| | `dev` | `testnet` | `mainnet` |
| --- | --- | --- | --- |
| Sui network | devnet | testnet | **mainnet (production target)** |
| Faucet | yes | no | no |
| Mocks allowed | yes | yes | **no (refused)** |
| Settlement mode | simulated or real | simulated or real | **real only (forced)** |
| Funds | test/free | test tokens | **real** |
| Fail-closed on mock/config mismatch | boot error | boot error | **boot error (mandatory)** |

> Production target: **Sui Mainnet** settlement with **Thetanuts V4 / Optionbook**.
> `dev` and `testnet` are development / staging boundaries with test funds.

Examples of boot-time violations that **prevent startup**:

- `MOVA_ENV=mainnet` + `USE_MOCKS=true`
- `MOVA_ENV=mainnet` + `SETTLEMENT_MODE=simulated`
- `MOVA_ENV=testnet` + `SUI_NETWORK=devnet`

## Environment variables

### Supabase (backend)

| Var | Default | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | `http://127.0.0.1:54321` | Supabase project URL |
| `SUPABASE_ANON_KEY` | — | Public client key (RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only (Edge Functions) — **secret** |
| `SUPABASE_JWT_SECRET` | — | Verify Supabase JWTs in Edge Functions — **secret** |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | Client-facing values for `apps/web` |
| `DATABASE_URL` | local | Direct Postgres (migrations / tooling only) |

### Logging

| Var | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `fatal/error/warn/info/debug/trace` |
| `LOG_FORMAT` | `json` | `json` or `pretty` |
| `LOG_REDACT_FIELDS` | `password,secret,apiKey,mnemonic,privateKey` | Fields always redacted |

### Database

| Var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | (required) | Postgres connection |
| `AUDIT_RETENTION_DAYS` | `1095` | Audit housekeeping window |

### AI layer — Google Gemini (proposals only)

| Var | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `gemini` | LLM provider (gemini default) |
| `GEMINI_API_KEY` | — | Gemini API key (**secret**) |
| `AI_MODEL` | `gemini-2.0-flash` | Model id |
| `AI_TIMEOUT_MS` | `15000` | LLM call timeout |
| `AI_MAX_RETRIES` | `1` | Retries for structured output |
| `AI_MAX_TOOL_CALLS` | `8` | Hard cap per workflow |

### Blockchain — Sui

| Var | Default | Purpose |
| --- | --- | --- |
| `SUI_NETWORK` | `devnet` | `devnet/testnet/mainnet` — must match `MOVA_ENV` |
| `SUI_RPC_URL` | `http://127.0.0.1:9000` | Local/fullnode RPC |
| `SUI_FAUCET_URL` | local | devnet faucet |
| `SUI_PRIVATE_KEY` / `SUI_MNEMONIC` | — | Server-side signer (**secret**, never logged) |
| `MOVA_PACKAGE_ID` | `0x2baa7a78…a55c2` | Deployed Move package — **published on testnet** (see `contracts/mova/Published.toml`, verify with `npx tsx scripts/verify-publish.ts`) |
| `MOVA_SMART_WALLET_ADDRESS` | `0x72e285da…9efe35` | Package `UpgradeCap` object id (MOVA ownership anchors at the user's Sui address) |

### Settlement

| Var | Default | Purpose |
| --- | --- | --- |
| `SETTLEMENT_MODE` | `simulated` | `simulated` → mock (no digest, flagged); `real` → Sui submission |

### Sponsor integrations

| Var | Default | Purpose |
| --- | --- | --- |
| `USE_MOCKS` | `true` | Master switch for deterministic mocks |
| `MARKET_DATA_PROVIDER` | `mock` | Quote source |
| `THETANUTS_VERSION` | `v4` | Thetanuts protocol version |
| `THETANUTS_OPTIONBOOK_ADDRESS` | — | V4 Optionbook contract address |
| `THETANUTS_NETWORK` | `mainnet` | Thetanuts deployment network |
| `THETANUTS_API_URL` / `THETANUTS_API_KEY` | — | Quote/aux endpoint + key (**secret**) |
| `SANCTIONS_LIST_PATH` | `./data/simulated-sanctions.json` | Simulated watchlist data |

### QR — local EMVCo decoder

| Var | Default | Purpose |
| --- | --- | --- |
| `QR_STRICT_CRC` | `true` | Reject payloads with a bad CRC (fail-closed on tampered QR) |

### Auth — Supabase

| Var | Default | Purpose |
| --- | --- | --- |
| `SUPABASE_JWT_SECRET` | — | Verify Supabase JWTs (**secret**) |
| Roles (app_metadata) | — | `OWNER / APPROVER / OPERATOR / AUDITOR` enforced by RLS |

### Deterministic policy defaults

| Var | Default | Purpose |
| --- | --- | --- |
| `MANUAL_APPROVAL_THRESHOLD` | `25000` | Above this → mandatory `REVIEW`/manual approval |
| `MAX_DAILY_TXN` | `100000` | Daily operating-wallet cap |

## Secret handling rules

- Real secrets live in a secrets manager / local `.env` — **never committed**,
  **never logged** (redaction list above), **never returned** by an API.
- `SUI_PRIVATE_KEY`, `SUI_MNEMONIC`, `GEMINI_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `THETANUTS_API_KEY` are
  secrets.
- The logger redacts by field name; the SDK signer code must not print key
  material at any level.

## Config code

- `parseEnv()` — Zod validation of raw env (throws on invalid, fail fast).
- `checkBoundary(env, { settlementMode, useMocks, suiNetwork })` — returns
  violations; the bootstrap throws if any exist.
