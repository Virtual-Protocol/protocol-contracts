# File Coverage Map

## File Coverage Map

| Source File | Referenced in Analysis? | Referenced By |
|-------------|------------------------|---------------|
| BondingV2.sol | YES | B1 (token flow), B2 (access control), B3 (migration), B4 (temporal/economic), B5 (storage/events) |
| BondingV3.sol | YES | B3 (migration — layout analysis), B5 (storage/events — silent setter list) |
| BondingV4.sol | YES | B2 (access control — EXECUTOR role), B3 (migration — storage slots N+16-N+21), B5 (storage/events — 14 silent setters including setAcpSkillLauncher, setXLauncher) |
| BondingV5.sol | YES (primary analysis target) | B1 (token flow — graduation flow L718-756, cancelLaunch), B2 (access control — setBondingConfig, setBondingConfig), B3 (migration — all scenarios), B4 (temporal/economic — preLaunch params, graduation math), B5 (storage/events — storage layout, setBondingConfig silent setter), B6 (external precond — all return value checks) |
| BondingConfig.sol | YES | B2 (access control — setters), B3 (migration — initialize(), teamTokenReservedWallet), B4 (temporal/economic — calculateGradThreshold, boundary analysis), B5 (storage/events — storage layout, setScheduledLaunchParams silent), B6 (external precond — return values) |
| FPairV2.sol | YES | B1 (token flow — reserve tracking, swap(), K invariant), B4 (temporal/economic — anti-sniper calc), B5 (storage/events — Pool struct, lastUpdated) |
| IFPairV2.sol | YES | B5 (interface confirmation), B6 (external precond — setTaxStartTime try/catch) |
| FFactoryV2.sol | YES | B2 (access control — setTaxParams, setRouter), B5 (storage/events — silent setters EVT-8, EVT-9) |
| FFactoryV3.sol | YES | B2 (access control — setTaxParams, setRouter), B4 (temporal/economic — antiSniperBuyTaxStartValue global), B5 (storage/events — silent setters EVT-8, EVT-9) |
| FRouterV2.sol | YES | B1 (token flow — sell/buy/graduate exits), B2 (access control — all EXECUTOR functions), B3 (migration — deprecated slots taxManager/antiSniperTaxManager), B4 (temporal/economic — tax formulas), B5 (storage/events — storage layout, setBondingV2/V4 silent setters) |
| FRouterV3.sol | YES (primary analysis target) | B1 (token flow — buy/sell/graduate/drain), B2 (access control — EXECUTOR functions), B3 (migration — MG-1 non-V5 revert), B4 (temporal/economic — anti-sniper calc, TE-3 validator manipulation), B5 (storage/events — setBondingV5() silent EVT-11), B6 (external precond — try/catch, depositTax, setTaxStartTime) |
| multicall3.sol | PARTIAL | static_analysis.md (assembly noted: aggregate3(), aggregate3Value(), withdrawEth()); NOT analyzed by any breadth agent for reentrancy, batch-call abuse, or ETH griefing vectors |

---

## Uncovered Files (add to depth_candidates as scope gaps)

| File | In-Scope? | Coverage Status | Depth Priority |
|------|-----------|-----------------|----------------|
| multicall3.sol | YES (in-scope per contract_inventory.md) | PARTIAL — only static analysis fallback grep; no dedicated breadth agent analyzed this file | HIGH — contains inline assembly, ETH transfers, batch external calls; potential donation/griefing vectors |

**Uncovered file count: 1** (multicall3.sol — partial coverage only)

**Scope gap for depth_candidates**:
- `multicall3.sol`: The `aggregate3Value()` function makes external calls in a loop with ETH forwarding. The `withdrawEth()` function transfers ETH without reentrancy protection. No breadth agent performed systematic analysis of: (a) whether multicall3 can be used to bypass nonReentrant guards on other contracts by batching calls, (b) whether the ETH forwarding loop can be used to drain any ETH held in the multicall3 contract, (c) whether `withdrawEth()` has any access control (it is marked as callable by admin/owner — needs verification).

---

## Reference-Only Files (confirmed out of scope)

| File | Referenced? | Why Out of Scope |
|------|-------------|------------------|
| MockUniswapV2Factory.sol | As test fixture baseline | Test mock only — reference for production UniswapV2Factory behavior |
| MockUniswapV2Pair.sol | As test fixture baseline | Test mock only — represents external Uniswap V2 pair behavior post-graduation |
| MockUniswapV2Router02.sol | As test fixture baseline | Test mock only — represents external Uniswap V2 router |
| MockAgentDAO.sol | Not referenced | Test mock only |
| MockAgentToken.sol | YES — referenced for TF-3/EP-10 gap | Critical gap: mock has NO transfer tax; production behavior unknown. NOT a security bug in the mock itself but creates audit coverage gap |
| MockAgentVeToken.sol | Referenced in EP-7, EP-11 | Test mock only — production veToken may be non-transferable or locked |
| MockERC20Decimals.sol | Not referenced | Test mock only |
| MockERC6551Registry.sol | Not referenced | Test mock only |
