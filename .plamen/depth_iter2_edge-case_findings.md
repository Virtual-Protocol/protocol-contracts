# Depth Iteration 2: Edge Case Domain — Devil's Advocate Analysis

**Agent**: DA Depth Agent — Edge Case & Temporal Domain
**Iteration**: 2 (Devil's Advocate)
**Date**: 2026-04-03

---

## DA Analysis: EC-11

**Prior Path Explored**: Iter1 found maxTx variable set in BondingConfig but not used in buy/sell validation; concluded intentionally removed in V5.

**New Path Explored**: Searched all versions (V2, V3, V4, V5) for maxTx enforcement in buy/sell code paths. Confirmed whether maxTx was EVER enforced on-chain, and evaluated the whale-graduation economic consequence.

**New Evidence**:
- [TRACE: BondingV2.buy() → _buy() → no maxTx check at any step → amountIn unbounded]
- [TRACE: BondingV3.buy() → identical structure, no maxTx check]
- [TRACE: BondingV4.buy() → identical structure, no maxTx check]
- [VARIATION: maxTx stored in BondingV2/V3/V4 state + setter exists → but grep for `require.*maxTx` across ALL launchpadv2 contracts returns zero matches → maxTx was NEVER enforced on-chain in any version]
- [BOUNDARY: gradThreshold in BondingV5 = fakeInitialVirtualLiq * bondingCurveSupply / (targetRealVirtual + fakeInitialVirtualLiq); with typical values (6300e18 * 450e24) / (42000e18 + 6300e18) ≈ 58.7e24 tokens; a single buyer purchasing enough VIRTUAL to drain reserve0 below 58.7e24 in one tx is feasible at sufficient capital]

**Verdict Update**: REFUTED (original hypothesis). EC-11 escalates to INFORMATIONAL at best — maxTx was never enforced in any Bonding version. The variable was declared and settable but was always dead code. There is no regression from V4 to V5; V5 simply omits the dead variable. The whale-graduation risk is real but is a design property (no per-tx limit by design), not a V5 regression.

**New Finding**: None. The absence of maxTx enforcement is consistent across all versions and is therefore a design choice, not a V5-specific regression.

**Confidence Change**: DECREASE — finding is refuted; confidence drops from 0.67 to effectively 0.0.

---

## DA Analysis: TE-2

**Prior Path Explored**: Iter1 found teamTokenReservedWallet is read at launch() not preLaunch(). If admin changes it between preLaunch and launch(), wrong wallet gets team tokens.

**New Path Explored**: Traced the full preLaunch → launch() flow to determine realistic attack window; evaluated MEV front-run feasibility; quantified economic value of redirecting team tokens.

**New Evidence**:
- [TRACE: _preLaunch() L382-386 → `IERC20(token).safeTransfer(bondingConfig.teamTokenReservedWallet(), totalReservedSupply * decimals)` — team reserved tokens (airdrop + ACF) are transferred in _preLaunch(), NOT in launch()]
- [TRACE: launch() L554 → `IERC20(tokenAddress_).safeTransfer(bondingConfig.teamTokenReservedWallet(), amountOut)` — only the initialPurchase output (creator's buy tokens) goes to teamTokenReservedWallet in launch()]
- [VARIATION: preLaunch teamTokenReservedWallet read at L383 → launch teamTokenReservedWallet read at L554 → if setTeamTokenReservedWallet() is called between preLaunch and launch(), ONLY the initialPurchase amountOut is misdirected; the larger reserved supply (airdrop + ACF tokens) already transferred in preLaunch]
- [BOUNDARY: with airdropBips=0, needAcf=false → totalReservedSupply=0 → nothing sent to teamTokenReservedWallet in preLaunch; only amountOut from creator's initialPurchase is at risk in launch]
- [BOUNDARY: with airdropBips=500 (5%), needAcf=true, acfReservedBips=5000 (50%) → totalReservedSupply = 5500 bips of 1B = 550M tokens → transferred in preLaunch → this large transfer is safe from the TE-2 attack path]
- [TRACE: launch() is public (no privileged check for NORMAL launch mode) → creator can call it; for X_LAUNCH/ACP_SKILL/Project60days, must be a privileged launcher → for normal tokens, launch() is permissionless so creator calls it, typically right after startTime is reached]

**Verdict Update**: PARTIAL → remains PARTIAL but with reduced attack surface. The prior analysis overstated the amount at risk. The large reserved supply (airdrop+ACF tokens) is transferred in preLaunch at the time teamTokenReservedWallet is read, NOT in launch. Only the initialPurchase amountOut (creator's buy output) is redirectable by a change between preLaunch and launch. The economic value depends on initialPurchase size; typical creator initial buys are modest (a few thousand VIRTUAL worth of tokens). For NORMAL mode, owner/MEV cannot block the creator from calling launch() immediately after startTime, so the window is narrow. For privileged modes, the backend calls launch() itself so the window is backend-controlled.

**Confidence Change**: DECREASE — attack surface is significantly smaller than iter1 suggested. Finding remains PARTIAL but the severity should be re-evaluated downward. The high-value reserved supply is NOT redirectable; only the creator's initial buy output is at risk.

---

## Finding [DA-TE-2-UPDATE]: TE-2 Revised — Only Creator's Initial Buy Tokens Redirectable

**Verdict**: PARTIAL
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✓] [R5:✗(single entity)] [R6:✓] [R8:✓] [R10:✓] [R14:✗(no aggregate)] [R13:✗(not design-related)]
**Depth Evidence**:
- [TRACE: _preLaunch() L382-386 → large reserved supply sent to teamTokenReservedWallet at preLaunch time → immutable regardless of subsequent config change]
- [TRACE: launch() L554 → only initialPurchase amountOut (creator's initial buy output) sent to teamTokenReservedWallet at launch time → this is the redirectable amount]
- [VARIATION: airdropBips=0,needAcf=false → totalReservedSupply=0 in preLaunch; only launch() output at risk]
- [BOUNDARY: initialPurchase cap = purchaseAmount_ - launchFee from creator at preLaunch; typical values: a few thousand VIRTUAL; amountOut tokens ≈ some percentage of that; economic value is modest]

**Severity**: Low (downgraded from Medium — only creator's initial buy tokens redirectable, not the large reserved supply)
**Location**: BondingV5.sol:L554, BondingConfig.sol:L250-253 (setTeamTokenReservedWallet)

**Description**:
`launch()` reads `bondingConfig.teamTokenReservedWallet()` at call time (L554) to determine where to send the creator's initial purchase output tokens. `setTeamTokenReservedWallet()` in BondingConfig is callable by the owner at any time with no time lock. If the owner changes this wallet between a token's `preLaunch()` and its `launch()` call, the creator's initial buy output (amountOut tokens from the creator's initialPurchase) is sent to the new wallet rather than the intended one.

Critically, the larger airdrop and ACF reserved supply is transferred in `_preLaunch()` (L382-386), not `launch()`, so it is sent to whatever `teamTokenReservedWallet` was at preLaunch time and is **not** redirectable via this window.

```solidity
// _preLaunch() L382-386 — sent at preLaunch time (safe from redirect)
if (totalReservedSupply > 0) {
    IERC20(token).safeTransfer(
        bondingConfig.teamTokenReservedWallet(), // read NOW (preLaunch time)
        totalReservedSupply * (10 ** IAgentTokenV2(token).decimals())
    );
}

// launch() L554 — sent at launch time (redirectable window)
IERC20(tokenAddress_).safeTransfer(
    bondingConfig.teamTokenReservedWallet(), // read LATER (launch time)
    amountOut
);
```

**Impact**:
- Owner changes `teamTokenReservedWallet` between `preLaunch` and `launch` → creator's initial buy output goes to wrong wallet
- Amount at risk: `amountOut` tokens from creator's `initialPurchase` in VIRTUAL — typically modest (proportional to the creator's VIRTUAL deposit minus fees, converted via bonding curve)
- For NORMAL launch mode, creator calls `launch()` themselves typically very soon after `startTime` is reached, keeping the window short
- No impact on the large airdrop/ACF reserved supply which is already secured at preLaunch time

### Precondition Analysis
**Missing Precondition**: Owner must change teamTokenReservedWallet between preLaunch and launch for a specific token
**Precondition Type**: ACCESS + TIMING
**Why This Blocks**: Requires owner action in a narrow window; for normal launches, creator controls when to call launch()

### Postcondition Analysis
**Postconditions Created**: Creator's initial buy tokens sent to wrong wallet
**Postcondition Types**: BALANCE
**Who Benefits**: Whoever controls the new teamTokenReservedWallet

---

## DA Analysis: TE-5

**Prior Path Explored**: Iter1 found taxStartTime defaults to 0 in FPairV2 constructor; did not determine the exact comparison direction to know if taxStartTime=0 means anti-sniper is permanently active or permanently inactive.

**New Path Explored**: Traced the exact comparison in both FRouterV2 and FRouterV3 with taxStartTime=0; determined the behavioral consequence.

**New Evidence**:
- [TRACE: FRouterV2._calculateAntiSniperTax() L306-317 → `finalTaxStartTime = pair.startTime()` first; then `try pair.taxStartTime() returns (_taxStartTime)` → if _taxStartTime > 0, `finalTaxStartTime = _taxStartTime`; if taxStartTime=0, condition `_taxStartTime > 0` is FALSE → falls back to `finalTaxStartTime = pair.startTime()`]
- [TRACE: FRouterV3._getTaxStartTime() L326-338 → identical logic: reads pair.startTime() as default, then `if (_taxStartTime > 0) { finalTaxStartTime = _taxStartTime }` → taxStartTime=0 means fallback to startTime]
- [VARIATION: With taxStartTime=0 before launch() is called → both routers use pair.startTime() as the tax reference → this is the pair creation time (actualStartTime from preLaunch)]
- [TRACE: BondingV5.launch() L531 → `router.setTaxStartTime(tokenRef.pair, block.timestamp)` → sets taxStartTime=block.timestamp (which is ≥ pair.startTime()) → AFTER this call, taxStartTime > 0 and is used correctly]
- [BOUNDARY: Scheduled launch: pair.startTime() = actualStartTime (future time); taxStartTime=0 → routers use pair.startTime() → if anyone buys between pair creation and launch() call, tax is measured from pair.startTime(), which is correct; BUT launch() blocks buying before startTime via FPairV2.swap() requiring block.timestamp >= startTime]
- [BOUNDARY: Immediate launch: pair.startTime() = block.timestamp at preLaunch; taxStartTime=0 → tax measured from preLaunch time; launch() may be called later → window between preLaunch and launch() where taxStartTime=0 and time elapses → anti-sniper clock starts from preLaunch, not launch, meaning some anti-sniper time is "consumed" before trading is officially open]
- [TRACE: For an immediate launch where creator takes 10 minutes between preLaunch and launch(): pair.startTime = T0, launch() called at T0+10min, taxStartTime set to T0+10min. Before launch() call, no buys possible (launchExecuted=false). After launch(), taxStartTime is set correctly. No window is exploitable because buys are gated by launchExecuted flag.]

**Verdict Update**: REFUTED. The taxStartTime=0 default is correctly handled by both routers: they fall back to pair.startTime() which is the correct reference. The `_taxStartTime > 0` guard is specifically designed for this case. Once launch() is called, taxStartTime is set to block.timestamp (the actual launch time). The anti-sniper window cannot be exploited during the pre-launch gap because buys are blocked by `launchExecuted` check in BondingV5.buy(). The design is sound: taxStartTime=0 → "not yet set, use startTime" → after launch() → "use actual launch timestamp."

**Confidence Change**: DECREASE — finding is refuted. Confidence drops from 0.63 to effectively 0.0.

---

## DA Analysis: EP-4

**Prior Path Explored**: Iter1 found validation inconsistency in pair address handling. Did not trace reachability under normal operation.

**New Path Explored**: Traced the full pair validation chain in FRouterV2.buy() and FRouterV3.buy() to determine whether an attacker can pass an arbitrary pair address.

**New Evidence**:
- [TRACE: FRouterV2.buy(amountIn, tokenAddress, to, isInitialPurchase) L174-228 → `address pair = factory.getPair(tokenAddress, assetToken)` L179 → pair address is DERIVED from factory, not taken as user input → no user-controlled pair address parameter]
- [TRACE: FRouterV3.buy(amountIn, tokenAddress, to, isInitialPurchase) L174-228 → identical: `address pair = factory.getPair(tokenAddress, assetToken)` L184 → same derivation]
- [TRACE: BondingV5.buy() → calls router.buy(amountIn_, tokenAddress_, buyer_, false) → router derives pair internally from factory.getPair → attacker has no way to inject an arbitrary pair]
- [TRACE: BondingV5._buy() L632-635 → also calls `factory.getPair(tokenAddress_, router.assetToken())` separately for reserve reads → consistent with router's derivation]
- [VARIATION: Could attacker use a malicious tokenAddress that maps to a pair they control? → factory.getPair() returns address(0) for unregistered pairs → IFPairV2(address(0)).getReserves() would revert → attack fails at first external call]
- [BOUNDARY: factory.createPair() is onlyRole(EXECUTOR_ROLE) in FFactoryV2/V3 → only BondingV5 can register pairs → user cannot register arbitrary pairs]

**Verdict Update**: REFUTED. There is no user-controllable pair address parameter in the buy/sell flow. The pair is always derived from `factory.getPair(tokenAddress, assetToken)` where factory is a trusted contract. An attacker cannot inject an arbitrary pair. The validation inconsistency noted by iter1 has no exploitable surface.

**Confidence Change**: DECREASE — finding is refuted. Confidence drops from 0.67 to effectively 0.0.

---

## DA Analysis: EP-12

**Prior Path Explored**: Iter1 found at least one try/catch in BondingV5. Did not enumerate all blocks.

**New Path Explored**: Exhaustively searched for try/catch blocks in BondingV5.sol (returned no matches), then checked FRouterV2 and FRouterV3 which contain the relevant try/catch logic.

**New Evidence**:
- [TRACE: BondingV5.sol → grep for try/catch returns NO matches → BondingV5 itself has ZERO try/catch blocks]
- [TRACE: FRouterV2._calculateAntiSniperTax() L309-314 → `try pair.taxStartTime() returns (_taxStartTime) {} catch {}` — backward compat for old pairs without taxStartTime(); no state written before try, catch is empty → no inconsistency possible]
- [TRACE: FRouterV2._calculateAntiSniperTax() L332-339 → `try bondingV4.isProjectXLaunch(tokenAddress) returns (bool _isXLaunch) {} catch { isXLaunch = false; }` — local variable only, no state writes before/after try → no inconsistency]
- [TRACE: FRouterV2.setTaxStartTime() L364 → `try pair.setTaxStartTime(_taxStartTime) {} catch {}` — backward compat; no state written in caller before try, empty catch → no inconsistency]
- [TRACE: FRouterV2.drainPrivatePool() L412 → `try pair.syncAfterDrain(assetAmount, tokenAmount) {} catch {}` — drain transfers ALREADY completed before this try; catch silently skips reserve sync → drain proceeds successfully but reserves may be stale in old contracts; NOT an attacker-controllable failure]
- [TRACE: FRouterV3._getTaxStartTime() L329-336 → same pattern as FRouterV2 for backward compat → no state written before try]
- [TRACE: FRouterV3.setTaxStartTime() L350 → `try pair.setTaxStartTime(_taxStartTime) {} catch {}` → same pattern]
- [TRACE: FRouterV3.drainPrivatePool() L398 → `try pair.syncAfterDrain(assetAmount, tokenAmount) {} catch {}` → same as FRouterV2; drain completed before try]
- [VARIATION: Can attacker force syncAfterDrain try to fail maliciously? → syncAfterDrain is onlyRouter in FPairV2; the pair is looked up via factory.getPair() (trusted derivation); the pair contract is the legitimate FPairV2 which implements syncAfterDrain → no attacker control over whether it succeeds or fails for new contracts]

**Verdict Update**: REFUTED. No try/catch blocks exist in BondingV5.sol itself. All try/catch blocks are in FRouterV2 and FRouterV3, and they are all backward-compatibility patterns: (a) no state is written before the try in ways that would leave inconsistent state if the catch fires, (b) the `syncAfterDrain` catch only affects reserve state (not token balances) and is explicitly documented as acceptable, (c) no attacker-controllable path forces the try to fail on modern FPairV2 contracts. EP-12 is a false positive.

**Confidence Change**: DECREASE — finding is refuted. Confidence drops from 0.67 to effectively 0.0.

---

## Summary of Iteration 2 Results

| Finding | Prior Verdict | Iter2 Verdict | Confidence Change | New Finding |
|---------|--------------|---------------|------------------|-------------|
| EC-11 | Medium (0.67) | REFUTED | 0.67 → 0.0 | None — maxTx was never enforced in any version; V5 correctly omits dead variable |
| TE-2 | Medium (0.67) | PARTIAL (downgrade) | 0.67 → ~0.35 | DA-TE-2-UPDATE: attack surface is only creator's initial buy tokens, not large reserved supply |
| TE-5 | Medium (0.63) | REFUTED | 0.63 → 0.0 | None — taxStartTime=0 fallback to pair.startTime() is correct by design; buys blocked by launchExecuted gate |
| EP-4 | Medium (0.67) | REFUTED | 0.67 → 0.0 | None — pair address is always factory-derived, not user-controllable |
| EP-12 | Medium (0.67) | REFUTED | 0.67 → 0.0 | None — BondingV5 has zero try/catch; all router try/catch blocks are safe backward-compat patterns |

**Key New Finding**: TE-2's attack surface is significantly narrower than iter1 assessed. Only the creator's initial buy output tokens (amountOut in launch()) are redirectable by a teamTokenReservedWallet change between preLaunch and launch. The large reserved supply (airdrop + ACF, potentially 550M tokens) is sent in _preLaunch() and cannot be redirected. Severity downgraded to Low.
