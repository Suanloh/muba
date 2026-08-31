/**
 * MOVA data layer — Supabase (Postgres + Realtime) with honest offline mode.
 *
 * Wire a real backend in two steps:
 *   1. Apply `supabase/migrations/*.sql` to a Supabase project (or `supabase db push`).
 *   2. Deploy the `mova-sync` Edge Function (`supabase/functions/mova-sync`).
 *   3. Point the app at it: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 *
 * Until then everything runs in-memory and every sync reports `offline: true`
 * — the demo never fakes persistence.
 */
export * from "./database.js";
export * from "./types.js";
export * from "./client.js";
export * from "./edge.js";
export * from "./realtime.js";
export * from "./offline.js";
export * from "./mova-db.js";
