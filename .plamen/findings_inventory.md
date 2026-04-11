# Findings Inventory

**Total: 95 findings from 9 agents** (75 from phases 1-2; 20 from phases 3b-3c merge)

| # | Finding ID | Agent | Severity | Location | Title | Verdict | Step Execution |
|---|-----------|-------|----------|----------|-------|---------|----------------|
| 1 | AC-1 | B2 Access-Control | Critical | FRouterV2.sol:230-239, FRouterV3.sol:230-239 | EXECUTOR_ROLE graduate() Bypasses All BondingV5 Safety Checks | CONFIRMED | 1,2,3,4,5,6,6b |
| 2 | AC-2 | B2 Access-Control | High | FRouterV2.sol:184, FRouterV3.sol:189 | EXECUTOR_ROLE Can Bypass Anti-Sniper Tax via isInitialPurchase Flag | CONFIRMED | 1,2,3,4,5,6,6b |
| 3 | AC-3 | B2 Access-Control | High | FFactoryV2.sol:108-122, FFactoryV3.sol:116-130 | ADMIN_ROLE Can Set Unbounded Tax Rates (Up to 100%) | CONFIRMED | 1,2,3,4,5,6,6b |
| 4 | AC-4 | B2 Access-Control | High | FFactoryV2.sol:124-126, FFactoryV3.sol:132-134 | ADMIN_ROLE setRouter() Can Compromise All Future Pairs | CONFIRMED | 1,2,3,4,5,6,6b |
| 5 | AC-5 | B2 Access-Control | High | FRouterV2.sol:358-369, FRouterV3.sol:344-355, FPairV2.sol:198-206 | EXECUTOR_ROLE setTaxStartTime() Can Extend Anti-Sniper Tax Indefinitely | CONFIRMED | 1,2,3,4,5,6,6b |
| 6 | AC-6 | B2 Access-Control | Medium | BondingV5.sol:857-859 | setBondingConfig() Silent Setter – No Event, No Validation | CONFIRMED | 1,2,3,4,5,6,6b |
| 7 | AC-7 | B2 Access-Control | Medium | setter_list.md (protocol-wide) | 23 Silent Setters Create Monitoring Blindspot | CONFIRMED | 1,2,3,4,5,6,6b |
| 8 | AC-8 | B2 Access-Control | Medium | FRouterV2.sol:241-250, FRouterV3.sol:241-250 | EXECUTOR_ROLE approval() Can Set Arbitrary Approvals on Pair Assets | CONFIRMED | 1,2,3,4,5,6,6b |
| 9 | AC-9 | B2 Access-Control | Low | BondingV5.sol:524-528 | privilegedLauncher Can Block Special Token Launches via Omission | CONFIRMED | 1,2,3,4,5,6,6b |
| 10 | AC-10 | B2 Access-Control | Medium | FRouterV2.sol:72, FRouterV3.sol:79, FFactoryV2.sol:51, FFactoryV3.sol:59 | DEFAULT_ADMIN_ROLE is Single Point of Escalation | CONFIRMED | 1,2,3,4,5,6,6b |
| 11 | EP-1 | B6 External-Precond | High | BondingV5.sol:331-352 | No Validation of AgentFactory.createNewAgentTokenAndApplication Return Value | CONFIRMED | 1,2,3 |
| 12 | EP-2 | B6 External-Precond | High | BondingV5.sol:366-371 | No Validation of factory.createPair Return Value | CONFIRMED | 1,2,3 |
| 13 | EP-3 | B6 External-Precond | High | BondingV5.sol:748-756 | executeBondingCurveApplicationSalt Return Value Not Validated | CONFIRMED | 1,2,3 |
| 14 | EP-4 | B6 External-Precond | Medium | FRouterV3.sol buy():207, sell():161 | taxVault Zero-Check Inconsistency | CONFIRMED | 1,2,3 |
| 15 | EP-5 | B6 External-Precond | High | BondingV5.sol:718-719 | Graduation Amounts Based on balanceOf (Donation Attack Surface) | CONFIRMED | 1,2,3 |
| 16 | EP-6 | B6 External-Precond | Low | FRouterV2/V3.sol drainUniV2Pool():457-458 | veToken founder() Return Not Validated (Safe by Accident) | CONFIRMED | 1,2,3 |
| 17 | EP-7 | B6 External-Precond | High | FRouterV2.sol:480, FRouterV3.sol:466 | drainUniV2Pool Assumes Founder Has Approved Factory for veToken Spend | CONFIRMED | 1,2,3 |
| 18 | EP-8 | B6 External-Precond | Critical | BondingV5.sol:664-670, 703-772 | Graduation Failure Creates Permanent Pool DoS | CONFIRMED | 1,2,3 |
| 19 | EP-9 | B6 External-Precond | Medium | BondingV5.sol:718-729 | Donation to Pair Before Graduation-Triggering Buy | CONFIRMED | 1,2,3 |
| 20 | EP-10 | B6 External-Precond | Critical | BondingV5.sol:746, 748-754 | Transfer Tax on Agent Token at Graduation — Amount Mismatch | CONFIRMED | 1,2,3 |
| 21 | EP-11 | B6 External-Precond | Medium | FRouterV2/V3.sol drainUniV2Pool():441-473 | Interface Spoofing in drainUniV2Pool veToken Verification | CONFIRMED (mitigated by EXECUTOR_ROLE) | 1,2,3 |
| 22 | EP-12 | B6 External-Precond | Medium | FRouterV3.sol:344-355, BondingV5.sol:531 | Silent Failure of setTaxStartTime May Cause Wrong Anti-Sniper Window | CONFIRMED | 1,2,3 |
| 23 | EP-13 | B6 External-Precond | Medium | BondingV5.sol:443-448, FRouterV3.sol:207-210 | taxVault Address Can Change Between registerToken and depositTax | CONFIRMED | 1,2,3 |
| 24 | EP-14 | B6 External-Precond | High | BondingV5.sol:727-756 | AgentFactory Role Dependency for Multi-Step Graduation | CONFIRMED | 1,2,3 |
| 25 | MG-1 | B3 Migration | Medium | FRouterV3.sol:293, BondingV5.sol:793-798 | FRouterV3 Anti-Sniper Tax Reverts for Non-BondingV5 Tokens (Hard DoS) | CONFIRMED | 1,2,3,4,5 |
| 26 | MG-2 | B3 Migration | Medium | FRouterV2.sol:40-41 | FRouterV2 Deprecated Storage Slots Must Be Preserved on Proxy Upgrade | CONFIRMED | 1,2,3,4 |
| 27 | MG-3 | B3 Migration | Low | BondingV5.sol:857-859, 390-393 | setBondingConfig() Mid-Launch — gradThreshold Safe, Fee/Supply Affect New Launches | PARTIAL | 1,2,3,4 |
| 28 | MG-4 | B3 Migration | Medium | BondingV5.sol:554-558, BondingConfig.sol:250-253 | teamTokenReservedWallet Can Change Between preLaunch() and launch() | CONFIRMED | 1,2,3,4 |
| 29 | MG-5 | B3 Migration | Info | BondingConfig.sol:138-149 | BondingConfig.initialize() Uses initializer — No Reinitializer Attack | REFUTED | 1,2,3 |
| 30 | MG-6 | B3 Migration | Low | BondingV2.sol, BondingV3.sol, BondingV4.sol | V2/V3/V4 Have No General Asset Recovery for Stranded Dust | CONFIRMED | 1,2,3,4a,4b,4c |
| 31 | MG-7 | B3 Migration | Info | BondingV2.sol, BondingV5.sol | V2 vs V5 Storage Layout Discontinuity (by design, separate deployments) | REFUTED as bug | 1,2,3,4 |
| 32 | MG-8 | B3 Migration | Medium | BondingV5.sol (entire) | BondingV5 Contract Size Exceeds EIP-170 Limit (28,310 > 24,576 bytes) | CONFIRMED | 1 |
| 33 | SLS-1 | B5 Storage-Events | Medium | All 9 upgradeable contracts | Missing `__gap` Storage Reservations in All Upgradeable Contracts | CONFIRMED | 1,2,3,4,5,6,7 |
| 34 | SLS-2 | B5 Storage-Events | Info | FRouterV2.sol:40-42, 59 | FRouterV2 Deprecated Fields Correctly Preserve Slot Order | CONFIRMED SAFE | 1,2,3,4,5,6,7 |
| 35 | SLS-3 | B5 Storage-Events | Info | BondingV2.sol, BondingV3.sol, BondingV4.sol | BondingV2/V3/V4 Compatible Base Layouts (parallel deployments) | CONFIRMED SAFE | 1,2,3,4,5,6,7 |
| 36 | SLS-4 | B5 Storage-Events | Info | BondingV5.sol | BondingV5 Incompatible with V2-V4 (confirmed separate deployment) | CONFIRMED SAFE | 1,2,3,4,5,6,7 |
| 37 | SLS-5 | B5 Storage-Events | Info | BondingConfig.sol:127-129 | All constructors correctly use _disableInitializers() | CONFIRMED SAFE | 1,2,3,4,5,6,7 |
| 38 | SLS-6 | B5 Storage-Events | Info | All 9 core contracts | No Inline Assembly with sstore/sload in Core Contracts | CONFIRMED SAFE | 1,2,3,4,5,6,7 |
| 39 | SLS-7 | B5 Storage-Events | Info | All 9 core contracts | No Memory vs Storage Confusion Detected | CONFIRMED SAFE | 1,2,3,4,5,6,7 |
| 40 | EVT-1 | B5 Storage-Events | Medium | BondingV2.sol:411-419, BondingV3.sol:346-354, BondingV4.sol:418-426 | cancelLaunch() Emits initialPurchase=0 (Post-Zeroing Value) | CONFIRMED | 1,2,3,4,5,6,7 |
| 41 | EVT-2 | B5 Storage-Events | Info | BondingV2-V5 launch() | launch() Correctly Emits Pre-Zero initialPurchase in All Versions | CONFIRMED SAFE | 1,2,3,4,5,6,7 |
| 42 | EVT-3 | B5 Storage-Events | Info | All Bonding versions _openTradingOnUniswap() | Graduated Event Emits Addresses Only (no balance data) | CONFIRMED SAFE | 1,2,3,4,5,6,7 |
| 43 | EVT-4 | B5 Storage-Events | Low | All Bonding versions buy()/sell() | buy/sell Functions Emit No Events | CONFIRMED | 1,2,3,4,5,6,7 |
| 44 | EVT-5 | B5 Storage-Events | Medium | BondingConfig.sol:240-244 | BondingConfig.setScheduledLaunchParams() Is a Silent Setter | CONFIRMED | 1,2,3,4,5,6,7 |
| 45 | EVT-6 | B5 Storage-Events | Medium | BondingV2.sol, BondingV3.sol, BondingV4.sol | 14 BondingV2-V4 Admin Setters Are Silent | CONFIRMED | 1,2,3,4,5,6,7 |
| 46 | EVT-7 | B5 Storage-Events | Medium | BondingV5.sol:857-859 | BondingV5.setBondingConfig() Is a Silent Setter | CONFIRMED | 1,2,3,4,5,6,7 |
| 47 | EVT-8 | B5 Storage-Events | High | FFactoryV2.sol:108-122, FFactoryV3.sol:116-130 | FFactoryV2/V3.setTaxParams() Are Silent Setters (Tax Rates + Vault Redirect) | CONFIRMED | 1,2,3,4,5,6,7 |
| 48 | EVT-9 | B5 Storage-Events | High | FFactoryV2.sol:124-126, FFactoryV3.sol:132-134 | FFactoryV2/V3.setRouter() Are Silent Setters (Routing Redirect) | CONFIRMED | 1,2,3,4,5,6,7 |
| 49 | EVT-10 | B5 Storage-Events | Low | FRouterV2.sol:252-278 | FRouterV2 4 Admin Setters Are Silent | CONFIRMED | 1,2,3,4,5,6,7 |
| 50 | EVT-11 | B5 Storage-Events | Medium | FRouterV3.sol:257-262 | FRouterV3.setBondingV5() Is a Silent Setter | CONFIRMED | 1,2,3,4,5,6,7 |
| 51 | TE-1 | B4 Temporal-Economic | High | BondingV5.sol:383, 555 | teamTokenReservedWallet Changes Between preLaunch() and launch() | CONFIRMED | 1,2,3,3b,4,5 |
| 52 | TE-2 | B4 Temporal-Economic | Medium | BondingV5.sol:267-271 | scheduledLaunchStartTimeDelay Changes Cause Inconsistent Fee Classification | CONFIRMED | 1,2,3,3b,4,5 |
| 53 | TE-3 | B4 Temporal-Economic | Medium | FRouterV3.sol:310-318 | Validator Timestamp Manipulation Can Reduce 60s Anti-Sniper Tax by Up to 20% | CONFIRMED | 1,2,3,3b,4,5 |
| 54 | TE-4 | B4 Temporal-Economic | High | FRouterV2.sol:358-369, FRouterV3.sol:344-355, FPairV2.sol:198-206 | EXECUTOR_ROLE Can Reset taxStartTime Arbitrarily | CONFIRMED | 1,2,3,3b,4,5 |
| 55 | TE-5 | B4 Temporal-Economic | Medium | FPairV2.sol:45, FRouterV3.sol:326-338 | taxStartTime=0 Default and Backward Compatibility Risks | CONFIRMED | 1,2,3,3b,4,5 |
| 56 | TE-6 | B4 Temporal-Economic | Medium | FFactoryV2.sol:27, FFactoryV3.sol:35, FRouterV3.sol:291 | Global antiSniperBuyTaxStartValue Retroactively Affects Active Windows | CONFIRMED | 1,2,3,3b,4,5 |
| 57 | EC-1 | B4 Temporal-Economic | High | FRouterV2.sol:190-191, FRouterV3.sol:195-196 | buyTax >= 100 Causes Underflow Revert in Anti-Sniper Cap, Bricks All Buys | CONFIRMED | 1,2,3,4,5 |
| 58 | EC-2 | B4 Temporal-Economic | High | BondingConfig.sol:224-233 | targetRealVirtual = 0 Causes Near-Zero Graduation Threshold | CONFIRMED | 1,2,3,4,5 |
| 59 | EC-3 | B4 Temporal-Economic | High | FRouterV2.sol:150-153, FRouterV3.sol:157-160 | sellTax Has No Cap; >= 100 Traps User Funds | CONFIRMED | 1,2,3,4,5 |
| 60 | EC-4 | B4 Temporal-Economic | High | BondingV5.sol:376-377 | fakeInitialVirtualLiq = 0 Causes Division by Zero in preLaunch | CONFIRMED | 1,2,3,4,5 |
| 61 | EC-11 | B4 Temporal-Economic | Medium | FRouterV2.sol, FRouterV3.sol, BondingV2-V5 | maxTx Is Set But Never Enforced | CONFIRMED | 1,2,3,4,5 |
| 62 | TF-1 | B1 Token-Flow | Medium | FPairV2.sol:180, 176, BondingV5.sol:718-719 | Donation Attack on FPairV2 Inflates Graduation Amounts | CONFIRMED | 1,2,3,4,5,6,7,8,9 |
| 63 | TF-2 | B1 Token-Flow | Medium | BondingV5.sol:462-497 | cancelLaunch() Permanently Locks Agent Tokens in FPairV2 | CONFIRMED | 1,2,3,5,6,8,9 |
| 64 | TF-3 | B1 Token-Flow | High | BondingV5.sol:746, FRouterV3.sol:131,155,223 | AgentToken Transfer Tax Causes Graduation Accounting Mismatch | CONFIRMED | 1,2,3,4,5,6,7,8,9 |
| 65 | TF-4 | B1 Token-Flow | Low | FPairV2.sol:86-107 | FPairV2.swap() Does Not Validate K Invariant | CONFIRMED | 1,2,3,5,6,7,8,9 |
| 66 | TF-5 | B1 Token-Flow | Medium | BondingV5.sol:718-720, FRouterV3.sol:235-238 | Graduate() Double-Read of assetBalance()/balance() Creates TOCTOU Pattern | CONFIRMED (low risk due to nonReentrant) | 1,2,3,4,5,6,7,8,9 |
| 67 | TF-6 | B1 Token-Flow | Medium | FRouterV3.sol:367-410 | drainPrivatePool() Captures Donated Tokens Without Reserve Sync Awareness | CONFIRMED | 1,2,3,5,6,7,8,9 |
| 68 | TF-7 | B1 Token-Flow | Low | FPairV2.sol:78, 101 | Pool.lastUpdated Written But Never Read (Dead Storage) | CONFIRMED | 1,2,3,5,6,7,8,9 |
| 69 | TF-8 | B1 Token-Flow | Medium | BondingV5.sol:746 | Graduation Sends Agent Tokens to Token Contract — Production Side Effects CONTESTED | CONTESTED | 1,2,3,4,5,6,7,8,9 |
| 70 | EC-5 | B4 Temporal-Economic | Low | FPairV2.sol:77 | K Overflow Risk with Extreme Parameter Values | CONFIRMED | 1,2,3,4,5 |
| 71 | EC-6 | B4 Temporal-Economic | Info | FRouterV2.sol, FRouterV3.sol | Buy/Sell Tax Asymmetry (Input vs Output Based) — Standard Design | INFO | 1,2,3,4,5 |
| 72 | EC-7 | B4 Temporal-Economic | Low | FRouterV3.sol, FRouterV2.sol | Rounding Dust: Small Transactions May Pay Zero Tax | CONFIRMED | 1,2,3,4,5 |
| 73 | EC-8 | B4 Temporal-Economic | Info | BondingV5.sol:639-668 | Graduation Math Verified Correct | INFO | 1,2,3,4,5 |
| 74 | EC-9 | B4 Temporal-Economic | Info | BondingV5.sol:666 | Graduation Blocked During Anti-Sniper Window — Design Choice | INFO/DESIGN | 1,2,3,4,5 |
| 75 | EC-10 | B4 Temporal-Economic | Low | BondingConfig.sol:207 | BPS Precision Loss for Pathological initialSupply Values | CONFIRMED | 1,2,3,4,5 |

---

## Phase 3b/3c New Findings (Merge)

**New findings added: 20** (20 unique, 11 duplicates discarded)
**Source breakdown:** RS2:6, RS3:2, PC1:12 

| # | Finding ID | Source | Severity | Location | Title | Verdict |
|----|-----------|--------|----------|----------|-------|---------|
| 76 | RS2-1 | B7 Rescan-2 | High | FRouterV3.sol:157-167, 199-210 | FRouterV3.buy/sell DoS when tax is zero — AgentTaxV2.depositTax reverts | CONFIRMED |
| 77 | RS2-2 | B7 Rescan-2 | Medium | multicall3.sol:446-460, 494-508 | Multicall3 batch functions silently fail for admins — broken access control | CONFIRMED |
| 78 | RS2-3 | B7 Rescan-2 | Medium | BondingV5.sol:462-497 | BondingV5.cancelLaunch() violates CEI — reentrancy possible before state update | CONFIRMED |
| 79 | RS2-4 | B7 Rescan-2 | Medium | FFactoryV2.sol:60-86, FFactoryV3.sol:68-94 | FFactory duplicate pair creation — existing pair overwritten, funds stranded | CONFIRMED |
| 80 | RS2-7 | B7 Rescan-2 | Info | multicall3.sol (all, 529 lines) | Multicall3 has zero test coverage — entire contract uncovered | CONFIRMED |
| 81 | RS2-8 | B7 Rescan-2 | Low | FRouterV3.sol:318, FRouterV2.sol:345 | FRouterV3 anti-sniper tax rounds toward zero; V2/V3 algorithm mismatch | CONFIRMED |
| 82 | RS3-3 | B8 Rescan-3 | Medium | BondingV5.sol:748-756 | Graduation DAO address non-deterministic — msg.sender of graduating buyer controls salt | CONFIRMED |
| 83 | RS3-4 | B8 Rescan-3 | Low | AgentFactoryV7.sol:315-319 | _createNewDAO _existingAgents check is dead code for DAOs | CONFIRMED |
| 84 | PC1-3 | B9 Per-Contract | Medium | multicall3.sol:350-357 | No two-step ownership transfer — owner mistaken transfer is irreversible | CONFIRMED |
| 85 | PC1-4 | B9 Per-Contract | Medium | multicall3.sol:90-185 | Payable aggregate functions trap ETH — no msg.value usage or refund | CONFIRMED |
| 86 | PC1-5 | B9 Per-Contract | Low | multicall3.sol:295-299 | getBlockHash() returns bytes32(0) for old blocks — silently invalid | CONFIRMED |
| 87 | PC1-6 | B9 Per-Contract | Low | multicall3.sol:387-422 | approveToken() callable by admins — can drain ERC-20s via external transferFrom | CONFIRMED |
| 88 | PC1-7 | B9 Per-Contract | Info | multicall3.sol:202-228, 258-284 | Inline assembly struct-layout assumptions — undocumented invariant | INFO |
| 89 | PC1-8 | B9 Per-Contract | Info | multicall3.sol:359-374 | No admin enumeration — zombie admin addresses cannot be bulk-revoked | INFO |
| 90 | PC1-10 | B9 Per-Contract | High | FFactoryV2.sol:48-58, FFactoryV3.sol:50-66 | CREATOR_ROLE and ADMIN_ROLE never granted at initialize() — factory starts fully DoS'd | CONFIRMED |
| 91 | PC1-12 | B9 Per-Contract | Medium | FFactoryV2.sol:124-126, FFactoryV3.sol:132-134 | setRouter(address(0)) not blocked — DoS on all future pair creation | CONFIRMED |
| 92 | PC1-14 | B9 Per-Contract | Medium | FFactoryV2.sol:15-16, FFactoryV3.sol:23-24 | Identical role bytes across factories — cross-factory role grant confusion possible | CONFIRMED |
| 93 | PC1-15 | B9 Per-Contract | Low | FFactoryV2.sol:81, FFactoryV3.sol:89 | pairs[] array grows unboundedly — no length cap, gas exhaustion in iteration | CONFIRMED |
| 94 | PC1-16 | B9 Per-Contract | Low | FFactoryV2.sol:60-86, FFactoryV3.sol:68-94 | No code-existence check on token addresses — EOA addresses accepted as pair tokens | CONFIRMED |
| 95 | PC1-17 | B9 Per-Contract | Low | FFactoryV2.sol:48-58, FFactoryV3.sol:50-66 | initialize() accepts unchecked tax values — circular dependency with PC1-10 | CONFIRMED |

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|-----------|----------|---------------------|---------|----------|-------------------|--------------------|
| AC-1 | FRouterV2/V3.sol:230-239 | FRouter.graduate() has no threshold/safety checks; EXECUTOR_ROLE EOA can drain all pools | CONFIRMED | Critical | KEY_COMPROMISE | TOTAL_LOSS |
| AC-2 | FRouterV2/V3.sol:184,189 | isInitialPurchase flag is EXECUTOR-caller-trusted; bypasses anti-sniper tax entirely | CONFIRMED | High | ROLE_ABUSE | TAX_BYPASS |
| AC-3 | FFactoryV2/V3.sol:108-130 | No upper-bound validation on buyTax/sellTax in setTaxParams() | CONFIRMED | High | ROLE_ABUSE | FEE_EXTRACTION |
| AC-4 | FFactoryV2/V3.sol:124-134 | setRouter() accepts any address; future pairs inherit malicious router | CONFIRMED | High | ROLE_ABUSE | FUTURE_PAIRS_COMPROMISED |
| AC-5 | FRouterV2/V3.sol, FPairV2.sol:198-206 | setTaxStartTime() has no upper bound; can set to far-future, locking 99% tax indefinitely | CONFIRMED | High | ROLE_ABUSE | TAX_MANIPULATION |
| AC-6 | BondingV5.sol:857-859 | setBondingConfig() silent, no validation; can swap entire config contract | CONFIRMED | Medium | ROLE_ABUSE | CONFIG_SWAP |
| AC-7 | Protocol-wide | 23+ setters modify critical state with no event; undetectable by monitoring | CONFIRMED | Medium | ROLE_ABUSE | MONITORING_BLINDSPOT |
| AC-8 | FRouterV2/V3.sol:241-250 | approval() lets EXECUTOR approve any pair token to any spender; alternative drain path | CONFIRMED | Medium | KEY_COMPROMISE | TOKEN_DRAINAGE |
| AC-9 | BondingV5.sol:524-528 | privilegedLauncher omission blocks X_LAUNCH/ACP_SKILL/Project60days launches | CONFIRMED | Low | OMISSION | DOS |
| AC-10 | FRouterV2/V3.sol, FFactoryV2/V3.sol | DEFAULT_ADMIN_ROLE can grant any role to attacker; single point of escalation | CONFIRMED | Medium | KEY_COMPROMISE | ROLE_ESCALATION |
| EP-1 | BondingV5.sol:331-352 | createNewAgentTokenAndApplication() return values not checked for zero | CONFIRMED | High | EXTERNAL_FAILURE | CORRUPTED_STATE |
| EP-2 | BondingV5.sol:366-371 | factory.createPair() return value not zero-checked | CONFIRMED | High | EXTERNAL_FAILURE | BROKEN_TRADING |
| EP-3 | BondingV5.sol:748-756 | executeBondingCurveApplicationSalt() return agentToken not validated | CONFIRMED | High | EXTERNAL_FAILURE | BAD_EVENT_DATA |
| EP-4 | FRouterV3.sol:207,161 | taxVault zero-check done in preLaunch but not in router buy/sell | CONFIRMED | Medium | CONFIG_CHANGE | REVERT_DOS |
| EP-5 | BondingV5.sol:718-719 | graduation reads balanceOf() which includes donations; inflates graduation amounts | CONFIRMED | High | UNSOLICITED_TRANSFER | GRADUATION_MANIPULATION |
| EP-6 | FRouterV2/V3.sol:457-458 | founder() return not validated but veTokenAmount > 0 check catches zero | CONFIRMED | Low | EXTERNAL_CALL | SAFE_BY_ACCIDENT |
| EP-7 | FRouterV2/V3.sol:466,480 | drainUniV2Pool relies on founder pre-approving factory; not enforced on-chain | CONFIRMED | High | MISSING_APPROVAL | FUNCTION_NOOP |
| EP-8 | BondingV5.sol:664-670 | AgentFactory failure mid-graduation bricks pool permanently; every buy reverts | CONFIRMED | Critical | EXTERNAL_DEPENDENCY | PERMANENT_DOS |
| EP-9 | BondingV5.sol:718-729 | Attacker donates to pair pre-graduation to distort Uniswap pool initialization ratio | CONFIRMED | Medium | UNSOLICITED_TRANSFER | POOL_RATIO_DISTORTION |
| EP-10 | BondingV5.sol:746,748-754 | AgentToken transfer tax reduces actual tokens received vs lpSupply sent to factory | CONFIRMED | Critical | PRODUCTION_BEHAVIOR | GRADUATION_FAILURE |
| EP-11 | FRouterV2/V3.sol:441-473 | veToken interface can be spoofed; but EXECUTOR_ROLE mitigates | CONFIRMED | Medium | INTERFACE_SPOOF | WRONG_POOL_DRAIN |
| EP-12 | FRouterV3.sol:344-355 | setTaxStartTime try/catch swallows failure; falls back to startTime for anti-sniper | CONFIRMED | Medium | SILENT_FAILURE | WRONG_TAX_WINDOW |
| EP-13 | BondingV5.sol:443-448 | taxVault changes between registerToken and depositTax; new vault doesn't know token | CONFIRMED | Medium | CONFIG_CHANGE | TRADE_REVERT |
| EP-14 | BondingV5.sol:727-756 | 4 sequential AgentFactory calls at graduation; any role revocation bricks graduation | CONFIRMED | High | ROLE_REVOCATION | PERMANENT_DOS |
| MG-1 | FRouterV3.sol:293 | tokenAntiSniperType() reverts for non-V5 tokens; no try/catch | CONFIRMED | Medium | MISCONFIGURATION | DOS |
| MG-2 | FRouterV2.sol:40-41 | Deprecated storage slots at N+2,N+3 must be preserved on proxy upgrade | CONFIRMED | Medium | UPGRADE_RISK | STORAGE_CORRUPTION |
| MG-3 | BondingV5.sol:857-859 | Config swap affects future tokens only; existing tokenGradThreshold immutable | PARTIAL | Low | ACCESS | N/A |
| MG-4 | BondingV5.sol:554-558 | teamTokenReservedWallet read fresh at launch(); can differ from preLaunch() value | CONFIRMED | Medium | CONFIG_CHANGE | ACCOUNTING_ERROR |
| MG-5 | BondingConfig.sol:138-149 | _disableInitializers() correctly prevents reinitializer attack | REFUTED | Info | STATE | N/A |
| MG-6 | BondingV2-V4 | No emergencyWithdraw; dust permanently locked for non-Project60days tokens | CONFIRMED | Low | DESIGN | STRANDED_ASSETS |
| MG-7 | BondingV2.sol, BondingV5.sol | V5 not an upgrade of V2; completely separate deployments by design | REFUTED as bug | Info | N/A | N/A |
| MG-8 | BondingV5.sol | BondingV5 is 28,310 bytes > 24,576 EIP-170 limit | CONFIRMED | Medium | DEPLOYMENT | DEPLOY_FAILURE |
| SLS-1 | All 9 upgradeable contracts | Missing __gap breaks safe upgrade extensibility | CONFIRMED | Medium | UPGRADE_RISK | STORAGE_COLLISION |
| EVT-1 | BondingV2-V4 cancelLaunch() | initialPurchase zeroed before event emit; logs zero always | CONFIRMED | Medium | CODE_BUG | WRONG_EVENT_DATA |
| EVT-4 | All Bonding buy/sell | No event emitted on buy/sell; monitoring relies on pair-level events | CONFIRMED | Low | DESIGN | MONITORING_GAP |
| EVT-5 | BondingConfig.sol:240-244 | setScheduledLaunchParams() modifies fees/timing silently | CONFIRMED | Medium | ROLE_ABUSE | MONITORING_BLINDSPOT |
| EVT-6 | BondingV2-V4 | 14 admin setters emit no events | CONFIRMED | Medium | ROLE_ABUSE | MONITORING_BLINDSPOT |
| EVT-7 | BondingV5.sol:857-859 | setBondingConfig() emits no event | CONFIRMED | Medium | ROLE_ABUSE | MONITORING_BLINDSPOT |
| EVT-8 | FFactoryV2/V3.sol | setTaxParams() emits no event; silent tax manipulation | CONFIRMED | High | ROLE_ABUSE | MONITORING_BLINDSPOT |
| EVT-9 | FFactoryV2/V3.sol | setRouter() emits no event; silent routing redirect | CONFIRMED | High | ROLE_ABUSE | MONITORING_BLINDSPOT |
| EVT-10 | FRouterV2.sol | setBondingV2/V4, deprecated setters emit no events | CONFIRMED | Low | ROLE_ABUSE | MONITORING_BLINDSPOT |
| EVT-11 | FRouterV3.sol:257-262 | setBondingV5() emits no event; affects drain+anti-sniper | CONFIRMED | Medium | ROLE_ABUSE | MONITORING_BLINDSPOT |
| TE-1 | BondingV5.sol:383,555 | teamTokenReservedWallet read at both preLaunch and launch; can diverge | CONFIRMED | High | CONFIG_CHANGE | ACCOUNTING_ERROR |
| TE-2 | BondingV5.sol:267-271 | startTimeDelay read at preLaunch time; inconsistent classification if changed | CONFIRMED | Medium | CONFIG_CHANGE | INCONSISTENCY |
| TE-3 | FRouterV3.sol:310-318 | Validators can skew block.timestamp +/-12s; 20% tax reduction on 60s window | CONFIRMED | Medium | EXTERNAL | TAX_BYPASS |
| TE-4 | FRouterV3.sol:344-355 | EXECUTOR can call setTaxStartTime with any future timestamp; 99% tax indefinitely | CONFIRMED | High | ROLE_ABUSE | TAX_MANIPULATION |
| TE-5 | FPairV2.sol:45, FRouterV3.sol:326-338 | taxStartTime=0 fallback to startTime; wrong window for scheduled launches | CONFIRMED | Medium | CONFIG_CHANGE | WRONG_TAX_WINDOW |
| TE-6 | FFactoryV3.sol:35, FRouterV3.sol:291 | Global antiSniperBuyTaxStartValue retroactively weakens active windows | CONFIRMED | Medium | CONFIG_CHANGE | TAX_RETROACTIVE |
| EC-1 | FRouterV2/V3.sol:190-196 | buyTax >= 100 causes 99 - buyTax underflow revert; bricks buys during anti-sniper | CONFIRMED | High | PARAM_BOUNDARY | REVERT_DOS |
| EC-2 | BondingConfig.sol:224-233 | targetRealVirtual = 0 makes gradThreshold equal initial reserve; instant graduation | CONFIRMED | High | PARAM_BOUNDARY | INSTANT_GRADUATION |
| EC-3 | FRouterV2/V3.sol:150-160 | sellTax no cap; >= 101 causes underflow revert; = 100 gives user zero | CONFIRMED | High | PARAM_BOUNDARY | USER_FUNDS_TRAPPED |
| EC-4 | BondingV5.sol:376-377 | fakeInitialVirtualLiq = 0 causes division by zero in preLaunch | CONFIRMED | High | PARAM_BOUNDARY | REVERT_DOS |
| EC-11 | FRouterV2/V3.sol, BondingV2-V5 | maxTx declared in V2-V4 but never enforced; absent in V5 | CONFIRMED | Medium | DESIGN | WHALE_IMPACT |
| TF-1 | FPairV2.sol:176-181, BondingV5.sol:718-719 | balanceOf() used for graduation; includes donations | CONFIRMED | Medium | UNSOLICITED_TRANSFER | GRADUATION_MANIPULATION |
| TF-2 | BondingV5.sol:462-497 | cancelLaunch() does not burn or drain agent tokens from FPairV2 | CONFIRMED | Medium | DESIGN | STRANDED_ASSETS |
| TF-3 | BondingV5.sol:746, FRouterV3.sol:131,155,223 | Production AgentToken has transfer tax; protocol assumes 1:1 delivery | CONFIRMED | High | PRODUCTION_BEHAVIOR | GRADUATION_FAILURE |
| TF-4 | FPairV2.sol:86-107 | swap() does not validate K invariant; router is sole pricing enforcer | CONFIRMED | Low | DESIGN | TRUST_MODEL |
| TF-5 | BondingV5.sol:718-720, FRouterV3.sol:235-238 | Balances read twice (BondingV5 + FRouterV3); TOCTOU pattern but nonReentrant guards | CONFIRMED | Medium | DOUBLE_READ | LOW_RISK_PATTERN |
| TF-6 | FRouterV3.sol:367-410 | drainPrivatePool reads real balance; syncAfterDrain may zero virtual reserves early | CONFIRMED | Medium | DONATION | RESERVE_INCONSISTENCY |
| TF-7 | FPairV2.sol:78,101 | Pool.lastUpdated written every swap but never read; dead storage gas waste | CONFIRMED | Low | DEAD_CODE | GAS_WASTE |
| TF-8 | BondingV5.sol:746 | Self-transfer at graduation may trigger unknown production token side effects | CONTESTED | Medium | PRODUCTION_BEHAVIOR | UNKNOWN |
| EC-5 | FPairV2.sol:77 | K = reserve0 * reserve1 can overflow with extreme parameter values | CONFIRMED | Low | PARAM_BOUNDARY | OVERFLOW |
| EC-7 | FRouterV2/V3.sol | Integer division floors tax to zero for small amounts | CONFIRMED | Low | MATH | TAX_ROUNDING |
| EC-10 | BondingConfig.sol:207 | BPS truncation for pathological initialSupply causes bondingCurveSupply = 0 | CONFIRMED | Low | MATH | REVERT_DOS |

---

## REFUTED Findings (for Depth Second Opinion)

| Finding ID | Agent | Reason for REFUTED | Domain |
|-----------|-------|--------------------|--------|
| MG-5 | B3 Migration | OpenZeppelin Initializable correctly prevents re-initialization via _disableInitializers() in constructor; no reinitializer attack surface | Upgrade Safety |
| MG-7 | B3 Migration | V5 storage layout discontinuity vs V2-V4 is confirmed by design — they are separate proxy deployments, not upgrades of each other | Storage Layout |

---

## CONTESTED Findings (for Depth Priority)

| Finding ID | Agent | External Dep Involved | Worst-Case Severity | Notes |
|-----------|-------|-----------------------|---------------------|-------|
| TF-8 | B1 Token-Flow | Production AgentToken (unverified behavior on self-receipt) | Critical (permanent graduation DoS) | Mock tests do not test transfer hooks; production token may auto-distribute, burn, or revert on self-receipt |
| TF-3 | B1 Token-Flow | Production AgentToken transfer tax (buy/sell basis points) | Critical (graduation fails if token is taxed) | Overlaps EP-10; 7 unverified external calls; mock tests mask this entirely |
| EP-10 | B6 External-Precond | Production AgentToken transfer tax at graduation | Critical (LP creation fails with wrong lpSupply) | Depends on whether BondingV5 is on AgentToken whitelist |
| EP-11 | B6 External-Precond | AgentVeToken contract (caller-supplied, unverified) | High (wrong pool drained) | Mitigated by EXECUTOR_ROLE trust; depth should verify validation logic |

---

## Incomplete Analysis Flags

| Finding ID | Missing Steps | Flag for Depth? |
|-----------|---------------|-----------------|
| TF-8 | Production token behavior verification (step 9 unverified) | YES — depth should verify AgentToken self-transfer behavior |
| TF-3 / EP-10 | Production AgentToken whitelist verification for BondingV5 | YES — depth must determine if BondingV5 is whitelisted in AgentToken |
| EP-7 | No on-chain verification that founder pre-approval exists before drainUniV2Pool | YES — check if any flow enforces founder approval |
| AC-1 / AC-9 | Both directions of EXECUTOR_ROLE semi-trusted: malicious vs compromised | PARTIAL — malicious modeled; key compromise modeled; R6 both directions confirmed |
| MG-3 | PARTIAL verdict; fee/supply parameters for future tokens not fully traced | YES — verify complete impact scope |

---

## Rule Application Violations

| Finding ID | Rule | Violation? |
|-----------|------|------------|
| AC-1 | R6: SEMI_TRUSTED EXECUTOR both directions required | COMPLIANT — both malicious and key-compromise modeled |
| AC-3 | R6: SEMI_TRUSTED ADMIN both directions required | COMPLIANT — both modeled |
| AC-7 | R8: Multi-step with silent setter → staleness check | COMPLIANT — AC-7 notes retroactive impact on active trades |
| EVT-8 | R10: If severity uses current state → recalibrate | FLAG — EVT-8 High severity assumes ADMIN_ROLE is compromised; per R10, current trust model marks ADMIN as FULLY_TRUSTED |
| AC-3 / EC-1 / EC-3 | R14: Admin setter modifies limit/bound → regression and coherence check | FLAG — setTaxParams has no upper bound regression; EC-1/EC-3 are the direct consequence |
| EP-8 | R8: Multi-step graduation operation → staleness check | COMPLIANT — EP-14 captures role dependency staleness |
| TE-1 / MG-4 | R8: Multi-step preLaunch → launch staleness | COMPLIANT — teamTokenReservedWallet staleness fully modeled |

---

## Assumption Dependency Audit

| Finding ID | Attack Actor | Actor Trust Level | Within Bounds? | Tag | Original Severity | Adjusted Severity |
|-----------|-------------|-------------------|----------------|-----|-------------------|-------------------|
| AC-1 | EXECUTOR_ROLE (beOpsWallet EOA) | SEMI_TRUSTED | NO — draining all pools exceeds bounded protocol operations | (none) | Critical | Critical |
| AC-2 | EXECUTOR_ROLE (beOpsWallet EOA) | SEMI_TRUSTED | NO — isInitialPurchase=true for arbitrary buys exceeds bounded operations | (none) | High | High |
| AC-3 | ADMIN_ROLE (Factory) | FULLY_TRUSTED (design_context.md) | N/A — trust assumption grants this | [ASSUMPTION-DEP: TRUSTED-ACTOR] | High | Medium (recalibrated) |
| AC-4 | ADMIN_ROLE (Factory) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | High | Medium (recalibrated) |
| AC-5 | EXECUTOR_ROLE (beOpsWallet) | SEMI_TRUSTED | NO — setting taxStartTime to max_uint is outside bounded operations | (none) | High | High |
| AC-6 | Owner (BondingV5) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| AC-7 | Admin/Owner roles | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| AC-8 | EXECUTOR_ROLE (beOpsWallet) | SEMI_TRUSTED | NO — arbitrary approvals on all pairs exceeds bounded operations | (none) | Medium | Medium |
| AC-9 | privilegedLauncher | SEMI_TRUSTED | WITHIN BOUNDS — omitting launch is within expected role uncertainty | [ASSUMPTION-DEP: WITHIN-BOUNDS] | Low | Low |
| AC-10 | DEFAULT_ADMIN_ROLE | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| EP-1 | External (AgentFactory) | N/A (external contract failure) | N/A | (none) | High | High |
| EP-2 | External (FFactory) | N/A (external contract failure) | N/A | (none) | High | High |
| EP-3 | External (AgentFactory) | N/A (external contract failure) | N/A | (none) | High | High |
| EP-4 | ADMIN_ROLE (Factory) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| EP-5 | Attacker (UNTRUSTED user) | UNTRUSTED | N/A — no trusted actor required | (none) | High | High |
| EP-6 | N/A | N/A | N/A | (none) | Low | Low |
| EP-7 | EXECUTOR_ROLE | SEMI_TRUSTED | WITHIN BOUNDS — drain is an expected operation; approval is a precondition gap | [ASSUMPTION-DEP: WITHIN-BOUNDS] | High | High (real operational gap) |
| EP-8 | External (AgentFactory upgrade/pause) | N/A (external dep) | N/A | (none) | Critical | Critical |
| EP-9 | Attacker (UNTRUSTED) | UNTRUSTED | N/A | (none) | Medium | Medium |
| EP-10 | Production behavior (AgentToken) | N/A (token design) | N/A | (none) | Critical | Critical |
| EP-11 | EXECUTOR_ROLE (potentially compromised) | SEMI_TRUSTED | NO — spoofed veToken exceeds bounded operations | (none) | Medium | Medium |
| EP-12 | External (old pair contract) | N/A | N/A | (none) | Medium | Medium |
| EP-13 | ADMIN_ROLE (Factory) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| EP-14 | External (AgentFactory role change) | N/A | N/A | (none) | High | High |
| MG-1 | EXECUTOR_ROLE / Misconfiguration | SEMI_TRUSTED | NO — routing non-V5 token through V3 is a misconfiguration | (none) | Medium | Medium |
| MG-2 | Upgrade process (admin action) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| MG-3 | Owner (BondingV5) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Low | Info (recalibrated) |
| MG-4 | Owner (BondingConfig) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| MG-6 | N/A (design gap) | N/A | N/A | (none) | Low | Low |
| MG-8 | N/A (deployment risk) | N/A | N/A | (none) | Medium | Medium |
| SLS-1 | N/A (upgrade hygiene) | N/A | N/A | (none) | Medium | Medium |
| EVT-1 | N/A (code bug) | N/A | N/A | (none) | Medium | Medium |
| EVT-4 | N/A (design) | N/A | N/A | (none) | Low | Low |
| EVT-5 | Owner (BondingConfig) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| EVT-6 | Owner (BondingV2-V4) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| EVT-7 | Owner (BondingV5) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| EVT-8 | ADMIN_ROLE (Factory) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | High | Medium (recalibrated) |
| EVT-9 | ADMIN_ROLE (Factory) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | High | Medium (recalibrated) |
| EVT-10 | ADMIN_ROLE (FRouterV2) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Low | Info (recalibrated) |
| EVT-11 | ADMIN_ROLE (FRouterV3) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| TE-1 | Owner (BondingConfig) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | High | Medium (recalibrated) |
| TE-2 | Owner (BondingConfig) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| TE-3 | Validator/block builder (UNTRUSTED/external) | UNTRUSTED | N/A | (none) | Medium | Medium |
| TE-4 | EXECUTOR_ROLE (beOpsWallet) | SEMI_TRUSTED | NO — setting taxStartTime to far-future exceeds bounded operations | (none) | High | High |
| TE-5 | N/A (edge case) | N/A | N/A | (none) | Medium | Medium |
| TE-6 | ADMIN_ROLE (Factory) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Medium | Low (recalibrated) |
| EC-1 | ADMIN_ROLE (Factory) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | High | Medium (recalibrated) |
| EC-2 | Owner (BondingConfig) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | High | Medium (recalibrated) |
| EC-3 | ADMIN_ROLE (Factory) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | High | Medium (recalibrated) |
| EC-4 | Owner (BondingConfig) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | High | Medium (recalibrated) |
| EC-11 | N/A (design) | N/A | N/A | (none) | Medium | Medium |
| TF-1 | Attacker (UNTRUSTED) | UNTRUSTED | N/A | (none) | Medium | Medium |
| TF-2 | N/A (design gap) | N/A | N/A | (none) | Medium | Medium |
| TF-3 | Production AgentToken design | N/A | N/A | (none) | High | High |
| TF-4 | N/A (design) | N/A | N/A | (none) | Low | Low |
| TF-5 | N/A (pattern) | N/A | N/A | (none) | Medium | Medium |
| TF-6 | Attacker (UNTRUSTED) | UNTRUSTED | N/A | (none) | Medium | Medium |
| TF-7 | N/A (dead code) | N/A | N/A | (none) | Low | Low |
| TF-8 | Production AgentToken design | N/A | N/A | (none) | Medium | Medium (CONTESTED) |
| EC-5 | Owner (BondingConfig) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Low | Info (recalibrated) |
| EC-7 | N/A (math) | N/A | N/A | (none) | Low | Low |
| EC-10 | Owner (BondingConfig) | FULLY_TRUSTED | N/A | [ASSUMPTION-DEP: TRUSTED-ACTOR] | Low | Info (recalibrated) |

---

## Slither Finding Promotion

### Static Analysis Results (grep-based fallback)

**[SLITHER-1] Divide-Before-Multiply Precision Loss — BondingV2/V3/V4 Liquidity Calculation**
- **Severity**: Medium
- **Location**: BondingV2.sol:325-326 (and identical pattern in BondingV3, BondingV4)
- **Pattern**: `(((((K * 10000) / assetRate) * 10000 ether) / bondingCurveSupply) * 1 ether) / 10000` — inner division `(K * 10000) / assetRate` occurs before subsequent multiplications, causing potential precision loss if `K * 10000 < assetRate`.
- **Detector**: divide-before-multiply
- **Promoted to inventory**: YES

**[SLITHER-2] Dead Storage — FPairV2.Pool.lastUpdated Field**
- **Severity**: Info
- **Location**: FPairV2.sol:78, 101
- **Pattern**: `_pool.lastUpdated = block.timestamp` written in mint() and every swap(), but never read by any function (except mint()'s initialization check which could use a simple boolean).
- **Detector**: dead code / unused storage
- **Note**: Overlaps with TF-7 finding. Confirmed as dead storage via TF-7.
- **Promoted to inventory**: YES (merged with TF-7)

**[SLITHER-3] Dead Code — BondingV2._preLaunch() Always Reverts**
- **Severity**: Info
- **Location**: BondingV2.sol:264, BondingV3.sol (same), BondingV4.sol (same)
- **Pattern**: `_preLaunch()` begins with `revert("Not implemented")` making all subsequent code in that function dead.
- **Detector**: dead code
- **Promoted to inventory**: YES (informational)

---

## Side Effect Trace Audit

### Side Effect Trace Summary

| # | External Call | Side Effect | Token Type | Landing | Consuming Code | Handled? | Breadth Coverage | Finding |
|---|--------------|-------------|------------|---------|----------------|----------|------------------|---------|
| 1 | `agentFactory.createNewAgentTokenAndApplication()` | Creates ERC20 agent token + application state | AgentToken (new) | BondingV5 tokenInfo mapping | All subsequent buy/sell/graduate ops | PARTIAL — return values not validated | EP-1 | EP-1 |
| 2 | `agentFactory.executeBondingCurveApplicationSalt()` | Creates real agentToken + seeds Uniswap V2 LP | AgentToken (post-grad) + LP | AgentFactory → Uniswap pair | Graduation flow | PARTIAL — return not validated | EP-3, EP-10 | EP-3, EP-10 |
| 3 | `agentFactory.addBlacklistAddress()` | Modifies agent token transfer restrictions | Agent token state | AgentToken contract | All transfers pre-graduation | YES — called explicitly at preLaunch | — | — |
| 4 | `agentFactory.removeBlacklistAddress()` | Removes transfer restriction for LP pool | Agent token state | AgentToken contract | Graduation flow | YES — called explicitly at graduation | — | — |
| 5 | `agentFactory.updateApplicationThresholdWithApplicationId()` | Updates application threshold in AgentFactory | External application state | AgentFactory | Graduation; determines Uniswap pool seed | PARTIAL — failure bricks graduation | EP-8, EP-14 | EP-8, EP-14 |
| 6 | `IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)` (graduation) | Agent token sent to its own contract address; may trigger production hooks | AgentToken (self) | Token contract itself | executeBondingCurveApplicationSalt uses these tokens | NO — production side effects unknown | TF-8, EP-10 | TF-8 (CONTESTED), [SE-1] |
| 7 | `IAgentTaxMinimal(taxVault).registerToken()` | Registers token for tax attribution | VIRTUAL tax flow | AgentTaxV2 amountCollected | All subsequent buy/sell depositTax calls | YES — checked taxVault != 0 | EP-13 | EP-13 |
| 8 | `IAgentTaxForRouter(taxVault).depositTax()` | Routes buy/sell tax to AgentTaxV2 | VIRTUAL (tax portion) | AgentTaxV2 | Tax distribution/swap | PARTIAL — taxVault not re-validated after registerToken | EP-4, EP-13 | EP-4, EP-13 |
| 9 | `agentFactory.removeLpLiquidity(veToken, recipient, ...)` | Removes Uniswap V2 LP liquidity via AgentFactory | LP token → AgentToken + VIRTUAL | Recipient address | drainUniV2Pool result | PARTIAL — founder approval not enforced | EP-7 | EP-7 |
| 10 | `IERC20(agentToken).safeTransferFrom(user, pair, amountIn)` during sell() | Production tax reduces amount received by pair | AgentToken (taxed) | FPairV2 real balance | Pair reserve accounting (virtual vs real divergence) | NO — assumes 1:1 delivery | TF-3 | TF-3 |
| 11 | `IFPairV2(pair).transferTo(buyer, amountOut)` during buy() | Production tax reduces amount received by buyer | AgentToken (taxed) | User wallet | User receives less than expected | NO — assumes 1:1 delivery | TF-3 | TF-3 |
| 12 | `pair.transferAsset(taxVault, txFee)` during buy/sell | Routes VIRTUAL tax; if taxVault is address(0) or unregistered → revert | VIRTUAL (tax) | AgentTaxV2 or arbitrary address | depositTax on new taxVault fails if token not registered | PARTIAL | EP-4, EP-13 | EP-13 |

### Side Effect Findings (if any)

**[SE-1] Production AgentToken May Reject or Transform Self-Receipt at Graduation**
- **Severity**: High (CONTESTED — depends on production token implementation)
- **Location**: BondingV5.sol:746
- **Trace**: `_openTradingOnUniswap()` → `IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)` — sends all agent tokens from bonding curve to the token contract itself
- **Side Effect**: If production AgentToken has any of: (a) transfer tax on non-whitelisted senders, (b) auto-distribute on receipt, (c) blacklist/whitelist that includes tokenAddress_, (d) auto-swap threshold, or (e) reflection logic, this transfer may: revert (blocking graduation permanently), or succeed with fewer tokens received than sent (causing lpSupply mismatch in executeBondingCurveApplicationSalt)
- **Exit Path**: None without admin intervention once graduation is bricked
- **Callback Revert Possible**: YES — if AgentToken reverts on self-receipt, the safeTransfer reverts, graduation fails, and every subsequent buy reverts (EP-8 DoS chain activates)
- **Breadth Coverage**: Partially covered by TF-8 (CONTESTED) and EP-10; SE-1 adds the self-transfer reentrancy/hook vector specifically
- **New Gap**: YES — the specific hook categories (auto-swap, reflection, self-blacklist) were not explicitly enumerated in TF-8

---

## Elevated Signal Audit

| Signal | Tag | Addressed? | Finding ID / Depth Flag |
|--------|-----|------------|------------------------|
| Storage layout for all upgradeable contracts | [ELEVATE:STORAGE_LAYOUT] | YES | SLS-1 (missing __gap), SLS-2 through SLS-7 (individual analyses), MG-2 (deprecated slots) |
| Single entry per token, no versioning | [ELEVATE:SINGLE_ENTRY] | PARTIAL | MG-4 (teamTokenReservedWallet read twice), EP-1/EP-2 (no return validation), TF-2 (cancel locks pair state permanently); depth should verify if tokenInfo[token] can be reused after cancelLaunch() + re-preLaunch() for same token address |
| Pump.fun fork ancestry | [ELEVATE:FORK_ANCESTRY:Pump.fun] | PARTIAL | TF-4 (K not validated), TF-7 (dead lastUpdated), SLITHER-1 (divide-before-multiply); depth should cross-reference known Pump.fun CVEs / rug patterns |
| buy() vs sell() branch asymmetry | [ELEVATE:BRANCH_ASYMMETRY] | YES | AC-2 (isInitialPurchase bypass on buy), EC-1 (anti-sniper cap underflow on buy), EC-3 (no cap on sell), EC-6 (input vs output tax basis) |
| Inline assembly in multicall3.sol | [ELEVATE:INLINE_ASSEMBLY] | PARTIAL | Noted in static_analysis.md; multicall3 not deeply analyzed; depth should audit aggregate3Value() for ETH donation griefing and call forwarding attacks |
