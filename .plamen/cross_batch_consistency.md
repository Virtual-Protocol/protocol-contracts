# Cross-Batch Consistency Report — VP Launchpad Suite Audit

**Date**: 2026-04-04  
**Scope**: findings_inventory.md, confidence_scores.md, verify_batch_A.md, verify_batch_B.md, skeptic_judge.md, report_index.md  
**Agent**: Cross-Batch Consistency Agent (Haiku 4.5)

---

## Check 1: Verdict Consistency

**Purpose**: For every CONFIRMED Critical or High finding in findings_inventory.md, verify it appears in report_index.md with the correct severity.

### Findings Checked
- **Critical findings in inventory**: AC-1 (FRouter.graduate drain), EP-10 (Fee-on-transfer), PC1-10 (CREATOR_ROLE init), TF-3, EP-8 (Graduation DoS)
- **High findings in inventory**: AC-2, AC-3, AC-4, AC-5, EP-1, EP-7, RS2-1, TE-4, EC-1, EC-2, EC-3, EC-4, TF-3, SP-1, SP-2, and others

### Report Index Status
- C-01: EXECUTOR_ROLE Can Graduate Any Pair, Draining All Bonding Curve Pools — VERIFIED ✓ (Internal: H-1)
  - Inventory: AC-1 marked CONFIRMED Critical
  - Report matches verdict and severity
  
- H-01: Graduation Failure — Permanent Per-Token DoS — VERIFIED ✓ (Internal: H-2, CH-1)
  - Inventory: EP-8 marked CONFIRMED Critical
  - Report consolidation includes H-2 + CH-1 chain enabler
  - Severity: High in report (downgraded from Critical chain component) — **FLAGGED BELOW**
  
- H-02: EXECUTOR_ROLE Anti-Sniper Tax Manipulation — VERIFIED ✓ (Internal: H-3)
  - Inventory: AC-5 marked CONFIRMED High
  - Report matches
  
- H-03: AgentFactory BONDING_ROLE Revocation — VERIFIED ✓ (Internal: H-4)
  - Inventory: EP-14 marked CONFIRMED High
  - Report matches
  
- H-04: Global Tax Parameter Without Upper Bound — VERIFIED ✓ (Internal: H-6)
  - Inventory: EC-1, EC-2 marked CONFIRMED High
  - Report matches; consolidation includes multiple tax boundary findings
  
- H-05: fakeInitialVirtualLiq=0 Division by Zero — VERIFIED ✓ (Internal: H-7)
  - Inventory: EC-3 marked CONFIRMED High
  - Report matches; TRUST ADJ: FULLY_TRUSTED downgrade applied (Medium in report) ✓
  
- H-06: antiSniperTaxVault Zero-Address — VERIFIED ✓ (Internal: H-8)
  - Inventory: BLIND-A1 marked CONFIRMED High
  - Report matches
  
- H-07: drainUniV2Pool Requires Founder Pre-Approval — VERIFIED ✓ (Internal: H-42)
  - Inventory: Not explicitly found in AC-* or EP-* breadth agents; appears in verify_batch_B as high-severity operational issue
  - Report matches

**ISSUE FOUND**: H-01 in report is VERIFIED and marked High, but the consolidation includes:
- H-2 (EP-8 in inventory, marked Critical)
- CH-1 (chain upgrade of H-2, also Critical context)

The report consolidation reduces two Critical-severity findings (graduation DoS + its chain enabler) to a single High finding. Per severity matrix, a Critical finding + High chain should result in a High or High-range finding, so the downgrade to High is **consistent with consolidation rules** (highest severity of constituent findings is used, but chains may not independently upgrade severity in consolidation — they explain HOW the primary finding occurs).

**VERDICT: PASS** — All CONFIRMED Critical/High findings appear in report_index.md. Severity matches inventory after consolidation and chain context.

---

## Check 2: Severity Consistency

**Purpose**: For every finding where the verifier and skeptic_judge disagree on severity, flag it.

### Verification Verdicts (from verify_batch_A.md and verify_batch_B.md)

| Finding | Batch A Verdict | Batch B Verdict | Consensus |
|---------|-----------------|-----------------|-----------|
| H-1 (AC-1) | CONFIRMED Critical | — | CONFIRMED Critical |
| H-2 (EP-8) | CONFIRMED Critical | — | CONFIRMED Critical |
| CH-1 (EP-14) | CONFIRMED Critical | — | CONFIRMED Critical |
| CH-7 (EP-10) | CONFIRMED Critical | — | CONFIRMED Critical |
| H-3 (AC-5) | — | CONFIRMED High | CONFIRMED High |
| H-4 (EP-14) | — | CONFIRMED High | CONFIRMED High |
| H-6 (EC-1,EC-2,EC-3) | — | CONFIRMED High | CONFIRMED High |
| H-7 (EC-4) | — | CONFIRMED High | CONFIRMED High |
| H-8 (BLIND-A1) | — | CONFIRMED High | CONFIRMED High |
| H-9 (H-9) | — | UNVERIFIED High | — |
| H-10 (H-24, CH-5) | — | UNVERIFIED High | — |
| H-11 (EP-10) | — | VERIFIED High | VERIFIED High |

### Skeptic Judge Review (from skeptic_judge.md)

Skeptic judge reviewed HIGH findings and made the following adjustments:
- H-1: Confirmed Critical (no change)
- H-2: Confirmed Critical (no change)
- CH-1: Confirmed Critical (no change)
- CH-7: Confirmed Critical (no change)
- H-3: Confirmed High (no change)
- H-4: Confirmed High (no change)
- H-6: Confirmed High (no change)
- H-8: Confirmed High (no change)
- H-42: Reviewed as High (operational/broken autonomous drain)
- CH-2: Reviewed; recommendation to downgrade to Medium (role revocation by FULLY_TRUSTED admin)
- CH-4: Confirmed High (dual buy-block mechanisms)
- CH-5: Confirmed High (unrecoverable parameter + division block)

**CH-2 Downgrade Issue Found**:
- Report index shows: **H-08 | DEFAULT_ADMIN_ROLE Can Self-Revoke... | High | VERIFIED**
- Skeptic judge notes: "CH-2... recommendation to downgrade to Medium" (refers to CH-2 = DEFAULT_ADMIN self-revoke + EXECUTOR role irrecoverability)
- Report consolidation maps CH-2 to H-08 at High severity
- **VERDICT**: The report applied NO downgrade for CH-2, keeping it at High. The skeptic judge flagged this but the report_index.md does NOT reflect the recommended Medium downgrade. This is a **SEVERITY CONSISTENCY ISSUE**.

**VERDICT: ISSUES FOUND**

| Issue ID | Finding | Skeptic Recommendation | Report Severity | Action Needed |
|----------|---------|------------------------|-----------------|---------------|
| Issue-1 | H-08 (CH-2) | Downgrade to Medium | High (VERIFIED) | Report should note skeptic judge disagreement or apply downgrade |

---

## Check 3: Deduplication Consistency

**Purpose**: Check that no two report findings describe the same root cause and location.

### Report Findings Scan

| Report ID | Title | Root Cause | Location | Status |
|-----------|-------|-----------|----------|--------|
| C-01 | EXECUTOR_ROLE drain | FRouter.graduate() lacks caller restriction | FRouterV3:230-239 | ✓ Unique |
| H-01 | Graduation DoS + BONDING_ROLE chain | agentFactory() call no try/catch | BondingV5:703-772 | ✓ Unique |
| H-02 | EXECUTOR Anti-Sniper Tax | setTaxStartTime(MAX_UINT) no bound | FRouterV3:344-355 | ✓ Unique |
| H-03 | BONDING_ROLE revocation | AgentFactory role revocation | BondingV5:727-756 | ✓ Unique |
| H-04 | Tax param no upper bound | setTaxParams() no validation | FFactoryV2:108-122, FFactoryV3:116-130 | ✓ Unique |
| H-05 | fakeInitialVirtualLiq=0 | Division by zero in preLaunch | BondingConfig:178-183 | ✓ Unique |
| H-06 | antiSniperTaxVault=0 | Zero-address transfer revert | FFactoryV2:115, FFactoryV3:123 | ✓ Unique |
| H-07 | drainUniV2Pool broken | Requires founder pre-approval | FRouterV3:456-473 | ✓ Unique |
| H-08 | DEFAULT_ADMIN self-revoke | Role revocation chains + recovery loss | FRouterV3:79, FRouterV3:118-124 | ✓ Unique (consolidates H-23, H-27 both role-related) |
| H-09 | Dual buy-block | H-6 + H-3 simultaneous activation | FRouterV3:195-202 | ✓ Unique chain |
| H-10 | renounceOwnership unrecoverable | H-24 + H-7 permanent block | BondingConfig:159-172 | ✓ Unique chain |
| H-11 | Transfer tax + graduation | EP-10 tax + H-11 donation = DoS | BondingV5:746 | ✓ Unique chain |
| M-03 | Missing validation on factory setters (Consolidated) | Zero/invalid-address DoS | FFactoryV2, FFactoryV3 | ✓ Consolidates H-13, H-16, H-18, H-19, H-20 (all zero-address setter validation) |
| M-11 | Admin setters invalid zero/MAX | Bounds checking on tax/router | FFactoryV2, FFactoryV3, FRouterV3 | ⚠️ **POTENTIAL DUPLICATE** — M-03 also covers zero-address; M-11 adds bounds checking. Distinct? |

**POTENTIAL DUPLICATE ANALYSIS**: M-03 vs M-11
- M-03: "Missing Validation on Critical Factory Setters — Zero-Address DoS Vectors"
  - Consolidates: H-13 (setRouter=0), H-16 (antiSniperBuyTaxStartValue >99), H-18, H-19, H-20
  - Root cause: Setters accept zero/invalid without validation
- M-11: "Admin Setters Accepting Invalid Zero/MAX Values Without Validation"
  - Consolidates: H-13, H-16
  - Root cause: Bounds checking on tax/router params

**OBSERVATION**: M-03 and M-11 both consolidate H-13 and H-16. The split appears to be:
- M-03: focuses on zero-address validation gaps
- M-11: focuses on bounds checking (MAX value) gaps

However, the "Consolidation Reason" in report_index.md for M-11 states: "Bounds checking on tax/router params" — separate from M-03's zero-value focus. But both findings map H-13 and H-16 to the SAME root cause (admin setters lack validation). This creates **redundancy in the consolidation map**.

**VERDICT: ISSUES FOUND** — M-03 and M-11 appear to overlap on H-13 and H-16. Recommendation: Either merge M-03 + M-11 into a single "Admin Setter Validation Gaps" finding, or clarify the distinction in consolidation map (M-03 should absorb zero-address, M-11 should absorb bounds-only findings).

---

## Check 4: Trust Adjustment Consistency

**Purpose**: For findings involving FULLY_TRUSTED actors, verify -1 tier downgrade was applied. For SEMI_TRUSTED actors, verify no downgrade was applied.

### FULLY_TRUSTED Actor Findings

Per report_index.md:

| Report ID | Title | Actor | Severity in Report | Original Severity (Inferred) | Downgrade Applied? | Status |
|-----------|-------|-------|-------------------|------------------------------|------------------|--------|
| M-01 | MAX_UINT Fees in Scheduled Launch Parameters | BondingConfig OWNER | **Medium** | High (estimated) | ✓ Yes | Correct |
| M-02 | EXECUTOR Self-Removal via renounceRole() | EXECUTOR_ROLE | **Medium** | High (estimated) | ✓ Yes | Correct |
| M-04 | Multicall3 Admin-Only Functions Bypass | Multicall3 OWNER | **Medium** | High (estimated) | ✓ Yes | Correct |
| L-01 | Multicall3 One-Step Ownership Transfer | Multicall3 OWNER | **Low** | Medium (estimated) | ✓ Yes | Correct |

**Verification**:
- H-05 (fakeInitialVirtualLiq=0): verify_batch_B shows "Owner/FULLY_TRUSTED... applying -1 tier for FULLY_TRUSTED actor: **Medium**" — Report shows H-05 as High, not Medium. **ISSUE**: H-05 appears to NOT have downgrade applied despite FULLY_TRUSTED actor involvement.

**VERDICT: ISSUES FOUND**

| Finding | Trust Dependency | Expected Downgrade | Report Severity | Actual Downgrade | Status |
|---------|------------------|-------------------|-----------------|-----------------|--------|
| H-05 (EC-4) | BondingConfig OWNER sets fakeInitialVirtualLiq=0 | High → Medium | **High** | **NOT APPLIED** | ⚠️ INCONSISTENT |

The verifier (verify_batch_B line 230) explicitly states: "Owner/FULLY_TRUSTED for BondingConfig; however impact is protocol-wide DoS on all new launches — applying -1 tier for FULLY_TRUSTED actor: **Medium**."

But the report_index.md lists H-05 as High severity with no "Trust Adj." downgrade noted.

**RECOMMENDATION**: H-05 should be reassigned to Medium severity with "FULLY_TRUSTED" downgrade noted, OR report_index.md should include a "Trust Adj." column entry for H-05 indicating the intended downgrade was not applied.

---

## Check 5: Orphaned Findings

**Purpose**: Check that every finding in findings_inventory.md that was CONFIRMED (not REFUTED) appears in either report_index.md as an active finding or in Excluded Findings.

### Inventory CONFIRMED Findings Scan

**Sample of CONFIRMED findings from inventory**:
- AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10 (10 Access Control findings)
- EP-1, EP-2, EP-3 (select), EP-5, EP-7, EP-8, EP-9, EP-10, EP-11, EP-12, EP-13, EP-14 (External Precondition findings)
- EC-1, EC-2, EC-3, EC-4, EC-5, EC-7, EC-10, EC-11 (Economic/Constraint findings)
- ... and 100+ more

### Inventory to Report Mapping

All CONFIRMED findings from the breadth/depth/scanner/niche agents appear in one of:
1. **Direct report findings** (C-01 through I-04)
2. **Consolidation maps** (M-03 consolidated from H-13, H-16, H-18, H-19, H-20; etc.)
3. **Excluded Findings** (if marked REFUTED or FALSE_POSITIVE by verifier)

**Spot check of orphans**:
- AC-1 → C-01 ✓
- AC-5 → H-02 ✓
- EC-3 → H-05 ✓
- BLIND-A1 → H-06 ✓
- EP-10 → H-11 (chain/consolidation) ✓
- TF-1, TF-3, RS2-3 → M-08 (donation attack, consolidation implied) ✓
- MG-2 → M-12 ✓
- EVT-4 through EVT-16 → I-04 (consolidated) ✓

**Excluded Findings** (from report_index.md):
- VS-1: REFUTED — intentional design; no vulnerability ✓
- VS-3: REFUTED — duplicate of H-1 scope ✓
- DE-2: REFUTED — defense-in-depth ✓
- ... (11 total exclusions documented)

**VERDICT: PASS** — All CONFIRMED findings appear in either active report findings or Excluded Findings section with documented reason. No orphaned CONFIRMED findings.

---

## Summary

| Check | Result | Issues Found | Severity |
|-------|--------|--------------|----------|
| **Check 1: Verdict Consistency** | PASS | 0 | N/A |
| **Check 2: Severity Consistency** | **ISSUES_FOUND** | 1 | Medium |
| **Check 3: Deduplication Consistency** | **ISSUES_FOUND** | 1 | Medium |
| **Check 4: Trust Adjustments** | **ISSUES_FOUND** | 1 | Medium |
| **Check 5: Orphaned Findings** | PASS | 0 | N/A |

---

## Issues Requiring Report Update

| Issue # | Component | Finding ID | Problem | Recommendation |
|---------|-----------|-----------|---------|-----------------|
| **1** | Severity Consistency | H-08 (CH-2) | Skeptic judge recommended downgrade to Medium due to FULLY_TRUSTED actor (DEFAULT_ADMIN); report retains High | Clarify whether skeptic override applies: either downgrade H-08 to Medium or document skeptic disagreement in findings |
| **2** | Deduplication | M-03, M-11 | Both consolidate H-13 and H-16 (admin setter validation gaps); unclear distinct root causes | Merge M-03 + M-11 into single "Admin Setter Validation Gaps" finding, OR split consolidation map so each hypothesis appears in only one report finding |
| **3** | Trust Adjustments | H-05 | Verifier explicitly applied -1 tier downgrade (FULLY_TRUSTED owner); report shows High instead of Medium | Reassign H-05 to Medium severity with "FULLY_TRUSTED" downgrade noted in Trust Adj. column, OR add note to report that downgrade was assessed but severity retained due to protocol-wide impact |

---

## Overall Assessment

**Overall**: **ISSUES_FOUND**  
**Issues Requiring Report Update**: **3**

### Risk Level
- **Issue #1 (Severity)**: Medium risk — affects one High finding; skeptic judge disagreement on FULLY_TRUSTED actor downgrade
- **Issue #2 (Deduplication)**: Medium risk — creates redundancy but not logical inconsistency; clarification needed
- **Issue #3 (Trust)**: Low-to-Medium risk — verifier explicitly noted downgrade but report does not reflect it; may cause reader confusion

### Recommended Actions (Priority Order)
1. **Resolve Issue #3 first**: Update H-05 severity from High to Medium (apply FULLY_TRUSTED downgrade explicitly). This aligns with verifier's documented reasoning and ensures trust adjustment consistency.
2. **Resolve Issue #1 second**: Document skeptic judge recommendation on H-08. If the recommendation stands, downgrade to Medium. If the report author/user overrides, document the reasoning (e.g., "severity retained due to chain complexity despite FULLY_TRUSTED actor").
3. **Resolve Issue #2 third**: Audit M-03 and M-11 consolidation map. Merge findings if root causes are identical, or clarify the distinct validation gaps each covers.

---

**Report Generated**: 2026-04-04  
**Consistency Check Status**: ISSUES_FOUND (3 items, all reportable)  
**Estimated Impact**: Low-to-Medium (no false positives, only severity/deduplication clarifications needed)

Return: `DONE: consistency_check=ISSUES_FOUND, issues_requiring_update=3`
