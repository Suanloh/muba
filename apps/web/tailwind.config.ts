import type { Config } from "tailwindcss";

/**
 * MOVA design system — everything maps onto the CSS custom properties defined
 * in app/globals.css (bark & vellum themes). The generic Tailwind palettes are
 * remapped by SEMANTIC ROLE so every existing class renders with MOVA's tokens:
 *   slate  → warm neutral ramp (text / hairline / surface)
 *   sky    → signal   (in progress, AI, info)
 *   emerald→ ledger   (confirmed / passed / settled)
 *   amber  → ember    (needs attention / review)
 *   rose   → alarm    (blocked / rejected / failed)
 *   violet → signal   (MOVA-introduced: AI parser, hedge)
 * No new palette, no hardcoded hex in components — only the token set from the
 * prototype.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Named surface / text tokens (used by primitives + shell)
        page: "var(--bg)",
        translucent: "var(--bg-translucent)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        raised: "var(--bg-raised)",
        ink: "var(--text)",
        muted: "var(--text-muted)",
        faint: "var(--text-faint)",
        hairline: "var(--border)",
        "hairline-strong": "var(--border-strong)",
        // Semantic status tokens (four, exactly — no fifth)
        signal: {
          DEFAULT: "var(--signal)",
          text: "var(--signal-text)",
          bg: "var(--signal-bg)",
          border: "var(--signal-border)",
        },
        ledger: {
          DEFAULT: "var(--ledger)",
          text: "var(--ledger-text)",
          bg: "var(--ledger-bg)",
          border: "var(--ledger-border)",
        },
        ember: {
          DEFAULT: "var(--ember)",
          text: "var(--ember-text)",
          bg: "var(--ember-bg)",
          border: "var(--ember-border)",
        },
        alarm: {
          DEFAULT: "var(--alarm)",
          text: "var(--alarm-text)",
          bg: "var(--alarm-bg)",
          border: "var(--alarm-border)",
        },
        // Per-chain identity dots (lookup only, per skill)
        chain: {
          sui: "var(--chain-sui)",
          eth: "var(--chain-eth)",
          sol: "var(--chain-sol)",
          poly: "var(--chain-poly)",
          arb: "var(--chain-arb)",
          base: "var(--chain-base)",
        },
        // Inverted code block (theme-aware)
        code: {
          DEFAULT: "var(--code-bg)",
          text: "var(--code-text)",
        },
        // ---- Generic palettes remapped to the tokens above ----
        slate: {
          50: "var(--surface-2)",
          100: "var(--border)",
          200: "var(--border)",
          300: "var(--border-strong)",
          400: "var(--text-faint)",
          500: "var(--text-muted)",
          600: "var(--text-muted)",
          700: "var(--text)",
          800: "var(--text)",
          900: "var(--text)",
        },
        sky: {
          50: "var(--signal-bg)",
          100: "var(--signal-bg)",
          200: "var(--signal-border)",
          300: "var(--signal-border)",
          400: "var(--signal)",
          500: "var(--signal)",
          600: "var(--signal)",
          700: "var(--signal-text)",
          800: "var(--signal-text)",
          900: "var(--signal)",
        },
        emerald: {
          50: "var(--ledger-bg)",
          100: "var(--ledger-bg)",
          200: "var(--ledger-border)",
          300: "var(--ledger-border)",
          400: "var(--ledger)",
          500: "var(--ledger)",
          600: "var(--ledger-text)",
          700: "var(--ledger-text)",
          800: "var(--ledger-text)",
          900: "var(--ledger)",
        },
        amber: {
          50: "var(--ember-bg)",
          100: "var(--ember-bg)",
          200: "var(--ember-border)",
          300: "var(--ember-border)",
          400: "var(--ember)",
          500: "var(--ember)",
          600: "var(--ember-text)",
          700: "var(--ember-text)",
          800: "var(--ember-text)",
          900: "var(--ember-text)",
        },
        rose: {
          50: "var(--alarm-bg)",
          100: "var(--alarm-bg)",
          200: "var(--alarm-border)",
          300: "var(--alarm-border)",
          400: "var(--alarm)",
          500: "var(--alarm)",
          600: "var(--alarm-text)",
          700: "var(--alarm-text)",
          800: "var(--alarm-text)",
          900: "var(--alarm)",
        },
        violet: {
          50: "var(--signal-bg)",
          100: "var(--signal-bg)",
          200: "var(--signal-border)",
          300: "var(--signal-border)",
          400: "var(--signal)",
          500: "var(--signal)",
          600: "var(--signal-text)",
          700: "var(--signal-text)",
          800: "var(--signal-text)",
          900: "var(--signal)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
      },
    },
  },
  plugins: [],
};

export default config;
