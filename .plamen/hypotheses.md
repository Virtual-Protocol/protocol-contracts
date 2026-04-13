# Hypotheses

## Hypothesis Table

| H-ID | Title | Severity | Component Findings | Group | Verification Priority |
|------|-------|----------|--------------------|-------|----------------------|
| H-1 | EXECUTOR_ROLE Can Graduate Any Pair, Draining All Bonding Curve Pools | Critical | AC-1, [BLIND-C4 chain] | EXECUTOR Abuse | P1 |
| H-2 | Graduation Failure — Permanent Per-Token DoS With No Admin Recovery | Critical | EP-8, DEPTH-ST-1, DA Iter2 refinement | Graduation DoS | P1 |
| H-3 | EXECUTOR_ROLE Anti-Sniper Tax Manipulation — Permanent Buy Freeze | High | AC-5, DEPTH-ST-6 | EXECUTOR Abuse | P2 |
| H-4 | AgentFactory BONDING_ROLE Revocation Triggers Systemic Graduation DoS | High | EP-14, EP-14-R (Iter3) | Graduation DoS | P2 |
| H-5 | drainUniV2Pool Unrestricted Recipient — EXECUTOR Redirects Graduated LP | Medium | EP-11, EP-11-R (Iter3) | EXECUTOR Abuse | P3 |
| H-6 | Global Tax Parameter Without Upper Bound — Admin-Settable DoS on Buy/Sell | High | DEPTH-EC-1 (buyTax>=100), DEPTH-EC-2 (sellTax>=100), SP-1 (FRouterV3 sellTax), SP-2 (antiSniperBuyTaxStartValue), DA-TF-2 | Tax Arithmetic | P2 |
| H-7 | fakeInitialVirtualLiq=0 Division-by-Zero Blocks All New Launches | High | DEPTH-EC-3, DEPTH-EC-4 (targetRealVirtual=0) | Admin Param Validation | P2 |
| H-8 | antiSniperTaxVault Zero-Address Bricks All Buys in Anti-Sniper Window | High | BLIND-A1 | Admin Param Validation | P2 |
| H-9 | setScheduledLaunchParams MAX_UINT Fees — Permanent DoS on Scheduled/ACF Launches | High | BLIND-A2 | Admin Param Validation | P3 |
| H-10 | cancelLaunch CEI Violation Across All Bonding Versions — Potential Double-Refund | Medium | RS2-3 (BondingV5), SP-3 / BLIND-B1 (BondingV2/V3/V4) | CEI Violation | P3 |
| H-11 | Graduation Donation Attack — Inflation of AgentFactory Application Threshold | Medium | TF-1 (EP-5), DEPTH-TF-3, DE-4, SP-4 (BondingV2/V3/V4) | Donation Attack | P3 |
| H-12 | drainPrivatePool Stale Reserve After Failed syncAfterDrain — Buy DoS on Old FPairV2 | Medium | DA-EP12-1 | Token Flow | P3 |
| H-13 | FFactory.setRouter() Accepts address(0) — All New Pair Creation Fails | Medium | DEPTH-ST-4 | Admin Param Validation | P3 |
| H-14 | FRouterV3 Depends on bondingV5.tokenAntiSniperType() Without Try/Catch — Hard DoS for Non-V5 Tokens | Medium | DEPTH-ST-9, DE-5, BLIND-B3 (consolidated) | Router Config | P3 |
| H-15 | Deprecated Storage Slots in FRouterV2 — Upgrade Collision Risk | Medium | DEPTH-ST-8, MG-2 | Storage Layout | P3 |
| H-16 | antiSniperBuyTaxStartValue + buyTax Sum Not Enforced — Silent Anti-Sniper Cap Corruption | Medium | DST-2 | Tax Arithmetic | P3 |
| H-17 | multicall3 Aggregate Functions Allow Admin to Bypass onlyOwner — Token Drain | Medium | VS-6 | Access Control | P3 |
| H-18 | BondingConfig.setCommonParams() feeTo Zero-Address Bricks Paid Launches | Medium | BLIND-A3 | Admin Param Validation | P3 |
| H-19 | BondingConfig.setDeployParams() tbaImplementation Zero-Address Corrupts Token Creation | Medium | BLIND-A4 | Admin Param Validation | P3 |
| H-20 | BondingConfig setTeamTokenReservedWallet(address(0)) Bricks X_LAUNCH / ACP_SKILL Launches | Medium | BLIND-A5 | Admin Param Validation | P3 |
| H-21 | teamTokenReservedWallet TOCTOU — Creator Initial Buy Tokens Redirectable | Low | SP-5, TE-1, MG-4, DA-TE-2-UPDATE | Config Staleness | P4 |
| H-22 | cancelLaunch Permanently Locks bondingCurveSupply Tokens — No Recovery Path | Medium | DST-3 | Design Gap | P3 |
| H-23 | DEFAULT_ADMIN_ROLE Can Self-Revoke, Locking Role Management Permanently | Medium | BLIND-C1 | Role Lifecycle | P3 |
| H-24 | OwnableUpgradeable.renounceOwnership() Unguarded on BondingV5 and BondingConfig | Medium | BLIND-B2, BLIND-C2 (dedup — same finding) | Role Lifecycle | P3 |
| H-25 | FFactoryV2/V3 CREATOR_ROLE and ADMIN_ROLE Not Granted in initialize() | Low | DEPTH-ST-3, PC1-10 | Initialization | P4 |
| H-26 | FRouterV3/V2.addInitialLiquidity() Missing nonReentrant Guard | Low | VS-4 | Guard Coverage | P4 |
| H-27 | EXECUTOR_ROLE Self-Removal via renounceRole() Permanently Halts All Trading | High | BLIND-C4 | Role Lifecycle | P2 |
| H-28 | buy() Declared payable — ETH Permanently Trapped in All Bonding Contracts | Low | CBS-1 | ETH Handling | P4 |
| H-29 | BondingV2/V3/V4 buy()/sell() Blocked — EXECUTOR_ROLE Never Granted to V2/V3/V4 Bonding | Informational | BLIND-C6 | Dead Code | P5 |
| H-30 | FRouterV2/V3 graduate() and addInitialLiquidity() Emit No Events | Low | EVT-13, EVT-14 | Event Completeness | P4 |
| H-31 | FPairV2 priceALast/priceBLast Always Returns Incorrect Value | Low | DA-1, DA-2 | Dimensional / Price Oracle | P4 |
| H-32 | Anti-Sniper Window Duration Inconsistency Between Router Versions | Informational | SC-2, SC-3, SC-4, RS2-8 | Version Consistency | P5 |
| H-33 | Silent Admin State Changes Without Events — 23+ Setters Emit No Event | Low | AC-7, EVT-4, EVT-5, EVT-6, EVT-7, EVT-8, EVT-9, EVT-10, EVT-11, EVT-16 | Event Completeness | P4 |
| H-34 | BondingV4 cancelLaunch Emits Zeroed initialPurchase Value | Low | SP-6, EVT-1 | Event Accuracy | P4 |
| H-35 | BondingV5/V2/V3/V4 Graduation Reads balanceOf (Not Tracked Reserve) — Donation Surface Confirmed | Medium | DEPTH-TF-3, DE-4, SP-4 (consolidated with H-11) | Donation Attack | — |
| H-36 | Graduated Event Missing agentToken Index and Graduation Amounts | Low | EVT-12 | Event Completeness | P4 |
| H-37 | DST-1: Creator Can Buy Entire Bonding Supply, Triggering Instant Graduation | Medium | DST-1 | Economic Design | P3 |
| H-38 | DST-4: Global bondingCurveParams Change Creates Two-Tier Graduation Regime | Low | DST-4 | Economic Design | P4 |
| H-39 | DST-5: Router bondingV5/bondingConfig References Not Cross-Validated — Upgrade Window DoS | Medium | DST-5 | Config Coherence | P3 |
| H-40 | DA-TF-1: FRouterV3.sell() Computes amountOut Before Transfer | Low | DA-TF-1 | Token Flow | P4 |
| H-41 | BondingV2/V3 cancelLaunch Does Not Set trading=false — Inconsistent Post-Cancel State | Low | DEPTH-ST-10, SC-5 | State Consistency | P4 |
| H-42 | DE-1: drainUniV2Pool Requires Founder Off-Chain Pre-Approval — Function Always Reverts Without It | High | DE-1 | External Dependency | P2 |
| H-43 | antiSniperBuyTaxStartValue Comment Declares "Basis Points" — Documentation/Misconfiguration Risk | Informational | SC-1 | Documentation | P5 |
| H-44 | BondingV4.preLaunch() Always Reverts — Dead API Surface | Informational | BLIND-C7 (BondingV3, BondingV4 preLaunch dead code) | Dead Code | P5 |
| H-45 | multicall3.batchTransferTokens() Non-Functional for Admin Callers | Low | VS-5 | Access Control | P4 |
| H-46 | EP-5/TF-1 Donation Attack on assetBalance at Graduation — Consolidated into H-11 | — | See H-11 | — | — |
| H-47 | PC1-3: Multicall3 One-Step Ownership Transfer — No revoke Path if Compromised | Low | BLIND-C3, PC1-3 | Role Lifecycle | P4 |
| H-48 | FFactoryV2/V3.createPair() Allows Duplicate Pair Overwrite | Low | RS2-4 (downgraded) | Factory | P4 |
| H-49 | Storage Layout Safety — No __gap in Any Upgradeable Contract | Medium | SLS-1 | Storage Layout | P3 |
| H-50 | FRouterV2 Deprecated taxManager/antiSniperTaxManager Slot Hazard on Upgrade | Medium | DEPTH-ST-8, MG-2 (consolidated into H-15) | — | — |
| H-51 | FRouterV3.sell() depositTax Called With Zero Amount — DoS When sellTax=0 | Medium | DEPTH-EC-5 | Tax Arithmetic | P3 |
| H-52 | EXECUTOR_ROLE Unrestricted taxStartTime — Can Set type(uint256).max for Permanent 99% Tax | High | DEPTH-ST-6 (AC-5 extends) | EXECUTOR Abuse | P2 |

---

> NOTE: H-35 and H-46 are consolidated into H-11. H-50 is consolidated into H-15. See Finding Mapping for full merges.

---

## Hypothesis Details

### H-1: EXECUTOR_ROLE Can Graduate Any Pair, Draining All Bonding Curve Pools
**Severity**: Critical
**Component Findings**: AC-1
**Root Cause**: FRouterV3.graduate() has EXECUTOR_ROLE gate but no validation that the target token originated from BondingV5. beOpsWallet EOA holds EXECUTOR_ROLE directly, so it can call graduate() on any pair in FFactoryV3, immediately draining all VIRTUAL and agent tokens to msg.sender.
**Preconditions**: beOpsWallet EOA account is controlled; pair exists in FFactoryV3
**Postconditions Created**: All VIRTUAL in all FPairV2 pairs drained to attacker; all agent tokens extracted; graduated state set on pair

---

### H-2: Graduation Failure — Permanent Per-Token DoS With No Admin Recovery
**Severity**: Critical
**Component Findings**: EP-8, DEPTH-ST-1, iter2 refinement (small buys still work, but graduation-triggering buys always revert)
**Root Cause**: _openTradingOnUniswap() makes 4 sequential external calls to AgentFactory with no try/catch. If any call reverts (AgentFactory paused, interface changed), the entire buy() reverts. tokenInfo[token].trading remains true, so every subsequent buy re-triggers the failing graduation path. No admin setter exists for trading/tradingOnUniswap/tokenGradThreshold. cancelLaunch() blocked by launchExecuted=true.
**Preconditions**: AgentFactory must fail during graduation (pause, role revocation, upgrade); token must be at or above graduation threshold
**Postconditions Created**: Permanent graduation loop — every graduation-triggering buy reverts indefinitely; small buys technically still work; only sell() path remains; no admin recovery without proxy upgrade

---

### H-3: EXECUTOR_ROLE Anti-Sniper Tax Manipulation — Permanent Buy Freeze
**Severity**: High
**Component Findings**: AC-5, DEPTH-ST-6
**Root Cause**: FRouterV3.setTaxStartTime() is EXECUTOR_ROLE gated with only a floor check (>= startTime). EXECUTOR can set taxStartTime = type(uint256).max, making block.timestamp < taxStartTime always true, permanently applying 99% anti-sniper tax to all buys on that pair. Users can still sell.
**Preconditions**: beOpsWallet EOA (holds EXECUTOR_ROLE) calls setTaxStartTime(pair, type(uint256).max)
**Postconditions Created**: 99% anti-sniper tax on all buys for that pair permanently; graduation becomes impossible (buy amounts too small to move reserves); token effectively dead for buyers

---

### H-4: AgentFactory BONDING_ROLE Revocation Triggers Systemic Graduation DoS
**Severity**: High
**Component Findings**: EP-14, EP-14-R (Iter3 confirmed independent)
**Root Cause**: BondingV5 graduation requires BONDING_ROLE on AgentFactoryV7 (for 3 calls) AND EXECUTOR_ROLE on FRouterV3 (for graduate()). AgentFactory has separate governance from BondingV5 owner. Role revocation by AgentFactory admin permanently bricks ALL tokens at graduation threshold on this BondingV5 instance. BondingV5 has no pre-flight role check and no restoration mechanism.
**Preconditions**: AgentFactory admin revokes BONDING_ROLE from BondingV5 (may be independent multisig); tokens at or near graduation threshold exist
**Postconditions Created**: Activates H-2 (graduation DoS) for all current graduation-eligible tokens; see H-2 for full consequence

---

### H-5: drainUniV2Pool Unrestricted Recipient — EXECUTOR Redirects Graduated LP
**Severity**: Medium
**Component Findings**: EP-11, EP-11-R (Iter3 confirmed distinct from AC-1/AC-8)
**Root Cause**: FRouterV3.drainUniV2Pool() accepts an unrestricted `recipient` parameter. EXECUTOR_ROLE (beOpsWallet) can call this directly for any Project60days token, draining the founder's entire Uniswap V2 LP position to any arbitrary address. amountAMin=0, amountBMin=0 — no slippage protection.
**Preconditions**: Token is Project60days; founder has pre-approved AgentFactory for veToken spend (per EP-7/DE-1); beOpsWallet calls drainUniV2Pool with attacker-controlled recipient
**Postconditions Created**: Founder's entire Uniswap LP position drained to arbitrary third party; Uniswap pool depleted; founder cannot recover LP without on-chain legal mechanism

---

### H-6: Global Tax Parameter Without Upper Bound — Admin-Settable DoS on Buy/Sell
**Severity**: High
**Component Findings**: DEPTH-EC-1 (buyTax>=100), DEPTH-EC-2 (sellTax>=100), SP-1 (FRouterV3 sellTax), SP-2 (antiSniperBuyTaxStartValue combined), DA-TF-2
**Root Cause**: FFactoryV2/V3.setTaxParams() accepts buyTax, sellTax, antiSniperBuyTaxStartValue with no upper bound. buyTax>=100 triggers 99-normalTax underflow in router (EC-1). sellTax>=101 triggers amountOut-txFee underflow (EC-2, SP-1). antiSniperBuyTaxStartValue>=100 with high buyTax triggers same underflow (SP-2).
**Preconditions**: ADMIN_ROLE calls setTaxParams with out-of-range value; affects ALL pairs on that factory globally
**Postconditions Created**: Global DoS on all buys (buyTax>=100), all sells (sellTax>=101), or all anti-sniper buys (startValue+buyTax combo)

---

### H-7: fakeInitialVirtualLiq=0 / targetRealVirtual=0 — Division by Zero Blocks All New Launches
**Severity**: High
**Component Findings**: DEPTH-EC-3 (fakeInitialVirtualLiq=0), DEPTH-EC-4 (targetRealVirtual=0)
**Root Cause**: BondingConfig.setBondingCurveParams() has no validation. fakeInitialVirtualLiq=0 causes division-by-zero in preLaunch(). targetRealVirtual=0 causes instant graduation (gradThreshold=bondingCurveSupply) on first post-anti-sniper buy. Same setter, different failure modes.
**Preconditions**: BondingConfig owner calls setBondingCurveParams with zero field(s)
**Postconditions Created**: All new token launches fail with division-by-zero (0 case); or all new tokens graduate instantly with no real liquidity (0 targetRealVirtual case)

---

### H-8: antiSniperTaxVault Zero-Address Bricks All Buys in Anti-Sniper Window
**Severity**: High
**Component Findings**: BLIND-A1
**Root Cause**: FFactoryV2/V3.setTaxParams() validates taxVault != address(0) but NOT antiSniperTaxVault. Setting antiSniperTaxVault=address(0) causes safeTransferFrom(to, address(0), antiSniperTxFee) to revert on any buy during anti-sniper window.
**Preconditions**: ADMIN_ROLE calls setTaxParams with antiSniperTaxVault_=address(0)
**Postconditions Created**: All buy() calls during anti-sniper window revert; tokens launched after misconfiguration have bricked anti-sniper windows

---

### H-9: setScheduledLaunchParams MAX_UINT Fees — Permanent DoS on Scheduled/ACF Launches
**Severity**: High
**Component Findings**: BLIND-A2
**Root Cause**: BondingConfig.setScheduledLaunchParams() has no validation on normalLaunchFee or acfFee. If set to MAX_UINT, calculateLaunchFee() returns MAX_UINT, and purchaseAmount_ < launchFee always reverts in preLaunch(), permanently bricking all X_LAUNCH and ACP_SKILL mode launches.
**Preconditions**: BondingConfig owner sets normalLaunchFee or acfFee to MAX_UINT (or very large value)
**Postconditions Created**: All scheduled and ACF launches permanently revert; only immediate non-ACF launches unaffected

---

### H-10: cancelLaunch CEI Violation Across All Bonding Versions — Potential Double-Refund
**Severity**: Medium
**Component Findings**: RS2-3 (BondingV5), SP-3 (BondingV2/V3/V4), BLIND-B1 (same as SP-3)
**Root Cause**: All four Bonding versions violate CEI in cancelLaunch(). safeTransfer(creator, initialPurchase) is called before initialPurchase=0 and launchExecuted=true. None of V2/V3/V4 have nonReentrant. Currently blocked by VIRTUAL being standard ERC-20, but exploitable if VIRTUAL upgrades to include callbacks.
**Preconditions**: Asset token must have transfer callbacks (ERC-777 hook, EIP-1363, or VIRTUAL proxy upgrade adding hooks)
**Postconditions Created**: Double-refund of initialPurchase draining Bonding contract's shared VIRTUAL balance (all creators' initial purchases held in shared pool)

---

### H-11: Graduation Donation Attack — Inflation of Graduation Amounts via balanceOf
**Severity**: Medium
**Component Findings**: TF-1 (EP-5), DEPTH-TF-3 (quantified), DE-4, SP-4 (extended to V2/V3/V4)
**Root Cause**: BondingV5 (and V2/V3/V4) reads pairContract.assetBalance() and pairContract.balance() at graduation — both are raw balanceOf(address(this)), not tracked reserves. An attacker can donate VIRTUAL or agent tokens to the pair pre-graduation. Agent token donation distorts Uniswap pool initialization ratio (lower initial price), enabling post-graduation arbitrage. VIRTUAL donation is economically irrational (attacker always loses money per iter2 analysis).
**Preconditions**: Attacker donates agent tokens to FPairV2 before graduation-triggering buy; MEV available on Base
**Postconditions Created**: Uniswap pool initialization price distorted; attacker can arbitrage mispriced initial price

---

### H-12: drainPrivatePool Stale Reserve After Failed syncAfterDrain — Buy DoS on Old FPairV2
**Severity**: Medium
**Component Findings**: DA-EP12-1
**Root Cause**: FRouterV3.drainPrivatePool() calls pair.syncAfterDrain() in a try/catch. On old FPairV2 contracts (pre-syncAfterDrain), the call fails silently. Pair reserves remain stale (pointing to drained amounts). Subsequent buy() reads stale reserve data, computes getAmountsOut incorrectly, and the underlying swap reverts because actual balance is insufficient.
**Preconditions**: Token is Project60days; FPairV2 contract predates syncAfterDrain feature; drainPrivatePool called once
**Postconditions Created**: All subsequent buy() calls for that token revert permanently; token effectively frozen for buyers

---

### H-13: FFactoryV2/V3.setRouter(address(0)) — All New Pair Creation Fails
**Severity**: Medium
**Component Findings**: DEPTH-ST-4, PC1-12
**Root Cause**: FFactoryV2/V3.setRouter() has no zero-address check. Setting router=address(0) causes _createPair() to revert at require(router != address(0)). All existing pairs still function but no new tokens can launch until admin corrects the router.
**Preconditions**: ADMIN_ROLE calls setRouter(address(0)) — accidental or malicious
**Postconditions Created**: All new token launches blocked; existing pairs unaffected; recoverable by re-setting router

---

### H-14: FRouterV3 tokenAntiSniperType() Reverts for Non-V5 Tokens — Hard DoS
**Severity**: Medium
**Component Findings**: DEPTH-ST-9, DE-5, BLIND-B3
**Root Cause**: FRouterV3._calculateAntiSniperTax() calls bondingV5.tokenAntiSniperType(token) with no try/catch. BondingV5 reverts with InvalidTokenStatus() for any token not created by it. Any non-V5 token pair registered in FFactoryV3 (misconfiguration, future migration, or admin error) becomes permanently untradeable. Also: if bondingV5 or bondingConfig references are unset/misconfigured at deployment, ALL buys fail.
**Preconditions**: Non-BondingV5 token registered in FFactoryV3 (via admin error or migration); OR bondingV5/bondingConfig references set incorrectly
**Postconditions Created**: All buy() calls for that token revert; sell() still works (no tokenAntiSniperType call in sell path)

---

### H-15: FRouterV2 Deprecated Storage Slots — Upgrade Collision Risk
**Severity**: Medium
**Component Findings**: DEPTH-ST-8, MG-2
**Root Cause**: FRouterV2 has deprecated storage declarations for taxManager (slot 103) and antiSniperTaxManager (slot 104). If a future upgrade removes these declarations, bondingV2 shifts from slot 105 to slot 103, reading old taxManager address data instead. This silently corrupts bondingV2/bondingV4 references.
**Preconditions**: Future FRouterV2 proxy upgrade removes deprecated slot declarations
**Postconditions Created**: Storage corruption — bondingV2 reads old taxManager address; all V2-bonded token operations on FRouterV2 behave incorrectly

---

### H-16: antiSniperBuyTaxStartValue + buyTax Sum Not Validated — Silent Anti-Sniper Cap Corruption
**Severity**: Medium
**Component Findings**: DST-2
**Root Cause**: setTaxParams() allows independent setting of antiSniperBuyTaxStartValue and buyTax without enforcing antiSniperBuyTaxStartValue + buyTax <= 99. The router silently caps antiSniperTax to 99-normalTax, meaning the actual anti-sniper tax is always less than configured. With typical production values (antiSniperBuyTaxStartValue=99, buyTax=1), snipers pay 98% peak instead of 99%.
**Preconditions**: Both parameters set with ADMIN_ROLE; sum exceeds 99
**Postconditions Created**: Anti-sniper protection is silently weaker than configured; monitoring systems see wrong configured value

---

### H-17: multicall3 Aggregate Functions Allow Admin to Drain Protocol Tokens Without Owner Approval
**Severity**: Medium
**Component Findings**: VS-6
**Root Cause**: All multicall3 aggregate functions are protected by onlyOwnerOrAdmin and execute arbitrary (target, callData) pairs via low-level call. An admin can encode a direct ERC20.transfer() call targeting tokens held by multicall3, bypassing the onlyOwner restriction on transferToken(). Admins can drain any token held by the multicall3 contract.
**Preconditions**: Admin account controlled; multicall3 holds ERC20 token balance or has approvals
**Postconditions Created**: Admin drains token balance from multicall3 without owner involvement

---

### H-18: BondingConfig.setCommonParams() feeTo Zero-Address Bricks All Paid Launches
**Severity**: Medium
**Component Findings**: BLIND-A3
**Root Cause**: setCommonParams() has no zero-address check on feeTo. Setting feeTo=address(0) causes safeTransferFrom(msg.sender, address(0), launchFee) to revert for all paid launches (scheduled + ACF).
**Preconditions**: BondingConfig owner sets feeTo=address(0)
**Postconditions Created**: All paid preLaunch() calls revert; immediate launches with zero fee unaffected

---

### H-19: BondingConfig.setDeployParams() tbaImplementation Zero-Address Corrupts Token Creation
**Severity**: Medium
**Component Findings**: BLIND-A4
**Root Cause**: setDeployParams() has no zero-address check on tbaImplementation. Zero address passed to agentFactory.createNewAgentTokenAndApplication() may cause DoS or silent TBA corruption depending on AgentFactory behavior (external dependency, R4 escalation applied).
**Preconditions**: BondingConfig owner sets tbaImplementation=address(0)
**Postconditions Created**: All new token launches DoS or produce tokens with broken/absent TBA functionality

---

### H-20: setTeamTokenReservedWallet(address(0)) Bricks X_LAUNCH / ACP_SKILL Launches
**Severity**: Medium
**Component Findings**: BLIND-A5
**Root Cause**: setTeamTokenReservedWallet() has no zero-address check. X_LAUNCH and ACP_SKILL modes always have totalReservedSupply > 0. safeTransfer(address(0), reservedTokens) reverts for standard ERC20.
**Preconditions**: BondingConfig owner sets teamTokenReservedWallet=address(0); any X_LAUNCH or ACP_SKILL preLaunch attempted
**Postconditions Created**: All X_LAUNCH / ACP_SKILL preLaunch() calls revert; normal immediate launches with no reserved supply unaffected

---

### H-21: teamTokenReservedWallet TOCTOU — Only Creator Initial Buy Tokens Redirectable
**Severity**: Low
**Component Findings**: SP-5 (V3/V4), TE-1, MG-4, DA-TE-2-UPDATE (revised scope)
**Root Cause**: launch() reads bondingConfig.teamTokenReservedWallet() live at call time. Owner can change wallet between preLaunch() and launch(). Critically, the large reserved supply (airdrop+ACF) is transferred at preLaunch time so is NOT affected. Only the creator's initial buy output (amountOut) is redirectable in this window.
**Preconditions**: Owner changes teamTokenReservedWallet between preLaunch and launch; economic value of creator's initial buy output
**Postconditions Created**: Creator's initial buy tokens sent to wrong wallet; reserved supply unaffected

---

### H-22: cancelLaunch Permanently Locks bondingCurveSupply in FPairV2 — No Recovery
**Severity**: Medium
**Component Findings**: DST-3
**Root Cause**: cancelLaunch() refunds initialPurchase VIRTUAL but leaves bondingCurveSupply agent tokens permanently in FPairV2. State machine after cancel: trading=false, launchExecuted=true — blocks all future trading. drainPrivatePool requires isProject60days=true. No general drain exists for cancelled tokens. EXECUTOR can drain via direct FRouterV3.graduate() call but tokens go to EXECUTOR, not creator.
**Preconditions**: Creator calls cancelLaunch()
**Postconditions Created**: ~450M-1B agent tokens permanently locked in FPairV2; not burned, not recoverable; inflates supply for any airdrop recipients

---

### H-23: DEFAULT_ADMIN_ROLE Self-Revocation Permanently Locks Role Management
**Severity**: Medium
**Component Findings**: BLIND-C1
**Root Cause**: OZ AccessControlUpgradeable.renounceRole(DEFAULT_ADMIN_ROLE, self) can be called by the DEFAULT_ADMIN_ROLE holder. Since DEFAULT_ADMIN_ROLE is its own admin, no external party can re-grant it. This prevents future revokeRole/grantRole on EXECUTOR_ROLE and ADMIN_ROLE. If combined with prior EXECUTOR_ROLE grant to attacker, becomes irrecoverable.
**Preconditions**: DEFAULT_ADMIN_ROLE EOA compromised; attacker calls renounceRole after granting EXECUTOR_ROLE to self
**Postconditions Created**: EXECUTOR_ROLE cannot be revoked; ADMIN_ROLE permanently frozen; EXECUTOR_ROLE holder (attacker) retains all trading control indefinitely

---

### H-24: OwnableUpgradeable.renounceOwnership() Unguarded — BondingV5 and BondingConfig Admin Permanently Frozen
**Severity**: Medium
**Component Findings**: BLIND-B2, BLIND-C2 (same finding, different scanner)
**Root Cause**: BondingV5 and BondingConfig both inherit OwnableUpgradeable which exposes renounceOwnership() as a public function callable by current owner with no override preventing the call. One call permanently sets owner=address(0), blocking all onlyOwner setters on both contracts. No UUPS upgrade path confirmed to exist.
**Preconditions**: Owner EOA calls renounceOwnership() (accidental or after compromise)
**Postconditions Created**: All BondingConfig setters permanently locked; BondingV5.setBondingConfig() permanently locked; protocol configuration frozen at last set values

---

### H-25: FFactoryV2/V3 CREATOR_ROLE / ADMIN_ROLE Not Granted in initialize()
**Severity**: Low
**Component Findings**: DEPTH-ST-3, PC1-10
**Root Cause**: FFactoryV2/V3.initialize() grants only DEFAULT_ADMIN_ROLE to deployer. CREATOR_ROLE and ADMIN_ROLE must be granted in separate post-deployment transactions. A window exists between initialize() and role-granting where the factory is non-functional. Recovery is always possible by the DEFAULT_ADMIN_ROLE holder.
**Preconditions**: Deployment interrupted after initialize() but before role-granting transactions
**Postconditions Created**: Factory permanently non-functional for createPair() and setTaxParams() until roles are granted (recoverable)

---

### H-26: FRouterV2/V3.addInitialLiquidity() Missing nonReentrant
**Severity**: Low
**Component Findings**: VS-4
**Root Cause**: addInitialLiquidity() lacks nonReentrant despite making two external calls. If token with ERC-777 callback is used, callback fires during safeTransferFrom before mint() has committed pool state, enabling double-initialization of the pair. Requires CREATOR_ROLE to register malicious token.
**Preconditions**: CREATOR_ROLE registers malicious token with ERC-777 callback; EXECUTOR_ROLE initiates addInitialLiquidity
**Postconditions Created**: Double-initialization of pair reserves for malicious token; pricing distorted for that pair

---

### H-27: EXECUTOR_ROLE Self-Removal via renounceRole() — Permanent Trading Halt Until Remediated
**Severity**: High
**Component Findings**: BLIND-C4
**Root Cause**: Any EXECUTOR_ROLE holder (including beOpsWallet EOA) can call AccessControlUpgradeable.renounceRole(EXECUTOR_ROLE, self). This immediately and irrevocably removes themselves from EXECUTOR_ROLE. Since ALL trading operations (buy, sell, graduate, addInitialLiquidity) require EXECUTOR_ROLE, all trading halts until DEFAULT_ADMIN_ROLE grants the role to a new address. If combined with H-23 (DEFAULT_ADMIN_ROLE also lost), no recovery path exists on-chain.
**Preconditions**: beOpsWallet EOA compromised; attacker calls renounceRole to DoS protocol
**Postconditions Created**: All trading halts protocol-wide; only DEFAULT_ADMIN_ROLE can recover by granting EXECUTOR_ROLE to a new address

---

### H-28: buy() Declared payable — ETH Permanently Trapped
**Severity**: Low
**Component Findings**: CBS-1
**Root Cause**: buy() is declared payable in all Bonding versions but msg.value is never read or forwarded. No receive/fallback/withdrawETH in Bonding contracts. Any ETH sent alongside buy() is permanently trapped.
**Preconditions**: User sends ETH alongside buy() call
**Postconditions Created**: ETH trapped in Bonding contract permanently; no recovery mechanism

---

### H-29: BondingV2/V3/V4 buy()/sell() Always Revert — EXECUTOR_ROLE Never Granted
**Severity**: Informational
**Component Findings**: BLIND-C6
**Root Cause**: FRouterV2.buy() and sell() require EXECUTOR_ROLE (onlyRole(EXECUTOR_ROLE)). BondingV2/V3/V4 do NOT hold EXECUTOR_ROLE on FRouterV2. All buy/sell operations through older Bonding versions revert at the router gate. Buys and sells for all V2/V3/V4 tokens are permanently blocked through the public interface.
**Preconditions**: Any call to BondingV2/V3/V4.buy() or sell()
**Postconditions Created**: Revert — no state change

---

### H-30: FRouterV2/V3.graduate() and addInitialLiquidity() Emit No Events
**Severity**: Low
**Component Findings**: EVT-13, EVT-14
**Root Cause**: Both functions execute large token transfers with no router-layer events emitted. The graduation drain (all VIRTUAL + agent tokens from pair) and pool initialization are completely silent from the router's perspective. Monitoring cannot detect these critical operations from router event logs.
**Preconditions**: Normal protocol operation (graduation, addInitialLiquidity)
**Postconditions Created**: No monitoring visibility for graduation drains and pool initialization at router layer

---

### H-31: FPairV2 priceALast/priceBLast Return Incorrect Values
**Severity**: Low
**Component Findings**: DA-1, DA-2
**Root Cause**: priceALast() = reserve1/reserve0 and priceBLast() = reserve0/reserve1 — both integer division of WAD values with no WAD scaling. priceALast always returns 0 (since reserve1 < reserve0 in typical bonding curve). priceBLast returns a raw integer (e.g., 158730), not WAD-scaled, so consumers expecting a WAD-format price get a 1e18-factor underestimate.
**Preconditions**: Off-chain consumer reads priceALast/priceBLast
**Postconditions Created**: Consumers receive always-zero or wildly underscaled price data

---

### H-32: Anti-Sniper Window Duration Inconsistency Between Router Versions
**Severity**: Informational
**Component Findings**: SC-2 (99s→60s for X_LAUNCH), SC-3 (different decay algorithms), SC-4 (99 min vs 98 min), RS2-8
**Root Cause**: FRouterV2 uses 99-second X_LAUNCH anti-sniper window; FRouterV3/BondingConfig uses ANTI_SNIPER_60S=60 seconds. Decay algorithms differ (step-down integer vs continuous interpolation). Full window is 99 min in V2 vs 98 min (5880s) in V3. These are undocumented behavioral changes with no migration note.
**Preconditions**: Tokens on FRouterV2 vs FRouterV3 share expectations about anti-sniper windows
**Postconditions Created**: Different effective anti-sniper protection per version; V2 tokens get 99s window, V3 tokens get 60s window; UI/monitoring receives misleading anti-sniper data

---

### H-33: Silent Admin State Changes — 23+ Setters Emit No Event
**Severity**: Low
**Component Findings**: AC-7, EVT-4, EVT-5, EVT-6, EVT-7, EVT-8, EVT-9, EVT-10, EVT-11, EVT-16
**Root Cause**: 23+ admin setters across the protocol (FFactoryV2/V3 setTaxParams, FRouterV2 setBondingV2/V4/setTaxManager/setAntiSniperTaxManager, FRouterV3 setBondingV5, BondingV5 setBondingConfig, BondingConfig setScheduledLaunchParams, FPairV2 setTaxStartTime) emit no events. Admin-controlled parameter changes are undetectable from event logs. Critical for DoS scenarios like H-6 and H-8 which compound with silent setters.
**Preconditions**: Admin changes any of the silent setters
**Postconditions Created**: No on-chain record of parameter change; monitoring systems cannot detect misconfiguration

---

### H-34: cancelLaunch Emits Zeroed initialPurchase Value (Post-Zero Emit)
**Severity**: Low
**Component Findings**: SP-6, EVT-1 (BondingV2/V3/V4)
**Root Cause**: BondingV2/V3/V4.cancelLaunch() zeros _token.initialPurchase BEFORE emitting CancelledLaunch event, which passes initialPurchase as an argument. Event always emits 0. Monitoring systems cannot determine how much was refunded from events alone.
**Preconditions**: Creator calls cancelLaunch() on V2/V3/V4 token
**Postconditions Created**: CancelledLaunch event emits initialPurchase=0 regardless of actual refunded amount

---

### H-36: Graduated Event Missing agentToken Index and Graduation Economics
**Severity**: Low
**Component Findings**: EVT-12
**Root Cause**: BondingV5 emits Graduated(indexed token, address agentToken) but agentToken is not indexed and assetBalance/tokenBalance amounts are not included. Off-chain indexers cannot filter by agentToken efficiently. Graduation economics are not auditable from events.
**Preconditions**: Normal graduation operation
**Postconditions Created**: Off-chain monitoring gap for graduation economics; post-incident analysis requires state replay not event reading

---

### H-37: Creator Can Buy Entire Bonding Supply — Instant Graduation During launch()
**Severity**: Medium
**Component Findings**: DST-1
**Root Cause**: preLaunch() has no upper bound on purchaseAmount_. Creator can set initialPurchase large enough to trigger graduation inside launch(). The initial buy is exempt from anti-sniper tax (isInitialPurchase=true). Token graduates before any public buyer can participate.
**Preconditions**: Creator deposits enough VIRTUAL as purchaseAmount_ to trigger graduation threshold; AgentFactory functional at launch time
**Postconditions Created**: Token graduates during launch() with zero public participation; creator holds all initial buy tokens; bonding curve never functions as price discovery mechanism

---

### H-38: Global bondingCurveParams Change Creates Two-Tier Graduation Regime
**Severity**: Low
**Component Findings**: DST-4
**Root Cause**: tokenGradThreshold[token] is frozen at preLaunch time. setBondingCurveParams() changes affect new tokens only. Tokens from different cohorts operate under different graduation requirements simultaneously, invisible to users consulting current BondingConfig parameters.
**Preconditions**: BondingConfig owner calls setBondingCurveParams() while tokens are live on old parameters
**Postconditions Created**: Two cohorts of tokens with different graduation requirements; frontend showing current config gives wrong estimates for old tokens

---

### H-39: Router bondingV5/bondingConfig References Not Cross-Validated — Upgrade Window DoS
**Severity**: Medium
**Component Findings**: DST-5
**Root Cause**: FRouterV3 stores bondingV5 and bondingConfig as independent references (setBondingV5(bondingV5_, bondingConfig_)). BondingV5 also has its own bondingConfig reference (setBondingConfig()). No on-chain mechanism validates that router.bondingConfig == bondingV5.bondingConfig. A routine upgrade that updates one without the other produces silently wrong anti-sniper durations or a complete buy DoS.
**Preconditions**: Admin upgrades BondingConfig but forgets to call FRouterV3.setBondingV5() atomically
**Postconditions Created**: Router computes anti-sniper tax using stale/wrong bondingConfig reference; wrong durations applied to all new tokens during the window

---

### H-40: FRouterV3.sell() Computes amountOut Before Transfer — Theoretical Stale Reserve
**Severity**: Low
**Component Findings**: DA-TF-1
**Root Cause**: FRouterV3.sell() reads getAmountsOut (which uses virtual reserves) before the actual token transfer arrives at the pair. In the current deployment, FPairV2 is NOT in AgentToken's LP pool set so no fee-on-transfer applies. Issue is theoretical but present in code.
**Preconditions**: Agent token with fee-on-transfer where FPairV2 is in LP pool set (not current deployment)
**Postconditions Created**: Pair's virtual reserve diverges from real balance over multiple sells (theoretical)

---

### H-41: BondingV2/V3 cancelLaunch Does Not Set trading=false — Inconsistent State
**Severity**: Low
**Component Findings**: DEPTH-ST-10, SC-5
**Root Cause**: BondingV2/V3/V4.cancelLaunch() sets launchExecuted=true but does NOT set trading=false. Post-cancel, trading=true allows buy/sell function guards to pass, but actual pair interaction requires EXECUTOR_ROLE (router operations) and the pair exists with old K values. In practice buys still succeed post-cancel if pair has liquidity, creating inconsistent state.
**Preconditions**: cancelLaunch() called on V2/V3/V4 token that has been through preLaunch
**Postconditions Created**: trading=true on cancelled token — inconsistent state; buys could technically proceed if pair has remaining liquidity (pair never fully drained by cancel)

---

### H-42: drainUniV2Pool Requires Founder Off-Chain Pre-Approval — Always Reverts Without It
**Severity**: High
**Component Findings**: DE-1
**Root Cause**: drainUniV2Pool() reads IERC20(veToken).balanceOf(founder) and passes the full amount to agentFactory.removeLpLiquidity(). Internally, removeLpLiquidity calls veToken.removeLpLiquidity which requires founder.approve(agentFactory, veTokenAmount). No protocol function creates this approval. The function always reverts unless the founder manually approves off-chain.
**Preconditions**: Any call to drainUniV2Pool() without prior off-chain founder approval
**Postconditions Created**: Function reverts; graduated Project60days liquidity cannot be drained programmatically without operational coordination with founder EOA

---

### H-43: antiSniperBuyTaxStartValue Comment Declares "Basis Points" — Documentation Risk
**Severity**: Informational
**Component Findings**: SC-1
**Root Cause**: FFactoryV2.sol:27 comment says "in basis points" but the variable is consumed as a percentage (÷100). An admin following the comment could set 9900 (expecting 99 bps ≈ 1%) but actually deliver 9900% anti-sniper tax, triggering the underflow DoS from H-6.
**Preconditions**: Admin reads comment and follows documentation
**Postconditions Created**: antiSniperBuyTaxStartValue set to 9900 → underflow DoS on all buys during anti-sniper window

---

### H-44: BondingV3/V4 preLaunch() Always Reverts — Dead API Surface
**Severity**: Informational
**Component Findings**: BLIND-C7
**Root Cause**: BondingV3.preLaunch() and BondingV4.preLaunch() begin with revert("Not implemented"). BondingV4.setXLauncher() writes to isXLauncher mapping which is never consumed. Dead API surface creates false impression of functionality.
**Preconditions**: Any call to BondingV3/V4.preLaunch()
**Postconditions Created**: Immediate revert

---

### H-45: multicall3.batchTransferTokens() Non-Functional for Admin Callers
**Severity**: Low
**Component Findings**: VS-5
**Root Cause**: batchTransferTokens() is protected by onlyOwnerOrAdmin and internally calls transferToken() which has onlyOwner. When called by admin, msg.sender inside transferToken() is address(this) (Multicall3 contract), not owner, so onlyOwner check fails. All batch transfers by non-owner admins silently fail (entire tx reverts).
**Preconditions**: Admin (not owner) calls batchTransferTokens()
**Postconditions Created**: Transaction reverts — no state change; admin deceived into thinking batch operation works

---

### H-47: Multicall3 One-Step Ownership — No Emergency Revoke If Compromised
**Severity**: Low
**Component Findings**: BLIND-C3, PC1-3
**Root Cause**: multicall3 uses a custom owner variable with no renounceOwnership() and a one-step transferOwnership(). If owner EOA is compromised, no on-chain mechanism freezes the contract — attacker retains permanent access to transferToken, withdrawETH, approveToken, batchWithdrawERC20Tokens.
**Preconditions**: multicall3 owner EOA compromised
**Postconditions Created**: Attacker retains permanent token and ETH drain capability

---

### H-48: FFactoryV2/V3.createPair() Allows Duplicate Pair Overwrite
**Severity**: Low
**Component Findings**: RS2-4
**Root Cause**: _createPair() does not check if _pair[tokenA][tokenB] already exists before overwriting. Requires CREATOR_ROLE (only BondingV5 holds it). Duplicate pair creation via normal flow is impossible (BondingV5 checks tokenInfo before creating), but the factory-level guard is absent.
**Preconditions**: CREATOR_ROLE calls createPair() for an already-registered token pair
**Postconditions Created**: Old pair address overwritten in factory mapping; old pair becomes unreachable through factory; funds in old pair inaccessible via normal routes

---

### H-49: No Storage Gap (__gap) in Any Upgradeable Contract — Upgrade Slot Collision Risk
**Severity**: Medium
**Component Findings**: SLS-1
**Root Cause**: All 9 upgradeable contracts (BondingV2-V5, BondingConfig, FRouterV2/V3, FFactoryV2/V3) inherit from OpenZeppelin upgradeable bases but NONE declare a storage gap (__gap[] array). Adding new state variables in a future upgrade shifts all subsequent slot assignments, colliding with OZ's inherited __gap slots.
**Preconditions**: Future proxy upgrade adds new state variable to any of these contracts
**Postconditions Created**: Storage slot collision; inherited OZ variable reads corrupted data; protocol state corrupted silently

---

### H-51: FRouterV3.sell() depositTax Called With Zero Amount When sellTax=0
**Severity**: Medium
**Component Findings**: DEPTH-EC-5
**Root Cause**: FRouterV3.sell() unconditionally calls IAgentTaxForRouter(feeTo).depositTax(token, txFee) even when txFee=0. If AgentTaxV2.depositTax() reverts on amount=0 (common defensive check), all sell operations via FRouterV3 revert when sellTax=0. FRouterV2 is not affected (direct safeTransfer of 0 is ERC20-safe).
**Preconditions**: Factory sellTax=0; AgentTaxV2.depositTax() has require(amount>0) guard
**Postconditions Created**: All sells via FRouterV3 revert when sellTax=0; users cannot sell bonding curve tokens; only FRouterV2 path (if accessible) works

---

### H-52: EXECUTOR_ROLE Can Set taxStartTime=type(uint256).max — Permanent 99% Buy Tax
**Severity**: High
**Component Findings**: DEPTH-ST-6, AC-5 (extended)
**Root Cause**: Consolidated into H-3 — same root cause (EXECUTOR sets taxStartTime to extreme value). H-52 documents the MAX_UINT specific boundary; both H-3 and H-52 describe the same attack path.

> NOTE: H-52 is a duplicate of H-3. Finding mapping reflects this.

---

## Deduplication Resolution Summary

| Duplicate Pair | Resolution |
|----------------|-----------|
| H-52 (DEPTH-ST-6) + H-3 (AC-5) | MERGE → H-3 absorbs both |
| H-35 (graduation donation extended) + H-11 | MERGE → H-11 absorbs H-35, SP-4, DE-4 |
| H-46 (EP-5/TF-1 donation) + H-11 | MERGE → H-11 absorbs all donation variants |
| H-50 (storage layout) + H-15 | MERGE → H-15 absorbs both DEPTH-ST-8 and MG-2 |
| BLIND-B2 + BLIND-C2 | MERGE → H-24 absorbs both (same finding, different scanners) |
| SP-3 + BLIND-B1 | MERGE → H-10 absorbs both (same finding, different scanners) |
| VS-2 (duplicate RS2-3) | FILTER — VS-2 explicitly marks itself as duplicate of RS2-3, absorbed into H-10 |
| VS-3 (duplicate AC-1) | FILTER — VS-3 explicitly marks as duplicate of AC-1, absorbed into H-1 |
| DA-TF-2 (factory tax upper bounds) | MERGE into H-6 (same root cause — setTaxParams no upper bound) |

---

## Chain Hypotheses (Phase 4c — Chain Agent 2)

> Added to hypothesis table by Chain Agent 2. Full details in chain_hypotheses.md.

| H-ID | Title | Severity | Component Findings | Group | Verification Priority |
|------|-------|----------|--------------------|-------|----------------------|
| CH-1 | BONDING_ROLE Revocation (H-4) Triggers Permanent Graduation DoS (H-2) — Critical Chain | Critical | H-4 (enabler) + H-2 (consequence) | Graduation DoS Chain | P1 |
| CH-2 | Admin Self-Revoke (H-23) + EXECUTOR Self-Removal (H-27) → H-1 EXECUTOR Drain Irrecoverable | Critical | H-23, H-27 (enablers) + H-1 (consequence) | EXECUTOR Abuse Chain | P1 |
| CH-3 | antiSniperTaxVault=0 (H-8) Blocks Graduation-Triggering Buys — Timing-Bounded DoS | High | H-8 (enabler) + H-2 (conditional consequence) | Graduation DoS Chain | P2 |
| CH-4 | Tax DoS (H-6) + taxStartTime=MAX (H-3) Dual Buy-Block | High | H-6 + H-3 (dual independent mechanisms) | Tax Arithmetic Chain | P2 |
| CH-5 | renounceOwnership (H-24) Enables Unrecoverable Zero-Param DoS (H-7) | High | H-24 (enabler) + H-7 (consequence) | Admin Param Chain | P2 |
| CH-6 | "Basis Points" Comment (H-43) → Admin Sets 9900 → Triggers Tax DoS (H-6) | High | H-43 (trigger) + H-6/H-16 (consequence) | Documentation Chain | P2 |
| CH-7 | AgentToken Transfer Tax (EP-10) + Donation Attack (H-11) Activates Graduation Loop (H-2) | Critical | EP-10 + H-11 (enablers) + H-2 (consequence) | Graduation DoS Chain | P1 |

---

### CH-1: BONDING_ROLE Revocation → Permanent Graduation DoS
**Severity**: Critical
**Component Findings**: H-4 (AgentFactory BONDING_ROLE revocation), H-2 (permanent graduation DoS)
**Root Cause Chain**: H-4's postcondition (AgentFactory graduation calls fail permanently) is the exact precondition H-2 requires. BONDING_ROLE revocation by an independent AgentFactory admin activates H-2's permanent graduation loop for all tokens at or above graduation threshold at time of revocation.
**Match Strength**: STRONG
**Preconditions**: AgentFactory admin (independent governance) revokes BONDING_ROLE; at least one token at graduation threshold
**Postconditions**: Every graduation-triggering buy permanently reverts; no admin recovery path from BondingV5 side; all affected tokens permanently locked in graduation-loop state

---

### CH-2: Admin Self-Revoke + EXECUTOR Compromise → Irrecoverable Protocol Takeover
**Severity**: Critical
**Component Findings**: H-23 (DEFAULT_ADMIN_ROLE self-revocation), H-27 (EXECUTOR self-removal threat), H-1 (EXECUTOR drains all pairs)
**Root Cause Chain**: H-23 removes on-chain recovery capability (no revokeRole possible after DEFAULT_ADMIN self-revoke). H-1 (EXECUTOR drain) can already be executed, but normally DEFAULT_ADMIN can revoke and recover. With H-23 triggered first, H-1 becomes permanently irrecoverable — EXECUTOR_ROLE cannot be revoked from an attacker.
**Match Strength**: STRONG
**Preconditions**: DEFAULT_ADMIN_ROLE EOA compromised; attacker grants themselves EXECUTOR_ROLE, triggers H-23; then uses EXECUTOR_ROLE to drain all pairs via H-1
**Postconditions**: All VIRTUAL drained from all bonding curve pools; no on-chain recovery mechanism

---

### CH-3: antiSniperTaxVault=0 Graduation Window Overlap
**Severity**: High
**Component Findings**: H-8 (antiSniperTaxVault=0 bricks anti-sniper buys), H-37/H-7 (token at or near graduation during anti-sniper window)
**Root Cause Chain**: H-8 blocks all buys during anti-sniper window. If token reaches graduation threshold during that window (via creator pre-load, H-37, or H-7 near-zero threshold), all graduation-triggering buys fail. Window is 60-99s — temporary unless H-2 conditions are also active.
**Match Strength**: MODERATE
**Preconditions**: antiSniperTaxVault=address(0); token approaches graduation threshold during anti-sniper window
**Postconditions**: Graduation-triggering buys fail during anti-sniper window; permanent if H-2 also active

---

### CH-4: Dual Independent Buy-Block (Tax DoS + taxStartTime DoS)
**Severity**: High
**Component Findings**: H-6 (buyTax>=100 underflow DoS), H-3 (taxStartTime=MAX permanent 99% tax)
**Root Cause Chain**: H-6 and H-3 each independently block all buys via different code paths in FRouterV3.buy(). If both conditions are set simultaneously by a compromised EXECUTOR+ADMIN, no single-setter fix is sufficient — both must be corrected. Combined effect is complete buy freeze.
**Match Strength**: MODERATE (independent mechanisms, not strictly composable)
**Preconditions**: EXECUTOR sets taxStartTime=MAX_UINT; ADMIN sets buyTax>=100 on same pair
**Postconditions**: All buys on that pair revert via two independent code paths

---

### CH-5: renounceOwnership → Unrecoverable Zero-Param DoS
**Severity**: High
**Component Findings**: H-24 (BondingConfig renounceOwnership unguarded), H-7 (zero param division-by-zero)
**Root Cause Chain**: H-7 is normally recoverable (admin resets params). H-24's postcondition (owner=address(0)) removes the recovery path. Any zero value in BondingConfig becomes permanently stuck if H-24 has been triggered.
**Match Strength**: STRONG
**Preconditions**: BondingConfig owner calls renounceOwnership() after misconfiguring params (or vice versa)
**Postconditions**: Zero-param DoS (H-7) is permanent; all new launches permanently blocked; no proxy upgrade confirmed

---

### CH-6: Documentation-Driven Tax DoS (Basis Points Comment)
**Severity**: High
**Component Findings**: H-43 (misleading "basis points" comment), H-6 (no upper bound on tax params), H-16 (sum not validated)
**Root Cause Chain**: A legitimate admin reading the misleading documentation sets antiSniperBuyTaxStartValue=9900 (intending 99 bps ≈ 1%). H-6's missing validation accepts this. H-16's missing sum check allows it to persist. All anti-sniper-window buys subsequently DoS via H-6 underflow.
**Match Strength**: MODERATE
**Preconditions**: Admin follows misleading comment; setTaxParams called with 9900
**Postconditions**: All anti-sniper-window buys revert; system-wide impact for all tokens on that factory

---

### CH-7: AgentToken Transfer Tax + Donation → Activates Graduation Loop
**Severity**: Critical
**Component Findings**: EP-10/TF-3 (AgentToken transfer tax causes graduation accounting mismatch), H-11 (donation attack distorts graduation amounts), H-2 (permanent graduation DoS)
**Root Cause Chain**: EP-10 (confirmed Critical) shows that AgentToken transfer tax at graduation causes fewer tokens to arrive at the Uniswap addLiquidity call than expected. H-11 further distorts the ratio via donation. Combined, Uniswap's addLiquidity() may revert, triggering H-2's permanent graduation loop. This chain does NOT require any governance action — it activates for any token with non-zero transfer tax.
**Match Strength**: MODERATE (requires AgentToken to have transfer tax; not all tokens affected)
**Preconditions**: AgentToken has non-zero transfer tax (legitimate token feature); graduation threshold reached
**Postconditions**: _openTradingOnUniswap() reverts during addLiquidity; H-2 permanent graduation loop activated; no recovery without proxy upgrade
