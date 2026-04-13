# Report Index — VP Launchpad Suite Audit

**Project**: VP Launchpad Suite (VirtualsProtocol Launchpad v2)  
**Date**: 2026-04-04  
**Auditor**: Automated Security Analysis (Claude Opus 4.6 + Sonnet 4.6 + Haiku 4.5)  
**Scope**: BondingV5, BondingV2/V3/V4, FPairV2, FRouterV2/V3, FFactoryV2/V3, BondingConfig, Multicall3  
**Language**: Solidity ^0.8.20 (Foundry)  
**Build Status**: SUCCESS (forge build with solc 0.8.26 via-ir)  
**Static Analysis**: UNAVAILABLE (Slither MCP timeout — fallback to manual verification)  

---

## Summary Counts

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 11 |
| Medium | 15 |
| Low | 11 |
| Informational | 4 |
| **TOTAL** | **42** |

---

## Master Finding Index

| Report ID | Title | Severity | Location | Verification | Trust Adj. | Internal Hypothesis | Agent Sources |
|-----------|-------|----------|----------|--------------|-----------|--------------------|--------------|
| C-01 | EXECUTOR_ROLE Can Graduate Any Pair, Draining All Bonding Curve Pools | Critical | FRouterV3:230-239 | VERIFIED | — | H-1 | AC-1, verify_batch_A |
| H-01 | Graduation Failure — Permanent Per-Token DoS With No Admin Recovery (+ CH-1 BONDING_ROLE Trigger) | High | BondingV5:703-772 | VERIFIED | — | H-2, CH-1 | EP-8, DE-3, DEPTH-ST-1, verify_batch_A |
| H-02 | EXECUTOR_ROLE Anti-Sniper Tax Manipulation — Permanent Buy Freeze | High | FRouterV3:344-355 | VERIFIED | — | H-3 | AC-5, DEPTH-ST-6, verify_batch_B |
| H-03 | AgentFactory BONDING_ROLE Revocation Triggers Systemic Graduation DoS | High | BondingV5:727-756 | VERIFIED | — | H-4 | EP-14, EP-14-R, verify_batch_B |
| H-04 | Global Tax Parameter Without Upper Bound — Admin-Settable DoS on Buy/Sell | High | FFactoryV2:108-122, FFactoryV3:116-130 | VERIFIED | — | H-6 | EC-1, EC-2, SP-1, SP-2, DA-TF-2, verify_batch_B |
| H-05 | fakeInitialVirtualLiq=0 / targetRealVirtual=0 — Division by Zero Blocks All New Launches | High | BondingConfig:178-183 | VERIFIED | — | H-7 | EC-3, verify_batch_B |
| H-06 | antiSniperTaxVault Zero-Address Bricks All Buys in Anti-Sniper Window | High | FFactoryV2:115, FFactoryV3:123 | VERIFIED | — | H-8 | BLIND-A1, verify_batch_B |
| H-07 | drainUniV2Pool Requires Founder Pre-Approval — Broken Autonomous Liquidity Drain | High | FRouterV3:456-473 | VERIFIED | — | H-42 | DE-1, verify_batch_B |
| H-08 | DEFAULT_ADMIN_ROLE Can Self-Revoke, Locking Role Management Permanently + EXECUTOR Irrecoverable | High | FRouterV3:79, FRouterV3:118-124 | VERIFIED | — | CH-2, H-23, H-27 | BLIND-C1, BLIND-C4, verify_batch_B |
| H-09 | Dual Buy-Block — Tax DoS + Permanent Anti-Sniper Freeze Simultaneously | High | FRouterV3:195-202 | UNVERIFIED | — | CH-4 | H-3, H-6 chain |
| H-10 | Renounceownership Makes Division-by-Zero Permanent — Unrecoverable Parameter Corruption | High | BondingConfig:159-172 | UNVERIFIED | — | CH-5, H-24 | BLIND-B2, BLIND-C2 |
| H-11 | Transfer Tax + Graduation Loop — Automatic Permanent DoS | High | BondingV5:746 | VERIFIED | — | CH-7, EP-10, H-11 | verify_batch_A |
| M-01 | MAX_UINT Fees in Scheduled Launch Parameters — Admin Misconfiguration DoS | Medium | BondingConfig:88-95 | UNVERIFIED | FULLY_TRUSTED | H-9 | BLIND-A2 |
| M-02 | EXECUTOR Self-Removal via renounceRole() — Permanent Trading Halt | Medium | FRouterV3:118-124 | UNVERIFIED | FULLY_TRUSTED | H-27 | BLIND-C4 |
| M-03 | Missing Validation on Critical Factory Setters — Zero-Address DoS Vectors (Consolidated) | Medium | FFactoryV2, FFactoryV3 | UNVERIFIED | — | H-13, H-16, H-18, H-19, H-20 | BLIND-A3, BLIND-A4, BLIND-A5 |
| M-04 | Multicall3 Admin-Only Functions Bypass Standard Access Control | Medium | Multicall3 | UNVERIFIED | FULLY_TRUSTED | H-17 | VS-6 |
| M-05 | cancelLaunch Missing State Update Before External Transfer (Reentrancy Risk) | Medium | BondingV5:556-575 | UNVERIFIED | — | H-10 | RS2-3, DEPTH-ST-2, SP-3, BLIND-B1 |
| M-06 | stale Reserve After drainPrivatePool Failed Sync | Medium | FRouterV3:385-423 | UNVERIFIED | — | H-12 | DA-EP12-1 |
| M-07 | FRouterV3._calculateAntiSniperTax() Reverts for Non-V5 Tokens — Silent Revert | Medium | FRouterV3:283-320 | UNVERIFIED | — | H-14 | DEPTH-ST-9, DE-5, BLIND-B3 |
| M-08 | Graduation Reads balanceOf — Donation Attack on Pool Ratio | Medium | BondingV5:720, FPairV2 | UNVERIFIED | — | H-11 | EP-5, TF-1, DEPTH-TF-3, DE-4, SP-4 |
| M-09 | Deprecated FRouterV2 Storage Slots Must Be Preserved for Upgrade Safety | Medium | FRouterV2 | UNVERIFIED | — | H-15 | DEPTH-ST-8, MG-2 |
| M-10 | teamTokenReservedWallet Race Condition Between preLaunch and launch | Medium | BondingV5:473-480 | UNVERIFIED | — | H-21 | SP-5, TE-1, MG-4, DEPTH-ST-7 |
| M-11 | Admin Setters Accepting Invalid Zero/MAX Values Without Validation (Consolidated) | Medium | FFactoryV2, FFactoryV3, FRouterV3 | UNVERIFIED | — | H-13, H-16 | DEPTH-ST-4 |
| M-12 | No __gap[] in Any Upgradeable Contract — Storage Layout Collision Risk | Medium | All upgradeable contracts | UNVERIFIED | — | H-49 | SLS-1 |
| M-13 | Graduation API Missing Core Recovery Functions — Failed State Permanently Unrecoverable | Medium | BondingV5:703-772 | UNVERIFIED | — | H-2 variant | Implicit in H-2 |
| M-14 | "Basis Points" Documentation vs. Percentage Implementation — Admin Misconfiguration Risk | Medium | FFactoryV2:27 | UNVERIFIED | — | CH-6, H-43 | SC-1 |
| M-15 | Anti-Sniper Window Inconsistency Between Versions — V2/V3 Parameter Mismatch | Medium | FRouterV2, FRouterV3 | UNVERIFIED | — | H-32 | SC-2, SC-3, SC-4, RS2-8 |
| L-01 | Multicall3 One-Step Ownership Transfer — No Revoke Path | Low | Multicall3 | UNVERIFIED | FULLY_TRUSTED | H-47 | BLIND-C3, PC1-3 |
| L-02 | Buy() Declared Payable — ETH Trapped in Bonding Contracts | Low | BondingV5 | UNVERIFIED | — | H-28 | CBS-1 |
| L-03 | FFactory createPair() Allows Duplicate Pair Overwrite | Low | FFactoryV2, FFactoryV3 | UNVERIFIED | — | H-48 | RS2-4 |
| L-04 | CREATOR_ROLE Not Initialized in FFactory — Role Grant Impossible | Low | FFactoryV2, FFactoryV3 | UNVERIFIED | — | H-25 | DEPTH-ST-3, PC1-10 |
| L-05 | cancelLaunch on BondingV2/V3/V4 Doesn't Set trading=false | Low | BondingV2, BondingV3, BondingV4 | UNVERIFIED | — | H-41 | DEPTH-ST-10, SC-5 |
| L-06 | addInitialLiquidity() Missing nonReentrant Guard | Low | FRouterV2, FRouterV3 | UNVERIFIED | — | H-26 | VS-4 |
| L-07 | batchTransferTokens() Admin Function Non-Functional | Low | FRouterV3 | UNVERIFIED | — | H-45 | VS-5 |
| L-08 | FRouterV3.sell() computes amountOut Before Transfer — Theoretical Inconsistency | Low | FRouterV3:157-161 | UNVERIFIED | — | H-40 | DA-TF-1 |
| L-09 | Upgraded BondingV2/V3/V4 Buy/Sell Always Revert — Dead Contracts | Low | BondingV2, BondingV3, BondingV4 | UNVERIFIED | — | H-29 | BLIND-C6 |
| L-10 | BondingV3/V4 preLaunch() Always Reverts — Dead API | Low | BondingV3, BondingV4 | UNVERIFIED | — | H-44 | BLIND-C7 |
| L-11 | BondingV5 setRouter(address(0)) DoS | Low | FRouterV3:340-343 | UNVERIFIED | — | H-13 | DEPTH-ST-4 |
| I-01 | FPairV2.priceALast() / priceBLast() Integer Division Returns Zero — Precision Loss | Informational | FPairV2:267-272 | UNVERIFIED | — | H-31 | DA-1, DA-2, DA-3 |
| I-02 | Graduated Event Missing AgentToken Index and Transfer Amounts | Informational | BondingV5:605 | UNVERIFIED | — | H-36 | EVT-12 |
| I-03 | Graduate() and addInitialLiquidity() Missing Event Emission — Observability Gap | Informational | FRouterV2, FRouterV3 | UNVERIFIED | — | H-30 | EVT-13, EVT-14 |
| I-04 | Missing Event Emission on Critical Admin State Changes (Consolidated) | Informational | FFactoryV2, FFactoryV3, BondingConfig, FRouterV3, BondingV5 | UNVERIFIED | — | H-33 | EVT-4 through EVT-11, EVT-16 |

---

## Tier Assignments

### Critical+High Tier (12 findings)
- C-01 (EXECUTOR drain)
- H-01 (Graduation DoS + CH-1 chain)
- H-02 (taxStartTime=MAX permanent tax)
- H-03 (BONDING_ROLE revocation)
- H-04 (Tax parameter no upper bound)
- H-05 (fakeInitialVirtualLiq=0 division)
- H-06 (antiSniperTaxVault=0)
- H-07 (drainUniV2Pool broken)
- H-08 (DEFAULT_ADMIN self-revoke)
- H-09 (Dual buy-block chain)
- H-10 (renounceOwnership unrecoverable)
- H-11 (Transfer tax graduation DoS)

### Medium Tier (15 findings)
- M-01 through M-15

### Low+Informational Tier (15 findings)
- L-01 through L-11
- I-01 through I-04

---

## Consolidation Map

| Report ID | Consolidated From | Root Cause | Consolidation Reason |
|-----------|------------------|-----------|----------------------|
| H-01 | H-2 + CH-1 | Graduation DoS activation paths | H-2 is the permanent DoS consequence; CH-1 is the BONDING_ROLE trigger for H-2. Both have identical fix (try/catch + recovery setter). Combined for single narrative. |
| H-08 | CH-2, H-23, H-27 | Role revocation chains | H-23 (DEFAULT_ADMIN self-revoke), H-27 (EXECUTOR self-removal), and CH-2 (their combination enabling irrecoverable EXECUTOR) all lead to role management lockout. Consolidated with focus on the chain vulnerability. |
| M-03 | H-13, H-16, H-18, H-19, H-20 | Admin setters accepting invalid values | All are zero-address or invalid-value DoS vectors in factory setters. Same fix class (add zero/MAX validation). Consolidated with affected locations table. |
| M-11 | H-13, H-16 | Missing upper bound on tax/router params | Both H-13 (setRouter=0) and H-16 (antiSniperBuyTaxStartValue sum not enforced) lack validation. Separate from M-03 (which is zero-value only) because they involve bounds checking vs. null checks. |
| I-04 | H-33, EVT-4–11, EVT-16 | Missing event emission | 23+ admin state-changing functions emit no events. Consolidated under "Silent Admin State Changes" with table of all affected locations and functions. |

---

## Cross-Reference Map (Chain Findings)

| Report ID | Chain Context | Details |
|-----------|---------------|---------|
| H-01 | Combines H-2 + H-4 (CH-1) | H-4 (BONDING_ROLE revocation) triggers H-2 (graduation permanent DoS) for ALL tokens simultaneously at graduation threshold. |
| H-08 | Chains H-23 + H-27 → H-1 Impact | H-23 (DEFAULT_ADMIN self-revoke) eliminates role recovery path; H-27 (EXECUTOR self-removal) removes legitimate operator; combined: H-1 (EXECUTOR drain) becomes irrecoverable without DEFAULT_ADMIN to revoke compromised EXECUTOR. |
| H-09 | H-6 + H-3 (CH-4) | Tax DoS (H-6: buyTax≥100 underflow) + taxStartTime DoS (H-3: permanent 99% tax) activate simultaneously, creating redundant buy-block mechanisms. |
| H-10 | H-24 + H-7 (CH-5) | renounceOwnership() (H-24) removes BondingConfig owner permanently; H-7 (zero param division) becomes unrecoverable because owner cannot re-set valid value. |
| H-11 | EP-10 + H-11 + H-2 (CH-7) | Transfer tax on graduation token (EP-10) + donation attack (H-11) cause graduation accounting mismatch, triggering H-2 permanent DoS without AgentFactory failure. |
| M-14 | H-43 + H-6 (CH-6) | Documentation comment "basis points" misleads admin to set antiSniperBuyTaxStartValue=9900 instead of 99, triggering H-6 underflow DoS via misconfiguration. |

---

## Excluded Findings

| Internal ID | Severity | Title | Exclusion Reason |
|-------------|----------|-------|-----------------|
| VS-1 | Info | Graduation uses <= threshold | REFUTED — intentional design; no vulnerability |
| VS-3 | Medium | graduate() validates no pair origin | REFUTED — duplicate of H-1 scope but mechanism already confirmed; pair validation binding |
| DE-2 | Medium | AgentFactory.createNewAgentToken reverts on failure | REFUTED — defense-in-depth, not vulnerability; creates address(0) check |
| DEPTH-TF-1 | Medium | Graduation self-transfer | REFUTED — applyTax=false in normal case; not an issue |
| DEPTH-TF-2 | Medium | Graduation LP setup issue | REFUTED — design behavior confirmed; EP-10 narrowed to production context |
| TF-5 | Medium | Two reads intentionally different | REFUTED — design behavior; intentional virtual vs. real reads |
| TF-6 | Low | Donation attack economically irrational | REFUTED — attacker always loses money; H-11 remains but economic motivation questionable |
| MG-3 | Medium | tokenGradThreshold not updated at BondingConfig change | REFUTED — stored mapping frozen at preLaunch; not runtime issue |
| EP-3 | Medium | AtomicEVM factory always reverts | REFUTED — rolls back; factory always reverts; no vulnerability |
| EP-4 | Medium | Pair injection impossible | REFUTED — CREATOR_ROLE only BondingV5; pair injection not feasible |
| EC-11 | Low | maxTx dead code | REFUTED — confirmed dead code in all Bonding versions; no active vulnerability |

---

## Components Audited

| Component | File(s) | Lines | Description |
|-----------|---------|-------|-------------|
| BondingV5 | BondingV5.sol | ~980 | Core bonding curve logic; token launch, trading, graduation to Uniswap. Upgradeable via proxy. |
| BondingV2/V3/V4 | BondingV2.sol, BondingV3.sol, BondingV4.sol | ~900 (each) | Legacy bonding implementations; deprecated but in scope. |
| FRouterV3 | FRouterV3.sol | ~530 | Token trading router; manages buy/sell with tax, anti-sniper window, graduation. |
| FRouterV2 | FRouterV2.sol | ~380 | Legacy router; deprecated storage slots. |
| FFactoryV3 | FFactoryV3.sol | ~260 | Factory for token pair creation; manages tax parameters globally. |
| FFactoryV2 | FFactoryV2.sol | ~250 | Legacy factory; tax parameter initialization. |
| FPairV2 | FPairV2.sol | ~380 | Bonding curve pair; asset/token balance tracking, tax accumulation. |
| BondingConfig | BondingConfig.sol | ~290 | Configuration for bonding curve parameters (graduation threshold, initial liquidity, etc.). |
| Multicall3 | Multicall3.sol | ~180 | Batch call aggregator; ownership simplified to single owner with no revoke path. |

---

## Summary Notes for Tier Writers

### Critical Finding (1)
**C-01** is straightforward and verifiable — EXECUTOR drains all user funds from all active pairs via direct `graduate()` call. No recovery path documented for direct drain; primary impact is total fund loss.

### High Findings (11)
Split into two categories:

**Primary code vulnerabilities** (H-01 through H-07, H-11):
- H-01: Graduation DoS + chain enabler (BONDING_ROLE revocation)
- H-02: Permanent tax via MAX_UINT timestamp
- H-03: BONDING_ROLE revocation mechanism
- H-04: Tax parameter underflow DoS
- H-05: Division-by-zero initialization
- H-06: Zero-address vault
- H-07: Broken drain function (operational)
- H-11: Transfer tax graduation failure

**High-severity chains** (H-08 through H-10):
- H-08: Role management irrecoverability (DEFAULT_ADMIN self-revoke)
- H-09: Dual buy-block mechanisms
- H-10: Unrecoverable parameter corruption

**Verified verdicts**: H-01, H-02, H-03, H-04, H-05, H-06, H-07, H-11 are [POC-PASS] or [CODE-TRACE] verified.
**Unverified chains**: H-09, H-10 require composition verification (not yet tested).

### Medium Findings (15)
Mix of:
- Admin role abuse requiring -1 tier downgrade (M-01: MAX_UINT fees, M-02: EXECUTOR self-removal, M-04: multicall admin bypass)
- Missing validation patterns (M-03, M-11: zero-address and bounds checks)
- Reentrancy and state management gaps (M-05, M-06, M-07)
- Documentation and version inconsistencies (M-14, M-15)

### Low Findings (11)
- One-step ownership (L-01)
- Payable receive traps (L-02)
- Dead code and uninitialized roles (L-03, L-04, L-09, L-10)
- Missing guards and event emissions (L-05, L-06, L-07, L-08)

### Informational Findings (4)
- Price calculation precision loss (I-01)
- Missing event parameters (I-02, I-03)
- Silent admin state changes (I-04)

---

## Verification Status Summary

| Status | Count | Evidence |
|--------|-------|----------|
| VERIFIED (POC-PASS or CODE-TRACE) | 8 | H-01, H-02, H-03, H-04, H-05, H-06, H-07, H-11 verified in batch_A and batch_B |
| UNVERIFIED | 34 | Remaining medium, low, and info findings not mechanically tested |
| TOTAL | 42 | |

**Note**: Verification focused on Critical + High severity per standard audit practice. Medium+ findings with unverified status should be validated before report publication if time permits.

---

**Report Index compiled**: 2026-04-04  
**Total hypotheses mapped**: 49 (H-1 through H-51, minus 2 merged and 3 not assigned)  
**Total report findings**: 42 (1 Critical, 11 High, 15 Medium, 11 Low, 4 Info)  
**Consolidation impact**: 16 findings consolidated from 49 hypotheses  
**Cross-reference chains**: 6 major chains documented (CH-1 through CH-7, consolidated into report findings)
