/**
 * Phase 0 smoke test — validates the technical foundation behaves correctly.
 *
 * Run: `npx tsx scripts/phase0-smoke.ts`
 *
 * Covers: config boundary enforcement (fail-closed), payment state machine
 * (happy path + guard failures), deterministic mocks (no fake digests, no
 * fake positions), and logger redaction.
 */
import { checkBoundary } from "@mova/config";
import { PaymentStateMachine } from "@mova/core";
import {
  ErrorCode,
  MovaError,
  createLogger,
  createNullLogger,
} from "@mova/logger";
import {
  MockHedgingProvider,
  MockMarketDataProvider,
  MockScreeningProvider,
  SimulatedSettlementProvider,
} from "@mova/integrations";
import { crc16Ccitt, decodeEmvco, EmvcoQrDecoder, stringToUtf8 } from "@mova/qr";
import type { PaymentGuardContext, PaymentState } from "@mova/types";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function expectThrowsAsync(name: string, fn: () => Promise<unknown>, code?: string): Promise<void> {
  return (async () => {
    try {
      await fn();
      check(name, false, "expected an error");
    } catch (err) {
      const isMova = err instanceof MovaError;
      check(name, isMova && (code === undefined || err.code === code), `got ${err}`);
    }
  })();
}

// ---------------------------------------------------------------------------
console.log("\n[1] Config boundary (fail-closed)");
// ---------------------------------------------------------------------------
{
  const devOk = checkBoundary("dev", {
    settlementMode: "simulated",
    useMocks: true,
    suiNetwork: "SUI_DEVNET",
  });
  check("dev + mocks + simulated is valid", devOk.violations.length === 0, devOk.violations.join("; "));

  const mainnetBad = checkBoundary("mainnet", {
    settlementMode: "simulated",
    useMocks: true,
    suiNetwork: "SUI_MAINNET",
  });
  check("mainnet refuses simulated settlement", mainnetBad.violations.some((v) => v.includes("SETTLEMENT_MODE=real")));
  check("mainnet refuses mocks", mainnetBad.violations.some((v) => v.includes("USE_MOCKS=true")));

  const netBad = checkBoundary("testnet", {
    settlementMode: "real",
    useMocks: false,
    suiNetwork: "SUI_DEVNET",
  });
  check("network must match env", netBad.violations.some((v) => v.includes("SUI_NETWORK")));
}

// ---------------------------------------------------------------------------
console.log("\n[2] Payment state machine — happy path");
// ---------------------------------------------------------------------------
{
  const ctx: PaymentGuardContext = {
    hasValidatedIntent: true,
    complianceDecision: "ALLOW",
    riskDecision: "PROCEED",
    approvalsMet: true,
    settlementConfirmed: true,
  };
  const sm = new PaymentStateMachine(ctx);
  const path: Array<[PaymentState, Parameters<PaymentStateMachine["apply"]>[1], PaymentState]> = [
    ["CREATED", "INTENT_PARSED", "PARSED"],
    ["PARSED", "ROUTE_FOUND", "ROUTE_FOUND"],
    ["ROUTE_FOUND", "COMPLIANCE_CHECKED", "COMPLIANCE_CHECKED"],
    ["COMPLIANCE_CHECKED", "RISK_ASSESSED", "RISK_ASSESSED"],
    ["RISK_ASSESSED", "APPROVAL_REQUESTED", "AWAITING_APPROVAL"],
    ["AWAITING_APPROVAL", "APPROVED", "APPROVED"],
    ["APPROVED", "EXECUTION_STARTED", "EXECUTING"],
    ["EXECUTING", "SETTLED", "SETTLED"],
  ];
  for (const [from, event, expected] of path) {
    const out = sm.apply(from, event);
    check(`${from} --${event}--> ${expected}`, out.ok && out.to === expected, JSON.stringify(out));
  }
  check("SETTLED is terminal", sm.apply("SETTLED", "EXECUTION_FAILED").ok === false);
}

// ---------------------------------------------------------------------------
console.log("\n[3] Payment state machine — guards");
// ---------------------------------------------------------------------------
{
  const blocked = new PaymentStateMachine({
    hasValidatedIntent: true,
    complianceDecision: "BLOCK",
    riskDecision: "PROCEED",
    approvalsMet: true,
    settlementConfirmed: true,
  });
  const g = blocked.apply("COMPLIANCE_CHECKED", "RISK_ASSESSED");
  check("BLOCKED compliance cannot advance", g.ok === false && g.reason?.includes("guard"), g.reason ?? "");

  const unapproved = new PaymentStateMachine({
    hasValidatedIntent: true,
    complianceDecision: "ALLOW",
    riskDecision: "PROCEED",
    approvalsMet: false,
    settlementConfirmed: true,
  });
  const a = unapproved.apply("AWAITING_APPROVAL", "APPROVED");
  check("unapproved cannot move to APPROVED", a.ok === false && a.reason?.includes("guard"), a.reason ?? "");

  const unconfirmed = new PaymentStateMachine({
    hasValidatedIntent: true,
    complianceDecision: "ALLOW",
    riskDecision: "PROCEED",
    approvalsMet: true,
    settlementConfirmed: false,
  });
  const s = unconfirmed.apply("EXECUTING", "SETTLED");
  check("unconfirmed cannot settle", s.ok === false && s.reason?.includes("guard"), s.reason ?? "");
}

// ---------------------------------------------------------------------------
console.log("\n[4] Deterministic mocks (no fake chain data)");
// ---------------------------------------------------------------------------
{
  const settlement = new SimulatedSettlementProvider({ allowed: true });
  const outcome = await settlement.submit({ network: "SUI_DEVNET", payload: { amount: "100" } });
  check("simulated settlement has NO digest", outcome.txDigest === null, String(outcome.txDigest));
  check("simulated settlement flagged simulated", outcome.simulated === true && outcome.status === "SIMULATED");

  expectThrowsAsync(
    "mock settlement refused when not allowed",
    async () => {
      await new SimulatedSettlementProvider({ allowed: false }).submit({ network: "SUI_MAINNET", payload: {} });
    },
    ErrorCode.MOCK_FORBIDDEN,
  );

  const hedging = new MockHedgingProvider({ allowed: true });
  const quote = await hedging.quote({
    asset: "SUI",
    amount: { asset: "SUI", amount: "1000000000" },
    strategy: "PUT_OPTION",
    durationDays: 7,
  });
  check("hedge quote is deterministic & simulated", quote.simulated === true && quote.premium.amount === "12000000", quote.premium.amount);

  const screening = new MockScreeningProvider({ allowed: true });
  const hit = await screening.screen({ name: "simulated sanctioned entity", identifier: null });
  check("watchlist HIT detected", hit.decision === "HIT", hit.decision);
  const unknown = await screening.screen({ name: "Acme Corp", identifier: "0xabc" });
  check("unknown counterparty clears", unknown.decision === "CLEAR", unknown.decision);
  const empty = await screening.screen({ name: null, identifier: null });
  check("no identity => REVIEW, never CLEAR", empty.decision === "REVIEW", empty.decision);

  const market = new MockMarketDataProvider({ allowed: true });
  const q = await market.getQuote({ base: "SUI", quote: "USDC" });
  check("market quote is simulated & priced", q.simulated === true && q.price === "1.000000", q.price);
}

// ---------------------------------------------------------------------------
console.log("\n[5] Logger redaction");
// ---------------------------------------------------------------------------
{
  let line = "";
  const logger = createLogger({ level: "info", format: "json", sink: (l) => (line = l) });
  logger.info("boot", { correlationId: "c-1", apiKey: "super-secret", nested: { mnemonic: "word1 word2" } });
  const parsed = JSON.parse(line) as Record<string, unknown>;
  check("correlationId preserved", parsed.correlationId === "c-1");
  check("apiKey redacted", parsed.apiKey === "[REDACTED]");
  check("nested mnemonic redacted", (parsed.nested as Record<string, unknown>).mnemonic === "[REDACTED]");

  const child = logger.child({ correlationId: "c-2" });
  line = "";
  child.warn("child line", { userId: "u1" });
  check("child threads correlationId", (JSON.parse(line) as Record<string, unknown>).correlationId === "c-2");
}

// ---------------------------------------------------------------------------
console.log("\n[6] QR — local EMVCo decoder (deterministic, no external call)");
// ---------------------------------------------------------------------------
{
  // Build a valid Merchant-Presented QR payload (currency 458 = MYR, amount 10.00).
  const body = [
    "000201", // 00 02 "01" payload format
    "010212", // 01 02 "12" point of initiation
    "02100000000000", // 02 10 "0000000000" merchant account
    "52045998", // 52 04 "5998" merchant category
    "5303458", // 53 03 "458" currency (MYR)
    "540510.00", // 54 05 "10.00" amount
    "5802MY", // 58 02 "MY" country
    "5913TEST MERCHANT", // 59 13 merchant name
    "6012KUALA LUMPUR", // 60 12 merchant city
  ].join("");
  const crc = crc16Ccitt(stringToUtf8(body)).toString(16).toUpperCase().padStart(4, "0");
  const payload = body + "6304" + crc;

  const decoded = decodeEmvco(payload);
  check("EMVCo payload decodes without errors", decoded.parseErrors.length === 0, decoded.parseErrors.join("; "));
  check("EMVCo CRC valid", decoded.crcValid === true);
  check("EMVCo merchant name", decoded.merchantName === "TEST MERCHANT", decoded.merchantName ?? "");
  check("EMVCo amount -> smallest units", decoded.amount?.amount === "1000", decoded.amount?.amount ?? "");
  check("EMVCo currency code", decoded.currencyCode === "458", decoded.currencyCode ?? "");
  check("EMVCo merchant account", decoded.merchantAccount === "0000000000", decoded.merchantAccount ?? "");

  const tampered = body.replace("10.00", "99.00") + "6304" + crc;
  check("tampered amount fails CRC", decodeEmvco(tampered).crcValid === false);

  const notQr = decodeEmvco("hello world not a qr");
  check("non-QR payload flagged", notQr.parseErrors.length > 0 && notQr.crcValid === false);

  const decoder = new EmvcoQrDecoder();
  check("QrDecoder contract works", decoder.decode(payload).merchantName === "TEST MERCHANT");
}

// ---------------------------------------------------------------------------
console.log(`\nPhase 0 smoke: ${passed} passed, ${failed} failed`);
createNullLogger();
if (failed > 0) {
  process.exit(1);
}
