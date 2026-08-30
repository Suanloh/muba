/**
 * PTB builder tests — offline, no network. Verifies the ONE-PTB MOVA payment
 * command sequence (split → transfer → record_payment) and the fail-closed
 * package-id guard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MovaError } from "@mova/logger";
import {
  buildMovaOwnedPaymentPtb,
  buildMovaReceiptPtb,
  type MovaOwnedTransferPayload,
} from "./sui-ptb.js";

const PKG = "0x2baa7a782929b0b2af8cbbfeb20d7f75ac89db18103ae9f2e029858156ea55c2";

/** Build a valid 64-hex Sui address from a short prefix (same as demoAddress). */
const addr = (prefix: string) => `0x${prefix.padEnd(64, "0")}`;
const FROM = addr("ea179fce");
const TO = addr("a11ce");

const PAYLOAD: MovaOwnedTransferPayload = {
  kind: "MOVA_OWNED_TRANSFER",
  from: FROM,
  to: TO,
  amount: "100000000", // 0.1 SUI in MIST
  asset: "SUI",
  movaPackageId: PKG,
  record: {
    correlationId: "corr-123",
    rawText: "Pay Alice 0.1 SUI",
    amountMist: "100000000",
    asset: "SUI",
    recipient: TO,
    network: "SUI_TESTNET",
    state: "SETTLED",
    createdAtMs: 1700000000000,
  },
};

type CommandShape = {
  $kind: string;
  SplitCoins?: unknown;
  TransferObjects?: { objects: unknown[]; address: unknown };
  MoveCall?: { package: string; module: string; function: string; arguments: unknown[] };
};

function commandsOf(tx: { getData(): unknown }): CommandShape[] {
  const data = tx.getData() as { commands: CommandShape[] };
  return data.commands;
}

test("buildMovaOwnedPaymentPtb: ONE block = split → transfer → record_payment", () => {
  const tx = buildMovaOwnedPaymentPtb(PAYLOAD);
  const cmds = commandsOf(tx);
  const kinds = cmds.map((c) => c.$kind);
  assert.deepEqual(kinds, ["SplitCoins", "TransferObjects", "MoveCall"]);
  const moveCall = cmds[2]!.MoveCall!;
  assert.equal(
    `${moveCall.package}::${moveCall.module}::${moveCall.function}`,
    `${PKG}::mova_owned::record_payment`,
  );
  // The entry fn takes 8 explicit args (TxContext is injected by the runtime).
  assert.equal(moveCall.arguments.length, 8);
});

test("buildMovaOwnedPaymentPtb: fail-closed when package id is missing/invalid", () => {
  assert.throws(
    () => buildMovaOwnedPaymentPtb({ ...PAYLOAD, movaPackageId: "" }),
    MovaError,
  );
  assert.throws(
    () => buildMovaOwnedPaymentPtb({ ...PAYLOAD, movaPackageId: "0x0" }),
    MovaError,
  );
  assert.throws(
    () => buildMovaOwnedPaymentPtb({ ...PAYLOAD, movaPackageId: "not-an-address" }),
    MovaError,
  );
});

test("buildMovaOwnedPaymentPtb: transfer targets the validated recipient", () => {
  const tx = buildMovaOwnedPaymentPtb(PAYLOAD);
  const cmds = commandsOf(tx);
  const transfer = cmds[1]!.TransferObjects!;
  // Objects reference the split coin (NestedResult); address is a pure input.
  assert.ok(Array.isArray(transfer.objects) && transfer.objects.length === 1);
  assert.ok(transfer.address !== undefined);
});

test("buildMovaReceiptPtb: separate follow-up block mints the receipt", () => {
  const tx = buildMovaReceiptPtb({
    movaPackageId: PKG,
    from: PAYLOAD.from,
    receipt: {
      paymentRecordId: "pay_abc",
      amountMist: "100000000",
      asset: "SUI",
      recipient: PAYLOAD.to,
      txDigest: "HASH123",
      simulated: false,
      issuedAtMs: 1700000001000,
    },
  });
  const cmds = commandsOf(tx);
  assert.deepEqual(cmds.map((c) => c.$kind), ["MoveCall"]);
  const mc = cmds[0]!.MoveCall!;
  assert.equal(`${mc.package}::${mc.module}::${mc.function}`, `${PKG}::mova_owned::mint_receipt`);
  assert.equal(mc.arguments.length, 7);
});
