"use client";
/**
 * MOVA zkLogin panel — explains and surfaces the Sui zkLogin identity.
 *
 * - When connected via the "MOVA zkLogin (Google)" wallet, it shows the
 *   derived zkLogin address, provider, proof mode (real vs demo/simulated),
 *   and the OAuth claims that produced it.
 * - When not connected, a "Preview" button derives a demo zkLogin session
 *   locally (no wallet, no network) so you can see exactly how a Sui address
 *   is derived from an OAuth identity before connecting.
 *
 * Honesty: a demo session derives a REAL zkLogin address but uses simulated
 * proof inputs — it is labelled "simulated" and can never submit a
 * chain-verifiable transaction.
 */
import { useEffect, useState } from "react";
import type { ZkLoginSession } from "@mova/wallet";
import { shortAddress } from "@/lib/pipeline/format";
import {
  getActiveZkLoginSession,
  subscribeZkLoginSession,
} from "@/lib/wallet/zklogin-wallet";
import {
  loginZkLoginDemo,
  getZkLoginModeChoice,
  setZkLoginModeChoice,
  resolveZkLoginMode,
  type ZkLoginModeChoice,
} from "@/lib/wallet/zklogin";
import { Badge, Button, Card, Code } from "../ui";

export function ZkLoginPanel() {
  const [session, setSession] = useState<ZkLoginSession | null>(() => getActiveZkLoginSession());
  const [preview, setPreview] = useState<ZkLoginSession | null>(null);
  const [mode, setMode] = useState<ZkLoginModeChoice>(() => getZkLoginModeChoice());
  const [resolved, setResolved] = useState(() => resolveZkLoginMode());

  useEffect(() => {
    const unsubscribe = subscribeZkLoginSession((s) => {
      setSession(s);
      // A fresh real connect supersedes any local preview.
      if (s) setPreview(null);
    });
    return unsubscribe;
  }, []);

  const changeMode = (m: ZkLoginModeChoice) => {
    setZkLoginModeChoice(m);
    setMode(m);
    setResolved(resolveZkLoginMode());
  };

  const active = session;
  const shown = active ?? preview;

  return (
    <Card
      title="Sui zkLogin"
      subtitle="Sign in with Google — a Sui address derived from your OAuth identity, no private key."
    >
      {/* Mode toggle — demo works offline (real address, simulated proof); real
          needs Google OAuth + a proving service that supports your client ID. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-surface-2 p-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            zkLogin mode
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
            {resolved === "demo"
              ? "Offline demo — real zkLogin address, simulated proof, no proving service needed."
              : resolved === "real"
                ? "Real Google OAuth — requires a proving service that supports your client ID."
                : "Auto — uses real when a Google client + redirect are configured, else demo."}
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-full border border-hairline bg-surface p-0.5">
          {(["auto", "demo", "real"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changeMode(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                mode === m ? "bg-signal text-white" : "text-muted hover:text-ink"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {!active && (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">
            zkLogin lets an OAuth identity (Google) own a Sui address: the wallet generates a
            single-use ephemeral key, derives the address from your verified claims, and only that
            ephemeral key can sign — no seed phrase, no extension.
          </p>
          <p className="text-xs text-muted">
            Connect via the wallet picker (“MOVA zkLogin (Google)”) or preview a derived address
            offline:
          </p>
          <Button
            variant="secondary"
            className="w-full"
            disabled={!!preview}
            onClick={() => setPreview(loginZkLoginDemo())}
          >
            {preview ? "Preview derived" : "Preview zkLogin address (demo)"}
          </Button>
        </div>
      )}

      {shown && <ZkLoginSessionView session={shown} connected={!!active} isPreview={!active} />}
    </Card>
  );
}

function ZkLoginSessionView({
  session,
  connected,
  isPreview,
}: {
  session: ZkLoginSession;
  connected: boolean;
  isPreview: boolean;
}) {
  const details: Array<{ label: string; value: string }> = [
    { label: "Address", value: shortAddress(session.address, 10) },
    { label: "Provider", value: session.providerLabel },
    { label: "Issuer", value: session.iss },
    { label: "Audience", value: session.aud },
    { label: "Account (sub)", value: shortAddress(session.sub, 8) },
    ...(session.email ? [{ label: "Email", value: session.email }] : []),
    { label: "Nonce", value: shortAddress(session.nonce, 10) },
    { label: "Proof valid until epoch", value: String(session.maxEpoch) },
  ];

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="violet">{session.simulated ? "simulated proof" : "real zk proof"}</Badge>
        {isPreview ? (
          <Badge tone="amber">preview — not connected</Badge>
        ) : (
          <Badge tone="green">connected</Badge>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {details.map((d) => (
          <div key={d.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-muted">{d.label}</dt>
            <dd className="max-w-[65%] truncate text-right text-ink">
              <Code>{d.value}</Code>
            </dd>
          </div>
        ))}
      </dl>

      <div className="rounded-lg border border-hairline bg-surface-2 p-3 text-[11px] text-muted">
        <p className="font-medium text-ink">How the address is derived</p>
        <p className="mt-1 leading-relaxed">
          address = H(H(salt ‖ “sub” ‖ {shortAddress(session.sub, 8)} ‖ aud) ‖ iss). The ephemeral
          key signs, and a zero-knowledge proof over the JWT (nonce = {shortAddress(session.nonce, 8)}
          …) proves the claims without revealing your Google secret.
        </p>
        {session.simulated && (
          <p className="mt-2 text-amber-700">
            Demo mode: the address is a <span className="font-medium">real</span> zkLogin derivation,
            but the proof inputs are simulated placeholders — this identity can’t submit an on-chain
            transaction. Connect with a configured Google client for a real proof.
          </p>
        )}
      </div>
      {connected && !session.simulated && (
        <p className="text-xs text-ledger">
          ✓ Real proof — this account is able to authorize on-chain zkLogin transactions.
        </p>
      )}
    </div>
  );
}
