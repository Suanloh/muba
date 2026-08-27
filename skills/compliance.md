# Compliance Skills

> Theme file extracted from the Reusable Skill Pack. These skills cover the mandatory
> controls between a proposed transaction and its execution: gates, screening, monitoring,
> scoring, policy, travel rule, and audit.

## 4.1 `compliance-gate`

**Short description.** Treating compliance as a mandatory gate that every transaction must pass before execution.

**When to use.** Any flow where a transaction moves from "proposed" to "executed".

**Why it exists / problem solved.** Without a gate, compliance checks are advisory and
easily skipped. A hard gate makes them structurally unavoidable.

**Core concepts.** Gate as middleware in the pipeline; ordered checks; fail-closed vs
fail-open; blocking vs quarantining; auditability of every gate decision.

**Architecture / pattern.**
- Insert the gate between planning and execution: `plan → compliance gate → policy → approve → execute`.
- Each check is a pure, ordered rule; the gate returns ALLOW / REVIEW / BLOCK.
- On any check failure, abort execution and record the reason.

**Implementation guidance.**
- Fail closed: if a check errors or a data source is unavailable, default to REVIEW/BLOCK.
- Make the gate the single choke point — no code path bypasses it.
- Log the full decision (inputs, checks, outcome, timestamp).

**Common failure modes.** Bypassable gate (an alternative execution path); fail-open on
error; checks running in parallel with no defined precedence; decisions not persisted.

**Security/compliance considerations.** The gate is a control, not a feature flag. It must
be impossible to execute a value-moving transaction without passing it.

**Example AI-agent instruction.** "Route every transaction through the compliance gate. If
any check cannot be evaluated, fail closed to REVIEW. Return the decision and the list of
checks with their individual outcomes."

**Related skills.** `counterparty-screening`, `transaction-monitoring`, `risk-scoring`, `policy-engine`, `audit-trail`.

---

## 4.2 `counterparty-screening`

**Short description.** Screening counterparties (recipients, senders, entities) against sanctions, watchlists, and prohibited lists before transacting.

**When to use.** Before onboarding a counterparty or processing a payment involving a new or existing counterparty.

**Why it exists / problem solved.** Transacting with sanctioned or high-risk entities is a
serious violation. Screening detects matches before value moves.

**Core concepts.** Sanctions/watchlist matching; name matching and fuzzy matching; identifier
matching (address, account); false-positive handling; screening decision (clear/hit/review).

**Architecture / pattern.**
- Normalize counterparty identity (name + identifiers) into a canonical record.
- Match against list data with both exact and fuzzy matchers.
- Hits route to REVIEW; clears proceed; ambiguous results escalate to a human.

**Implementation guidance.**
- Keep list data versioned and timestamped — stale lists are a compliance failure.
- Prefer deterministic matching with configurable thresholds over LLM judgment.
- Store both the screened identity and the list version used.

**Common failure modes.** Matching on name only and missing identifiers; ignoring
transliteration/alias variations; using an outdated list; treating "review" as "clear".

**Security/compliance considerations.** Screening is a legal obligation in many
jurisdictions. Record the exact match logic and source so decisions are defensible.

**Example AI-agent instruction.** "Screen this counterparty against the configured lists
using exact and fuzzy matching. Return CLEAR / HIT / REVIEW with the matched fields and the
list version. Never treat an ambiguous match as CLEAR."

**Related skills.** `compliance-gate`, `travel-rule`, `audit-trail`.

---

## 4.3 `transaction-monitoring`

**Short description.** Monitoring transactions over time for suspicious patterns (AML-style), distinct from pre-execution risk scoring.

**When to use.** Ongoing surveillance of transaction flows: structuring, unusual velocity,
anomalous counterparties, threshold reporting.

**Why it exists / problem solved.** Compliance is not only a pre-transaction check. Patterns
that emerge across many transactions (structuring, layering) are only visible over time.

**Core concepts.** Monitoring vs screening; velocity and structuring detection; thresholds;
anomaly detection; alert generation; suspicious activity reporting workflows.

**Architecture / pattern.**
- A monitoring pipeline consumes a transaction/audit stream, applies pattern rules, and raises alerts.
- Rules are deterministic and time-windowed (e.g. aggregate amount over N days).
- Alerts feed a review queue with evidence attached.

**Implementation guidance.**
- Monitor on the audit trail, not live inference alone — the trail is the source of truth.
- Keep window definitions explicit and configurable.
- Every alert carries the triggering transactions and rule for explainability.

**Common failure modes.** Monitoring only single transactions and missing multi-tx patterns;
alert fatigue from un-tuned thresholds; discarding false positives without audit note.

**Security/compliance considerations.** Monitoring must be tamper-evident: alerts and their
resolution are part of the audit record.

**Example AI-agent instruction.** "Add a monitoring rule that aggregates transfers per
counterparty over a rolling window and alerts when the total exceeds the threshold. Each
alert must reference the contributing transactions and the rule ID."

**Related skills.** `audit-trail`, `compliance-gate`, `risk-scoring`.

---

## 4.4 `risk-scoring`

**Short description.** Deterministic, explainable risk scoring with a standard classification scale (LOW / MEDIUM / HIGH / CRITICAL).

**When to use.** Anywhere a decision needs a reproducible risk class: transaction risk,
counterparty risk, portfolio risk, fraud detection, lending, access control.

**Why it exists / problem solved.** Risk must be explainable and consistent. A scoring
framework turns many signals into one defensible classification.

**Core concepts.** Signal extraction; weighting; aggregation; classification thresholds;
explainability (reason codes); override rules; score history.

**Architecture / pattern.**
- Decompose risk into named signals, each a pure function returning a value and a reason.
- Aggregate deterministically (weighted sum or rule tree) into a score band.
- Attach reason codes so every score is traceable to its inputs.

**Implementation guidance.**
- Keep the LLM out of final classification; allow it only to *suggest* signals or explain results.
- Unit-test every rule and the aggregation with known inputs.
- Store score + inputs + version so scores are reproducible.

**Common failure modes.** Unexplainable "black box" scores; hidden weights; inconsistent
bands across teams; overriding a score without recording who and why.

**Security/compliance considerations.** In regulated contexts the model and reasons may be
audited. Maintain versioned scoring logic.

**Example AI-agent instruction.** "Score this transaction with deterministic rules and
return LOW / MEDIUM / HIGH / CRITICAL plus the list of contributing signals and reasons.
Do not have the LLM decide the final class."

**Related skills.** `transaction-risk`, `policy-engine`, `audit-trail`, `structured-llm-output`.

---

## 4.5 `policy-engine`

**Short description.** A configurable rules engine that evaluates transactions and returns ALLOW / REVIEW / BLOCK before execution.

**When to use.** Pre-execution authorization for payments, transfers, approvals, and any
rule-driven decision (also applies to payment systems, banking apps, enterprise approval
workflows, fraud detection, access control).

**Why it exists / problem solved.** Hard-coded business rules are brittle. A policy engine
makes limits, restrictions, and approval thresholds configurable and auditable without redeploying code.

**Core concepts.** Policy as data; rule types (amount limits, asset restrictions, network
restrictions, counterparty restrictions, exposure limits); outcomes ALLOW / REVIEW / BLOCK;
manual approval thresholds; evaluation order and precedence.

**Architecture / pattern.**
- Policies are stored/loaded as data (DB or config), evaluated by a deterministic engine.
- Evaluate in a defined order; first BLOCK wins; REVIEW accumulates conditions.
- The engine returns a decision object with the matched policies, not just the outcome.

**Implementation guidance.**
- Version policies and log which version evaluated each transaction.
- Allow operators to edit policies without code changes; require audit of policy changes.
- Keep the engine pure and fast — no network calls inside evaluation.

**Common failure modes.** Hard-coding rules in the app; ambiguous precedence; policy
changes without versioning; an engine that returns REVIEW but the caller executes anyway.

**Security/compliance considerations.** Policy evaluation is the last software gate before
human approval/execution. It must be deterministic, versioned, and logged.

**Example AI-agent instruction.** "Evaluate this transaction against the active policy set
and return ALLOW / REVIEW / BLOCK with the specific policies matched and their thresholds.
Do not execute; only decide."

**Related skills.** `risk-scoring`, `compliance-gate`, `audit-trail`, `ai-deterministic-boundary`.

---

## 4.6 `travel-rule`

**Short description.** Capturing and exchanging originator/beneficiary information for transfers between financial institutions/VASPs as required by regulation.

**When to use.** Cross-institution transfers where regulation requires transmitting sender
and receiver identity data alongside the transaction.

**Why it exists / problem solved.** Regulators require originator/beneficiary information to
travel with certain transfers. Missing this data blocks or invalidates transactions.

**Core concepts.** Originator/beneficiary data capture; required data elements; data
validation; secure transmission between counterparties; record keeping; jurisdiction thresholds.

**Architecture / pattern.**
- Capture required counterparty data at intent/order time, validate completeness before execution.
- Attach the travel-rule payload to the transfer and persist it in the audit trail.
- For prototype/simulated systems, model the workflow without claiming real regulatory transmission.

**Implementation guidance.**
- Enforce completeness: block or hold transfers missing required data.
- Store both the payload and the counterparty/transmission outcome.
- Clearly distinguish simulated compliance from real regulatory integration.

**Common failure modes.** Missing required fields discovered only at execution; storing
payloads without linkage to the transaction; conflating prototype screens with real regulatory reporting.

**Security/compliance considerations.** Travel-rule data is sensitive PII — encrypt at rest
and in transit, and minimize access. Never claim real regulatory compliance for a prototype.

**Example AI-agent instruction.** "Validate that the transfer has complete originator and
beneficiary data per the configured travel-rule requirements. If incomplete, hold the
transfer with the missing fields listed."

**Related skills.** `counterparty-screening`, `audit-trail`, `compliance-gate`.

---

## 4.7 `audit-trail`

**Short description.** Recording an immutable, queryable history of every decision and action — from user intent to final execution.

**When to use.** Any financial or compliance system where decisions must be reconstructed after the fact.

**Why it exists / problem solved.** Auditors and regulators ask "why did this happen?" An
audit trail connects intent → plan → risk → policy → approval → execution → result.

**Core concepts.** Append-only events; correlation IDs; decision logging; risk decision
history; transaction history; explainable decisions; traceability; retention.

**Architecture / pattern.**
- A single append-only event store; every stage writes events with a shared correlation ID.
- Events are immutable; corrections are new events, never edits.
- Store the full decision context (inputs, matched rules, outcome, actor, timestamp).

**Implementation guidance.**
- Emit events at every boundary, not only at execution.
- Use a correlation ID threaded through the whole flow for end-to-end traceability.
- Make events queryable by transaction, counterparty, actor, and decision.

**Common failure modes.** Logging only the final transaction and losing the "why"; mutable
logs; missing actor/timestamp; no correlation across services.

**Security/compliance considerations.** The audit trail is evidence. Protect it from
tampering (append-only, access-controlled) and retain per policy.

**Example AI-agent instruction.** "Add an audit event at this step with the shared
correlation ID, including the decision inputs, outcome, actor, and timestamp. Never modify
an existing event; append a correction event if needed."

**Related skills.** `compliance-gate`, `policy-engine`, `risk-scoring`, `transaction-monitoring`.
