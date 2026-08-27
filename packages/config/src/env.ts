/**
 * MOVA environment configuration.
 *
 * Single source of truth for every environment variable. Mirror of `.env.example`.
 * `parseEnv()` validates with Zod and FAILS FAST on invalid values. Secrets are
 * never logged (see `@mova/logger` redaction).
 */
import { z } from "zod";

export const movaEnvSchema = z.object({
  // Runtime boundary
  MOVA_ENV: z.enum(["dev", "testnet", "mainnet"]).default("dev"),

  // Supabase (backend: Postgres + Auth + Realtime + Edge Functions)
  SUPABASE_URL: z.string().default("http://127.0.0.1:54321"),
  SUPABASE_ANON_KEY: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_JWT_SECRET: z.string().default(""),
  NEXT_PUBLIC_SUPABASE_URL: z.string().default("http://127.0.0.1:54321"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().default(""),
  // Direct Postgres connection (migrations / local tooling only)
  DATABASE_URL: z
    .string()
    .default("postgres://postgres:postgres@localhost:54322/mova"),

  // Logging
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),
  LOG_REDACT_FIELDS: z
    .string()
    .default("password,secret,apiKey,geminiApiKey,mnemonic,privateKey"),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(1095),

  // AI layer — Google Gemini (proposals ONLY)
  AI_PROVIDER: z.enum(["gemini", "openai", "anthropic", "mock"]).default("gemini"),
  GEMINI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("gemini-2.0-flash"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  AI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(1),
  AI_MAX_TOOL_CALLS: z.coerce.number().int().positive().default(8),

  // Blockchain — Sui (production target: mainnet)
  SUI_NETWORK: z.enum(["devnet", "testnet", "mainnet"]).default("devnet"),
  SUI_RPC_URL: z.string().default("http://127.0.0.1:9000"),
  SUI_FAUCET_URL: z.string().default("http://127.0.0.1:9123/gas"),
  SUI_PRIVATE_KEY: z.string().default(""),
  SUI_MNEMONIC: z.string().default(""),
  MOVA_PACKAGE_ID: z.string().default(""),
  MOVA_SMART_WALLET_ADDRESS: z.string().default(""),

  // Settlement mode
  SETTLEMENT_MODE: z.enum(["simulated", "real"]).default("simulated"),

  // Sponsor integrations
  USE_MOCKS: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("true"),
  MARKET_DATA_PROVIDER: z.string().default("mock"),
  THETANUTS_VERSION: z.enum(["v4"]).default("v4"),
  THETANUTS_OPTIONBOOK_ADDRESS: z.string().default(""),
  THETANUTS_NETWORK: z.string().default("mainnet"),
  THETANUTS_API_URL: z.string().default(""),
  THETANUTS_API_KEY: z.string().default(""),
  SANCTIONS_LIST_PATH: z.string().default("./data/simulated-sanctions.json"),

  // QR — local EMVCo decoder
  QR_STRICT_CRC: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("true"),

  // Deterministic policy defaults
  MANUAL_APPROVAL_THRESHOLD: z.coerce.number().int().nonnegative().default(25000),
  MAX_DAILY_TXN: z.coerce.number().int().nonnegative().default(100000),
});

export type MovaEnv = z.infer<typeof movaEnvSchema>;

/** Validate raw env (defaults to process.env). Throws ZodError on invalid. */
export function parseEnv(
  source: Record<string, string | undefined> = process.env,
): MovaEnv {
  return movaEnvSchema.parse(source);
}
