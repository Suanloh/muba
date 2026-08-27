# AI Skills

> Theme file extracted from the Reusable Skill Pack. These skills cover turning
> unstructured input into structured, machine-actionable data and designing safe,
> deterministic AI agent workflows.

## 1.1 `financial-intent-parsing`

**Short description.** Turning unstructured natural language into structured, machine-actionable financial instructions.

**When to use.** Any feature where a user describes a financial action in words and the
system must produce a deterministic plan (payments, transfers, trade orders, invoices,
approvals). Also when a human operator types intent in a chat/command box.

**Why it exists / problem solved.** Natural language is ambiguous ("pay Alice RM2,500 by
Friday") while execution engines need exact fields (amount, asset, recipient, deadline,
network). Intent parsing bridges the two without hard-coding every sentence shape.

**Core concepts.** Intent schema; slot filling; entity extraction (amount, currency,
counterparty, date, action); normalization of units and ISO codes; fuzzy date resolution;
disambiguation questions; confidence scoring; partial intents that require clarification.

**Architecture / pattern.**
- Define a single canonical intent schema (action + required/optional fields).
- LLM extracts entities and maps them to the schema via **structured output**, never free text.
- A deterministic validator rejects impossible values (negative amounts, unknown assets).
- Missing required fields trigger a clarifying question; never guess silently.

**Implementation guidance.**
- Keep the schema small and closed — enumerations for actions and asset types.
- Parse amounts into smallest-unit integers (cents, base units) deterministically.
- Resolve "by Friday" to an actual timestamp in server code, not in the LLM.
- Store the original text alongside the parsed intent for auditability.

**Common failure modes.** LLM invents amounts or defaults for missing fields; timezone
bugs in date resolution; silent currency mismatches (USD vs USDT); accepting ambiguous
counterparty names without re-confirmation.

**Security/compliance considerations.** Never let parsed output skip validation; the parser
is a suggestion engine, the validator is the authority. Log raw text → parsed intent → source.

**Example AI-agent instruction.** "Parse this instruction into the `Intent` schema. Return
only valid JSON. If any required field is missing or ambiguous, return `needsClarification`
with a precise question. Do not invent amounts, assets, or recipients."

**Related skills.** `structured-llm-output`, `ai-deterministic-boundary`, `policy-engine`.

---

## 1.2 `agentic-workflow-design`

**Short description.** Designing multi-step AI agent workflows with clear hand-offs between reasoning, validation, and execution.

**When to use.** When building features where an LLM proposes but must not directly execute:
planners, orchestrators, routers, multi-hop financial flows, human-in-the-loop approvals.

**Why it exists / problem solved.** A single LLM call is not trustworthy enough for
financial actions. A workflow decomposes the problem into reasoning steps separated from
deterministic gates, making each step testable and auditable.

**Core concepts.** Agent loop; tool/function calling; planner vs executor; state machine;
checkpoints; approval gates; retries with bounded attempts; idempotency; cancellation.

**Architecture / pattern.**
- **Plan → Validate → Enforce → Approve → Execute → Audit.** Each stage is a separate,
  deterministic component; the LLM is confined to the first one or two stages.
- Agents emit *proposals* (data), not side effects. Code performs side effects.
- Every destructive step is preceded by an explicit approval checkpoint.

**Implementation guidance.**
- Give the agent a strict tool contract: inputs, outputs, error semantics.
- Cap the number of tool calls and total tokens per workflow.
- Make each step re-runnable and idempotent (same input → same proposal).
- Persist the full trace of every step.

**Common failure modes.** LLM calling execution tools directly; unbounded loops; silent
retries that double-spend; no checkpoint so a mid-flow failure corrupts state; mixing
reasoning and execution in one untestable blob.

**Security/compliance considerations.** LLM output is untrusted input. The executor must
validate every parameter it receives. Keep an approval gate for anything that moves value.

**Example AI-agent instruction.** "Implement the planner as a pure function that takes a
validated intent and returns a list of candidate routes. Do not call any execution or
approval code from inside the LLM reasoning step."

**Related skills.** `financial-intent-parsing`, `structured-llm-output`, `ai-deterministic-boundary`, `fintech-system-architecture`.

---

## 1.3 `structured-llm-output`

**Short description.** Forcing LLMs to return typed, schema-validated JSON instead of free text.

**When to use.** Anywhere the LLM feeds a downstream system: intent parsing, classification,
risk explanation, extraction, summarization of structured records.

**Why it exists / problem solved.** Free-text output is unparsable and unvalidatable.
Structured output guarantees the downstream code can consume results without fragile string parsing.

**Core concepts.** JSON Schema; function/tool calling; typed responses; strict mode;
validation and retry-on-invalid; enum fields; required vs optional; refusal signals.

**Architecture / pattern.**
- Declare a JSON Schema (or typed function signature) as the contract.
- Validate every response with a real schema validator before use.
- On validation failure, retry once with the error message fed back; then fail loudly.

**Implementation guidance.**
- Prefer enumerations over free strings for any closed set (action, asset, status).
- Use numeric values (smallest units) for money, never floats or formatted strings.
- Include an explicit `confidence` or `needsClarification` field where relevant.
- Keep schemas flat and shallow; deep nesting increases failure rate.

**Common failure modes.** Assuming "it looked valid" without schema validation; accepting
extra/missing keys; LLM returning money as "RM2,500" string; silent schema drift between prompt and validator.

**Security/compliance considerations.** Never trust an LLM value; always re-validate and
re-compute money, routes, and risk scores in deterministic code.

**Example AI-agent instruction.** "Return the result as JSON matching this schema. If you
cannot satisfy a required field, return `{ "error": "<reason>" }`. Do not add fields outside the schema."

**Related skills.** `financial-intent-parsing`, `agentic-workflow-design`, `risk-scoring`.
