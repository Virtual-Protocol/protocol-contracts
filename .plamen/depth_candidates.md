# Depth Candidates

**Updated:** 2026-04-02 — Phase 3b/3c merge adds 4 new depth candidates

## Depth Candidates

### Token Flow Domain

**Priority: CRITICAL**
- **AC-1 / EP-8 Chain**: EXECUTOR_ROLE graduate() drains all pools + graduation failure creates permanent DoS. These two findings share the same graduation pathway. Depth must trace: (1) whether beOpsWallet having EXECUTOR_ROLE is unavoidable by protocol design, (2) whether the permanent DoS can be recovered through admin action without pausing the entire system.
- **RS3-3 (NEW)**: Graduation DAO address controlled by graduating buyer's msg.sender — frontrunner can precompute and influence DAO address. Chains with AC-1: if the graduating buyer is beOpsWallet (EXECUTOR_ROLE holder), they control the DAO salt, enabling governance manipulation before graduation completes.
- **EP-10 / TF-3 / SE-1 Chain**: Production AgentToken transfer tax at graduation. Depth must: (a) read the actual production AgentToken source and determine if BondingV5 is on the whitelist, (b) determine if the self-transfer at L746 triggers auto-swap or reflection, (c) model what happens to lpSupply when tokens arrive taxed.

**Priority: HIGH**
- **TF-1 / EP-5 / EP-9**: Donation attack vectors to FPairV2. Multiple findings overlap. Depth should consolidate and quantify: what is the minimum donation to distort the Uniswap pool by 1%, 5%, 10%? Is there an economic incentive for this attack?
- **TF-2**: cancelLaunch() locks bondingCurveSupply agent tokens permanently. Depth should check: can a re-preLaunch() for the same token address (same agent token) overwrite the pair? Or is a new pair created? If the FPairV2 with `lastUpdated != 0` blocks a re-mint, what happens?
- **TF-5 / TF-6**: TOCTOU double-read pattern and drain reserve sync. Both involve balance reads that could diverge. Depth should trace if any callback between the two reads in the same call stack is possible given the specific token implementations.

### State Trace Domain

**Priority: CRITICAL**
- **EP-8**: Permanent DoS when AgentFactory is paused/upgraded mid-graduation. Depth must model: (1) exact recovery path — can admin fix this without a selfdestruct/migration, (2) whether existing pair funds (user VIRTUAL) can be recovered after the DoS occurs.
- **PC1-10 (NEW)**: CREATOR_ROLE and ADMIN_ROLE are never granted in FFactoryV2/V3 initialize() — factory starts fully non-functional. Depth must verify: (1) is this initialization gap present in production deployment, (2) what is the expected workflow for role grants after factory proxy deployment, (3) can missing role grants be caught by deployment automation?

**Priority: HIGH**
- **RS2-3 (NEW)**: BondingV5.cancelLaunch() violates CEI — external call (safeTransfer) before state update (zeroing initialPurchase). Depth must verify: (1) can the assetToken (VIRTUAL in production) be upgraded to a callback-bearing token (ERC777), (2) is there a real reentrancy path during token transfer callbacks, (3) does current ERC20 VIRTUAL tokenomics have any auto-swap or reflection that could trigger cascading transfers?
- **PC1-12 (NEW)**: setRouter(address(0)) not blocked — subsequent createPair() calls all revert. Depth must verify: (1) is setRouter ever called post-initialization in production, (2) what is the expected admin workflow around router updates, (3) are there safeguards in the admin UI/backend to prevent zero-address router?
- **EP-14**: 4 sequential AgentFactory calls at graduation — any single role revocation bricks all. Depth must enumerate which specific AgentFactory roles are required for each call and verify BondingV5 holds all of them in the current deployment.
- **AC-1 + AC-8**: Two independent drain vectors (graduate() and approval()). Depth should verify: are both vectors simultaneously available to beOpsWallet? Does fixing AC-1 also close AC-8?
- **TE-4 / AC-5**: EXECUTOR can set taxStartTime to far-future, creating indefinite 99% tax. Confirm: is there any user recourse (e.g., wait for EXECUTOR to be revoked, use different buying path)?

**Priority: MEDIUM**
- **MG-2**: Deprecated storage slots N+2,N+3 in FRouterV2. Depth must: verify exact storage slot positions including OZ Initializable and AccessControlUpgradeable gap sizes, and determine if any production upgrade has already modified the layout.
- **TE-1 / MG-4**: teamTokenReservedWallet read at preLaunch and launch. Depth should trace: is there a transaction ordering attack where a user could race condition between a config change and their launch() call?

### Edge Case Domain

**Priority: HIGH**
- **EC-1 / EC-3 / EC-4**: Parameter boundary failures — buyTax >= 100 causes underflow revert, sellTax >= 101 causes underflow revert, fakeInitialVirtualLiq = 0 causes division by zero. Depth should verify the exact Solidity 0.8.x checked arithmetic behavior for each case and whether any of these can be set as a misconfiguration during normal protocol operation (e.g., copy-paste error in deployment script).
- **EC-2**: targetRealVirtual = 0 causes instant graduation. Depth should verify: is targetRealVirtual validated in setCommonParams or setBondingCurveParams? If set to 0, what is the attack flow?
- **SLITHER-1**: Divide-before-multiply in BondingV2/V3/V4 liquidity calculation. Depth must verify: for the actual K and assetRate values used in production, does `K * 10000 < assetRate`? What is the precision loss in wei terms?

**Priority: MEDIUM**
- **TE-3**: Validator timestamp manipulation on 60s anti-sniper. Depth should verify: is this exploitable on the actual production chain (Base)? Base uses a centralized sequencer — what is the timestamp manipulation window?
- **TF-4**: FPairV2.swap() does not validate K invariant. Depth should model: given a compromised router, what is the minimum number of operations needed to extract all funds without a K check?
- **EC-11**: maxTx never enforced. Depth should determine: was this intentionally removed in V5? If so, is there a frontend/backend limit that compensates?

### External Dependency Domain

**Priority: CRITICAL**
- **EP-10 / TF-3 / SE-1** (repeated from Token Flow — highest priority): Production AgentToken whitelist for BondingV5 and transfer tax behavior at all protocol touchpoints.

**Priority: HIGH**
- **EP-7**: drainUniV2Pool requires founder pre-approval of AgentFactory for veTokens. Depth must determine: is there a protocol flow that creates this approval? Or is it purely an off-chain assumption?
- **EP-11**: veToken interface spoofing. Depth should: (a) verify if drainUniV2Pool is callable by non-BondingV5 EXECUTOR addresses (i.e., beOpsWallet), and (b) determine if input validation on the veToken address is done off-chain in the backend.
- **EP-1 / EP-2 / EP-3**: Return value non-validation. Depth must verify: can AgentFactory.createNewAgentTokenAndApplication() realistically return (address(0), 0) without reverting? What factory-internal conditions cause this?

**Priority: MEDIUM**
- **MG-1**: FRouterV3 reverts for non-V5 tokens. Depth should confirm: is there any operational scenario where a non-V5 token pair is registered in FFactoryV3? Check current factory pair registry.
- **EP-12**: Silent failure of setTaxStartTime for old pairs. Depth should check: what pairs are currently in production that lack the setTaxStartTime function?
- **ELEVATE:INLINE_ASSEMBLY**: multicall3 aggregate3Value() — depth should audit for ETH draining via delegatecall patterns and return data manipulation.

---

## Second Opinion Targets

| Finding ID | Domain | Breadth Reasoning | Potential Enablers |
|-----------|--------|-------------------|--------------------|
| MG-5 | Upgrade Safety | REFUTED — OZ Initializable prevents reinit | Depth should verify _disableInitializers in constructor exists for ALL proxy implementations, not just BondingConfig |
| MG-7 | Storage Layout | REFUTED as bug — confirmed separate deployments | If any admin ever attempts to upgrade V4 proxy to V5, this becomes CRITICAL |
| TF-8 | Token Flow | CONTESTED — production AgentToken behavior unverified | Production AgentToken whitelist; auto-swap threshold; reflection logic |
| TF-3 | Token Flow | CONFIRMED but depends on production behavior | Same as TF-8 — BondingV5 whitelist status in AgentToken |
| EP-10 | External Precond | CONFIRMED but depends on production AgentToken | BondingV5 must be on AgentToken's valid caller/whitelist to avoid tax |

---

## File Coverage Map

See `/Users/lisanaaa/Documents/virtuals_protocol/vp_launchpad_suite/protocol-contracts/.plamen/file_coverage.md` for detailed coverage.

**In-Scope Files Analyzed:**
1. BondingV2.sol — COVERED (B2, B3, B4, B5, B1)
2. BondingV3.sol — COVERED (B3, B5)
3. BondingV4.sol — COVERED (B2, B3, B5)
4. BondingV5.sol — COVERED (B1, B2, B3, B4, B5, B6)
5. BondingConfig.sol — COVERED (B2, B3, B4, B5, B6)
6. FPairV2.sol — COVERED (B1, B4, B5)
7. IFPairV2.sol — COVERED (B5 interface)
8. FFactoryV2.sol — COVERED (B2, B5)
9. FFactoryV3.sol — COVERED (B2, B5)
10. FRouterV2.sol — COVERED (B1, B2, B3, B4, B5, B6)
11. FRouterV3.sol — COVERED (B1, B2, B3, B4, B5, B6)
12. multicall3.sol — PARTIAL (noted in static_analysis, not deeply analyzed)

---

## Chain-Escalated Findings

| Low Finding ID | Postcondition | Matches Medium+ Precondition | Medium+ Finding ID | Escalation Tag |
|----------------|---------------|------------------------------|---------------------|----------------|
| AC-9 (Low: privilegedLauncher blocks launch) | DOS on special token launch | Users cannot buy → no graduation → VIRTUAL locked | EP-8 (Critical: permanent pool DoS) | CHAIN_ESCALATED: enables EP-8 scenario via non-graduation path |
| MG-6 (Low: no asset recovery for V2-V4 dust) | STRANDED_ASSETS in non-Project60days pairs | Dust permanently locked → no admin recovery | EP-8 (Critical: DoS) | CHAIN_ESCALATED: administrative gap similar to EP-8 DoS scenario |
| MG-3 (Low/PARTIAL: config swap affects future tokens) | Future tokens get wrong params | New preLaunch with zero gradThreshold → instant graduation | EC-2 (High: targetRealVirtual=0) | CHAIN_ESCALATED: enables EC-2 via malicious config with targetRealVirtual=0 |
| EP-6 (Low: founder() return not validated) | Safe-by-accident via veTokenAmount > 0 check | If founder is non-zero but has 0 balance, drain fails silently | EP-7 (High: founder approval gap) | CHAIN_ESCALATED: both contribute to drainUniV2Pool operational failure |
| TF-7 (Low: Pool.lastUpdated dead storage) | GAS_WASTE on every swap | Higher gas costs → reduced economic viability for small trades | EC-11 (Medium: no maxTx limit) | CHAIN_ESCALATED: combined high gas + large single trades worsen UX |
| EC-7 (Low: rounding dust, zero tax for small amounts) | TAX_ROUNDING loses small tax amounts | Accumulated precision loss over many micro-transactions | SLITHER-1 (Medium: divide-before-multiply) | CHAIN_ESCALATED: both represent precision loss patterns from integer math |
| EVT-4 (Low: no events on buy/sell) | MONITORING_GAP for trade activity | Silent state changes undetectable → delayed response to AC-3 tax manipulation | EVT-8 (High: setTaxParams silent) | CHAIN_ESCALATED: enables AC-3 to go undetected longer |
| EC-5 (Low: K overflow at extreme params) | Possible K = 0 or overflow | K = 0 breaks getAmountsOut() division → same effect as EC-4 | EC-4 (High: fakeInitialVirtualLiq=0) | CHAIN_ESCALATED: K overflow produces same division-by-zero downstream path |
