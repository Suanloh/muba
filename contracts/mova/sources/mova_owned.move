/// MOVA — Sui-owned payment state (ownership blueprint, Phase 1).
///
/// This module defines how MOVA represents payment-related state as Sui-owned
/// objects. Ownership is visibly central to MOVA's architecture: every object
/// is transferred to a user's Sui address.
///
///   - `MovaPaymentAuthz`   : wallet-scoped, human-approved payment authorization
///   - `OwnedPaymentRecord` : deterministic payment record (state machine mirror)
///   - `MovaReceipt`        : settlement receipt, minted only after SETTLED
///
/// SAFETY: these objects are created from programmable transaction blocks the
/// USER signs, and only after the deterministic approval gate
/// (`packages/wallet`) issues a `PaymentAuthz`. Nothing here executes a payment
/// on its own — it records ownership of already-approved, settled state.
///
/// STATUS: Phase 1 blueprint only. Not yet deployed — compile + unit-test in
/// Phase 2 with `sui move build` / `sui move test` against the target network.
module mova::mova_owned {
    use std::string::{Self, String};
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    // ------------------------------------------------------------------
    // Sui-owned objects
    // ------------------------------------------------------------------

    /// A wallet-scoped payment authorization, owned by the user's address.
    /// Carries the approval nonce so the executor can prove the human gate
    /// authorized this specific payment (replay protection on-chain).
    public struct MovaPaymentAuthz has key, store {
        id: UID,
        payment_record_id: String,
        amount: u64,
        asset: String,
        recipient: address,
        nonce: String,
        expires_at: u64,
    }

    /// A deterministic payment record, owned by the user's address. `state`
    /// mirrors the `@mova/types` payment state machine (e.g. "SETTLED").
    public struct OwnedPaymentRecord has key, store {
        id: UID,
        correlation_id: String,
        raw_text: String,
        amount: u64,
        asset: String,
        recipient: address,
        network: String,
        state: String,
        created_at: u64,
    }

    /// A settlement receipt, owned by the user's address, minted post-SETTLED.
    /// `tx_digest` is null (empty) when the settlement was simulated.
    public struct MovaReceipt has key, store {
        id: UID,
        payment_record_id: String,
        amount: u64,
        asset: String,
        recipient: address,
        tx_digest: String,
        simulated: bool,
        issued_at: u64,
    }

    // ------------------------------------------------------------------
    // Entrypoints (Phase 2 wiring — called from user-signed PTBs)
    // ------------------------------------------------------------------

    /// Create a payment authorization owned by `ctx.sender()`.
    /// Only called after the approval gate passed (never from an AI suggestion).
    public fun issue_authz(
        payment_record_id: String,
        amount: u64,
        asset: String,
        recipient: address,
        nonce: String,
        expires_at: u64,
        ctx: &mut TxContext,
    ) {
        let authz = MovaPaymentAuthz {
            id: object::new(ctx),
            payment_record_id,
            amount,
            asset,
            recipient,
            nonce,
            expires_at,
        };
        transfer::transfer(authz, tx_context::sender(ctx));
    }

    /// Record a payment owned by `ctx.sender()` (the deterministic record mirror).
    public fun record_payment(
        correlation_id: String,
        raw_text: String,
        amount: u64,
        asset: String,
        recipient: address,
        network: String,
        state: String,
        created_at: u64,
        ctx: &mut TxContext,
    ) {
        let record = OwnedPaymentRecord {
            id: object::new(ctx),
            correlation_id,
            raw_text,
            amount,
            asset,
            recipient,
            network,
            state,
            created_at,
        };
        transfer::transfer(record, tx_context::sender(ctx));
    }

    /// Advance the state of a user-owned payment record (e.g. to "SETTLED").
    public fun update_state(record: &mut OwnedPaymentRecord, state: String) {
        record.state = state;
    }

    /// Mint a receipt owned by `ctx.sender()` after the record is SETTLED.
    public fun mint_receipt(
        payment_record_id: String,
        amount: u64,
        asset: String,
        recipient: address,
        tx_digest: String,
        simulated: bool,
        issued_at: u64,
        ctx: &mut TxContext,
    ) {
        let receipt = MovaReceipt {
            id: object::new(ctx),
            payment_record_id,
            amount,
            asset,
            recipient,
            tx_digest,
            simulated,
            issued_at,
        };
        transfer::transfer(receipt, tx_context::sender(ctx));
    }

    // ------------------------------------------------------------------
    // Read accessors (for dApps / indexers)
    // ------------------------------------------------------------------

    public fun authz_amount(authz: &MovaPaymentAuthz): u64 {
        authz.amount
    }

    public fun authz_recipient(authz: &MovaPaymentAuthz): address {
        authz.recipient
    }

    public fun authz_expires_at(authz: &MovaPaymentAuthz): u64 {
        authz.expires_at
    }

    public fun record_state(record: &OwnedPaymentRecord): String {
        record.state
    }

    public fun record_amount(record: &OwnedPaymentRecord): u64 {
        record.amount
    }

    public fun receipt_digest(receipt: &MovaReceipt): String {
        receipt.tx_digest
    }
}
