"use client";
/**
 * Google OAuth → MOVA zkLogin callback landing page.
 *
 * `NEXT_PUBLIC_ZKLOGIN_REDIRECT_URI` points here
 * (default `http://localhost:3001/auth/callback`). Google returns the
 * `id_token` in the URL fragment:
 *
 *   /auth/callback#id_token=<jwt>&iss=...&aud=...&...
 *
 * The zkLogin wallet's real connect flow opens this URL in a popup and reads
 * the token straight from the fragment to complete the Sui address derivation.
 * Because of that, this page deliberately keeps the fragment INTACT — it never
 * navigates away or clears the hash, so the opener can read `id_token`.
 *
 * States handled here:
 *  - `id_token` present → "Sign-in complete". As a popup it auto-closes
 *    (the opener also closes it once the token is read); as a full page it
 *    offers a button back to MOVA.
 *  - `error=...`        → the OAuth error (e.g. access_denied) + a way home.
 *  - no fragment        → a direct visit; explain and link home.
 */
import { useEffect, useState } from "react";

type CallbackState =
  | { kind: "loading" }
  | { kind: "complete" }
  | { kind: "error"; message: string };

function readFragment(): { hasToken: boolean; error: string | null } {
  // Guard for SSR — this only runs on the client, in the effect.
  if (typeof window === "undefined") return { hasToken: false, error: null };
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const hasToken = !!params.get("id_token");
  const error = params.get("error_description") ?? params.get("error");
  return { hasToken, error };
}

export default function AuthCallbackPage() {
  const [state, setState] = useState<CallbackState>({ kind: "loading" });
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const { hasToken, error } = readFragment();

    if (hasToken) {
      setState({ kind: "complete" });
      // Popup case: the opener (window.open) is polling our href for the
      // token, so we must NOT navigate away or clear the hash. We auto-close
      // as a fallback if the opener gave up, and show a live countdown so the
      // window never lingers.
      const isPopup = !!window.opener && window.opener !== window;
      const delayMs = 4000;
      let remaining = Math.round(delayMs / 1000);
      setSecondsLeft(remaining);
      const tick = window.setInterval(() => {
        remaining -= 1;
        setSecondsLeft(remaining);
        if (remaining <= 0) window.clearInterval(tick);
      }, 1000);
      const t = window.setTimeout(() => {
        if (isPopup) {
          try {
            window.close();
          } catch {
            /* popup already closed by the opener */
          }
        } else {
          // Full-page visit with a token but no opener to consume it — return
          // to the app (the connect flow will not have completed, but the user
          // is never stranded on a dead page).
          window.location.replace("/");
        }
      }, delayMs);
      return () => {
        window.clearTimeout(t);
        window.clearInterval(tick);
      };
    }

    if (error) {
      setState({ kind: "error", message: error });
      return;
    }

    setState({
      kind: "error",
      message: "No Google sign-in response was found in this URL.",
    });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 text-ink">
      <section className="w-full max-w-md rounded-[18px] border border-hairline bg-surface p-8 text-center shadow-card">
        {state.kind === "loading" && (
          <>
            <Spinner />
            <h1 className="mt-4 font-display text-[17px] font-semibold text-ink">
              Completing Google sign-in…
            </h1>
            <p className="mt-1 text-xs text-muted">MOVA is finishing the zkLogin hand-off.</p>
          </>
        )}

        {state.kind === "complete" && (
          <>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ledger-bg text-ledger-text">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-6 w-6" aria-hidden="true">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="mt-4 font-display text-[17px] font-semibold text-ink">
              Sign-in complete
            </h1>
            <p className="mt-1 text-xs text-muted">
              Your Google identity was handed off to MOVA. This window will close automatically.
            </p>
            {secondsLeft !== null && (
              <p className="mt-2 font-mono text-[11px] text-faint">closing in {secondsLeft}s…</p>
            )}
            <a
              href="/"
              className="mt-5 inline-flex items-center justify-center rounded-[12px] border border-hairline-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Back to MOVA
            </a>
          </>
        )}

        {state.kind === "error" && (
          <>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ember-bg text-ember-text">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
                <path d="M12 8v5m0 3h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="mt-4 font-display text-[17px] font-semibold text-ink">
              Google sign-in didn&apos;t complete
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-muted">{state.message}</p>
            <a
              href="/"
              className="mt-5 inline-flex items-center justify-center rounded-[12px] border border-signal bg-signal px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Back to MOVA
            </a>
          </>
        )}
      </section>
    </main>
  );
}

function Spinner() {
  return (
    <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-hairline-strong border-t-signal" />
  );
}
