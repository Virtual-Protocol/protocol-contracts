# Phase 4 Gates

## Phase 4 Gates

---

### Gate 1 — Pre-Depth: ALL required agents spawned?

**Status: YES**

| Agent ID | Domain | Status |
|---------|--------|--------|
| B1 Token-Flow | Token flow, unsolicited transfers, exit paths, side effects | COMPLETE |
| B2 Access-Control | Semi-trusted roles, EXECUTOR/ADMIN/Owner abuse vectors | COMPLETE |
| B3 Migration | Version compatibility, storage layout, stranded assets | COMPLETE |
| B4 Temporal-Economic | Parameter staleness, economic invariants, fee math | COMPLETE |
| B5 Storage-Events | Storage layout safety, event correctness, silent setters | COMPLETE |
| B6 External-Precond | External call preconditions, return value validation, state dependencies | COMPLETE |

All 6 breadth agents have produced analysis files. Inventory agent (current) has processed all 6.

---

### Gate 2 — Findings coverage: Any uncovered in-scope files?

**Status: 1 uncovered file**

| File | Coverage Status | Risk Level |
|------|-----------------|------------|
| multicall3.sol | PARTIAL (static analysis grep only; no dedicated breadth analysis) | HIGH |

**Detail**: `multicall3.sol` (529 lines, in-scope) was noted in static_analysis.md but no breadth agent performed systematic security analysis. The file contains:
- Inline assembly in `aggregate3()` and `aggregate3Value()`
- External calls in a loop with ETH value forwarding (`aggregate3Value()` L255)
- `withdrawEth()` function at L520 — ETH transfer with no apparent reentrancy guard

**Required depth action**: Add `multicall3.sol` systematic analysis as a depth candidate. Priority: HIGH.

---

### Gate 3 — Side effects: Any unresolved UNKNOWN side effects?

**Status: 3 unresolved UNKNOWN side effects**

| # | External Call | Finding | Status |
|---|--------------|---------|--------|
| 1 | `IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)` at graduation (BondingV5:746) | TF-8, SE-1 | UNKNOWN — production AgentToken self-receipt behavior unverified. Mock tests have no transfer hooks. Whether BondingV5 is whitelisted in production AgentToken unknown. |
| 2 | `IFPairV2(pair).transferTo(buyer, amountOut)` — AgentToken delivery to buyer during buy() | TF-3 | UNKNOWN — production AgentToken transfer tax on non-whitelisted pairs; mock has no tax |
| 3 | `IERC20(veToken).balanceOf(founder)` and drainUniV2Pool operations | EP-7, EP-11 | UNKNOWN — production veToken may have transfer locks, maturity periods, or non-standard balance reporting |

**Required depth action**: All 3 UNKNOWN side effects require production contract analysis. EP-10 and TF-3 share the same root cause (AgentToken transfer tax) — these should be resolved together by examining the production AgentToken.sol implementation.

---

### Gate 4 — CONTESTED count: N contested findings for priority depth treatment

**Status: 4 CONTESTED findings**

| Finding ID | Domain | Contest Reason | Depth Priority |
|-----------|--------|----------------|----------------|
| TF-8 | Token Flow | Production AgentToken may reject or transform self-receipt at graduation (BondingV5:746); mock tests do not reveal this behavior | CRITICAL |
| TF-3 | Token Flow | Production AgentToken transfer tax causes reserve divergence and graduation mismatch; overlaps EP-10 | CRITICAL |
| EP-10 | External Precond | Transfer tax at graduation reduces actual tokens received; factory is told pre-tax lpSupply | CRITICAL |
| EP-11 | External Precond | veToken interface spoofing — mitigated by EXECUTOR_ROLE trust but only if EXECUTOR is not compromised | HIGH |

**Aggregate**: 4 contested findings. TF-8, TF-3, and EP-10 are effectively one finding chain (AgentToken production behavior) that must be resolved together.

---

### Summary Metrics

| Metric | Value |
|--------|-------|
| Total findings | 75 (including info/safe confirmations) |
| Security-relevant findings (excluding purely informational safe confirmations) | 62 |
| Critical | 3 (AC-1, EP-8, EP-10) |
| High (original, pre-assumption adjustment) | 16 (AC-2, AC-3, AC-4, AC-5, EC-1, EC-2, EC-3, EC-4, EP-1, EP-2, EP-3, EP-5, EP-7, EP-14, TE-1, TE-4, TF-3, EVT-8, EVT-9) |
| High (adjusted for trust assumptions, UNTRUSTED/SEMI_TRUSTED actors only) | 9 (AC-1, AC-2, AC-5, AC-8, EP-1, EP-2, EP-3, EP-5, EP-7, EP-8, EP-14, TE-4, TF-3) |
| Medium | ~22 |
| Low | ~14 |
| Info/Safe | ~16 |
| REFUTED | 2 (MG-5, MG-7) |
| CONTESTED | 4 |
| ELEVATE signals processed | 5 |
| Uncovered in-scope files | 1 (multicall3.sol) |
| Unresolved UNKNOWN side effects | 3 |
| Chain-escalated findings | 8 Low findings CHAIN_ESCALATED to Medium+ |
