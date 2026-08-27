# Architecture Skills

> Theme file extracted from the Reusable Skill Pack. These skills define the top-level
> safety and layering of a financial system so AI and execution stay correctly separated.

## 5.1 `ai-deterministic-boundary`

**Short description.** Drawing a hard boundary so AI is never the final authority for financial or compliance decisions.

**When to use.** Any high-impact system where an LLM recommends actions — especially when it
could directly execute sensitive operations.

**Why it exists / problem solved.** LLMs hallucinate and cannot be held accountable for
money. The boundary ensures AI only interprets and recommends, while deterministic code
validates, enforces policy, and humans approve.

**Core concepts.** AI interpretation vs recommendation vs deterministic validation vs policy
enforcement vs human approval vs execution; trust boundaries; fail-closed design.

**Architecture / pattern.**

```
Natural language
   ↓ AI interpretation (suggestion only)
Intent parser → structured intent
   ↓ deterministic validation
Planner (proposes routes)
   ↓ deterministic risk + policy
Compliance / Risk layer
   ↓ deterministic policy engine
ALLOW / REVIEW / BLOCK
   ↓ human approval (value movement)
Blockchain execution
   ↓
Audit trail
```

- The LLM appears only in the top layers (interpretation, suggestions).
- Every figure (amount, route, risk score) is recomputed by code.
- A human always approves irreversible value movement.

**Implementation guidance.**
- Enumerate the exact functions the LLM may call; nothing else is callable.
- Treat LLM output as untrusted input and validate it like any external API.
- Add a physical code boundary: the AI module cannot import execution modules.

**Common failure modes.** LLM calling execution tools directly; LLM writing the risk score;
no human gate for value movement; validation that trusts the LLM's own claims.

**Security/compliance considerations.** This boundary is the core safety property. Violating
it is a compliance incident, not a style issue.

**Example AI-agent instruction.** "Ensure the AI module only produces structured proposals.
Execution and policy modules must not be importable from the AI module. Add a human approval
step for any value-moving action."

**Related skills.** `agentic-workflow-design`, `policy-engine`, `compliance-gate`, `fintech-system-architecture`.

---

## 5.2 `fintech-system-architecture`

**Short description.** Layered architecture for full-stack financial systems: frontend, backend, AI, blockchain, and compliance as separate layers.

**When to use.** Designing or extending a financial application end-to-end.

**Why it exists / problem solved.** Mixing UI, AI, value execution, and compliance into one
layer produces untestable, insecure systems. Clean layering makes each concern independently verifiable.

**Core concepts.** Layer separation; data modeling; API design; separation of frontend /
backend / AI / blockchain / compliance; single source of truth; shared types across layers.

**Architecture / pattern.**
- Frontend (Next.js/React, TypeScript, Tailwind) → API/backend (Node/Express or serverless)
  → AI layer (proposals) → compliance/risk → policy → execution → blockchain → audit DB.
- Shared TypeScript types package for contracts across layers.
- A relational store (PostgreSQL/Prisma) for business data; an event store for audit.

**Implementation guidance.**
- Model entities explicitly (intent, route, transaction, policy, audit event) with clear relations.
- Keep each layer deployable and testable in isolation.
- Pass validated typed objects across layers, never raw JSON strings.

**Common failure modes.** One monolithic layer doing everything; duplicated types drifting
between frontend and backend; business logic in UI components; audit data stored ad hoc.

**Security/compliance considerations.** Layer boundaries are also trust boundaries — value
execution lives in a layer the AI and UI cannot directly drive.

**Example AI-agent instruction.** "When adding a feature, identify which layer it belongs to
and keep the layer's responsibility. Add shared types rather than duplicating definitions.
Do not put business or execution logic in the UI."

**Related skills.** `ai-deterministic-boundary`, `ai-assisted-existing-codebase`, `audit-trail`.
