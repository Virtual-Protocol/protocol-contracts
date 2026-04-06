# Finding Mapping — VP Launchpad Suite Phase 4c Chain Analysis

> Maps every agent finding ID from all Phase 3/4b output files to its assigned hypothesis.
> Status: ASSIGNED (active hypothesis), ABSORBED (absorbed into another hypothesis), REFUTED (false positive), DUPLICATE (same root cause as another finding — absorbed by the primary).

---

## Legend

| Status | Meaning |
|--------|---------|
| `ASSIGNED → H-N` | Finding is a primary or component finding in hypothesis H-N |
| `ABSORBED → H-N` | Finding duplicates H-N's root cause; H-N is the canonical hypothesis |
| `REFUTED` | Finding was REFUTED by a depth agent; excluded from hypotheses |
| `DUPLICATE → [ID]` | Same finding as [ID]; absorbed by that finding's hypothesis |

---

## Scanner A — `blind_spot_A_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| BLIND-A1 | antiSniperTaxVault zero-address bricks buys | ASSIGNED → H-8 | Primary component |
| BLIND-A2 | setScheduledLaunchParams MAX_UINT fees DoS | ASSIGNED → H-9 | Primary component |
| BLIND-A3 | setCommonParams feeTo=address(0) DoS | ASSIGNED → H-18 | Primary component |
| BLIND-A4 | setDeployParams tbaImplementation=address(0) corrupts token creation | ASSIGNED → H-19 | Primary component |
| BLIND-A5 | setTeamTokenReservedWallet(address(0)) bricks X_LAUNCH/ACP | ASSIGNED → H-20 | Primary component |

---

## Scanner B — `blind_spot_B_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| BLIND-B1 | cancelLaunch CEI violation BondingV2/V3/V4 | ABSORBED → H-10 | Same root cause as SP-3 and RS2-3; H-10 is canonical |
| BLIND-B2 | OwnableUpgradeable.renounceOwnership() unguarded | ABSORBED → H-24 | Same as BLIND-C2; H-24 is canonical (merged) |
| BLIND-B3 | FRouterV3._calculateAntiSniperTax() no null-check | ABSORBED → H-14 | Same root cause as DEPTH-ST-9 and DE-5; H-14 is canonical |

---

## Scanner C — `blind_spot_C_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| BLIND-C1 | DEFAULT_ADMIN_ROLE can self-revoke | ASSIGNED → H-23 | Primary component |
| BLIND-C2 | BondingV5/BondingConfig renounceOwnership() unguarded | ABSORBED → H-24 | Same as BLIND-B2; H-24 is canonical (both are component findings) |
| BLIND-C3 | Multicall3 one-step ownership, no revoke path | ASSIGNED → H-47 | Primary component (with PC1-3) |
| BLIND-C4 | EXECUTOR_ROLE self-removal via renounceRole() halts trading | ASSIGNED → H-27 | Primary component |
| BLIND-C5 | FPairV2.router immutable — factory router change doesn't affect existing pairs | ASSIGNED → H-39 | Secondary context for DST-5 scope |
| BLIND-C6 | BondingV2/V3/V4 buy()/sell() always revert | ASSIGNED → H-29 | Primary component |
| BLIND-C7 | BondingV4.preLaunch() always reverts / dead API | ASSIGNED → H-44 | Primary component (BondingV3/V4 dead preLaunch) |

---

## Validation Sweep — `validation_sweep_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| VS-1 | Graduation uses <= threshold | REFUTED | Intentional design; REFUTED by depth agents |
| VS-2 | cancelLaunch missing nonReentrant | ABSORBED → H-10 | Duplicate of RS2-3/BLIND-B1/SP-3; H-10 canonical |
| VS-3 | graduate() validates no pair origin | REFUTED | Duplicate of AC-1 scope but REFUTED as separate issue; pair validation confirmed binding |
| VS-4 | addInitialLiquidity() missing nonReentrant | ASSIGNED → H-26 | Primary component |
| VS-5 | batchTransferTokens() non-functional for admins | ASSIGNED → H-45 | Primary component |
| VS-6 | multicall3 aggregate bypasses onlyOwner | ASSIGNED → H-17 | Primary component |

---

## Sibling Propagation — `sibling_propagation_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| SP-1 | FRouterV3.sell() sellTax>=100 underflow | ABSORBED → H-6 | Same root cause as DEPTH-EC-2; H-6 canonical (multi-version) |
| SP-2 | antiSniperBuyTaxStartValue>99 breaks 99% cap | ABSORBED → H-6 | Same root cause as DEPTH-EC-1; H-6 canonical |
| SP-3 | BondingV2/V3/V4.cancelLaunch() CEI violation | ABSORBED → H-10 | Same as BLIND-B1 and RS2-3; H-10 canonical |
| SP-4 | BondingV2/V3/V4 graduation reads balanceOf | ABSORBED → H-11 | Same root cause as TF-1/DE-4; H-11 canonical |
| SP-5 | BondingV3/V4 teamTokenReservedWallet TOCTOU | ABSORBED → H-21 | Same as MG-4/TE-1; H-21 canonical |
| SP-6 | BondingV4.cancelLaunch emits zeroed initialPurchase | ABSORBED → H-34 | Same as EVT-1; H-34 canonical |

---

## Design Stress Testing — `design_stress_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| DST-1 | Creator can buy entire supply → instant graduation | ASSIGNED → H-37 | Primary component |
| DST-2 | antiSniperBuyTaxStartValue + buyTax sum not enforced | ASSIGNED → H-16 | Primary component |
| DST-3 | cancelLaunch permanently locks bondingCurveSupply | ASSIGNED → H-22 | Primary component |
| DST-4 | Global bondingCurveParams creates two-tier graduation regime | ASSIGNED → H-38 | Primary component |
| DST-5 | Router bondingV5/bondingConfig refs not cross-validated | ASSIGNED → H-39 | Primary component |

---

## Depth Token Flow — `depth_token-flow_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| DEPTH-TF-1 | Graduation self-transfer | REFUTED | applyTax=false in normal case; CONTESTED/REFUTED by iter analysis; EP-10 narrowed |
| DEPTH-TF-2 | Graduation LP setup (virtual not AgentToken) | REFUTED | Design behavior confirmed; EP-10 downgraded to Medium and consolidated |
| DEPTH-TF-3 | Donation attack quantified ([MEDUSA-PASS]) | ABSORBED → H-11 | Quantification of TF-1/EP-5 attack; H-11 canonical |

---

## Depth State Trace — `depth_state-trace_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| DEPTH-ST-1 | Graduation failure no admin recovery | ABSORBED → H-2 | Confirms and deepens EP-8; H-2 canonical |
| DEPTH-ST-2 | cancelLaunch CEI violation BondingV5 | ABSORBED → H-10 | BondingV5 variant; H-10 canonical (all versions) |
| DEPTH-ST-3 | FFactory CREATOR_ROLE not in initialize() | ASSIGNED → H-25 | Primary component (with PC1-10) |
| DEPTH-ST-4 | setRouter(address(0)) DoS | ASSIGNED → H-13 | Primary component |
| DEPTH-ST-5 | BondingV5 needs EXECUTOR_ROLE on FRouterV3 + BONDING_ROLE on AgentFactoryV7 | ABSORBED → H-4 | Confirms role requirement for EP-14 chain; H-4 canonical |
| DEPTH-ST-6 | taxStartTime type(uint256).max → permanent 99% tax | ASSIGNED → H-3 | Primary component (deepens AC-5; H-52 merged into H-3) |
| DEPTH-ST-7 | teamTokenReservedWallet race condition | ABSORBED → H-21 | Same as SP-5/MG-4/TE-1; H-21 canonical |
| DEPTH-ST-8 | FRouterV2 deprecated storage slots | ASSIGNED → H-15 | Primary component (with MG-2) |
| DEPTH-ST-9 | FRouterV3._calculateAntiSniperTax() reverts for non-V5 tokens | ABSORBED → H-14 | Same as DE-5/BLIND-B3; H-14 canonical |
| DEPTH-ST-10 | BondingV2/V3/V4 cancelLaunch doesn't set trading=false | ASSIGNED → H-41 | Primary component (with SC-5) |

---

## Depth External — `depth_external_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| DE-1 | drainUniV2Pool always reverts without founder pre-approval | ASSIGNED → H-42 | Primary component |
| DE-2 | AgentFactory.createNewAgentToken reverts on failure (not address(0)) | REFUTED | Defense-in-depth; not a vulnerability; PARTIAL/design |
| DE-3 | 4 sequential AgentFactory calls at graduation; BONDING_ROLE revocation bricks all | ABSORBED → H-2 | Core mechanism behind H-2; EP-8/DE-3 combined root cause |
| DE-4 | Donation attack on graduation amounts | ABSORBED → H-11 | Same root cause as TF-1/DEPTH-TF-3/SP-4; H-11 canonical |
| DE-5 | FRouterV3._calculateAntiSniperTax reverts for non-V5 tokens | ABSORBED → H-14 | Same as DEPTH-ST-9/BLIND-B3; H-14 canonical |

---

## Depth Edge Case — `depth_edge-case_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| DEPTH-EC-1 | buyTax>=100 underflow revert (99-normalTax) | ASSIGNED → H-6 | Primary component |
| DEPTH-EC-2 | sellTax>=100 silent confiscation / >=101 DoS | ASSIGNED → H-6 | Primary component |
| DEPTH-EC-3 | fakeInitialVirtualLiq=0 division-by-zero | ASSIGNED → H-7 | Primary component |
| DEPTH-EC-4 | targetRealVirtual=0 instant graduation | ABSORBED → H-7 | Related to DEPTH-EC-3: same setter (BondingConfig admin params), same fix class; consolidated |
| DEPTH-EC-5 | FRouterV3.sell() depositTax called with zero amount | ASSIGNED → H-51 | Primary component |

---

## Depth Iteration 2 — State Trace — `depth_iter2_state-trace_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| DA analysis of EP-8 | No admin recovery path confirmed | ABSORBED → H-2 | Deepens H-2; absorbed into EP-8 scope |
| DA analysis of MG-3 | REFUTED: tokenGradThreshold is frozen mapping, not runtime BondingConfig read | REFUTED | MG-3 REFUTED — no hypothesis needed |

---

## Depth Iteration 2 — External — `depth_iter2_external_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| DA-EP12-1 | drainPrivatePool stale reserve after failed syncAfterDrain | ASSIGNED → H-12 | New finding from Iter2; primary component |
| EP-3 | AtomicEVM factory always reverts | REFUTED | Rolls back; factory always reverts; REFUTED |
| EP-4 | Pair injection impossible | REFUTED | CREATOR_ROLE only BondingV5; pair injection impossible; REFUTED |
| EP-11 partial | LP pair validation + unrestricted recipient | ABSORBED → H-5 | Iter3 confirmed EP-11-R as independent and primary; H-5 canonical |

---

## Depth Iteration 2 — Token Flow — `depth_iter2_token-flow_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| DA-TF-1 | FRouterV3.sell() computes amountOut before transfer | ASSIGNED → H-40 | New finding from Iter2; primary component; theoretical (Low) |
| DA-TF-2 | Factory buyTax/sellTax lack upper bound | ABSORBED → H-6 | Same root cause as DEPTH-EC-1/EC-2/SP-1; H-6 canonical |
| TF-5 revised | Two reads intentionally different (virtual vs real) | REFUTED | Design behavior; REFUTED |
| TF-6 revised | Donation attack economically irrational | REFUTED | Attacker always loses money (profit = f×D - D < 0); H-11 severity remains but attack motivation questionable |

---

## Depth Iteration 2 — Edge Case — `depth_iter2_edge-case_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| EC-11 | maxTx was never enforced — dead code | REFUTED | Dead code in all Bonding versions; REFUTED |
| TE-2 downgrade | Only creator initial buy output redirectable (Low) | ABSORBED → H-21 | Severity downgrade absorbed into H-21; noted as DA-TE-2-UPDATE |

---

## Depth Iteration 3 — `depth_iter3_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| EP-11-R | drainUniV2Pool unrestricted recipient — confirmed independent High | ASSIGNED → H-5 | Iter3 confirmed distinct from AC-1/AC-8; primary component of H-5 |
| EP-14-R | AgentFactory BONDING_ROLE revocation — confirmed independent High | ASSIGNED → H-4 | Iter3 confirmed distinct from H-2; primary component of H-4 |

---

## Niche Agent — Event Completeness — `niche_event_completeness_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| EVT-1 | BondingV4.cancelLaunch emits zeroed initialPurchase | ABSORBED → H-34 | Same as SP-6; H-34 canonical |
| EVT-4 | FFactoryV2/V3 setRouter no event | ABSORBED → H-33 | Part of silent admin state changes group |
| EVT-5 | BondingConfig setTaxParams no event | ABSORBED → H-33 | Part of silent admin state changes group |
| EVT-6 | BondingConfig setCommonParams no event | ABSORBED → H-33 | Part of silent admin state changes group |
| EVT-7 | BondingConfig setDeployParams no event | ABSORBED → H-33 | Part of silent admin state changes group |
| EVT-8 | BondingConfig setScheduledLaunchParams no event | ABSORBED → H-33 | Part of silent admin state changes group |
| EVT-9 | FRouterV3 setTaxStartTime no event | ABSORBED → H-33 | Part of silent admin state changes group |
| EVT-10 | FRouterV3 setAntiSniperBuyTaxStartValue no event | ABSORBED → H-33 | Part of silent admin state changes group |
| EVT-11 | BondingV5 setTeamTokenReservedWallet no event | ABSORBED → H-33 | Part of silent admin state changes group |
| EVT-12 | Graduated event missing agentToken index and amounts | ASSIGNED → H-36 | Primary component |
| EVT-13 | FRouterV2/V3.graduate() emits no event | ASSIGNED → H-30 | Primary component (with EVT-14) |
| EVT-14 | FRouterV2/V3.addInitialLiquidity() emits no event | ABSORBED → H-30 | Same class as EVT-13; H-30 canonical (both are component findings) |
| EVT-16 | BondingV5 preLaunch/launch admin config changes no event | ABSORBED → H-33 | Part of silent admin state changes group |

---

## Niche Agent — Callback Safety — `niche_callback_safety_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| CBS-1 | buy() declared payable — ETH trapped in Bonding contracts | ASSIGNED → H-28 | Primary component |

---

## Niche Agent — Semantic Consistency — `niche_semantic_consistency_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| SC-1 | antiSniperBuyTaxStartValue "basis points" comment is wrong | ASSIGNED → H-43 | Primary component |
| SC-2 | Anti-sniper window 99s (V2) vs 60s (V3) | ASSIGNED → H-32 | Primary component (with SC-3, SC-4, RS2-8) |
| SC-3 | Anti-sniper decay algorithm structurally different V2 vs V3 | ABSORBED → H-32 | Same grouping; H-32 canonical |
| SC-4 | Full anti-sniper window 99 min (V2) vs 98 min/5880s (V3) | ABSORBED → H-32 | Same grouping; H-32 canonical |
| SC-5 | BondingV2/V3/V4 cancelLaunch doesn't set trading=false | ABSORBED → H-41 | Same as DEPTH-ST-10; H-41 canonical |

---

## Niche Agent — Dimensional Analysis — `niche_dimensional_analysis_findings.md`

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| DA-1 | FPairV2.priceALast() always returns 0 (integer division) | ASSIGNED → H-31 | Primary component |
| DA-2 | FPairV2.priceBLast() raw integer not WAD-scaled | ABSORBED → H-31 | Same root cause; H-31 canonical (combined) |
| DA-3 | tokenInfo.data.price = supply/liquidity stores raw ratio, not WAD | ASSIGNED → H-31 | Additional component finding |

---

## Phase 3 Breadth Scanner — `findings_inventory.md` (breadth agent findings)

> Note: findings_inventory.md is the canonical merged inventory. The following IDs from the breadth scan phase are mapped here.

### Access Control Breadth Findings

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| AC-1 | EXECUTOR_ROLE can graduate any pair (no origin validation) | ASSIGNED → H-1 | Primary component (Critical) |
| AC-5 | EXECUTOR setTaxStartTime permanent anti-sniper freeze | ABSORBED → H-3 | Same root cause as DEPTH-ST-6; H-3 canonical |
| AC-7 | Silent admin state changes without events | ABSORBED → H-33 | Same class as EVT-4 through EVT-16; H-33 canonical |
| AC-8 | Graduated LP: unrestricted pair approval without recipient check | ABSORBED → H-5 | Related to EP-11 scope; H-5 canonical (Iter3 re-confirmed) |

### External Protocol Breadth Findings

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| EP-5 | Graduation reads balanceOf (donation attack surface) | ABSORBED → H-11 | Same as TF-1/DE-4/DEPTH-TF-3/SP-4; H-11 canonical |
| EP-8 | Graduation failure permanent DoS no recovery | ASSIGNED → H-2 | Primary component (Critical) |
| EP-10 | Graduation LP asset transfer scope | ABSORBED → H-2 | DEPTH-TF-1/TF-2 narrowed this; absorbed into EP-8/H-2 |
| EP-11 | Interface spoofing / unrestricted recipient (pre-Iter3) | ABSORBED → H-5 | EP-11-R (Iter3) is canonical; H-5 is the hypothesis |
| EP-14 | BondingV5 missing role verification at graduation | ASSIGNED → H-4 | Primary component (High); Iter3 confirmed independent of H-2 |

### Token Flow Breadth Findings

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| TF-1 | Graduation reads balanceOf — donation attack (EP-5 alias) | ABSORBED → H-11 | Same as EP-5/DE-4; H-11 canonical |
| TF-5 | Two reads intentionally different (virtual vs real) | REFUTED | Design; REFUTED in Iter2 |
| TF-6 | Donation attack economically irrational | REFUTED | Attacker always loses (profit < 0); H-11 severity notes this |

### Migration / Configuration Breadth Findings

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| MG-2 | FRouterV2 deprecated storage slots collision | ABSORBED → H-15 | Same as DEPTH-ST-8; H-15 canonical |
| MG-3 | tokenGradThreshold not updated at BondingConfig change | REFUTED | REFUTED by Iter2-DA: stored mapping frozen at preLaunch |
| MG-4 | teamTokenReservedWallet TOCTOU (migration breadth) | ABSORBED → H-21 | Same as SP-5/TE-1; H-21 canonical |

### Tax / Economic Breadth Findings

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| TE-1 | teamTokenReservedWallet race condition (TE alias of MG-4) | ABSORBED → H-21 | Same as MG-4/SP-5; H-21 canonical |

### Re-Scan Breadth Findings

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| RS2-3 | cancelLaunch missing nonReentrant (BondingV5) | ABSORBED → H-10 | Same as DEPTH-ST-2/BLIND-B1/SP-3/VS-2; H-10 canonical |
| RS2-4 | FFactory.createPair() duplicate pair overwrite (downgraded) | ASSIGNED → H-48 | Primary component (Low) |
| RS2-8 | Anti-sniper window inconsistency | ABSORBED → H-32 | Same class as SC-2/SC-3/SC-4; H-32 canonical |

### Storage Layout Safety

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| SLS-1 | No __gap[] in any upgradeable contract | ASSIGNED → H-49 | Primary component (Medium) |

### Per-Contract Scan Findings

| Finding ID | Title (short) | Status | Notes |
|------------|--------------|--------|-------|
| PC1-3 | Multicall3 one-step ownership no revoke path | ABSORBED → H-47 | Same as BLIND-C3; H-47 canonical |
| PC1-10 | FFactory CREATOR_ROLE not in initialize() | ABSORBED → H-25 | Same as DEPTH-ST-3; H-25 canonical |

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Total finding IDs tracked | ~115 |
| ASSIGNED as primary/component of a hypothesis | ~72 |
| ABSORBED (deduplicated into canonical hypothesis) | ~33 |
| REFUTED (false positive / design) | ~12 |
| Active hypotheses | 49 (H-1 through H-51, minus H-35/H-46/H-50/H-52 merged) |

### Deduplicated Finding Clusters (by root cause)

| Cluster | Root Cause | All Finding IDs | Canonical Hypothesis |
|---------|-----------|-----------------|---------------------|
| cancelLaunch CEI | Missing state update before transfer | RS2-3, DEPTH-ST-2, SP-3, BLIND-B1, VS-2 | H-10 |
| Tax DoS (buy/sell) | setTaxParams no upper bound | DEPTH-EC-1, DEPTH-EC-2, SP-1, SP-2, DA-TF-2 | H-6 |
| Donation attack | graduation reads balanceOf | EP-5, TF-1, DEPTH-TF-3, DE-4, SP-4 | H-11 |
| FRouterV3 non-V5 revert | bondingV5.tokenAntiSniperType() no try/catch | DEPTH-ST-9, DE-5, BLIND-B3 | H-14 |
| renounceOwnership unguarded | OwnableUpgradeable override missing | BLIND-B2, BLIND-C2 | H-24 |
| teamTokenReservedWallet TOCTOU | TOCTOU window between preLaunch/launch | SP-5, TE-1, MG-4, DEPTH-ST-7, DA-TE-2-UPDATE | H-21 |
| FRouterV2 storage slots | Deprecated slots must be preserved | DEPTH-ST-8, MG-2 | H-15 |
| Anti-sniper window inconsistency | V2 vs V3 window duration difference | SC-2, SC-3, SC-4, RS2-8 | H-32 |
| cancelLaunch no trading=false | Inconsistent post-cancel state | DEPTH-ST-10, SC-5 | H-41 |
| Silent admin events | 23+ setters emit no event | AC-7, EVT-4–11, EVT-16 | H-33 |
| Graduation DoS root mechanism | _openTradingOnUniswap 4 sequential calls no try/catch | EP-8, DE-3, DEPTH-ST-1 | H-2 |

---

> **Written by**: Chain Agent 1 — Enabler Enumeration and Grouping
> **Date**: 2026-04-03
> **Pipeline Phase**: 4c — Chain Analysis
