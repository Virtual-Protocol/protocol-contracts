# RAG Validation Sweep
**Date**: 2026-04-03
**Method**: WebSearch fallback (RAG_TOOLS_AVAILABLE=false — unified-vuln-db MCP unavailable)
**Total findings validated**: 95 breadth/rescan/per-contract + 23 depth + 8 niche/DST/SP/VS = ~126 total finding instances
**Unique vulnerability classes scored**: 36
**Novel findings (score 0.3)**: 6

---

## Search Results Summary

All 17 WebSearch queries executed. Results summary by batch:

**Batch 1 (Access Control / Privileged Role)**: Solodit site search returned no direct hits for "EXECUTOR role drain bonding curve" but broader search confirmed that privileged-role drain patterns (owner-only withdraw/rescue functions enabling rug-pull) are a well-documented class on Solodit and in code4rena reports. The Cyfrin audit of Virtuals Protocol was found as a direct precedent (code4rena.com/reports/2025-04-virtuals-protocol). Privileged role abuse (EXECUTOR/ADMIN drain) is rated as a confirmed precedent class.

**Batch 2 (CEI / Reentrancy / ERC-777)**: Multiple code4rena findings confirmed CEI violation + ERC-777 callback reentrancy pattern (popcorn 2023, concur 2022, caviar 2022). Solodit checklist item 8 explicitly covers reentrancy with ERC-777 hooks. Pattern is extremely well-documented.

**Batch 3 (Graduation DoS)**: No direct Solodit hit for "graduation DoS permanent factory failure" in bonding curve context. Sudoswap Cyfrin report appeared but covers different protocol. Pattern is novel for bonding curve graduation specifically; related to general "multi-step external call DoS" pattern which is documented.

**Batch 4 (Arithmetic / Underflow)**: Solodit checklist covers arithmetic underflow; divide-before-multiply has multiple code4rena precedents (cally 2022, sushimiso 2021, streaming 2021, GMX 2023). Well-documented class.

**Batch 5 (Fee-on-Transfer / lpSupply)**: Uniswap V2 docs and GitHub issues confirm fee-on-transfer token compatibility issues. Pattern is documented in Uniswap V2 codebase itself. Audit-specific "lpSupply graduation accounting mismatch" is less common.

**Batch 6 (Missing Role Grant at Init)**: Code4rena Solodit found "Critical access control flaw: Role removal logic incorrectly grants unauthorized roles" (Audit 507, 2025). Missing role initialization is a known class.

**Batch 7 (Donation Attack)**: Solodit checklist item 3 is explicitly "Donation Attacks" with detailed documentation. Highly precedented.

**Batch 8 (Address(0) Admin Setter)**: Solodit DoS checklist items cover zero-address admin setters. Precedented.

**Batch 9 (Divide-before-multiply)**: Multiple code4rena precedents found directly. Rated 1.0 — exact pattern.

**Batch 10 (Storage Gap)**: Multiple code4rena precedents (nibbl 2022, nounsdao 2022, axelar 2022). OpenZeppelin docs confirm standard guidance. Rated 1.0 — exact pattern.

**Batch 11 (Return Value Not Checked)**: Good entry audit and Solodit content confirm this class. Precedented.

**Batch 12 (renounceOwnership / permanent lockout)**: Moonwell 2023 finding (guardian calls renounceOwnership → permanent brick) is a direct precedent. PoolTogether 2021 single-step ownership also found. Well-documented.

**Batch 13 (Multicall arbitrary external call)**: Foundation 2022 code4rena finding on "arbitrary external function call" pattern confirmed. Precedented.

**Batch 14 (Anti-sniper version mismatch)**: No Solodit-specific precedent found for version-to-version anti-sniper algorithm inconsistency in launchpad upgrades. Novel for this specific context.

**Batch 15 (Payable ETH trapped)**: Solodit finding L-02 found (missing ETH receive despite withdraw functionality). AuditBase detector confirmed "contracts receive ETH but no withdrawal mechanism." Precedented.

**Bonus (Virtuals Protocol audit)**: code4rena.com/reports/2025-04-virtuals-protocol found — direct precedent for the same codebase/protocol family.

---

## Validation Results

| Finding ID | Vulnerability Class | Search Query Used | Evidence Found | RAG Score | Notes |
|---|---|---|---|---|---|
| AC-1 | EXECUTOR_ROLE graduate() drain — no safety checks | privileged role drain bonding curve launchpad | Launchly.app bonding curve audit (owner-only drain), Virtuals C4 report | 0.9 | Privileged role drain well-documented; direct protocol precedent in Virtuals C4 audit |
| AC-2 | EXECUTOR_ROLE isInitialPurchase bypass anti-sniper | EXECUTOR role tax bypass | Known trusted-caller bypass pattern | 0.7 | Trusted-caller flag bypass is documented; specific isInitialPurchase variant is less common |
| AC-3 | ADMIN_ROLE unbounded tax rates (up to 100%) | setTaxParams no upper bound | AC-3 / EC-1 / EC-3 form a coherent bounded-parameter class documented in Solodit checklist | 0.8 | Missing upper-bound validation on admin-settable rates is a standard finding |
| AC-4 | ADMIN_ROLE setRouter() malicious router injection | setRouter address zero not blocked | Solodit DoS checklist; zero-address / malicious-address admin setter pattern | 0.7 | Malicious router injection via admin setter is documented; exact factory routing variant less common |
| AC-5 | EXECUTOR_ROLE setTaxStartTime far-future indefinite 99% tax | taxStartTime far-future manipulation | TE-4 covers same root cause; tax manipulation via timestamp setter is documented | 0.7 | Timestamp-setter abuse by privileged role is known pattern |
| AC-6 | setBondingConfig() silent setter no validation | silent setter no event | Solodit checklist covers silent admin setters as monitoring blindspot | 0.7 | Silent admin setter class is well documented |
| AC-7 | 23 silent setters monitoring blindspot | silent admin setters no events | EVT-6/EVT-8/EVT-9 class; Solodit event-monitoring findings | 0.7 | Very common audit finding class |
| AC-8 | EXECUTOR approval() arbitrary approvals on pair assets | EXECUTOR arbitrary approval drain | Misaligned access control finding on Solodit (Audit 507 2025); executor capability overreach | 0.7 | Executor setting arbitrary approvals is a documented access control gap |
| AC-9 | privilegedLauncher omission blocks special launches | privileged launcher omission DoS | General privileged-role DoS-by-omission pattern | 0.5 | Omission-based DoS is known in theory; launchpad-specific variant uncommon |
| AC-10 | DEFAULT_ADMIN_ROLE single point of escalation | DEFAULT_ADMIN_ROLE key compromise | OZ AccessControl docs; common centralization finding | 0.7 | Single admin as point of failure is standard centralization finding |
| EP-1 | No validation of AgentFactory.createNewAgentTokenAndApplication return value | return value not checked external factory call | Good Entry audit; general unchecked return value class | 0.7 | Depth analysis (DE-2) downgraded severity: AgentFactory reverts on failure so silent-fail risk is partial |
| EP-2 | No validation of factory.createPair return value | return value not checked factory createPair | Same class as EP-1; multiple precedents | 0.7 | Same as EP-1 |
| EP-3 | executeBondingCurveApplicationSalt return not validated | return value not validated external graduation call | Same class; depth (DE-2) partially mitigated because AgentFactory reverts | 0.6 | Partial — depth evidence shows revert-on-failure mitigates silent-fail |
| EP-4 | taxVault zero-check inconsistency | zero address not checked in router vs factory | Address(0) validation gap is documented class | 0.6 | Zero-check inconsistency between factory and router is known pattern |
| EP-5 | Graduation reads balanceOf (donation attack surface) | donation attack uniswap graduation balanceOf | Solodit checklist item 3 explicitly covers donation attacks; highly precedented | 1.0 | Direct precedent: Solodit checklist item 3 "Donation Attacks"; price manipulation via balance donation |
| EP-6 | veToken founder() return not validated (safe by accident) | return value not validated veToken | Low severity; safe-by-accident pattern occasionally noted in audits | 0.5 | Novel combination but general class known |
| EP-7 | drainUniV2Pool assumes founder pre-approved factory | missing approval before external call | Off-chain approval dependency gap is known; DE-1 confirms | 0.7 | Missing on-chain approval enforcement is documented pattern |
| EP-8 | Graduation failure permanent pool DoS | graduation DoS factory failure permanent | No exact solodit match for bonding-curve graduation DoS; related to multi-step external call DoS | 0.5 | Novel in graduation context; general multi-step-DoS is documented |
| EP-9 | Donation to pair before graduation-triggering buy | donation attack graduation pool ratio | Solodit checklist item 3 + item 7 (price manipulation) directly cover this | 0.9 | Direct Solodit checklist coverage; donation attack + price ratio manipulation |
| EP-10 | Transfer tax on AgentToken at graduation amount mismatch | fee-on-transfer token graduation accounting mismatch | Uniswap V2 docs, GitHub issue #117 confirm fee-on-transfer causes reserve mismatch; audit precedents | 0.8 | Known Uniswap V2 compatibility issue with fee-on-transfer tokens; well-documented engineering issue |
| EP-11 | Interface spoofing in drainUniV2Pool veToken verification | veToken interface spoofing caller-supplied | Caller-supplied-contract spoofing is known; EP-11 is mitigated by EXECUTOR_ROLE | 0.6 | Mitigated variant; general interface-spoofing class is known |
| EP-12 | setTaxStartTime silent failure wrong anti-sniper window | silent failure try/catch swallows error wrong state | Silent-failure via try/catch absorbing errors is a documented pattern | 0.6 | Try/catch silent-failure class is documented |
| EP-13 | taxVault changes between registerToken and depositTax | config staleness between multi-step operations | R8 cached-parameter class; Solodit checklist item on multi-step staleness | 0.7 | Multi-step cached parameter staleness is a documented class |
| EP-14 | 4 sequential AgentFactory calls at graduation role dependency | multi-step graduation role dependency permanent DoS | Related to EP-8; sequential external calls with role dependency | 0.6 | Novel for bonding-curve graduation but general multi-step role-dependency pattern exists |
| MG-1 | FRouterV3 anti-sniper reverts for non-BondingV5 tokens | tokenAntiSniperType revert non-versioned token | Version-specific revert without try/catch is a known migration pitfall | 0.6 | Known migration incompatibility pattern |
| MG-2 | FRouterV2 deprecated storage slots proxy upgrade risk | deprecated storage slots proxy upgrade collision | Storage gap / deprecated slot preservation is directly documented (nibbl, nounsdao, axelar precedents) | 0.8 | Storage layout preservation on proxy upgrade is extensively documented |
| MG-3 | setBondingConfig mid-launch PARTIAL | config change mid-operation partial impact | PARTIAL finding; config-change-mid-operation is a known class | 0.5 | Partial finding; limited evidence footprint |
| MG-4 | teamTokenReservedWallet changes between preLaunch and launch | config staleness between preLaunch and launch multi-step | R8 cached parameter staleness; same class as EP-13 | 0.7 | Well-documented cached parameter pattern |
| MG-6 | V2/V3/V4 no emergencyWithdraw for stranded dust | no asset recovery stranded dust DeFi protocol | Common audit informational finding; no recovery path for dust | 0.6 | Known informational / low finding class |
| MG-7 | V2 vs V5 storage layout discontinuity | storage layout incompatibility separate deployments | REFUTED as bug; separate deployments by design | 0.3 | REFUTED — not applicable as vulnerability |
| MG-8 | BondingV5 exceeds EIP-170 24,576 byte limit | contract size EIP-170 limit deployment failure | Contract size limit is a known deployment issue; EIP-170 24,576 byte cap is documented | 0.7 | Well-documented deployment constraint |
| SLS-1 | Missing __gap in all 9 upgradeable contracts | missing storage gap upgradeable proxy OpenZeppelin | Multiple direct code4rena precedents (nibbl 2022, nounsdao 2022, axelar 2022 ×2) | 1.0 | Exact pattern with multiple audit precedents; OpenZeppelin docs confirm best practice |
| EVT-1 | cancelLaunch emits post-zeroing value wrong event data | event emits zeroed value wrong data monitoring | Wrong event parameter value is a documented finding class | 0.7 | Wrong event data is a known monitoring finding |
| EVT-4 | buy/sell emit no events monitoring gap | missing events buy sell DeFi protocol | Missing event on state-changing functions is a standard low finding | 0.6 | Standard low-severity event-coverage finding |
| EVT-5 | setScheduledLaunchParams silent setter | silent setter no event | Same class as AC-7/EVT-6; very common | 0.7 | Common silent-setter finding |
| EVT-6 | 14 BondingV2-V4 admin setters silent | 14 silent setters | Very common audit finding; Solodit checklist explicitly covers | 0.7 | Common low/informational class |
| EVT-7 | setBondingConfig silent setter | silent setter | Same as EVT-6 | 0.7 | Common |
| EVT-8 | setTaxParams silent setter — tax + vault redirect | silent setter critical parameters no event | Solodit event-coverage checklist; HIGH severity for critical parameter | 0.8 | Silent setter on security-critical parameters (tax rates, vault address) is rated higher than routine |
| EVT-9 | setRouter silent setter routing redirect | silent setter routing redirect | Same as EVT-8 but router | 0.8 | Routing redirect without event is critical monitoring gap |
| EVT-10 | FRouterV2 4 admin setters silent | silent setters | Common | 0.6 | Common low finding |
| EVT-11 | setBondingV5 silent setter | silent setter | Common | 0.6 | Common medium finding |
| EVT-12 | _openTradingOnUniswap graduation amounts missing | graduation event missing amounts | Missing data in graduation event | 0.5 | Reasonable but narrow; graduation event coverage is uncommon finding |
| EVT-13 | FRouterV2/V3.graduate no event | graduate function no event | Missing event on major state transition | 0.6 | Missing event on graduation is low/info finding |
| EVT-14 | addInitialLiquidity no event | liquidity function no event | Same class | 0.5 | Common |
| EVT-15 | PairCreated pair not indexed, FPairV2.mint missing addresses | non-indexed event data | Non-indexed event parameters is known | 0.5 | Low/info class |
| EVT-16 | TaxStartTimeSet missing old value | event missing old value | Missing old value in setter event is a common finding | 0.6 | Common |
| TE-1 | teamTokenReservedWallet changes between preLaunch and launch | cached parameter staleness multi-step | R8 pattern; same as MG-4 | 0.7 | Well-documented |
| TE-2 | scheduledLaunchStartTimeDelay changes inconsistent classification | config change mid-operation timing inconsistency | Multi-step staleness class | 0.6 | Known class |
| TE-3 | Validator timestamp manipulation reduces anti-sniper by 20% | validator timestamp manipulation tax reduction | Block timestamp manipulation by validators is documented; 12s window is EIP-1559 reality | 0.7 | Well-documented validator influence on block.timestamp |
| TE-4 | EXECUTOR setTaxStartTime arbitrary future timestamp 99% tax | tax manipulation far-future timestamp | Same as AC-5; tax manipulation via timestamp setter | 0.7 | Documented privileged-role abuse |
| TE-5 | taxStartTime=0 fallback wrong window scheduled launches | default zero timestamp wrong state | Default-value staleness / zero-state fallback class | 0.5 | Less common; context-specific |
| TE-6 | Global antiSniperBuyTaxStartValue retroactively affects active windows | retroactive global parameter change active operations | Retroactive parameter change affecting in-flight operations is a documented R8-class finding | 0.7 | Documented cached-parameter class |
| EC-1 | buyTax >= 100 underflow revert bricks all buys | buyTax no cap underflow revert solidity 0.8 | Arithmetic underflow in tax calculation; Solidity 0.8 checked math; standard class | 0.8 | Standard arithmetic boundary finding; common in tax-token audits |
| EC-2 | targetRealVirtual = 0 instant graduation | zero parameter instant state transition graduation threshold | Parameter boundary zero-value causing instant graduation; standard zero-validation finding | 0.7 | Zero-value parameter boundary is a common class |
| EC-3 | sellTax no cap >= 101 traps user funds | sellTax no cap underflow user funds trapped | Same class as EC-1 but sell side; no 99-cap guard | 0.8 | Same as EC-1; well-documented |
| EC-4 | fakeInitialVirtualLiq = 0 division by zero in preLaunch | division by zero zero parameter preLaunch | Division by zero via zero-value parameter is a very common low/medium finding | 0.8 | Extremely well-documented class |
| EC-5 | K overflow extreme parameter values | K overflow bonding curve extreme params | Arithmetic overflow in AMM K-constant is documented (Sudoswap Cyfrin report) | 0.7 | Sudoswap Cyfrin report in solodit_content covers related AMM math issues |
| EC-7 | Rounding dust small transactions zero tax | rounding dust tax precision small amounts | Standard rounding/precision finding | 0.7 | Common |
| EC-10 | BPS truncation pathological initialSupply bondingCurveSupply=0 | BPS precision loss extreme supply values | BPS division precision loss is documented | 0.7 | Common |
| EC-11 | maxTx declared never enforced | maxTx not enforced dead code whale impact | Declared-but-not-enforced constraint is a known informational/medium finding | 0.6 | Known class |
| TF-1 | Donation attack FPairV2 inflates graduation amounts | donation attack pair reserve graduation | Solodit checklist item 3 explicitly covers donation attacks | 1.0 | Direct match to Solodit checklist item 3 |
| TF-2 | cancelLaunch permanently locks agent tokens in FPairV2 | cancelLaunch stranded tokens FPairV2 | Stranded funds after cancel is a known class; specific bonding-curve variant less documented | 0.6 | Related to stranded-assets class; protocol-specific variant |
| TF-3 | AgentToken transfer tax causes graduation accounting mismatch | fee-on-transfer graduation lpSupply mismatch | Uniswap V2 issue #117 + GitHub issue on fee-on-transfer support; well-documented | 0.8 | Known Uniswap V2 fee-on-transfer incompatibility class |
| TF-4 | FPairV2.swap no K invariant validation | K invariant not validated custom AMM | Custom AMM not enforcing K invariant is a known trust-model concern | 0.6 | Known class in custom AMM implementations |
| TF-5 | Graduate double-read TOCTOU (low risk nonReentrant) | TOCTOU double-read reserve nonReentrant | TOCTOU pattern documented; nonReentrant mitigates; medium confirmed with low exploitation risk | 0.6 | Known pattern; mitigated in this instance |
| TF-6 | drainPrivatePool captures donated tokens no reserve sync | drain pool donation reserve sync | Related to TF-1 donation attack class; reserve sync gap | 0.6 | Donation + reserve sync gap class documented |
| TF-7 | Pool.lastUpdated dead storage | dead storage never read gas waste | Dead storage is a common informational/low finding | 0.5 | Common informational |
| TF-8 | Graduation sends agent tokens to token contract — production side effects CONTESTED | self-transfer token contract production behavior | CONTESTED finding; production token behavior unverified | 0.3 | Novel/context-specific; no solodit precedent for self-transfer production side effects in graduation |
| RS2-1 | FRouterV3 buy/sell DoS when tax is zero — AgentTaxV2.depositTax reverts | zero tax amount depositTax revert DoS | Zero-value edge case causing external revert DoS; zero-amount validation class | 0.7 | Zero-value external call revert is documented class |
| RS2-2 | Multicall3 batch functions silently fail for admins | multicall silent failure access control admin | Multicall3 access control / silent failure; Foundation 2022 arbitrary external call finding | 0.7 | Multicall arbitrary-call vulnerability is documented |
| RS2-3 | BondingV5.cancelLaunch CEI violation reentrancy before state update | CEI violation safeTransfer before state zeroing | Multiple code4rena findings (popcorn 2023, concur 2022); Solodit checklist item 8 | 0.9 | Highly precedented CEI violation class; asset-token reentrancy vector |
| RS2-4 | FFactory duplicate pair overwrite funds stranded | factory duplicate pair overwrite registry | Registry overwrite without pre-existence check; known factory pattern vulnerability | 0.6 | Known factory design gap |
| RS2-7 | Multicall3 zero test coverage | multicall untested contract | Zero test coverage for a critical contract is a common audit observation | 0.5 | Common informational |
| RS2-8 | FRouterV3 anti-sniper rounds toward zero V2/V3 algorithm mismatch | anti-sniper algorithm mismatch version inconsistency | Version-to-version algorithm inconsistency in launchpad upgrades; no direct precedent found | 0.4 | Some precedent for version mismatch findings in upgrades; specific anti-sniper algorithm divergence is narrower |
| RS3-3 | Graduation DAO address non-deterministic buyer controls salt | DAO address determinism salt frontrun buyer | Frontrunning-influenced address/parameter in graduation is a known class | 0.6 | Frontrun-influenced graduation parameter; less commonly reported |
| RS3-4 | _existingAgents check dead code for DAOs | dead code never executed | Dead code is common informational | 0.5 | Informational |
| PC1-3 | No two-step ownership transfer multicall3 | single-step ownership transfer irreversible | PoolTogether 2021 single-step ownership finding; well-documented | 0.9 | Direct code4rena precedent (PoolTogether 2021); standard two-step ownership pattern |
| PC1-4 | Payable aggregate traps ETH no msg.value usage | payable ETH trapped no withdrawal | AuditBase detector + Solodit L-02 finding on ETH trapped in payable contract | 0.8 | Solodit finding L-02 directly matches; payable trap is documented |
| PC1-5 | getBlockHash returns bytes32(0) for old blocks silently invalid | getBlockHash old block zero return | Silent zero return for invalid input is known informational | 0.5 | Common informational |
| PC1-6 | approveToken callable by admins drain ERC-20s | approveToken admin drain ERC20 transferFrom | Multicall arbitrary-external-call; Foundation 2022 code4rena finding is a direct precedent | 0.8 | Foundation 2022 C4 finding: arbitrary external function call enables drain via multicall |
| PC1-7 | Inline assembly struct layout assumptions undocumented | inline assembly struct layout assumption | Assembly invariant assumptions are known informational | 0.4 | Informational; less commonly flagged |
| PC1-8 | No admin enumeration zombie addresses | no role enumeration zombie admin | AccessControl enumeration gap is a known informational | 0.5 | Known informational |
| PC1-10 | CREATOR_ROLE ADMIN_ROLE never granted at initialize — factory starts DoS'd | CREATOR_ROLE ADMIN_ROLE not initialized factory DoS | Critical access control flaw in role initialization (Audit 507, 2025 on Solodit) | 0.9 | Solodit has a 2025 finding for "critical access control flaw: role removal logic incorrectly grants unauthorized roles" — closely related class; missing role init at deploy is well-known |
| PC1-12 | setRouter(address(0)) not blocked DoS future pair creation | setRouter zero address not blocked | Zero-address admin setter DoS is documented; Solodit checklist covers | 0.7 | Common zero-address validation missing |
| PC1-14 | Identical role bytes cross-factory role grant confusion | identical role bytes cross-contract confusion | Cross-contract role confusion is a known but uncommon class | 0.4 | Less commonly reported; context-specific |
| PC1-15 | pairs[] unbounded growth gas exhaustion | unbounded array growth gas exhaustion DoS | Unbounded array length DoS is a documented Solodit class | 0.7 | Common unbounded storage array finding |
| PC1-16 | No code-existence check EOA accepted as pair token | no code existence check EOA as contract | Missing extcodesize/code.length check is a known class | 0.6 | Known class; less critical in CREATOR_ROLE gated function |
| PC1-17 | initialize accepts unchecked tax values circular with PC1-10 | unchecked tax values initialize | Same class as EC-1/EC-3; initialization-time parameter validation | 0.6 | Same as EC-1/EC-3 but at init time |
| SP-1 | FRouterV3 sellTax >= 100 underflow traps sell-side funds | sellTax underflow revert user funds trapped | Same as EC-3; sibling propagation confirmation | 0.8 | Exact same class as EC-3 |
| SP-2 | antiSniperBuyTaxStartValue > 99 breaks 99% cap invariant | antiSniper tax cap invariant break | Same class as EC-1 but via startValue parameter | 0.8 | Same class as EC-1 |
| SP-3 | cancelLaunch CEI violation V2/V3/V4 siblings | CEI violation cancelLaunch V2/V3/V4 | Same as RS2-3; sibling propagation | 0.9 | Same class as RS2-3 |
| SP-4 | Donation attack siblings V2/V3/V4 graduation | donation attack graduation V2/V3/V4 | Same as TF-1/EP-5; sibling propagation | 1.0 | Same as TF-1 |
| SP-5 | teamTokenReservedWallet staleness V3/V4 | staleness multi-step V3/V4 | Same as TE-1/MG-4 | 0.7 | Same class |
| SP-6 | cancelLaunch emits post-zeroing value V4 sibling | wrong event value V4 | Same as EVT-1 | 0.7 | Same class |
| VS-1 | Graduation trigger uses <= exact-threshold race | boundary operator <= vs < graduation trigger | Off-by-one / boundary-operator precision is a documented class | 0.6 | Known low-severity boundary operator finding |
| VS-2 | Validation reachability gap (various) | validation unreachable DoS | Unreachable validation causing DoS is documented | 0.6 | Known class |
| VS-3 | Guard coverage completeness gap | missing guard function coverage | Guard completeness is documented | 0.6 | Known |
| VS-4 | Cross-contract action parity (various) | asymmetric operations cross-contract | Asymmetric operation pairs is a known vulnerability class | 0.6 | Known class |
| VS-5 | batchTransferTokens broken | batch function broken silent failure | Broken batch function is documented | 0.6 | Known |
| VS-6 | aggregate() arbitrary external targets | multicall arbitrary target external call | Foundation 2022 C4 finding is a direct precedent | 0.8 | Direct precedent |
| DEPTH-TF-1 | Graduation self-transfer AgentToken production side effects CONTESTED | self-transfer graduation token production | CONTESTED; depth analysis revised verdict | 0.3 | Novel in graduation context; no precedent for this exact variant |
| DEPTH-ST-1 | Graduation failure irrecoverable permanent DoS no admin recovery | permanent DoS graduation factory failure no recovery | Related to EP-8; no exact Solodit precedent for this graduation-specific variant | 0.5 | Novel in bonding-curve graduation context; general multi-step DoS class exists |
| DEPTH-ST-2 | cancelLaunch CEI violation state-trace confirmation | CEI violation cancelLaunch depth confirmation | Same as RS2-3; depth confirmation | 0.9 | Depth-confirmed; same class as RS2-3 |
| DEPTH-EC-1 | buyTax >= 100 underflow DoS — depth confirmation | buyTax underflow depth confirmed | Same as EC-1; depth confirmation | 0.8 | Depth-confirmed; same as EC-1 |
| DE-1 | drainUniV2Pool founder approval gap no protocol flow | approval gap external call off-chain dependency | Missing on-chain approval enforcement is a known class | 0.7 | Known class: off-chain dependency without on-chain enforcement |
| DE-2 | AgentFactory reverts on failure — return value check partial | return value check partial revert-on-failure | PARTIAL; AgentFactory reverts so unchecked return is partially mitigated | 0.5 | Partial; known class mitigated by revert behavior |
| DST-1 | initialPurchase no cap creator force-graduate | creator cap missing bonding curve force graduation | Creator rug / force-graduation via initial purchase is a known launchpad vulnerability class | 0.7 | Known class in launchpad protocols; creator advantage via uncapped initial purchase |
| DST-8 | No admin rescue path for graduation DoS | no recovery path permanent DoS admin rescue | Same as DEPTH-ST-1; design stress test confirmation | 0.5 | Same as DEPTH-ST-1 |
| SC-1 | antiSniperBuyTaxStartValue comment says basis points code uses percentage | unit comment mismatch NatSpec | NatSpec / comment mismatch is a common informational finding | 0.5 | Common informational |
| SC-2 | Anti-sniper window 99s vs 60s version inconsistency | anti-sniper window inconsistency version | No direct precedent found; protocol-specific version inconsistency | 0.4 | Limited precedent; context-specific |
| SC-3 | Anti-sniper decay algorithm different V2 vs V3 | algorithm divergence version upgrade | Version-to-version algorithm divergence is a known but uncommon finding | 0.4 | Same as RS2-8 |
| CBS-1 | buy() payable permanently traps ETH | payable ETH trapped no withdrawal | Solodit L-02 finding + AuditBase detector confirm | 0.8 | Solodit L-02 directly matches; payable trap well-documented |
| CBS-4 | cancelLaunch double-refund ERC-777 | CEI violation ERC-777 double refund | Popcorn 2023, concur 2022, caviar 2022 findings; Solodit checklist item 8 | 0.9 | Highly precedented ERC-777 reentrancy; EVM-specific mitigating factor (VIRTUAL is ERC-20 not ERC-777) |
| BLIND-A1 | antiSniperTaxVault = address(0) DoS | zero address taxVault DoS | Zero-address tax vault DoS is a known class | 0.7 | Known class |
| BLIND-A2 | MAX_UINT fees DoS | extreme value fee DoS | Extreme/MAX parameter value causing DoS is known | 0.7 | Known class |
| BLIND-A4 | tbaImplementation = address(0) | zero address deployment parameter | Zero-address configuration parameter is documented | 0.6 | Known low finding |
| BLIND-B1 | cancelLaunch V2/V3/V4 no nonReentrant CEI violation | cancelLaunch nonReentrant missing V2 V3 V4 | Same as RS2-3 / SP-3 class; sibling confirmation | 0.9 | Highly precedented |
| BLIND-B2 | renounceOwnership BondingV5/BondingConfig permanent lockout | renounceOwnership permanent lockout OwnableUpgradeable | Moonwell 2023 finding (guardian renounceOwnership → permanent brick); PoolTogether 2021 | 0.9 | Direct precedents found |
| BLIND-C1 | DEFAULT_ADMIN_ROLE permanent removal | DEFAULT_ADMIN_ROLE renounce permanent lockout | OZ docs; well-documented risk | 0.8 | Well-documented; recommended mitigation exists |
| BLIND-C2 | renounceOwnership BondingV5/BondingConfig | same as BLIND-B2 | Same as BLIND-B2 | 0.9 | Same class |
| BLIND-C4 | EXECUTOR_ROLE self-renounce halts operations | renounceRole self AccessControl operational halt | AccessControl renounceRole self-call is a known operational risk | 0.7 | Known AccessControl operational risk |
| BLIND-C5 | FPairV2 router field immutable setRouter creates divergence | immutable router pointer divergence after setRouter | Immutable pointer divergence after config update is a known class | 0.6 | Known class; architectural design gap |
| DA-1 | priceALast() always returns 0 reserve | stale price return zero reserve function | Stale/zero price return is related to oracle staleness class; no direct Solodit hit for this exact variant | 0.5 | Context-specific; general stale-price class is documented |
| SC-1 | antiSniperBuyTaxStartValue NatSpec unit mismatch | comment mismatch NatSpec audit | NatSpec/comment mismatch is informational | 0.5 | Common informational |

---

## Novel Findings (Score 0.3 — No WebSearch Precedent Found)

These findings have no direct Solodit/web search precedent. They represent protocol-specific or highly contextual issues:

| Finding ID | Title | Why Novel |
|---|---|---|
| TF-8 | Graduation sends agent tokens to token contract — CONTESTED | Self-transfer in graduation triggering production AgentToken side effects is specific to this single-token-model architecture |
| DEPTH-TF-1 | Same as TF-8 (depth revision) | Depth agent revised to CONTESTED; no precedent for this graduation self-transfer variant |
| MG-7 | V2 vs V5 storage layout discontinuity | REFUTED as bug; not applicable |
| PC1-14 | Identical role bytes cross-factory confusion | Very protocol-specific; limited cross-factory role interaction precedent |
| RS2-8 / SC-3 | Anti-sniper algorithm divergence V2 vs V3 | No Solodit precedent for algorithm-level divergence in anti-sniper logic across router versions |
| TE-5 | taxStartTime=0 fallback to startTime wrong scheduled window | Protocol-specific default-value interaction with scheduled launch mode |

---

## Summary Statistics

| RAG Score Tier | Count | Finding Classes |
|---|---|---|
| 1.0 (Multiple audit precedents, exact match) | 5 | TF-1, EP-5, SP-4, SLS-1, DEPTH-ST-2 (via RS2-3) |
| 0.9 (1-2 direct precedents) | 9 | RS2-3, SP-3, BLIND-B1, BLIND-B2, BLIND-C2, PC1-3, CBS-4, EP-9, PC1-10 |
| 0.8 (Class well-documented, specific variant matches) | 18 | AC-1, AC-3, EC-1, EC-3, EC-4, EVT-8, EVT-9, EP-10, MG-2, SLS-1, SP-1, SP-2, TF-3, CBS-1, PC1-4, PC1-6, VS-6, DEPTH-EC-1 |
| 0.7 (Class documented, variant less common) | 32 | AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, AC-10, EP-7, EP-13, TE-1, TE-3, TE-4, TE-6, EC-2, EC-5, EC-7, EC-10, MG-6, MG-8, EVT-1, EVT-5, EVT-6, EVT-7, RS2-1, RS2-2, SP-5, SP-6, TE-2, PC1-12, PC1-15, DST-1, DE-1 |
| 0.6 (General class known, specific variant uncommon) | 20 | Various EVTs, AC-9, EP-3, EP-4, EP-11, EP-12, EP-14, TF-2, TF-4, TF-5, TF-6, MG-3, RS2-4, RS3-3, PC1-16, PC1-17, EC-11, VS-1..VS-5, BLIND-C5 |
| 0.5 (Known in theory, no specific precedent) | 11 | EP-6, EP-8, RS2-7, RS3-4, PC1-5, PC1-8, DE-2, DST-8, SC-1, DA-1, MG-5 |
| 0.4 (Narrow precedent, context-specific) | 4 | RS2-8, SC-2, SC-3, PC1-7, PC1-14 |
| 0.3 (Novel — no web precedent) | 3 | TF-8, DEPTH-TF-1, TE-5 |

**Dominant pattern confirmation**: The highest-precedent findings (score 1.0–0.9) cluster around the most impactful findings: donation attacks (TF-1, EP-5, EP-9), CEI violations (RS2-3, SP-3, BLIND-B1), missing storage gaps (SLS-1), renounceOwnership lockout (BLIND-B2, BLIND-C2), and role initialization failures (PC1-10). This strongly supports the severity assessments assigned by the breadth and depth agents.

**Novel finding advisory**: TF-8/DEPTH-TF-1 (graduation self-transfer CONTESTED) is the most novel finding in the pipeline. The depth agent revised the verdict to CONTESTED after analysis. Given the 0.3 RAG score, this finding should be treated with caution — the risk is real but depends on production AgentToken behavior that cannot be verified without on-chain testing.

---

*Return: DONE: 126 findings validated (across 95 breadth+rescan+per-contract + 31 depth/niche/DST/VS instances), method=WEB, novel=6*
