/**
 * MOVA Supabase database schema types.
 *
 * Hand-maintained mirror of `supabase/migrations/0001_init.sql` +
 * `0002_sync_meta.sql` (the migration is the source of truth; these types make
 * `@supabase/supabase-js` queries type-safe). Only the tables the MOVA runtime
 * actually reads/writes are fully modelled; the rest are kept minimal so a
 * future migration can expand them without churn.
 */

// ---------------------------------------------------------------------------
// Enums (closed sets — mirror packages/types/src/enums.ts)
// ---------------------------------------------------------------------------

export type MovaUserRole =
  | "OWNER"
  | "APPROVER"
  | "OPERATOR"
  | "AUDITOR"
  | "ADMIN";
export type MovaNetwork = "SUI_DEVNET" | "SUI_TESTNET" | "SUI_MAINNET";
export type MovaIntentSource = "CHAT" | "API" | "MANUAL" | "QR";
export type MovaPaymentState =
  | "CREATED"
  | "PARSED"
  | "ROUTE_FOUND"
  | "COMPLIANCE_CHECKED"
  | "RISK_ASSESSED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "SETTLED"
  | "FAILED";
export type MovaTransactionStatus =
  | "PENDING"
  | "SIMULATED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "REVERTED"
  | "FAILED"
  | "CANCELLED";
export type MovaActorType =
  | "USER"
  | "SYSTEM"
  | "AI"
  | "APPROVER"
  | "EXTERNAL";
export type MovaAuditEntityType =
  | "PAYMENT_INTENT"
  | "ROUTE"
  | "COMPLIANCE"
  | "RISK"
  | "APPROVAL"
  | "TRANSACTION";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface UsersRow {
  id: string;
  external_id: string;
  email: string;
  display_name: string | null;
  role: MovaUserRole;
  status: string;
  kyc_status: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentIntentRow {
  id: string;
  correlation_id: string;
  intent_ref: string;
  user_id: string | null;
  wallet_id: string | null;
  source: MovaIntentSource;
  raw_text: string;
  network: MovaNetwork;
  status: MovaPaymentState;
  failure_code: string | null;
  /** Denormalized demo record snapshot (0002) — full PaymentRecord for round-trip. */
  meta: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEventRow {
  id: string;
  correlation_id: string;
  entity_type: MovaAuditEntityType;
  entity_id: string;
  event_type: string;
  actor: { type: MovaActorType; id: string };
  payload: Record<string, unknown>;
  previous_state: string | null;
  new_state: string | null;
  simulated: boolean;
  created_at: string;
}

export interface ReceiptRow {
  id: string;
  payment_intent_id: string;
  owner_address: string;
  amount_asset: string;
  amount_amount: string;
  recipient: string;
  network: MovaNetwork;
  tx_digest: string | null;
  simulated: boolean;
  issued_at: string;
}

export interface SettlementTransactionRow {
  id: string;
  payment_intent_id: string | null;
  approval_id: string | null;
  type: string;
  network: MovaNetwork;
  payload: Record<string, unknown>;
  simulation: Record<string, unknown> | null;
  status: MovaTransactionStatus;
  tx_digest: string | null;
  simulated: boolean;
  error: string | null;
  created_at: string;
  confirmed_at: string | null;
}

/** Minimal rows for the tables we touch only indirectly. */
export interface MinimalJsonbRow {
  id: string;
  created_at: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Supabase `Database` generic — enables type-safe `from()` queries.
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      users: {
        Row: UsersRow;
        Insert: Partial<UsersRow> & Pick<UsersRow, "id" | "external_id" | "email">;
        Update: Partial<UsersRow>;
        Relationships: [];
      };
      payment_intents: {
        Row: PaymentIntentRow;
        Insert: Partial<PaymentIntentRow> &
          Pick<PaymentIntentRow, "correlation_id" | "intent_ref" | "raw_text" | "network">;
        Update: Partial<PaymentIntentRow>;
        Relationships: [];
      };
      audit_events: {
        Row: AuditEventRow;
        Insert: Partial<AuditEventRow> &
          Pick<AuditEventRow, "correlation_id" | "entity_type" | "entity_id" | "event_type" | "actor">;
        Update: Partial<AuditEventRow>;
        Relationships: [];
      };
      receipts: {
        Row: ReceiptRow;
        Insert: Partial<ReceiptRow>;
        Update: Partial<ReceiptRow>;
        Relationships: [];
      };
      settlement_transactions: {
        Row: SettlementTransactionRow;
        Insert: Partial<SettlementTransactionRow>;
        Update: Partial<SettlementTransactionRow>;
        Relationships: [];
      };
      // Present in the schema but not directly queried by this package.
      wallets: { Row: MinimalJsonbRow; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
      parsed_intents: { Row: MinimalJsonbRow; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
      qr_decoded: { Row: MinimalJsonbRow; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
      routes: { Row: MinimalJsonbRow; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
      compliance_assessments: { Row: MinimalJsonbRow; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
      risk_assessments: { Row: MinimalJsonbRow; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
      approval_requests: { Row: MinimalJsonbRow; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
      approvals: { Row: MinimalJsonbRow; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      network: MovaNetwork;
      payment_state: MovaPaymentState;
      user_role: MovaUserRole;
    };
    CompositeTypes: Record<string, never>;
  };
}
