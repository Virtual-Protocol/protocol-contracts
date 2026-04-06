# Template Recommendations

## Recommended Templates

### Template: TOKEN_FLOW_TRACING
**Trigger**: BALANCE_DEPENDENT flag (21 matches), virtual vs real liquidity mismatch in FPairV2
**Relevance**: FPairV2 tracks reserves virtually (via _pool struct) but balance()/assetBalance() use actual balanceOf. This dual-accounting is the core of the bonding curve mechanism and the primary source of economic exploits. Unsolicited token transfers can affect graduation amounts.
**Instantiation Parameters**:
- {TOKEN_A}: Agent token (ERC20, created by AgentFactory)
- {TOKEN_B}: Asset token ($VIRTUAL, ERC20)
- {POOL}: FPairV2 contract
- {VIRTUAL_RESERVE_TRACKING}: _pool.reserve0 / _pool.reserve1
- {REAL_BALANCE_TRACKING}: IERC20.balanceOf(address(this))
- {GRADUATION_FUNCTION}: _openTradingOnUniswap()
**Key Questions**:
1. Can an attacker send tokens directly to FPairV2 to inflate assetBalance() and cause excess assets to flow to AgentFactory during graduation?
2. Does the virtual liquidity in reserve1 (set at mint time without actual token transfer) create exploitable discrepancies?
3. Can graduation be triggered with manipulated balances to steal funds?
4. What happens if agent tokens are sent directly to FPairV2, inflating balance() used in graduation?

---

### Template: ECONOMIC_DESIGN_AUDIT
**Trigger**: MONETARY_PARAMETER flag (34 matches), bonding curve with K constant, assetRate, gradThreshold, fee params
**Relevance**: The protocol implements a pump.fun-style bonding curve with constant-product AMM (x*y=k). Economic parameters (K, assetRate, fakeInitialVirtualLiq, targetRealVirtual) directly determine token pricing and graduation conditions. Multiple constraint variables are UNENFORCED.
**Instantiation Parameters**:
- {CURVE_TYPE}: Constant product (x*y=k) with virtual initial liquidity
- {KEY_PARAMS}: K (constant per version), fakeInitialVirtualLiq, targetRealVirtual, gradThreshold
- {FEE_STRUCTURE}: buyTax + antiSniperTax (buy), sellTax (sell), launch fees
- {GRADUATION_CONDITION}: newReserveA <= gradThreshold && !hasAntiSniperTax
**Key Questions**:
1. Can the graduation threshold be gamed by buying just enough to trigger graduation during anti-sniper period?
2. Does the constant K across all tokens in V2-V4 create unfair pricing for tokens with different supply configurations?
3. Can an owner set fakeInitialVirtualLiq or targetRealVirtual to 0, causing division-by-zero or instant graduation?
4. Are there sandwich attack vectors on buy/sell given the AMM design?

---

### Template: SEMI_TRUSTED_ROLES
**Trigger**: SEMI_TRUSTED_ROLE flag (26 matches for EXECUTOR_ROLE)
**Relevance**: EXECUTOR_ROLE on FRouterV2/V3 controls all trading operations (buy, sell, graduate, drain). This role is granted to Bonding contracts but the admin can change it. ADMIN_ROLE can change tax params, router addresses, and bonding contract references. Privileged launchers in BondingV5 control launch() for special tokens.
**Instantiation Parameters**:
- {SEMI_TRUSTED_ROLE_1}: EXECUTOR_ROLE on FRouterV2/V3 (held by Bonding contracts)
- {SEMI_TRUSTED_ROLE_2}: ADMIN_ROLE on FRouterV2/V3 and FFactoryV2/V3
- {SEMI_TRUSTED_ROLE_3}: privilegedLauncher in BondingConfig (backend wallets)
- {FULL_TRUST_ROLE}: Owner of Bonding contracts, DEFAULT_ADMIN_ROLE
**Key Questions**:
1. If EXECUTOR_ROLE is compromised, can all pair liquidity be drained via drainPrivatePool by first marking tokens as project60days?
2. Can ADMIN_ROLE on factory set tax to 100%, effectively stealing all user trades?
3. Can a malicious bonding contract with EXECUTOR_ROLE call graduate() prematurely?
4. What is the blast radius if a privileged launcher key is compromised?

---

### Template: TEMPORAL_PARAMETER_STALENESS
**Trigger**: TEMPORAL flag (177 matches), anti-sniper tax with time decay, startTime, deadline, startTimeDelay
**Relevance**: Anti-sniper tax is time-based (decays from 99% to 0% over 60s or 98min). The taxStartTime is set during launch(). There are deadline checks on buy/sell. The startTime mechanism gates when swaps can begin.
**Instantiation Parameters**:
- {TEMPORAL_PARAM_1}: antiSniperTax (60s or 98min decay)
- {TEMPORAL_PARAM_2}: startTime / taxStartTime
- {TEMPORAL_PARAM_3}: deadline on buy/sell
- {TEMPORAL_PARAM_4}: scheduledLaunchStartTimeDelay
**Key Questions**:
1. Can a validator manipulate block.timestamp to bypass anti-sniper tax or trigger early graduation?
2. What happens if taxStartTime is set much later than startTime -- does it create a window of untaxed trading?
3. Can the delay between preLaunch and launch be exploited (tokens exist but are not yet launched)?
4. Is the 300-second deadline in launch() initial buy vulnerable to timing manipulation?

---

### Template: EVENT_CORRECTNESS
**Trigger**: 40 emit statements, 23 SILENT SETTERS detected
**Relevance**: Critical admin parameter changes (tax rates, fees, thresholds, supply, wallet addresses) in BondingV2-V4 and Factory/Router contracts have NO events. This means off-chain monitoring cannot detect parameter manipulation. BondingV2 cancelLaunch emits initialPurchase=0 (after zeroing) instead of actual value.
**Instantiation Parameters**:
- {TOTAL_EVENTS}: 40 in-scope
- {SILENT_SETTERS}: 23 (see setter_list.md)
- {INCORRECT_EMIT}: BondingV2.sol:418 cancelLaunch emits _token.initialPurchase after zeroing it (always 0)
**Key Questions**:
1. Can the absence of events on setTokenParams allow silent rug via parameter change?
2. Is the CancelledLaunch event in BondingV2 always emitting 0 for initialPurchase a monitoring blindspot?
3. Are buy/sell events traceable only through FPairV2 Swap events? Is that sufficient for accounting?

---

### Template: MIGRATION_ANALYSIS
**Trigger**: MIGRATION flag (221 matches), V2/V3/V4/V5 parallel deployments
**Relevance**: Four parallel Bonding contract versions exist, each with slightly different logic. V2/V3/V4 have disabled preLaunch but active buy/sell/launch/graduate. V5 is the active version. Storage layout compatibility across upgrades is critical. FRouterV2 serves V2-V4, FRouterV3 serves V5.
**Instantiation Parameters**:
- {VERSIONS}: BondingV2, BondingV3, BondingV4, BondingV5
- {ACTIVE_VERSION}: BondingV5 (only version with working preLaunch)
- {SHARED_DEPS}: FPairV2 (used by all), IFPairV2 interface
- {ROUTER_SPLIT}: FRouterV2 (V2-V4), FRouterV3 (V5)
**Key Questions**:
1. Can a token created by BondingV4 be manipulated through FRouterV2 by exploiting differences in tax calculation?
2. Are there storage layout conflicts if BondingV2 is upgraded to V3/V4/V5 via proxy?
3. Can FRouterV2's bondingV4 reference be set to BondingV5, causing unexpected behavior?
4. Do the deprecated taxManager/antiSniperTaxManager fields in FRouterV2 create storage collision risks?

---

### Template: STORAGE_LAYOUT_SAFETY
**Trigger**: STORAGE_LAYOUT flag (29 matches), all core contracts are upgradeable with Initializable
**Relevance**: 9 of 12 in-scope contracts use the upgradeable proxy pattern. Storage layout order matters. BondingV2-V5 have complex struct-based storage. FRouterV2 has deprecated fields (taxManager, antiSniperTaxManager) that must maintain their storage slots.
**Instantiation Parameters**:
- {UPGRADEABLE_CONTRACTS}: BondingV2, BondingV3, BondingV4, BondingV5, BondingConfig, FFactoryV2, FFactoryV3, FRouterV2, FRouterV3
- {NON_UPGRADEABLE}: FPairV2 (ReentrancyGuard, not upgradeable), Multicall3
- {DEPRECATED_SLOTS}: FRouterV2.taxManager (slot), FRouterV2.antiSniperTaxManager (slot)
**Key Questions**:
1. If BondingV2 proxy is upgraded to V4 code, do the new mappings (isProjectXLaunch, isAcpSkillLaunch) collide with existing storage?
2. Are FRouterV2's deprecated taxManager/antiSniperTaxManager slots properly preserved in any upgrade?
3. Does BondingV5's use of BondingConfig.Token struct in mapping storage differ from BondingV4's local Token struct?

---

### Template: EXTERNAL_PRECONDITION_AUDIT
**Trigger**: Multiple external contract interactions (AgentFactory, AgentToken, AgentTax, UniswapV2Pair)
**Relevance**: The protocol heavily depends on external contracts (AgentFactoryV6/V7, AgentTokenV2, AgentVeTokenV2, AgentTax). Graduation requires multiple external calls that must succeed atomically. The try-catch patterns on setTaxStartTime and syncAfterDrain suggest backward-compatibility concerns.
**Instantiation Parameters**:
- {EXTERNAL_1}: IAgentFactoryV6/V7 (createNewAgentTokenAndApplication, executeBondingCurveApplicationSalt)
- {EXTERNAL_2}: IAgentTokenV2 (liquidityPools, decimals)
- {EXTERNAL_3}: IAgentTaxForRouter (depositTax, registerToken)
- {EXTERNAL_4}: IAgentVeTokenV2 (assetToken, founder)
**Key Questions**:
1. What happens if AgentFactory.executeBondingCurveApplicationSalt reverts during graduation? Funds are already transferred.
2. Can AgentTokenV2.decimals() return an unexpected value, causing overflow in bondingCurveSupply calculation?
3. What if IAgentTaxForRouter.depositTax() reverts? It would block all buys/sells on FRouterV3.
4. Can a malicious AgentFactory return a controlled address from executeBondingCurveApplicationSalt?

---

### Template: INTEGRATION_HAZARD_RESEARCH
**Trigger**: NAMED_EXTERNAL_PROTOCOL flag (IUniswapV2Pair usage in drain functions)
**Relevance**: Post-graduation, tokens trade on real UniswapV2 pairs. The drain functions interact with UniV2 pairs via AgentFactory.removeLpLiquidity. The veToken/LP pair verification could potentially be bypassed with crafted contracts.
**Instantiation Parameters**:
- {PROTOCOL}: UniswapV2 (post-graduation liquidity)
- {INTERACTION}: drainUniV2Pool via removeLpLiquidity through AgentFactory
- {VERIFICATION}: token0/token1 matching on IUniswapV2Pair
**Key Questions**:
1. Can a fake veToken contract return a crafted lpPair with matching token0/token1 to drain unrelated liquidity?
2. What happens if the veToken.founder() returns an address with 0 balance but the actual LP tokens are elsewhere?
3. Is the 0-slippage on drain operations exploitable via sandwich attack by a validator?

---

## BINDING MANIFEST

| Template | Pattern Trigger | Required? | Reason |
|----------|-----------------|-----------|--------|
| TOKEN_FLOW_TRACING | BALANCE_DEPENDENT (21) | YES | Virtual vs real liquidity is the core economic mechanism; dual-accounting creates exploit surface |
| ECONOMIC_DESIGN_AUDIT | MONETARY_PARAMETER (34) | YES | Bonding curve parameters directly control pricing, graduation, and fee extraction |
| SEMI_TRUSTED_ROLES | SEMI_TRUSTED_ROLE (26) | YES | EXECUTOR_ROLE controls all trading and drain operations |
| TEMPORAL_PARAMETER_STALENESS | TEMPORAL (177) | YES | Anti-sniper tax timing, launch timing, deadline checks are critical |
| EVENT_CORRECTNESS | 40 events, 23 silent setters | YES | 23 silent setters represent monitoring blindspot for admin parameter manipulation |
| MIGRATION_ANALYSIS | MIGRATION (221) | YES | 4 parallel bonding versions with different logic sharing infrastructure |
| STORAGE_LAYOUT_SAFETY | STORAGE_LAYOUT (29) | YES | 9 upgradeable contracts with complex struct storage |
| EXTERNAL_PRECONDITION_AUDIT | Multiple external deps | YES | Heavy dependency on AgentFactory, AgentToken, AgentTax for critical operations |
| INTEGRATION_HAZARD_RESEARCH | NAMED_EXTERNAL_PROTOCOL (1) | YES | UniswapV2 integration in drain functions with verification bypass risk |
| FLASH_LOAN_INTERACTION | FLASH_LOAN_EXTERNAL (39) | NO | No direct flash loan interaction, but AMM is manipulable |
| ORACLE_ANALYSIS | ORACLE (0) | NO | No oracle usage detected |
| CROSS_CHAIN_TIMING | CROSS_CHAIN (0) | NO | No cross-chain functionality |
| STAKING_RECEIPT_TOKENS | STAKING_RECEIPT (0) | NO | No staking receipt pattern |
| ZERO_STATE_RETURN | ERC4626 (partial, vault refs only) | NO | Not actual ERC4626 |
| SHARE_ALLOCATION_FAIRNESS | SHARE_ALLOCATION (1) | NO | Minimal share allocation pattern |
| CROSS_CHAIN_MESSAGE_INTEGRITY | CROSS_CHAIN_MSG (0) | NO | No cross-chain messaging |

### Binding Rules Applied
- BALANCE_DEPENDENT (21 matches) -> TOKEN_FLOW_TRACING: REQUIRED
- MONETARY_PARAMETER (34 matches) -> ECONOMIC_DESIGN_AUDIT: REQUIRED
- SEMI_TRUSTED_ROLE (26 matches) -> SEMI_TRUSTED_ROLES: REQUIRED
- TEMPORAL (177 matches) -> TEMPORAL_PARAMETER_STALENESS: REQUIRED
- 40 events + 23 SILENT SETTERS -> EVENT_CORRECTNESS: REQUIRED
- MIGRATION (221 matches) -> MIGRATION_ANALYSIS: REQUIRED
- STORAGE_LAYOUT (29 matches) -> STORAGE_LAYOUT_SAFETY: REQUIRED
- External dependencies (AgentFactory, AgentToken, AgentTax) -> EXTERNAL_PRECONDITION_AUDIT: REQUIRED
- NAMED_EXTERNAL_PROTOCOL (IUniswapV2Pair) -> INTEGRATION_HAZARD_RESEARCH: REQUIRED
- FORK_ANCESTRY:Pump.fun -> Triggers ECONOMIC_DESIGN_AUDIT with pump.fun-specific checks

### Niche Agent Binding
| Niche Agent | Trigger | Required? | Reason |
|-------------|---------|-----------|--------|
| EVENT_COMPLETENESS | MISSING_EVENT | YES | 23 silent setters, buy/sell missing events, cancelLaunch emits stale value |
| SIGNATURE_VERIFICATION_AUDIT | HAS_SIGNATURES | NO | Only in mock contracts (MockUniswapV2Pair PERMIT_TYPEHASH) |
| SEMANTIC_CONSISTENCY_AUDIT | HAS_MULTI_CONTRACT | YES | 12 in-scope contracts with 4 bonding versions sharing similar but subtly different logic |
| MULTI_STEP_OPERATION_SAFETY | MULTI_STEP_OPS | NO | No explicit for/on-behalf-of patterns |
| CALLBACK_RECEIVER_SAFETY | OUTCOME_CALLBACK | YES | SafeERC20 used extensively; multicall3 has arbitrary .call(); graduation is multi-step with external calls |
| SPEC_COMPLIANCE_AUDIT | HAS_DOCS | NO | No docs provided |
| DIMENSIONAL_ANALYSIS | MIXED_DECIMALS | YES | 10 matches for decimals()/10** patterns; bondingCurveSupply calculation uses external decimals() |

### Injectable Skills
- **DEX_INTEGRATION_SECURITY**: REQUIRED - Protocol is a DEX (bonding curve AMM) with UniswapV2 post-graduation integration
- Pump.fun fork comparison analysis recommended

### Manifest Summary
- **Total Required Breadth Agents**: 9 (TOKEN_FLOW_TRACING, ECONOMIC_DESIGN_AUDIT, SEMI_TRUSTED_ROLES, TEMPORAL_PARAMETER_STALENESS, EVENT_CORRECTNESS, MIGRATION_ANALYSIS, STORAGE_LAYOUT_SAFETY, EXTERNAL_PRECONDITION_AUDIT, INTEGRATION_HAZARD_RESEARCH)
- **Total Required Niche Agents**: 4 (EVENT_COMPLETENESS, SEMANTIC_CONSISTENCY_AUDIT, CALLBACK_RECEIVER_SAFETY, DIMENSIONAL_ANALYSIS)
- **HARD GATE**: Orchestrator MUST spawn agent for each REQUIRED template
