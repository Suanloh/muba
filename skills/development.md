# Development Skills

> Theme file extracted from the Reusable Skill Pack. These skills govern how a coding
> agent should work on an existing codebase.

## 6.1 `ai-assisted-existing-codebase`

**Short description.** Working with a coding agent on an existing codebase: inspect first, reuse, extend — avoid rewrites and duplicate functionality.

**When to use.** Any coding task on an existing project (the default, not the exception).

**Why it exists / problem solved.** Agents that don't read first tend to invent parallel
implementations and break existing architecture. This skill keeps changes minimal and consistent.

**Core concepts.** Inspect before changing; identify existing features; reuse existing
implementations; extend partially implemented features; preserve architecture; one feature
at a time; test after changes; avoid unnecessary rewrites.

**Architecture / pattern.**
- Read the relevant files and conventions before editing.
- Find the existing pattern (service, hook, component) and follow it.
- Make the smallest change that satisfies the requirement; verify with tests/build.

**Implementation guidance.**
- Search for existing similar code before writing new code.
- Extend a partially implemented feature rather than creating a parallel one.
- Implement one feature at a time and validate after each change.
- Match the codebase's naming, folder, and type conventions.

**Common failure modes.** Rewriting working code "for cleanliness"; adding a duplicate
service that shadows an existing one; ignoring existing tests; making many unrelated changes at once.

**Security/compliance considerations.** Preserve existing trust boundaries and gates — do not
add a bypass or an unlogged execution path while "refactoring".

**Example AI-agent instruction.** "Before writing code, find the existing implementation of
this concern and reuse it. Extend it with the smallest change needed. Run the relevant
checks afterward. Do not rewrite unrelated code."

**Related skills.** `fintech-system-architecture`, `audit-trail`.
