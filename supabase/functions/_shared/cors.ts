/** Shared CORS + JSON helpers for MOVA Edge Functions. */

export const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...extraHeaders },
  });
}

export function ok(payload: unknown, written = 0): Response {
  return json({ ok: true, ...(payload as object), written });
}
