# Fintech Skills

> Theme file extracted from the Reusable Skill Pack. These skills cover treasury and
> portfolio management of digital assets, plus the financial risk of proposed transactions.

## 3.1 `digital-asset-treasury`

**Short description.** Architecture of a treasury wallet system holding digital assets, with custody tiers, allocation, and controlled disbursement.

**When to use.** Building treasury management, operating wallets, fund custody, or any
system holding assets on behalf of an organization.

**Why it exists / problem solved.** Treasuries concentrate risk: a single exposed hot
wallet can drain everything. Segregation, exposure limits, and approval flows contain that risk.

**Core concepts.** Hot/warm/cold wallet tiers; operating vs custody vs reserve accounts;
sweeping to cold storage; multi-signature policies; treasury exposure limits; rebalancing;
funding flows (top-up and disbursement).

**Architecture / pattern.**
- Tiered wallets: hot (small, automated) → warm (approval-gated) → cold (manual, offline).
- Disbursements originate from a proposal and pass policy/approval before touching the hot wallet.
- A treasury ledger tracks every account balance and movement.

**Implementation guidance.**
- Model accounts and balances explicitly; never assume a wallet's balance from memory.
- Sweep excess from hot wallets to warm/cold on a schedule or threshold.
- Keep a single source of truth for "available to spend" vs "total held".

**Common failure modes.** Everything in one hot wallet; no sweep; manual key handling;
ignoring that "available" excludes reserved/frozen amounts; treating exchange balances as treasury balances.

**Security/compliance considerations.** Custody segregation is a compliance control as much
as a security one. Enforce exposure limits and dual control for large movements.

**Example AI-agent instruction.** "Model the treasury as accounts with tier and balance.
A disbursement may only draw from the operating account and must reduce the ledger balance
only after the policy and approval gates pass."

**Related skills.** `portfolio-monitoring`, `transaction-risk`, `compliance-gate`, `policy-engine`.

---

## 3.2 `portfolio-monitoring`

**Short description.** Tracking a portfolio of digital assets — valuation, allocation, concentration, volatility, liquidity, and rebalancing triggers.

**When to use.** Dashboards and alerting over holdings, or any risk decision that depends
on portfolio state (concentration, exposure).

**Why it exists / problem solved.** A portfolio can drift into dangerous concentration or
illiquidity. Monitoring makes that drift visible and actionable instead of discovered after a loss.

**Core concepts.** Mark-to-market valuation; price oracles; asset allocation; concentration
ratio; volatility; liquidity depth; exposure by asset and counterparty; rebalancing bands.

**Architecture / pattern.**
- Ingest prices from a source with timestamps; store snapshots for history.
- Compute metrics deterministically on snapshots (allocation %, concentration, volatility, liquidity).
- Emit threshold events consumed by risk and alerting layers.

**Implementation guidance.**
- Never compute valuation inline from live calls; cache a price snapshot and re-evaluate.
- Define explicit rebalancing bands (e.g. drift > X% triggers review).
- Use consistent quote currency across all assets.

**Common failure modes.** Using a single price source without staleness checks; mixing
quote currencies; double-counting across accounts; ignoring liquidity when valuing size.

**Security/compliance considerations.** Portfolio metrics feed risk decisions, so they must
be explainable and reproducible from stored snapshots, not ephemeral calls.

**Example AI-agent instruction.** "Compute allocation and concentration from the latest
price snapshot. Flag any asset above the concentration threshold. Return the metrics with
the snapshot timestamp so results are reproducible."

**Related skills.** `digital-asset-treasury`, `transaction-risk`, `risk-scoring`.

---

## 3.3 `transaction-risk`

**Short description.** Assessing the financial risk of a proposed transaction (size, exposure, liquidity, volatility) before execution.

**When to use.** Pre-execution checks on payments, transfers, swaps, and treasury moves.

**Why it exists / problem solved.** Even a well-formed transaction can be financially
dangerous (too large, too concentrated, too illiquid). This skill scores the *economic*
risk, distinct from compliance risk.

**Core concepts.** Risk signals (amount vs limits, concentration, counterparty exposure,
volatility, liquidity, velocity); weighted scoring; risk classification; threshold escalation.

**Architecture / pattern.**
- A pipeline of pure risk rules; each rule returns a signal + score.
- Combine signals into a total score → LOW / MEDIUM / HIGH / CRITICAL.
- Feed the score into the policy engine, which decides allow/review/block.

**Implementation guidance.**
- Keep rules deterministic and unit-testable; no LLM in the scoring path.
- Make each signal explainable: `score = reason + value + threshold`.
- Log every signal that contributed to the final classification.

**Common failure modes.** A single rule dominating; hiding reasons behind a black-box
score; inconsistent thresholds across rules; skipping the "why" that auditors need.

**Security/compliance considerations.** Risk scoring supports (but does not replace) the
policy decision. The score must be recorded in the audit trail with its inputs.

**Example AI-agent instruction.** "Implement transaction risk as deterministic rules. For a
given proposal, return each signal, its weight, and the final classification with a
human-readable explanation. Do not use the LLM to assign the final risk class."

**Related skills.** `risk-scoring`, `policy-engine`, `portfolio-monitoring`, `compliance-gate`.
