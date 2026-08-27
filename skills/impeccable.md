# Impeccable Skills

> Theme file extracted from the Reusable Skill Pack. These skills cover writing and
> shipping code that is correct, clear, tested, and safe — "flawless" in the sense that
> defects are caught before they reach production, not after.

## 1.1 `impeccable-code-quality`

**Short description.** Writing code that is correct, clear, tested, and maintainable, with defects prevented at the source rather than found later.

**When to use.** Any task where code is written, changed, or reviewed — and especially before
marking a piece of work as complete. Load it for every non-trivial change, and always for
code that moves value or makes decisions.

**Why it exists / problem solved.** Correctness is the foundation of everything else. In
financial, blockchain, and compliance systems a single subtle defect (off-by-one, float
math, swallowed error, non-idempotent retry) can cause real loss. Flawless code is not
about cleverness — it is about making wrong code hard to write and easy to catch.

**Core concepts.** Correctness first; single responsibility; explicit invariants; defensive
boundary validation; deterministic behavior; idempotency; testability; readability; no dead
code; no magic values; review and static analysis as gates.

**Architecture / pattern.**
- Prefer small, pure, deterministic functions over large stateful ones.
- Validate at boundaries: every external input is untrusted until a validator says otherwise.
- Fail fast and loudly — never silently swallow an error or continue with bad state.
- Express the happy path and every error path explicitly; avoid implicit fall-through.
- Make changes locally reversible (idempotent, transactional) where side effects exist.

**Implementation guidance.**
- Write tests before or alongside the change, not after; cover happy path **and** failure paths.
- Use smallest-unit integers for money; never floating point.
- Give names that say what a thing is, not how it was built; delete commented-out code.
- Keep functions short enough to reason about; one function, one job.
- Encode invariants as assertions or explicit checks, not as comments that can drift.

**Common failure modes.** Testing only the happy path; swallowing or broadly catching errors;
off-by-one and boundary errors; using floats for currency; copy-paste duplication that drifts;
premature optimization that obscures intent; "works on my machine" assumptions about time,
timezone, locale, or environment.

**Security/compliance considerations.** No secrets or keys in code or logs. Validate all input
at trust boundaries. Deterministic, auditable money math. Every code path that moves value or
changes a decision must be traceable and reversible.

**Example AI-agent instruction.** "Make the change minimal and correct. Use integer math for
money, validate all inputs, and add tests for both success and failure paths before you finish.
Do not swallow errors, do not add dead code, and do not embed secrets or project-specific
constants."

**Related skills.** `ai-assisted-existing-codebase`, `fintech-system-architecture`,
`structured-llm-output`, `ai-deterministic-boundary`.

---

## 1.2 `flawless-delivery`

**Short description.** Releasing changes safely and completely: tests pass, reviews happen, gates hold, and a rollback path exists.

**When to use.** Whenever a change is about to be committed, merged, or deployed — and whenever
you are asked to "finish", "ship", or "close out" a task.

**Why it exists / problem solved.** Code that works locally can still fail in production
because a check was skipped, a gate was bypassed, or no one planned for failure. Delivery
discipline turns "it works on my machine" into "it works, and we can prove it and recover."

**Core concepts.** Definition of done; test and lint/type-check gates; code review; small
reversible changes; feature flags; canary or staged rollout; rollback plan; monitoring;
post-deploy verification; clean commit history.

**Architecture / pattern.**
- Every merge is gated: tests, lint/type checks, and review must pass — no exceptions.
- Ship small, single-purpose changes that are easy to review and easy to revert.
- Decouple release from deploy with feature flags; never big-bang a risky change.
- Instrument before you ship: logs and metrics that prove the change behaves in production.

**Implementation guidance.**
- Run the full relevant test suite, not just the one file you touched.
- Keep each change reviewable; if a diff is huge, split it.
- Write clear commit messages that explain *why*, not just *what*.
- Define the rollback before the rollout; verify the rollback works.
- After deploy, confirm the feature is live and healthy, then close the loop.

**Common failure modes.** Shipping without running the full suite; merging unreviewed or
self-approved code; no rollback path for a change that moves value; big-bang deploys that
mix unrelated changes; declaring done when tests were never written; skipping post-deploy
verification.

**Security/compliance considerations.** Never bypass a gate to "save time". Secrets move
through a secrets manager, never through code or chat. Value-moving or compliance-relevant
changes require explicit approval and a complete audit trail.

**Example AI-agent instruction.** "Before you consider the task done: run the full test and
lint/type-check suite, confirm the change is minimal and reviewable, and describe the rollback
path. Do not skip any gate and do not mark the task complete if any check fails."

**Related skills.** `impeccable-code-quality`, `audit-trail`, `ai-assisted-existing-codebase`,
`compliance-gate`.
