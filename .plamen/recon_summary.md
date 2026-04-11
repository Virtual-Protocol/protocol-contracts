# Recon Summary — VP Launchpad Suite (LaunchpadV2)

## 1. Build Status
- **Result**: SUCCESS (Hardhat + Forge both compile, Solc 0.8.26)
- **Warning**: BondingV5 is 28,310 bytes > EIP-170 24,576-byte limit — optimizer required for mainnet
- **Test Suite**: 121 pass / 50 fail (all failures are BondingV2 stubs — intentional; BondingV5 100% pass)

## 2. Contracts
- **Total in scope**: 12 contracts, ~6,718 lines
- **Core contracts**: BondingV5 (active), BondingV2/V3/V4 (deprecated), BondingConfig, FPairV2, FFactoryV2/V3, FRouterV2/V3
- **Reference only**: 8 mock contracts (MockUniswapV2*, MockAgent*)
- **All core contracts use upgradeable proxy pattern (Initializable)**

## 3. External Dependencies
- **AgentFactory (V6/V7)**: Creates agent tokens at graduation
- **AgentToken / AgentTokenV2**: ERC20 with transfer tax — behavior diverges from mock
- **AgentVeToken**: LP veToken wrapper
- **AgentTax / AgentTaxV2**: Tax distribution system
- **UniswapV2Pair**: Post-graduation trading (IUniswapV2Pair interface)
- **ERC6551Registry**: Account abstraction registry
- **VIRTUAL token**: The bonding curve asset token

## 4. Detected Patterns (15 flags)
TEMPORAL, BALANCE_DEPENDENT, MIGRATION, MONETARY_PARAMETER, SEMI_TRUSTED_ROLE,
STORAGE_LAYOUT, OUTCOME_CALLBACK, NAMED_EXTERNAL_PROTOCOL, OUTCOME_CALLBACK_LOW_LEVEL,
OUTCOME_DELAY, INLINE_ASSEMBLY, MIXED_DECIMALS, FLASH_LOAN_EXTERNAL, BRANCH_ASYMMETRY,
FORK_ANCESTRY:Pump.fun

## 5. Recommended Templates (9 required)
1. TOKEN_FLOW_TRACING — virtual vs real reserve dual-accounting
2. ECONOMIC_DESIGN_AUDIT — bonding curve parameters, K constant, graduation threshold
3. SEMI_TRUSTED_ROLES — EXECUTOR_ROLE (all trading), ADMIN_ROLE (tax config), privilegedLauncher
4. TEMPORAL_PARAMETER_STALENESS — anti-sniper tax decay, startTime, deadline checks
5. EVENT_CORRECTNESS — 40 events, 23 silent setters
6. MIGRATION_ANALYSIS — 4 parallel bonding versions (V2–V5) sharing infrastructure
7. STORAGE_LAYOUT_SAFETY — 9 upgradeable contracts with complex struct storage
8. EXTERNAL_PRECONDITION_AUDIT — AgentFactory/AgentToken/AgentTax/UniswapV2
9. INTEGRATION_HAZARD_RESEARCH — UniswapV2 drain integration, veToken verification bypass risk

## 6. Niche Agents Required (4)
- EVENT_COMPLETENESS — 23 setters without events
- SEMANTIC_CONSISTENCY_AUDIT — shared parameters across BondingV2–V5 and Bonding/Router/Factory
- CALLBACK_RECEIVER_SAFETY — OUTCOME_CALLBACK flag (safeTransfer, onERC1155Received patterns)
- DIMENSIONAL_ANALYSIS — MIXED_DECIMALS flag (mulDiv + decimals() patterns)

## 7. Key Risk Signals
- **FPairV2.swap() has NO K invariant check** — trusts router completely
- **23 silent setters** — admin parameter changes emit no events
- **Post-graduation behavior completely untested** (MockUniswapV2Router02 uses 1:1 swaps)
- **BondingV5 exceeds contract size limit** — mainnet deployment risk
- **cancelLaunch() does not burn tokens** — pair remains with locked tokens permanently
- **MockAgentToken has no transfer tax** — tests don't validate tax-on-transfer interactions

## 8. Artifacts Written
attack_surface.md, build_status.md, call_graph.md, constraint_variables.md,
contract_inventory.md, design_context.md, detected_patterns.md, emit_list.md,
event_definitions.md, external_interfaces.md, external_production_behavior.md,
function_list.md, meta_buffer.md, modifiers.md, setter_list.md, state_variables.md,
static_analysis.md, template_recommendations.md, test_results.md
