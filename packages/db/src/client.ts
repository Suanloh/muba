/**
 * Supabase client factories for MOVA.
 *
 * Two modes, matching the documented architecture:
 *   - Browser client (anon key + RLS): used ONLY for reads the user is allowed
 *     to make and for Realtime subscriptions. Never for privileged writes.
 *   - Admin client (service-role key): server-side only (Edge Functions,
 *     local scripts). Bypasses RLS — never exposed to the browser.
 *
 * Config is read from the environment (see `packages/config/src/env.ts`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.js";

export interface MovaClientConfig {
  url: string;
  anonKey?: string;
  serviceRoleKey?: string;
}

/** True when enough config exists to attempt a real Supabase connection. */
export function isSupabaseConfigured(cfg: Partial<MovaClientConfig>): boolean {
  const url = (cfg.url ?? "").trim();
  if (!url) return false;
  // A URL without any key is just a placeholder (defaults in .env.example) —
  // connecting without a key would fail anyway, so treat it as unconfigured.
  return Boolean((cfg.anonKey ?? "").trim() || (cfg.serviceRoleKey ?? "").trim());
}

/**
 * Browser / RLS-scoped client. `persistSession:false` keeps the demo
 * stateless — a real deployment would wire Supabase Auth here.
 */
export function createMovaBrowserClient(
  url: string,
  anonKey: string,
): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Server-side service-role client. Call ONLY in Edge Functions / scripts —
 * it bypasses RLS and can read/write everything.
 */
export function createMovaAdminClient(
  url: string,
  serviceRoleKey: string,
): SupabaseClient<Database> {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
