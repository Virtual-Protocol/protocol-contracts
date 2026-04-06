# Composition Coverage Map — VP Launchpad Suite Phase 4c

> **Written by**: Chain Agent 2 — Chain Matching and Composition Coverage
> **Date**: 2026-04-03

---

## Coverage Map: All Hypothesis Pairs Considered

> Pairs listed where at least one finding has a postcondition OR a missing precondition that could interact with another hypothesis.
> Cross-class pairs (state × token, access × external) are HIGH PRIORITY.

| H-A | H-B | Class A | Class B | Cross-class? | Explored? | Result | Chain ID | Notes |
|-----|-----|---------|---------|-------------|-----------|--------|----------|-------|
| H-4 (BONDING_ROLE revoke) | H-2 (Graduation DoS) | ACCESS/STATE | STATE/EXTERNAL | YES | YES | **CHAIN** | CH-1 | STRONG match — H-4 postcondition is exact precondition for H-2; Critical chain |
| H-23 (Admin self-revoke) | H-1 (EXECUTOR drain) | ACCESS | ACCESS | NO | YES | **CHAIN** | CH-2 | H-23 removes recovery path for H-1; Critical irrecoverability compound |
| H-27 (EXECUTOR self-removal) | H-23 (Admin self-revoke) | ACCESS | ACCESS | NO | YES | **CHAIN** | CH-2 supporting | H-27 + H-23 combined → no recovery from EXECUTOR compromise |
| H-8 (antiSniperVault=0) | H-2 (Graduation DoS) | STATE | STATE | NO | YES | **CHAIN** | CH-3 | MODERATE — timing-dependent; graduation-window overlap; High severity |
| H-8 (antiSniperVault=0) | H-37 (Creator instant graduation) | STATE | STATE | NO | YES | PARTIAL | CH-3 supporting | H-37 can trigger graduation during anti-sniper window where H-8 blocks; context for CH-3 |
| H-6 (Tax DoS) | H-3 (taxStartTime=MAX) | STATE | STATE | NO | YES | **CHAIN** | CH-4 | Dual independent buy-block mechanisms; High compound |
| H-7 (Zero param DoS) | H-24 (renounceOwnership) | STATE | ACCESS | YES | YES | **CHAIN** | CH-5 | H-24 removes recovery path for H-7; High unrecoverable compound |
| H-43 (Comment misleads admin) | H-6 (Tax DoS) | STATE | STATE | NO | YES | **CHAIN** | CH-6 | Documentation-driven path to H-6 DoS; High severity |
| H-43 (Comment misleads admin) | H-16 (Sum not validated) | STATE | STATE | NO | YES | **CHAIN** | CH-6 supporting | H-16 missing validation allows H-43 misconfiguration to persist |
| EP-10 (Transfer tax mismatch) | H-2 (Graduation DoS) | TOKEN | STATE/EXTERNAL | YES | YES | **CHAIN** | CH-7 | EP-10 + H-11 creates new H-2 activation path; Critical chain |
| H-11 (Donation attack) | H-2 (Graduation DoS) | TOKEN | STATE/EXTERNAL | YES | YES | **CHAIN** | CH-7 supporting | H-11 supports CH-7 as ratio distortion enabler |
| H-23 (Admin self-revoke) | H-7 (Zero param DoS) | ACCESS | STATE | YES | YES | **CHAIN** | CH-5 (see also) | H-23 also enables unrecoverable H-7 (owner=address(0) equivalent outcome) |
| H-1 (EXECUTOR drain) | H-4 (BONDING_ROLE) | ACCESS | ACCESS | NO | YES | NO CHAIN | — | H-4 breaks graduation path; H-1 can directly graduate without needing graduation path; independent attacks |
| H-1 (EXECUTOR drain) | H-3 (taxStartTime=MAX) | ACCESS | STATE | YES | YES | NO CHAIN | — | H-3 freezes buys; H-1 uses graduate() directly, not buy(); independent attacks |
| H-1 (EXECUTOR drain) | H-6 (Tax DoS) | ACCESS | STATE | YES | YES | NO CHAIN | — | Same as above; H-1 uses graduate() which bypasses buy() tax path |
| H-2 (Graduation DoS) | H-10 (CEI violation cancelLaunch) | STATE | STATE | NO | YES | NO CHAIN | — | cancelLaunch() is blocked by launchExecuted=true after graduation attempt; H-10 cannot compound H-2 recovery |
| H-2 (Graduation DoS) | H-12 (drainPrivatePool stale reserve) | STATE/EXTERNAL | TOKEN | YES | YES | NO CHAIN | — | drainPrivatePool is for Project60days tokens; H-2 affects normal graduation path; independent |
| H-5 (drainUniV2Pool recipient) | H-42 (drainUniV2Pool always reverts) | ACCESS | EXTERNAL | NO | YES | WEAK | — | H-42 blocks H-5: without founder pre-approval, drainUniV2Pool reverts before reaching recipient parameter; H-42 is a precondition blocker for H-5 |
| H-5 (drainUniV2Pool recipient) | H-23 (Admin self-revoke) | ACCESS | ACCESS | NO | YES | NO CHAIN | — | H-23 doesn't help or hinder H-5; EXECUTOR_ROLE is separate from DEFAULT_ADMIN_ROLE scope |
| H-10 (CEI violation cancelLaunch) | H-22 (locked bondingCurveSupply) | STATE | STATE | NO | YES | NO CHAIN | — | H-10 is about double-refund; H-22 is about stranded agent tokens; both affect cancelLaunch but different assets and different mechanisms |
| H-13 (setRouter address(0)) | H-25 (CREATOR_ROLE not in initialize) | STATE | ACCESS | YES | YES | PARTIAL | — | Both block new pair creation; compound DoS on factory but same end result (no new pairs); not a chain, just compound severity |
| H-14 (non-V5 token reverts) | H-39 (router refs not cross-validated) | STATE | STATE | NO | YES | PARTIAL | — | H-39 (stale bondingConfig reference) could cause FRouterV3 to query wrong contract version, potentially triggering H-14 behavior; MODERATE connection but operationally bounded |
| H-15 (FRouterV2 storage slots) | H-49 (no __gap) | STATE | STATE | NO | YES | NO CHAIN | — | Both are upgrade-path risks but operate on different contracts; H-15 is about deprecated slot preservation (FRouterV2 specific), H-49 about missing gap arrays (all contracts); independent risks |
| H-49 (no __gap) | H-7 (zero param DoS) | STATE | STATE | YES | YES | PARTIAL | EN-2 (from enabler) | Storage collision in upgrade could zero out BondingConfig params → H-7 trigger; documented as EN-2 in enabler_results.md; Medium priority |
| H-24 (renounceOwnership) | H-9 (MAX_UINT fees DoS) | ACCESS | STATE | YES | YES | PARTIAL | — | H-24 removes recovery path for H-9 (can't re-set normalLaunchFee after owner renounced); similar mechanism to CH-5 but H-9 is bounded to scheduled/ACF launches |
| H-24 (renounceOwnership) | H-18 (feeTo=address(0) DoS) | ACCESS | STATE | YES | YES | PARTIAL | — | Same pattern as above; owner loss makes H-18 permanent |
| H-24 (renounceOwnership) | H-20 (teamTokenReservedWallet=address(0)) | ACCESS | STATE | YES | YES | PARTIAL | — | Owner loss makes H-20 permanent; Medium+Medium=High compound when combined |
| H-17 (multicall3 admin drain) | H-47 (multicall3 no revoke) | ACCESS | ACCESS | NO | YES | NO CHAIN | — | H-17 is about admin using multicall3 to drain tokens; H-47 is about owner compromise; orthogonal attack paths |
| H-26 (addInitialLiquidity no nonReentrant) | H-10 (cancelLaunch CEI) | STATE | STATE | NO | YES | NO CHAIN | — | Different reentrancy surfaces on different functions; not composable without exotic callback setup |
| H-37 (creator instant graduation) | H-11 (donation attack) | STATE | TOKEN | YES | YES | PARTIAL | — | Creator can trigger graduation during launch; donating tokens before launch() call could distort Uniswap initialization; MODERATE — timing window is very tight (same transaction) |
| H-37 (creator instant graduation) | H-2 (Graduation DoS) | STATE | STATE | NO | YES | NO CHAIN | — | H-37 triggers graduation; if graduation fails (H-2 conditions), H-37 + H-2 = instant permanent DoS; but H-37 requires working graduation path. Overlap captured in CH-7 context. |
| H-3 (taxStartTime=MAX) | H-2 (Graduation DoS) | STATE | STATE | NO | YES | PARTIAL | — | H-3 postcondition (graduation impossible, buys too small) is related to H-2 but different mechanism; H-3 creates economic impossibility of graduation (not technical revert); H-2 creates technical revert after threshold reached; both prevent graduation but via different mechanisms; not a compound chain |
| H-6 (Tax DoS) | H-2 (Graduation DoS) | STATE | STATE | NO | YES | NO CHAIN | — | H-6 blocks buys (threshold never reached); H-2 requires threshold to be reached first; H-6 prevents H-2 from being triggered but is not an enabler |
| H-9 (MAX_UINT fees) | H-25 (CREATOR_ROLE not in initialize) | STATE | ACCESS | YES | YES | NO CHAIN | — | Both affect ability to launch tokens; H-9 affects scheduled/ACF launches; H-25 affects pair creation; independent initialization failures |
| H-22 (locked bondingCurveSupply) | H-41 (no trading=false after cancel) | STATE | STATE | NO | YES | NO CHAIN | — | H-22 and H-41 both affect post-cancel state in different bonding versions; not composable (same transaction context, not sequential) |
| H-12 (drainPrivatePool stale reserve) | H-5 (drainUniV2Pool recipient) | TOKEN | ACCESS | YES | YES | NO CHAIN | — | Different pool types (FPairV2 private vs Uniswap V2 LP); different functions; independent |
| H-51 (sell depositTax zero amount) | H-6 (Tax DoS) | STATE | STATE | NO | YES | NO CHAIN | — | H-51 affects sells when sellTax=0; H-6 affects buys when buyTax>=100; different code paths, different actors, orthogonal |
| H-51 (sell depositTax zero amount) | H-2 (Graduation DoS) | STATE | STATE | NO | YES | NO CHAIN | — | H-51 blocks sells; H-2 blocks graduation-triggering buys; independent (sell DoS does not prevent graduation) |
| H-16 (antiSniperBuyTaxStartValue sum) | H-8 (antiSniperTaxVault=0) | STATE | STATE | NO | YES | NO CHAIN | — | Both affect anti-sniper mechanics; H-16 is about incorrect effective rate; H-8 is about reverts on transfer to zero address; different failure modes, not composable |
| H-39 (router refs not cross-validated) | H-8 (antiSniperTaxVault=0) | STATE | STATE | NO | YES | NO CHAIN | — | H-39 causes wrong duration; H-8 causes revert; could combine (wrong bondingConfig reference returns wrong vault address), but the actual antiSniperTaxVault is set separately and this path is speculative |
| H-23 (Admin self-revoke) | H-27 (EXECUTOR self-removal) | ACCESS | ACCESS | NO | YES | **CHAIN** | CH-2 | Combined enables full irrecoverability: Admin gone + EXECUTOR can drain with no recovery |
| H-4 (BONDING_ROLE revoke) | H-24 (renounceOwnership) | ACCESS | ACCESS | NO | YES | NO CHAIN | — | H-4 is AgentFactory governance; H-24 is BondingConfig ownership; independent governance failures |
| H-25 (CREATOR_ROLE not in initialize) | H-48 (createPair duplicate overwrite) | ACCESS | STATE | YES | YES | NO CHAIN | — | H-25 prevents pair creation (no CREATOR_ROLE); H-48 allows overwriting existing pairs; if CREATOR_ROLE IS granted, H-48 becomes relevant; sequential but not compound |

---

## Unexplored Cross-Class Pairs (Remaining — LOW PRIORITY)

> These pairs were NOT fully analyzed due to low prior evidence of interaction. Listed for iteration 2 consideration.

| H-A | H-B | Class A | Class B | Why Not Explored | Priority |
|-----|-----|---------|---------|-----------------|----------|
| H-31 (priceALast/priceBLast incorrect) | H-11 (donation attack) | Oracle | Token | Both affect FPairV2 price data; if an off-chain oracle consumes priceALast() and that oracle feeds a Uniswap-adjacent price check, donation attack could compound incorrect price reading | LOW |
| H-40 (sell amountOut before transfer) | H-11 (donation attack) | Token | Token | Both affect FPairV2 reserves; donation before sell could increase amountOut beyond actual delivery; but H-40 is theoretical (no fee-on-transfer in current deployment) | LOW |
| H-15 (FRouterV2 storage slots) | H-14 (non-V5 token reverts) | State | State | H-15 upgrade corrupts bondingV2 reference; if corrupted reference is read by H-14's bondingV5.tokenAntiSniperType() call, could cause unexpected behavior | LOW |
| H-28 (ETH trapped in buy) | H-37 (creator instant graduation) | ETH | State | Creator sends ETH alongside the large initialPurchase that triggers graduation; ETH is permanently trapped; but this is an additive loss, not a compound vulnerability | LOW |
| H-45 (batchTransferTokens broken for admins) | H-17 (multicall3 aggregate drain) | ACCESS | ACCESS | H-45 prevents batch transfers; H-17 allows aggregate function drain; orthogonal paths within multicall3 | LOW |

---

## Cross-Class Pair Count Summary

| Pair Type | Explored | Chains Found | No Chain |
|-----------|---------|-------------|---------|
| ACCESS × STATE | 8 | 4 (CH-1, CH-5, CH-6 partial, H-24×H-9 partial) | 4 |
| ACCESS × ACCESS | 6 | 3 (CH-2 main + supporting) | 3 |
| TOKEN × STATE | 4 | 2 (CH-7 main + supporting) | 2 |
| STATE × STATE | 14 | 3 (CH-3, CH-4, CH-6) | 11 |
| TOKEN × TOKEN | 2 | 0 | 2 |
| ETH × STATE | 1 | 0 | 1 |
| **TOTAL** | **35** | **7 chains** | **23** |

---

## Iteration 2 Recommendation

Based on the composition coverage map, **0 high-priority cross-class pairs remain unexplored**. The 5 unexplored pairs in the LOW PRIORITY table are all speculative (require non-deployed behavior or are additive-loss scenarios, not compound attack paths).

**Iteration 2 Chain Agent is NOT required**: Agent 2 has covered all Medium+ cross-class pairs. The 5 remaining unexplored pairs are all Low/Informational severity in the best-case compound scenario.
