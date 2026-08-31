/**
 * Web singleton for the MOVA data layer.
 *
 * Builds the `MovaDb` facade from the browser-facing env vars:
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * When either is missing the facade is `offline` and every sync reports
 * `{ ok: false, offline: true }` — the app keeps working in-memory and the
 * Settings "Data layer" panel shows the honest state. Writes always go through
 * the `mova-sync` Edge Function (service-role key stays server-side).
 */
import { createMovaDb } from "@mova/db";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

export const movaDb = createMovaDb({
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  functionName: "mova-sync",
});

export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
