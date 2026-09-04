---
name: mova-backend-integration
description: Wire MOVA's real, already-built backend into the existing mova-prototype.html UI. Always consult this before touching mova-prototype.html, before writing any integration code for it, and before assuming any data shape it currently uses — the backend is authoritative and must not be changed to fit the UI; the UI adapts to the backend, using the visual system it already has.
---

# MOVA Backend Integration

## Mission

`mova-prototype.html` is a fully-built, single-file UI — real CSS, real animation, a real client-side state machine — currently driven by mock functions standing in for backend calls. Your job is to make it a true reflection of the backend you already have, not the other way around.

Two things are fixed here, in two different directions:

- **The backend's data, states, and logic are fixed and authoritative.** Nothing about how it works changes for this integration — not a field name, not an enum value, not a validation rule — even if it doesn't match what the mock currently assumes. When the mock and the real backend disagree, the mock is wrong.
- **The UI's visual system is fixed too, but the other way around.** Colors, type, spacing, motion, and the existing component patterns (badges, cards, rows, log lines) stay exactly as built. They're a rendering toolkit, not a data spec — reuse them to display whatever the backend actually returns.

## Backend first, always

Before writing any integration code, go read the backend's actual code, actual API responses, actual database schema, actual state and status names. Whatever it actually has is correct, even where it disagrees with something described later in this document.

**Do not, under any circumstance:**
- Add a field, endpoint, or parameter to the backend because the UI would find it convenient.
- Rename a backend enum, state, or status to match the mock's vocabulary (`PASS`/`REVIEW`/`BLOCK`, `CREATED`/`PARSED`/etc.).
- Change backend validation, scoring, or business logic to produce a tidier number for the UI to display.
- Add a compliance rule, a pipeline stage, or a route field to the backend just because the mock happens to demonstrate one.
- "Fix" a backend response you think looks wrong. If it looks wrong, ask — don't patch it from the frontend integration task.

**Do instead:** adapt the frontend's data-mapping and rendering code to correctly represent whatever the backend already does. Four pipeline stages instead of six? The rail shows four rows. Compliance returns `APPROVED`/`MANUAL_REVIEW`/`DENIED` instead of `PASS`/`REVIEW`/`BLOCK`? Map those three onto the existing ledger/ember/alarm badge colors by meaning, not by string-matching a name that will never arrive. See "When the shapes don't match" below for the common cases, worked through.

Everything further down that looks like a data shape (`intent`, a route, a compliance rule) describes what the *mock* currently fabricates. Read it as a map of what needs replacing and roughly what it's for — not as a spec the backend needs to satisfy.

## Product-safety non-negotiables

Independent of shape, these behaviors came from MOVA's own product spec and must survive integration:

- **AI parses, it never decides.** Natural-language parsing may call an LLM. Route scoring, compliance verdicts, and risk numbers must come from your real, deterministic backend logic — never re-derive or "sanity-check" them with an LLM call, and never let the client fabricate a result if the backend is slow or errors. A hard compliance denial is a hard stop; nothing after it should render or execute.
- **Nothing signs without the human.** The Approve/Reject gate is the only point that may trigger wallet signing, however confident an upstream result was.
- **Don't claim live data you can't confirm is live.** The Thetanuts panel currently carries a hardcoded "cached demo data" tag. If your real integration exposes a live/cached or confidence signal, drive the tag from that; if it doesn't expose any such signal, don't fabricate one either way — just don't leave a hardcoded claim standing once it's no longer true.
- **Idempotency stays.** The approve/reject buttons disable themselves the instant they're clicked, before any async work starts. That's frontend behavior independent of backend shape — keep it regardless of what you change around it.

## How the file is built

Single HTML file: all CSS in one `<style>` block in the head (both themes via `data-theme="dark"|"light"` on `<html>`), one `<script>` IIFE at the end of `<body>`, plain JS, no framework, no build step. Everything the UI can render already exists in the file you're editing — there's no external stylesheet or component library involved.

The mock's pipeline currently visualizes this state machine: `CREATED → PARSED → ROUTE_FOUND → COMPLIANCE_CHECKED → RISK_ASSESSED → AWAITING_APPROVAL → APPROVED → EXECUTING → SETTLED / FAILED`. That's what the *mock* shows, not a requirement — if the real backend's pipeline has different stages, different names, or a different number of steps, change the rail to match it (see below). What has to carry over regardless of stage count: it runs on its own once started, it only pauses itself for a genuine blocking problem, and it stops for a human exactly once, right before anything irreversible.

## Design tokens (unaffected by any of the above — these don't change)

CSS custom properties already defined in `:root`, `:root[data-theme="dark"]`, `:root[data-theme="light"]`. Reference with `var(--name)`; never hardcode a hex value in new code, and never introduce a new one.

| Token | Dark | Light | Meaning |
|---|---|---|---|
| `--bg` / `--surface` / `--surface-2` | `#15110E` / `#1F1A16` / `#262019` | `#F6F1E8` / `#FFFDF8` / `#FBF6EC` | page / card / raised card |
| `--text` / `--text-muted` / `--text-faint` | `#F4EFE7` / `#AFA79B` / `#7A7266` | `#1C1712` / `#6B6459` / `#9A9285` | primary / secondary / tertiary text |
| `--border` / `--border-strong` | `rgba(246,241,232,.10)` / `.18` | `rgba(21,17,14,.10)` / `.18` | hairlines |
| `--signal` (+ `-text`/`-bg`/`-border`) | `#6C7BFF` | `#4B4FD1` | **in progress** — actively working |
| `--ledger` (+ variants) | `#1FAE7A` | `#127A54` | **confirmed / passed / settled** |
| `--ember` (+ variants) | `#E8A23D` | `#9C6512` | **needs your attention** |
| `--alarm` (+ variants) | `#E14B3D` | `#C23A2D` | **blocked / rejected / failed** |
| `--chain-sui/-eth/-sol/-poly/-arb/-base` | pastel set, see file | deep set, see file | per-chain identity dot |

The color mapping is semantic, not decorative. Whatever vocabulary the real backend uses for its outcomes, map each one onto whichever of these four means the same thing — don't reuse `--alarm` for anything short of a hard failure, and don't invent a fifth status color.

Type: `--font-display` (Fraunces — headings and the one emphasis line only), `--font-body` (IBM Plex Sans — everything else), `--font-mono` (IBM Plex Mono — every number, address, hash, timestamp, state name). Radius `--r-sm/md/lg/full` = `8/12/18/999px`. Spacing `--sp-1…--sp-16` = `4/8/12/16/20/24/32/40/48/64px`. Two easing curves total: `--ease`, `--ease-out`.

## Reuse these render patterns — they don't care what data feeds them

A `badge` doesn't know or care whether you're showing `PASS` or `APPROVED`. A `.rail-row` doesn't care if there are four of them or six. These are rendering mechanics, decoupled from the mock's specific vocabulary — that's exactly why they survive a backend with different names, states, or field counts.

**Status badge:**
```html
<span class="badge ledger-badge">PASS</span>   <!-- ledger-badge | ember-badge | alarm-badge | signal-badge -->
```

**A rule/check row** (see `renderCompliance` for the live generator):
```html
<div class="rule-row">
  <span class="rule-name">Transaction limit <span class="mono chip-tag">BNM</span><span class="rule-note">Within standard limits.</span></span>
  <span class="badge ledger-badge">PASS</span>
</div>
```

**A selectable option card** (see `renderRoutes`) — a real `<button type="button">` with a click handler, never a `<div>`:
```html
<button type="button" class="route-card selected">
  <div class="route-top"><span class="route-name"><span class="chain-dot" style="background:var(--chain-eth)"></span>Ethereum · bridged via Wormhole</span>
  <span class="badge ledger-badge">Best value</span></div>
  <!-- metric rows via the existing routeMetric() helper -->
</button>
```

**A key/value summary row:**
```html
<div class="summary-row"><span>Label</span><span class="mono">Value</span></div>
```

**A live-log line** — call the existing `logPush(text, kind)`, kinds `'run'|'ok'|'warn'|'fail'`. **A toast** — call `showToast(msg, kind)`, kinds `signal`/`ledger`/`ember`/`alarm`/`neutral`.

Everything above already runs through `escapeHtml()` in the source — keep doing that for any text that came from an external response, so nothing from a real name or memo field can break rendering.

## What the mock currently fabricates (reference only — go verify against the real backend before trusting any of this)

**`intent`**, the mock's parsed-payment shape:
```js
{ raw, source:'text'|'qr', amount, currency, recipient:{type,label}, network, purpose, needsClarification }
```

**A route**, one entry in the mock's route list:
```js
{ chain, chainName, dot, name, costPct, timeSec, risk, cost, score, recommended? }
```

**A compliance rule**, one entry in the mock's rule list:
```js
{ label, std, result:'PASS'|'REVIEW'|'BLOCK', note, evidence? }
```

**Risk result**, the mock's shape:
```js
{ exposure, driver, instrument, hedgeRecommended, hedgeCost, exposureWithHedge }
```

**`current`**, the single live-pipeline object everything reads from:
```js
{ intent, routes, selectedRoute, compliance, risk, hedgeOn, settleAddress, startedAt, retried, token }
```

None of these are requirements. They exist so you can see, function by function, what's currently being faked and roughly what job it's doing — a starting map of the territory, not the territory itself. Expect real field names, nesting, and value sets to differ once you look at the actual backend, and treat that as normal, not as something to reconcile by changing the backend.

## Mock → real: what to open, and how to think about each one

For each of these, go find the real equivalent first — the real endpoint, the real table, the real SDK call — and see what it actually returns before touching the mock function. Then replace the function's body so it calls that real thing, and adapt whatever renders its result to the shape that actually comes back.

1. **Wallet connect** — `walletBtn` click handler. Real Sui wallet adapter connect call in place of the fake timeout + `fakeAddress()`. Keep whatever the real account/signer object looks like; adapt later signing code to it rather than flattening it into just an address string if it carries more than that.
2. **Network switch** — `networkSwitchBtn` handler. Reflect the wallet's actual connected network. If the wallet can't switch programmatically, say so through the existing toast/`.notice` pattern instead of pretending it worked.
3. **Balance check** — `WALLET_BALANCE_USDC`. Read the real balance from the connected wallet/RPC, in whatever denomination it's actually returned in.
4. **Parsing** — `parseIntentFromText(raw)`. Call the real parsing endpoint; render whatever fields it actually returns, however they're actually named.
5. **QR decode** — `intentFromQR()`. Per MOVA's spec this is local/offline EMVCo decoding, not a server round-trip. Wire in the real decoder; adapt to its real output fields.
6. **Routing** — `generateRoutes(intent)`. Call the real routing engine. If it already picks and scores a winner, trust its ordering — don't re-run the mock's scoring formula over real numbers; that formula exists only to *explain* a decision, and only the system that made the decision can explain it honestly.
7. **Compliance** — `runCompliance(intent)`. Call the real compliance engine. Map whatever outcome vocabulary it uses onto ledger/ember/alarm by meaning. Safety-critical — see non-negotiables above.
8. **Risk/hedge** — `assessRisk(intent)`. Call the real Thetanuts/risk integration; render whatever it actually exposes.
9. **Wallet signing** — inside the approve handler. Real sign-and-submit request to the connected wallet in place of the fixed delay.
10. **Settlement** — `proceedToSettle()` / `finishSettle()` / `showSettleFailure()`. Real transaction digest and package ID from the real submitted transaction, in place of `fakeDigest()`/`fakeAddress()`. Delete the random `willFail` simulation entirely — real failures now come from the real submission's own try/catch, routed into the existing `showSettleFailure()` path.

## When the shapes don't match (they will — here's how to handle the common cases)

- **Backend has fewer or more pipeline stages than the six shown.** Add or remove `.rail-row` blocks to match the real count; relabel each `data-state-label` to the real stage name. Keep the same node/line/stage-card markup for every row regardless of count.
- **Backend has no concept of one of the mock's stages at all** (say, no hedging step exists). Remove that rail row and its stage-card outright. Don't invent placeholder data for a step the backend doesn't have.
- **Backend's outcome vocabulary differs from `PASS`/`REVIEW`/`BLOCK`.** Keep the backend's real values in your state; only decide, at render time, which of `ledger-badge`/`ember-badge`/`alarm-badge` each one visually maps to.
- **Backend's field names differ** (`payee` not `recipient`, `asset` not `currency`, etc.). Rename the references in the rendering code to match the backend. Never ask the backend to rename its own fields for the UI's convenience.
- **Backend supports a different set of chains/currencies** than the mock's Ethereum/Solana/Polygon/Arbitrum/Base or USDC/USDT/SUI/MYR/SGD/USD. Edit `CHAIN_INFO`/`CHAIN_PROFILE` (or their currency equivalents) to the real supported set — these are frontend lookup tables, safe to edit freely; they're the part of the "mock" that's actually meant to be edited down to the real answer.

## The automation engine still applies — extend it, don't bypass it

`runToken` / `afterDelay(ms, fn)` exist to stop a stale run's timers from touching the DOM after the user starts a new payment or edits mid-flight. That guarantee matters *more* with real network latency, not less. Use this shape for any new async call instead of a bare `fetch(...).then(...)`:

```js
// Same cancellation guarantee as afterDelay, plus a floor so a fast
// response doesn't flash the stage before the user can read it.
function afterAsync(promise, minMs, onResolve, onReject){
  var token = current.token;
  var floor = new Promise(function(res){ setTimeout(res, minMs); });
  Promise.all([promise, floor]).then(function(r){
    if (token === runToken) onResolve(r[0]);
  }, function(err){
    if (token === runToken) (onReject || function(){})(err);
  });
}
```

## Error handling

A real backend fails in ways the mock never did. Every stage that calls out needs a failure path, not just a happy path. `showSettleFailure()` is the reference shape: sets the row to `failed` with an explicit reason, reveals a `.notice` explaining what happened and that funds haven't moved, offers retry. Give the same shape to any other stage that can realistically error live — copy the pattern, using whatever error information the real backend actually gives you, rather than letting an unhandled rejection freeze the rail mid-animation.

## Suggested order

Wallet connect first — balance checks, signing, and settlement all depend on a real address existing. Then parsing, routing, compliance, risk, signing, settlement — last because it's the only irreversible one. At each stage: look at the real thing before writing code against it, get that one stage working end-to-end including its failure path, then move on. A pipeline that still falls back to the mock for stages you haven't reached yet is a fine intermediate state; one that mixes real and fake data within the *same* run is not.

## Definition of done

- Nothing in the backend's code, schema, or endpoints changed to accommodate this work.
- Every mock function calls the real backend/SDK, and the UI correctly renders whatever shape actually comes back — not the shapes documented above where those turned out to differ.
- A hard compliance denial still halts before approval; rejection and insufficient-balance checks still work; nothing signs without the explicit approve click.
- The Thetanuts tag (or whatever replaced it) reflects reality, not a hardcoded string.
- No new inline `style="..."`, no new CSS rules, no new component patterns — only the existing classes and tokens, now full of real data.
- Theme toggle, tabs, and the automation/log/rail motion all still work exactly as before.
