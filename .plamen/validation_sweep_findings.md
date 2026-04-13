# Validation Sweep Findings

**Agent**: Validation Sweep Agent
**Scope**: BondingV5.sol, FRouterV2.sol, FRouterV3.sol, FPairV2.sol, FFactoryV2.sol, FFactoryV3.sol, BondingConfig.sol, multicall3.sol, BondingV2.sol
**Total functions scanned**: ~95 functions across 9 contracts

---

## Sweep Summary

| Check | Functions Scanned | Findings | False Positives Filtered |
|-------|------------------|----------|--------------------------|
| CHECK 1: Boundary Operator Precision | ~40 comparisons | 2 | 1 (buy tax cap at 99 — intentional design) |
| CHECK 2: Validation Reachability | ~30 validations | 2 | 0 |
| CHECK 3: Guard Coverage Completeness | 9 modifiers/guards | 2 | 0 |
| CHECK 4: Cross-Contract Action Parity | 8 paired actions | 1 | 1 (V2/V3 design divergence confirmed) |
| CHECK 5: External Call Parameter Validation | ~12 external calls | 1 | 0 |
| CHECK 6: Helper Function Call-Site Parity | 3 helpers | 1 | 0 |
| CHECK 7: Write Completeness for Accumulators | 5 variables from semantic_invariants | 1 (partial) | 2 |
| CHECK 8: Conditional Branch State Completeness | ~20 branching functions | 1 | 0 |
| CHECK 9: Validation Semantic Adequacy | ~15 validations protecting value | 1 | 0 |

---

## CHECK 1: Boundary Operator Precision

**Targets enumerated (21 comparisons checked):**

1. FPairV2.swap() L92: `block.timestamp >= startTime` — DONE. `>=` correct; using `>` would add a 1-block exclusion window with no benefit.
2. FPairV2.mint() L72: `_pool.lastUpdated == 0` — DONE. Exact equality guard is correct.
3. FPairV2.resetTime() L185: `block.timestamp >= startTime` reverts — DONE. Correct; pair has already started, no reset permitted.
4. FPairV2.resetTime() L189: `newStartTime < block.timestamp + startTimeDelay` reverts — DONE. `<` correct; newStartTime must be strictly at or beyond the floor.
5. FPairV2.setTaxStartTime() L200: `_taxStartTime >= startTime` — DONE. `>=` allows exact-same timestamp as startTime. This is intentional (launch at startTime).
6. FRouterV2.buy() L190: `normalTax + antiSniperTax > 99` → cap — DONE. `>99` triggers cap; at exactly 99 no cap applies. Intentional design (99% maximum antiSniper is the configured value).
7. FRouterV2._calculateAntiSniperTax() L323: `block.timestamp < finalTaxStartTime` — DONE. `<` correct; equal timestamp means time=0 elapsed, proceeds to compute.
8. FRouterV2._calculateAntiSniperTax() L348: `startTax <= taxReduction` returns 0 — DONE. `<=` correct; once taxReduction equals startTax the tax is zero.
9. FRouterV3._calculateAntiSniperTax() L306: `block.timestamp < taxStartTime` — DONE. Same as V2, correct.
10. FRouterV3._calculateAntiSniperTax() L313: `timeElapsed >= duration` returns 0 — **FLAG: `>=` vs `>`**. When `timeElapsed == duration`, tax = `startTax * 0 / duration = 0` anyway via the formula on L318. So both `>=` and `>` produce same result here. NOT an off-by-one. DONE.
11. BondingV5._buy() L664: `newReserveA <= gradThreshold` — **CONFIRMED FLAG**. See VS-1 below.
12. BondingV2._buy() L575: `newReserveA <= gradThreshold` — Same operator as BondingV5 on L664. Consistent. DONE.
13. BondingV5.launch() L518: `block.timestamp < pairContract.startTime()` reverts — DONE. `<` correct; at exactly startTime the launch can proceed.
14. BondingV5._preLaunch() L307: `purchaseAmount_ < launchFee` reverts — DONE. `<` means `purchaseAmount_ == launchFee` is accepted (zero initialPurchase). Intentional per design (zero-initial-purchase is a valid launch path).
15. BondingV5.sell() L597: `block.timestamp > deadline_` reverts — DONE. `>` means at exactly deadline the tx is still valid. Intentional.
16. BondingV5._buy() L629: `block.timestamp > deadline_` reverts — DONE. Same.
17. BondingConfig.setReserveSupplyParams() L281: `params_.maxAirdropBips + params_.acfReservedBips <= params_.maxTotalReservedBips` — DONE. `<=` allows equality (sum can equal max). Intentional.
18. BondingConfig.setReserveSupplyParams() L282-284: `maxAirdropBips <= 10000` etc. — DONE. `<=` allows 100% which is extreme but not an off-by-one flaw.
19. BondingConfig.calculateBondingCurveSupply() L204: `totalReserved > reserveSupplyParams.maxTotalReservedBips` reverts — DONE. `>` means equality passes validation. Consistent with setter at L281.
20. BondingV5._validateLaunchMode() L846: `antiSniperTaxType_ != bondingConfig.ANTI_SNIPER_60S()` — DONE. Strict equality required for special modes.
21. BondingV5.cancelLaunch() L479: `tokenRef.initialPurchase > 0` for transfer — DONE. Correct. Zero initialPurchase skips transfer.

**COVERAGE GATE**: All 21 targets processed.

---

## Finding [VS-1]: Graduation Trigger Uses `<=` Instead of `<` — Creates Exact-Threshold Graduation Race

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no role)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity per token), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✓, R13:✗(not design-related), R14:✗(no aggregate variable), R15:✓, R16:✗(no oracle)]
**Severity**: Low
**Location**: BondingV5.sol:664, BondingV2.sol:575

**Description**:
The graduation condition in both `_buy()` functions is:
```solidity
if (newReserveA <= gradThreshold && !router.hasAntiSniperTax(pairAddress) && tokenInfo[tokenAddress_].trading)
```
Using `<=` means graduation is triggered when `newReserveA` is **equal to** `gradThreshold`, not only strictly below it. This is a design choice: the comment in BondingV2 (`gradThreshold`) confirms that the intention is "at or below". However, `<=` means a single buy that lands the reserve exactly on the threshold triggers graduation. Given the AMM formula (`k/newReserveB`), hitting exactly the threshold via a buy is astronomically rare in practice.

Concrete off-by-one impact: if `gradThreshold` is computed as `fakeInitialVirtualLiq * bondingCurveSupply / (targetRealVirtual + fakeInitialVirtualLiq)` (integer division), the stored threshold already has rounding applied. Using `<=` vs `<` creates a 1-unit window where the last buy could trigger graduation when the reserve equals the threshold. This is actually correct behavior (graduation should occur at threshold, not after).

**Assessment**: NOT a concrete exploitable flaw. The `<=` is the intended comparison. Flagged for documentation purposes only. Downgraded to Informational.

**Impact**: No concrete financial impact. Correct boundary semantics.

**Evidence**: BondingV5.sol:664 `newReserveA <= gradThreshold`; BondingV2.sol:575 `newReserveA <= gradThreshold`

**SELF-CONSISTENCY**: Missing pattern (graduation at exact threshold) is FUNCTIONALLY REQUIRED by design — verdict: REFUTED as a bug.

**Revised Verdict**: REFUTED

---

## CHECK 2: Validation Reachability

**Targets enumerated (20 validations checked):**

1. FPairV2.swap() `onlyRouter` — reachability: is swap() accessible except via router? DONE. `onlyRouter` enforced; pair.router is set at construction and there is no setter, so the only caller is the immutable router address.
2. FPairV2.mint() `onlyRouter` — DONE. Same as swap().
3. FPairV2.transferAsset() `onlyRouter` — DONE.
4. FPairV2.transferTo() `onlyRouter` — DONE.
5. FPairV2.syncAfterDrain() `onlyRouter` — DONE.
6. FPairV2.setTaxStartTime() `onlyRouter` — DONE.
7. FPairV2.approval() `onlyRouter` — DONE.
8. BondingV5.buy() `trading` and `launchExecuted` checks — **PARTIAL FLAG**: see VS-2.
9. BondingV5.sell() `trading` and `launchExecuted` checks — Same.
10. BondingV5.cancelLaunch() `launchExecuted` check — DONE. Single entry point, no alternative path.
11. BondingV5.launch() `launchExecuted` check — DONE. Single entry point.
12. FRouterV2.graduate() `onlyRole(EXECUTOR_ROLE)` — **CONFIRMED FLAG**: see VS-3.
13. FRouterV3.graduate() `onlyRole(EXECUTOR_ROLE)` — Same as above.
14. FRouterV2.buy() `onlyRole(EXECUTOR_ROLE)` — DONE. No public path to same state change.
15. FRouterV2.sell() `onlyRole(EXECUTOR_ROLE)` — DONE.
16. FRouterV3.buy() `onlyRole(EXECUTOR_ROLE)` — DONE.
17. FRouterV3.sell() `onlyRole(EXECUTOR_ROLE)` — DONE.
18. FRouterV2.drainPrivatePool() `isProject60days` check — DONE. Checked before any state change.
19. FRouterV3.drainPrivatePool() `isProject60days` check — DONE.
20. BondingConfig.setReserveSupplyParams() validation — DONE. All constraints enforced at setter.

**COVERAGE GATE**: All 20 targets processed.

---

## Finding [VS-2]: BondingV5.cancelLaunch() Missing nonReentrant Guard Allows CEI Violation

**Verdict**: CONFIRMED (duplicate of RS2-3 already in findings_inventory.md)
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✓, R5:✗(single entity), R6:✗(no role), R8:✓, R10:✓, R11:✗(asset tokens only), R12:✗(not a dangerous state creation), R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: Medium
**Location**: BondingV5.sol:462-497

**Description**:
`cancelLaunch()` at BondingV5.sol:462 has no `nonReentrant` modifier. The function:
1. Checks `tokenRef.launchExecuted == false` (L475)
2. Transfers `tokenRef.initialPurchase` assets OUT (L480-484)
3. THEN zeroes `tokenRef.initialPurchase` and sets `tokenRef.launchExecuted = true` (L487-489)

If the assetToken is a token with a re-entry hook (e.g., ERC-777 or rebasing token), the `safeTransfer` on L480 could re-enter `cancelLaunch()` before state is updated, allowing a double-refund.

NOTE: This is already captured as RS2-3. Marking as duplicate.

**Impact**: Double-refund of initialPurchase if assetToken is an ERC-777/hook-enabled token.
**Evidence**: BondingV5.sol:479-489 — transfer precedes state update, no reentrancy guard.

**DUPLICATE of RS2-3 — filter from output.**

---

## Finding [VS-3]: FRouter.graduate() Validates No Pair Origin — EXECUTOR Can Graduate Pair From Arbitrary Factory

**Verdict**: CONFIRMED (already captured in AC-1)
**Status**: Duplicate of AC-1 — filter from output.

---

## CHECK 3: Guard Coverage Completeness

**Targets enumerated (all modifiers and guards):**

**FPairV2:**
1. `onlyRouter` — Applied to: mint, swap, approval, transferAsset, transferTo, syncAfterDrain, resetTime, setTaxStartTime. NOT applied to: getReserves(), kLast(), balance(), assetBalance() — all read-only, correct. DONE.

**FRouterV2/V3:**
2. `onlyRole(EXECUTOR_ROLE)` — Applied to: buy, sell, graduate, approval, drainPrivatePool, drainUniV2Pool, resetTime, setTaxStartTime, addInitialLiquidity. NOT applied to view functions (getAmountsOut, hasAntiSniperTax). DONE.
3. `onlyRole(ADMIN_ROLE)` — Applied to: setTaxManager, setAntiSniperTaxManager, setBondingV2, setBondingV4 (V2); setBondingV5 (V3). No state-writing function missing this guard. DONE.
4. `nonReentrant` — Applied in FRouterV2 to: sell, buy, graduate, approval, drainPrivatePool, drainUniV2Pool, resetTime. MISSING on `addInitialLiquidity`. See VS-4 below.

**FFactoryV2/V3:**
5. `onlyRole(CREATOR_ROLE)` on createPair — Applied. DONE.
6. `onlyRole(ADMIN_ROLE)` on setTaxParams, setRouter — Applied. DONE.
7. `nonReentrant` on createPair — Applied. DONE.

**BondingV5:**
8. `nonReentrant` — Applied to: preLaunch, preLaunchV2, launch, buy. NOT applied to: sell(), cancelLaunch(). Sell not using reentrancy-prone pattern (just calls router.sell which is EXECUTOR_ROLE protected). cancelLaunch already flagged as RS2-3. DONE.
9. `onlyOwner` on setBondingConfig — Applied. DONE.

**multicall3:**
10. `onlyOwner` on transferOwnership, transferToken, withdrawETH, grantAdmin, revokeAdmin, withdrawERC20Token — Applied. DONE.
11. `onlyOwnerOrAdmin` on aggregate, tryAggregate, blockAndAggregate, tryBlockAndAggregate, aggregate3, aggregate3Value, batchApproveTokens, batchTransferTokens, batchWithdrawERC20Tokens, approveToken — **FLAG**: see VS-5.

**COVERAGE GATE**: All 11 guard categories processed.

---

## Finding [VS-4]: FRouterV2/V3.addInitialLiquidity() Lacks nonReentrant Guard

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(N/A) | ✗7(no external deps)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role beyond EXECUTOR), R8:✓, R10:✓, R11:✓, R12:✗(no dangerous state creation), R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: Low
**Location**: FRouterV2.sol:115-129, FRouterV3.sol:122-136

**Description**:
`addInitialLiquidity()` is protected by `onlyRole(EXECUTOR_ROLE)` but lacks `nonReentrant`. The function:
1. Calls `IERC20(token_).safeTransferFrom(msg.sender, pairAddress, amountToken_)` — external call with user-controlled token address
2. Calls `IFPairV2(pairAddress).mint(amountToken_, amountAsset_)` — external call that writes pool state

If `token_` is a token with an ERC-777-style `tokensToSend` callback, the callback fires during `safeTransferFrom` on step 1, before `mint()` has written the pool. A reentrant call to `addInitialLiquidity()` (by another EXECUTOR_ROLE call or through a callback) could call `mint()` again on a pair that has `_pool.lastUpdated == 0` and is thus unminted, allowing double-initialization.

In practice this requires:
- A malicious token registered with the factory (requires CREATOR_ROLE)
- An EXECUTOR_ROLE operator initiating the call

Risk is Low due to EXECUTOR_ROLE requirement at both call sites. However, the guard pattern is inconsistent with all other state-mutating router functions which consistently apply `nonReentrant`.

**Impact**: Double-mint of pool reserves for a CREATOR_ROLE-controlled malicious token, distorting AMM pricing for that pair. Does not affect unrelated pairs.

**Evidence**:
```solidity
// FRouterV2.sol:115-129
function addInitialLiquidity(
    address token_,
    uint256 amountToken_,
    uint256 amountAsset_
) public onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
    // No nonReentrant
    ...
    IERC20(token_).safeTransferFrom(msg.sender, pairAddress, amountToken_); // external call #1
    IFPairV2(pairAddress).mint(amountToken_, amountAsset_);                  // external call #2
```

---

## Finding [VS-5]: multicall3.batchTransferTokens() Bypass — onlyOwnerOrAdmin Allows Admin to Call transferToken() (onlyOwner)

**Verdict**: CONFIRMED (partially overlaps RS2-2 but is a distinct bypass path)
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✗(evidence clear), R5:✗, R6:✗, R8:✗(single-step), R10:✓, R11:✓, R12:✓, R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: Medium
**Location**: multicall3.sol:446-460 (batchTransferTokens), 428-440 (transferToken)

**Description**:
`transferToken()` is protected by `onlyOwner`:
```solidity
function transferToken(address token, address to, uint256 amount) public onlyOwner {
```

However, `batchTransferTokens()` is protected by `onlyOwnerOrAdmin`, and it calls `transferToken()` internally:
```solidity
function batchTransferTokens(...) public onlyOwnerOrAdmin {
    for (uint256 i = 0; i < tokens.length; i++) {
        transferToken(tokens[i], recipients[i], amounts[i]);  // msg.sender is multicall3, passes onlyOwner
    }
}
```

When `batchTransferTokens()` is called by an admin (not owner), the loop executes `transferToken()` as a regular call from within the same contract. Since `transferToken()` checks `msg.sender == owner` and the call originates from within the Multicall3 contract (`address(this)`), `msg.sender` is the Multicall3 contract itself, not the original caller. The check `require(msg.sender == owner)` will FAIL because `msg.sender` inside `transferToken()` is `address(this)` (the Multicall3 contract), which is NOT the owner.

**Revised Assessment**: This means `batchTransferTokens()` called by an admin will ALWAYS revert, since `transferToken()` checks `msg.sender == owner` but gets `address(this)` as `msg.sender`. The admin cannot use `batchTransferTokens()` to transfer tokens — it silently fails by reverting.

This confirms RS2-2 (broken access control — batch functions silently fail for admins). The batch function is intended to allow admins to batch-transfer, but the internal `onlyOwner` check on `transferToken()` prevents it.

**Impact**: `batchTransferTokens()` is effectively non-functional for admin callers. The `onlyOwnerOrAdmin` modifier on the batch function is misleading — only owner can actually succeed. Any admin who relies on this function will have their batch silently fail (the whole tx reverts).

**Evidence**: multicall3.sol:428 `function transferToken(...) public onlyOwner` called at multicall3.sol:457 from within `batchTransferTokens()` which allows `onlyOwnerOrAdmin`.

**Postcondition Analysis**:
**Postconditions Created**: None — transaction reverts
**Postcondition Types**: None
**Who Benefits**: Nobody — broken functionality

---

## CHECK 4: Cross-Contract Action Parity

**Targets enumerated (8 paired actions):**

1. FRouterV2.graduate() vs FRouterV3.graduate() — Both: `onlyRole(EXECUTOR_ROLE)`, `nonReentrant`, no threshold check, no factory origin validation. SAME. DONE.
2. FRouterV2.buy() vs FRouterV3.buy() — Both: `onlyRole(EXECUTOR_ROLE)`, `nonReentrant`. Tax logic differs (V3 has `depositTax` call; V2 doesn't). This divergence is intentional (different tax architectures). Gap already captured in EP-4. DONE.
3. FRouterV2.sell() vs FRouterV3.sell() — Both: `nonReentrant`, `onlyRole(EXECUTOR_ROLE)`. Same guards. DONE.
4. FRouterV2.drainPrivatePool() vs FRouterV3.drainPrivatePool() — Both have `isProject60days` check, `nonReentrant`, EXECUTOR_ROLE. DONE.
5. FRouterV2.setTaxStartTime() vs FRouterV3.setTaxStartTime() — Both: `onlyRole(EXECUTOR_ROLE)`, both use try/catch. DONE.
6. FFactoryV2.setTaxParams() vs FFactoryV3.setTaxParams() — Both: `onlyRole(ADMIN_ROLE)`, both validate taxVault != address(0). DONE.
7. FFactoryV2.setRouter() vs FFactoryV3.setRouter() — Both: `onlyRole(ADMIN_ROLE)`. Neither validates router != address(0). Already captured as PC1-12. DONE.
8. FFactoryV2.createPair() vs FFactoryV3.createPair() — Both: `onlyRole(CREATOR_ROLE)`, `nonReentrant`. Neither validates pair doesn't already exist. Already captured as RS2-4. DONE.

**NEW PARITY FINDING:**

FRouterV3.sell() transfers tax via `depositTax()` on the taxVault. If `taxVault` is address(0) or not an IAgentTax contract, the sell reverts. FRouterV2.sell() just calls `pair.transferAsset(feeTo, txFee)` — it does NOT call `depositTax()`. A zero `feeTo` would revert in FPairV2 (checked: `require(recipient != address(0))`). However, FRouterV2.sell() applies tax even when `txFee == 0` (i.e., when `fee * amountOut / 100 == 0` due to rounding), calling `pair.transferAsset(feeTo, 0)` which does not revert (SafeERC20.safeTransfer of 0 is a no-op). FRouterV3.sell() also handles zero tax correctly (no depositTax call for zero). DONE — no new parity gap.

**COVERAGE GATE**: All 8 pairs processed.

---

## CHECK 5: External Call Parameter Validation

**Targets enumerated (12 external calls):**

1. BondingV5._preLaunch(): `agentFactory.createNewAgentTokenAndApplication(...)` — Return values `(token, applicationId)` are used directly without zero-check. Already captured as EP-1. DONE.
2. BondingV5._preLaunch(): `factory.createPair(...)` — Return value `pair` stored without zero-check. Already captured as EP-2. DONE.
3. BondingV5._openTradingOnUniswap(): `agentFactory.executeBondingCurveApplicationSalt(...)` — Return value `agentToken` stored without zero-check. Already captured as EP-3. DONE.
4. BondingV5._openTradingOnUniswap(): `agentFactory.updateApplicationThresholdWithApplicationId(...)` — No return value, void call. DONE.
5. BondingV5._openTradingOnUniswap(): `agentFactory.removeBlacklistAddress(...)` — No return value, void call. DONE.
6. BondingV5._openTradingOnUniswap(): `agentFactory.addBlacklistAddress(...)` — Called in _preLaunch, no return value. DONE.
7. FRouterV2.drainUniV2Pool(): `IAgentFactoryV6.removeLpLiquidity(veToken, recipient, veTokenAmount, 0, 0, deadline)` — `amountAMin=0, amountBMin=0` explicitly by design (privileged drain). No parameter validation issue. DONE.
8. FRouterV3.drainUniV2Pool(): Same as above via IAgentFactoryV7. DONE.
9. multicall3.aggregate(): `call.target.call(call.callData)` — No validation of `call.target`. See VS-6 below.
10. multicall3.aggregate3(): `calli.target.call(calli.callData)` — Same.
11. multicall3.aggregate3Value(): `calli.target.call{value: val}(calli.callData)` — Same.
12. BondingV5.launch(): `router.setTaxStartTime(tokenRef.pair, block.timestamp)` — Uses `block.timestamp` as parameter. No issue — this is the intended value.

**COVERAGE GATE**: All 12 targets processed.

---

## Finding [VS-6]: multicall3 Aggregate Functions Accept Arbitrary Call Targets Including Self — Privilege Escalation via Self-Callback

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no role hierarchy)
**Rules Applied**: [R4:✓, R5:✗(single-entry), R6:✓, R8:✗(single call), R10:✓, R11:✓, R12:✓, R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: Medium
**Location**: multicall3.sol:90-233 (aggregate, tryAggregate, blockAndAggregate, tryBlockAndAggregate, aggregate3, aggregate3Value)

**Description**:
All aggregate functions are protected by `onlyOwnerOrAdmin`. They execute arbitrary `(target, callData)` pairs via `.call()` with NO validation of the call target. Specifically, `call.target` can be:

1. **`address(this)` (Multicall3 itself)**: An admin calling `aggregate()` with `target=address(this)` and `callData=transferToken(...)` would call `transferToken()` where `msg.sender = address(this)`. The `onlyOwner` check in `transferToken()` would then compare `msg.sender` (Multicall3) against `owner`. If the Multicall3 contract is its own owner (not possible by design, but illustrates the pattern), this bypasses the access control. More concretely: if an admin passes `target=address(this), callData=grantAdmin(attackerAddress)`, the `onlyOwner` check inside `grantAdmin()` would fail since `msg.sender=Multicall3 != owner`. So self-targeting to escalate privileges fails due to `msg.sender` being `address(this)`.

2. **External protocol addresses**: An admin can call `aggregate()` with `target=anyContractAddress, callData=anyFunction(...)`. If Multicall3 holds token balances (which it does — it has `transferToken`, `withdrawERC20Token`, etc.) or has approvals set, an admin can target any external contract and trigger arbitrary state changes FROM the Multicall3 contract's context.

   Concrete attack: Admin calls `aggregate([{target: ERC20Token, callData: transfer(attacker, balance)}])`. This executes as `ERC20Token.transfer(attacker, balance)` with `msg.sender = Multicall3`, draining any tokens held by Multicall3 WITHOUT going through `onlyOwner` protected `transferToken()`.

**Impact**: An admin (not owner) can drain ERC-20 tokens held by Multicall3 by encoding an ERC-20 `transfer()` call directly as a target in `aggregate()`, bypassing the `onlyOwner` restriction on `transferToken()`. This makes the admin/owner privilege distinction in `transferToken()` meaningless.

**Evidence**:
```solidity
// multicall3.sol:104-108 — No target validation
(success, returnData[i]) = call.target.call(call.callData); // call.target is user-supplied, unchecked

// transferToken is onlyOwner but admins can bypass via aggregate():
function transferToken(address token, address to, uint256 amount) public onlyOwner { ... }

// Bypass: aggregate([{target: tokenAddress, callData: abi.encodeCall(IERC20.transfer, (attacker, amount))}])
```

### Precondition Analysis
**Missing Precondition**: Requires Multicall3 to hold ERC-20 token balance or have approvals granted to it.
**Precondition Type**: BALANCE
**Why This Blocks**: If Multicall3 holds no tokens, no drain occurs. However, the intended use of the contract (transferToken, approveToken, withdrawERC20Token) implies it does hold tokens.

### Postcondition Analysis
**Postconditions Created**: Admin can drain all ERC-20 tokens from Multicall3 without owner approval.
**Postcondition Types**: BALANCE, ACCESS
**Who Benefits**: Any admin can extract tokens if the contract holds a balance.

---

## CHECK 6: Helper Function Call-Site Parity

**Targets enumerated (3 helpers):**

1. `_calculateAntiSniperTax()` — FRouterV2: Called only in `buy()` via `antiSniperTax = _calculateAntiSniperTax(pair)`. NOT called in sell(). This is intentional by design (no anti-sniper tax for sells). Consistent with comment on L164: `"no antiSniper tax for sell"`. DONE.

2. `_calculateAntiSniperTax()` — FRouterV3: Called only in `buy()` (L192). Not called in sell(). Same design rationale. DONE.

3. `_getTaxStartTime()` — FRouterV3: Called only by `_calculateAntiSniperTax()`. Not called anywhere else. No missing call site. DONE.

4. Tax calculation helpers across V2 vs V3:
   - **FRouterV2 sell tax**: `uint fee = factory.sellTax(); uint256 txFee = (fee * amountOut) / 100;` — Inline, not a helper function.
   - **FRouterV3 sell tax**: `uint fee = factory.sellTax(); uint256 txFee = (fee * amountOut) / 100;` — Identical inline calculation.
   - **FRouterV2 buy normal tax**: `(normalTax * amountIn) / 100` — Inline.
   - **FRouterV3 buy normal tax**: `(normalTax * amountIn) / 100` — Identical. DONE.

5. **FRouterV2.sell() vs FRouterV3.sell() — anti-sniper tax application**: FRouterV2.sell() does NOT apply anti-sniper tax (correctly, by design). FRouterV3.sell() also does NOT apply anti-sniper tax. CONSISTENT. DONE.

**NEW FINDING — see VS-7 below**:

6. FRouterV3._calculateAntiSniperTax() calls `bondingV5.tokenAntiSniperType(tokenAddress)` WITHOUT a try/catch. This is already captured as MG-1. DONE.

**COVERAGE GATE**: All 6 helpers processed. No new parity gap.

---

## Finding [VS-7]: FRouterV3._calculateAntiSniperTax() Calls bondingV5 Without Null Check — Reverts When bondingV5 Not Set

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✗(evidence clear), R5:✗, R6:✗, R8:✗, R10:✓, R11:✗, R12:✗, R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: Medium
**Location**: FRouterV3.sol:293

**Description**:
`_calculateAntiSniperTax()` in FRouterV3 directly calls `bondingV5.tokenAntiSniperType(tokenAddress)` on line 293 without checking whether `bondingV5` is set:

```solidity
uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress); // L293 — no null check
```

If `setBondingV5()` has not been called (or the contract is in an early deployment state), `bondingV5` is `address(0)`, and this call will revert with a low-level exception. This causes ALL buy calls to revert via `buy() -> _calculateAntiSniperTax()`.

In contrast, FRouterV2._calculateAntiSniperTax() wraps its bondingV4 call in a try/catch:
```solidity
try bondingV4.isProjectXLaunch(tokenAddress) returns (bool _isXLaunch) { ... } catch { isXLaunch = false; }
```

The asymmetry means FRouterV3 is MORE fragile than FRouterV2 when external dependencies are not configured.

Additionally, `bondingV5.tokenAntiSniperType(tokenAddress)` reverts with `InvalidTokenStatus()` if the token was not created by BondingV5 (confirmed in BondingV5.sol:794: `if (tokenInfo[token_].creator == address(0)) { revert InvalidTokenStatus(); }`). This is the MG-1 finding: any non-BondingV5 token routed through FRouterV3 causes all buys to revert.

**Impact**: All buy operations through FRouterV3 fail if (a) `bondingV5` is not configured, or (b) the token being bought was not created by BondingV5.

**Evidence**: FRouterV3.sol:293 — `uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);` — no null check, no try/catch. Already substantially captured by MG-1 (the non-BondingV5 revert path).

**DUPLICATE of MG-1 for the non-BondingV5 revert path. The null-address path is a NEW sub-finding. Marking as partial duplicate.**

---

## CHECK 7: Write Completeness for Accumulators

**Targets from semantic_invariants.md:**

1. `_pool.lastUpdated` NOT updated in syncAfterDrain() — **Consumed?** Read by nothing in the codebase (confirmed: grep shows `lastUpdated` in FPairV2 is only written, never read by any external consumer — only `getReserves()` returns reserve0 and reserve1, not lastUpdated). Stale after drain but functionally harmless. Already confirmed as TF-7 (dead storage). DONE — NOT a new finding.

2. `tokenInfo[token].trading` NOT set false in BondingV2/V3/V4 cancelLaunch() — **Guard prevents trading?** In BondingV2.sell() L502: `if (!tokenInfo[tokenAddress].trading)` checked first. Since `trading=true` post-cancel in V2/V3/V4, this guard passes. Then `if (!tokenInfo[tokenAddress].launchExecuted)` L508 catches it (launchExecuted=true after cancel). So trading IS blocked for cancelled tokens in V2/V3/V4 via `launchExecuted` guard. The asymmetry with V5 is a latent inconsistency (if guard order changes) but not currently exploitable. Already captured in GAP-7 of semantic_invariants.md. DONE.

3. `volume24H` tracking — confirmed as dead code (GAP-11). Variable written to 0 at preLaunch, never incremented in buy/sell. `data.lastUpdated` updated conditionally but `volume24H` never modified during trades. **NEW CONFIRMATION**: VS-8 below.

4. BondingConfig.setScheduledLaunchParams() has no input validation — confirmed GAP-8. Already captured as EVT-5 (silent setter) and BondingConfig.setScheduledLaunchParams() analysis. DONE.

5. FFactoryV2/V3 antiSniperBuyTaxStartValue retroactively affects all active windows — confirmed TE-6. DONE.

**COVERAGE GATE**: All 5 variables processed.

---

## Finding [VS-8]: volume24H Field Is Never Written During Trades — Accumulator Infrastructure Is Dead Code

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3 | ✗4(N/A — no external deps) | ✗5(no role)
**Rules Applied**: [R4:✗, R5:✗, R6:✗, R8:✗, R10:✓, R11:✗, R12:✗, R13:✓, R14:✗, R15:✗, R16:✗]
**Severity**: Informational
**Location**: BondingV5.sol:437, BondingV2.sol (data.volume24H), BondingConfig.sol (Data struct)

**Description**:
The `Data.volume24H` field is initialized to `0` at preLaunch (`newToken.data.volume24H = 0;` at BondingV5.sol:437) and is **never incremented** in any `buy()`, `sell()`, or `_buy()` function across all Bonding versions. The `data.lastUpdated` field IS updated conditionally (when `duration > 86400`), acting as a staleness marker. However, the rolling-24h volume accumulation never happens.

Any UI or analytics that reads `tokenInfo[token].data.volume24H` will always receive 0. This field exists in the struct definition across all versions.

**Impact**: Off-chain analytics reading `volume24H` receive stale zeros for all tokens. No on-chain financial impact.

**Evidence**: BondingV5.sol:437 `newToken.data.volume24H = 0;` — set at preLaunch. No write to `volume24H` exists in buy() or sell(). `data.lastUpdated` at L658 updated without accompanying volume update.

---

## CHECK 8: Conditional Branch State Completeness

**Targets enumerated (20 branching functions):**

1. BondingV5.launch() `if (initialPurchase > 0)` — TRUE branch: calls `_buy()`, zeroes `initialPurchase`. FALSE branch: skips both. `launchExecuted = true` is UNCONDITIONAL outside the if-block (L571). State: both paths reach `launchExecuted=true`. DONE.

2. BondingV5._preLaunch() `if (isScheduledLaunch)` — TRUE: uses provided startTime, sets actualStartTimeDelay. FALSE: uses block.timestamp, sets delay=0. Both branches write `actualStartTime` and `actualStartTimeDelay`. DONE.

3. BondingV5._preLaunch() `if (totalReservedSupply > 0)` — TRUE: transfers reserved tokens. FALSE: no transfer. Both end at same state. DONE.

4. BondingV5._preLaunch() `if (launchFee > 0)` — TRUE: transfers fee. FALSE: skips. DONE.

5. BondingV2.cancelLaunch() `if (_token.initialPurchase > 0)` — TRUE: transfers then zeroes. FALSE: just zeroes. Both paths reach `initialPurchase=0, launchExecuted=true`. DONE. But NOTE: BondingV2 does NOT zero `trading` in EITHER branch. Captured GAP-7.

6. FRouterV2.buy() `if (isInitialPurchase)` — TRUE: no anti-sniper tax. FALSE: computes anti-sniper tax. Both branches compute `antiSniperTxFee`. DONE.

7. FRouterV2.buy() `if (antiSniperTxFee > 0)` — TRUE: transfers anti-sniper tax. FALSE: skips. Both branches reach same pool state after `swap()`. DONE.

8. FRouterV2.drainPrivatePool() `if (assetAmount > 0)` and `if (tokenAmount > 0)` — Conditional transfers are independent of reserve sync: `syncAfterDrain(assetAmount, tokenAmount)` is called with the original amounts regardless of whether the transfers were zero. So if `assetAmount == 0`, `syncAfterDrain(0, tokenAmount)` still reduces reserve1 by 0. CORRECT. DONE.

9. FRouterV3.sell() — always calls `depositTax(tokenAddress, txFee)` even when `txFee == 0`. **NEW FLAG**: see VS-9.

10. BondingV5._buy() `if (duration > 86400)` — Updates `lastUpdated` only in true branch. In false branch, `lastUpdated` is not updated. No asymmetric state write issue — the 24h window is intentionally not reset on short intervals. DONE.

11. BondingV5._buy() graduation trigger `if (newReserveA <= gradThreshold && ...)` — Only true branch calls `_openTradingOnUniswap()`. False branch continues. No missing state write. DONE.

12-20: Remaining branches in FFactoryV2/V3, BondingConfig — all setters are unconditional writes. DONE.

**COVERAGE GATE**: All 20 functions processed.

---

## Finding [VS-9]: FRouterV3.sell() Calls depositTax() With Zero Amount — Unnecessary External Call May Revert

**Verdict**: PARTIAL
**Step Execution**: ✓1,2,3,4 | ?5(uncertain — depends on IAgentTax implementation)
**Rules Applied**: [R4:✓, R5:✗, R6:✗, R8:✓, R10:✓, R11:✓, R12:✗, R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: Low
**Location**: FRouterV3.sol:157-170

**Description**:
`FRouterV3.sell()` computes `txFee = (fee * amountOut) / 100`. When `fee == 0` or `amountOut` is small enough that integer division rounds to zero, `txFee == 0`. The function then:

```solidity
pair.transferAsset(address(this), txFee);   // transfers 0 tokens — no-op via SafeERC20
IERC20(assetToken).forceApprove(feeTo, txFee); // approves 0 — no-op
IAgentTaxForRouter(feeTo).depositTax(tokenAddress, txFee); // calls depositTax with amount=0
```

`depositTax(tokenAddress, 0)` is called unconditionally. Depending on the IAgentTax implementation:
- If `depositTax` has a `require(amount > 0)` guard, the sell will revert when fee is zero.
- If it accepts zero, no issue.

In contrast, `FRouterV2.sell()` calls `pair.transferAsset(feeTo, txFee)` unconditionally (SafeERC20 allows zero transfers). The depositTax architecture in V3 introduces a conditional revert risk not present in V2.

`FRouterV3.buy()` already handles zero normal tax via the structure (normalTxFee is always computed, depositTax is called unconditionally for buy too). This is consistent between buy and sell in V3, but both share the zero-amount risk.

Checking: `factory.sellTax()` in normal operation returns the configured tax percentage. If `sellTax = 0`, every sell calls `depositTax(token, 0)`. This is the EP-4 scenario.

**Impact**: If AgentTax.depositTax() reverts on zero amount, all sells fail when sellTax==0 (or for small amounts). Partially captured by EP-4 (taxVault zero-check inconsistency). The zero-amount path through depositTax is a distinct sub-issue.

**Evidence**: FRouterV3.sol:167 `IAgentTaxForRouter(feeTo).depositTax(tokenAddress, txFee);` — called with txFee potentially == 0 when fee rounds to 0.

### Precondition Analysis
**Missing Precondition**: AgentTax.depositTax() must revert on zero input
**Precondition Type**: EXTERNAL
**Why This Blocks**: If depositTax accepts zero amounts, no revert occurs

---

## CHECK 9: Validation Semantic Adequacy

**Targets enumerated (15 validations protecting value):**

1. **Slippage protection in FRouterV2.buy()**: No `amountOutMin` parameter in `buy()`. Slippage is entirely enforced in BondingV2.buy() caller via `amountOutMin_` + SlippageTooHigh check. FRouterV2.buy() itself has no slippage guard. This is the architecture: the router is called by the bonding contract which enforces slippage. DONE.

2. **Slippage protection in FRouterV3.buy()**: Same pattern — no `amountOutMin` in router.buy(). Enforced at BondingV5.buy() level. DONE.

3. **Slippage protection in FRouterV2.sell()**: Same — enforced at BondingV2.sell() level. DONE.

4. **FPairV2.swap() K invariant**: NOT validated. After swap, `k` is carried forward unchanged as a constant (swap() does not recompute k). The router pre-computes `amountOut = k / newReserve`, so k consistency is maintained mathematically by the router's pricing formula, not by the pair's swap() function. Confirmed as TF-4 (already in inventory). DONE.

5. **FRouterV2.graduate() validation**: No threshold check — any pair can be graduated regardless of reserve level. Already captured as AC-1. DONE.

6. **FRouterV3.graduate() validation**: Same. AC-1. DONE.

7. **BondingV5._openTradingOnUniswap() double-graduation guard**: `if (tokenRef.tradingOnUniswap || !tokenRef.trading) { revert InvalidTokenStatus(); }` — validates both that graduation hasn't happened AND trading is active. DONE.

8. **BondingConfig.calculateBondingCurveSupply() — zero division risk**: `fakeInitialVirtualLiq == 0` case. Called at `bondingConfig.calculateGradThreshold()`: `(fakeInitialVirtualLiq * bondingCurveSupplyWei_) / (targetRealVirtual + fakeInitialVirtualLiq)`. If `fakeInitialVirtualLiq == 0`, division by `(0 + targetRealVirtual)` — no division by zero unless `targetRealVirtual` is also 0. If both are 0, result is 0/0. But the NUMERATOR is also 0, so Solidity integer division returns 0 (not revert). `gradThreshold = 0` means graduation triggers on the FIRST buy. Already captured as EC-2 and EC-4. DONE.

9. **FFactoryV2/V3.setTaxParams(): buyTax and sellTax validation**: No upper-bound check. `buyTax=100` causes underflow in buy() at `antiSniperTax = 99 - normalTax` when `normalTax=100`. Already captured as EC-1 and EC-3. DONE.

10. **FPairV2.mint() L72: `_pool.lastUpdated == 0` guard**: This is the only re-mint prevention. Confirms a pair can only be initialized once. DONE.

11-15: Additional checks in BondingV5._validateLaunchMode(), BondingConfig reserve bips — all confirmed functioning per CHECK 1. DONE.

**NEW FINDING:**

---

## Finding [VS-10]: FRouterV2.sell() Applies Tax to `amountOut` Computed Pre-Swap but Transfers amountOut Post-Swap — Tax Receiver Gets Less Than Expected on Fees Exceeding Actual Pool Transfer

**Verdict**: REFUTED
**Step Execution**: ✓1,2,3,4 | ✗5(N/A)
**Rules Applied**: [R4:✗, R5:✗, R6:✗, R8:✗, R10:✓, R11:✓, R12:✗, R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: N/A

**Description**:
`sell()` computes `amountOut = getAmountsOut(tokenAddress, address(0), amountIn)`, then `txFee = (fee * amountOut) / 100`, then `amount = amountOut - txFee`. It then calls `pair.transferAsset(to, amount)` and `pair.transferAsset(feeTo, txFee)`. Total transferred out of pair = `amount + txFee = amountOut`. The pair has exactly `amountOut` available because the bonding contract pre-verified the AMM formula, so the math is internally consistent.

There is no semantic mismatch here — `getAmountsOut` and `swap()` use the same constant-k formula. The tax is correctly applied and total transfers equal computed amountOut. DONE.

**Self-consistency**: This is functionally safe. REFUTED.

---

## Self-Consistency Check (MANDATORY)

Reviewing all findings for false positives where missing pattern is functionally required to be absent:

- VS-1 (graduation boundary `<=`): REFUTED — `<=` is correct design.
- VS-2 (cancelLaunch reentrancy): Duplicate RS2-3. Remove from output.
- VS-3 (graduate pair origin): Duplicate AC-1. Remove from output.
- VS-4 (addInitialLiquidity no nonReentrant): CONFIRMED Low — pattern inconsistent with all other mutating functions.
- VS-5 (batchTransferTokens broken for admins): CONFIRMED Medium — subset of RS2-2 but adds the `aggregate()` bypass angle.
- VS-6 (multicall3 aggregate arbitrary target): CONFIRMED Medium — concrete bypass for admin to drain tokens.
- VS-7 (FRouterV3 bondingV5 null check): Partial duplicate MG-1 — new sub-finding for null address path.
- VS-8 (volume24H dead code): CONFIRMED Informational — extends GAP-11 from semantic invariants.
- VS-9 (depositTax zero amount): CONFIRMED Low — adds to EP-4.
- VS-10 (sell tax accounting): REFUTED — math is correct.

After filtering duplicates: **VS-4, VS-5, VS-6, VS-9** are new findings. VS-8 is informational extension. VS-7 partially extends MG-1 with a null-address sub-path.

---

## Findings Summary

### [VS-1]: REFUTED — graduation boundary `<=` is correct design

### [VS-4]: addInitialLiquidity() Missing nonReentrant Guard
**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✗, R5:✗, R6:✗, R8:✓, R10:✓, R11:✓, R12:✗, R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: Low
**Location**: FRouterV2.sol:115-129, FRouterV3.sol:122-136
**Description**: `addInitialLiquidity()` is the only state-mutating EXECUTOR_ROLE function in FRouterV2/V3 missing `nonReentrant`. An EXECUTOR_ROLE caller using a token with an ERC-777 callback could trigger a reentrant `mint()` on the pair. Low severity because requires EXECUTOR_ROLE + malicious token registration.
**Impact**: Potential double-mint of pair reserves for a malicious token, corrupting AMM pricing for that specific pair.
**Evidence**: FRouterV2.sol:115 `function addInitialLiquidity(...) public onlyRole(EXECUTOR_ROLE)` — missing `nonReentrant`; contrast with sell() L135, buy() L174, graduate() L232, etc., all of which have `nonReentrant`.

### [VS-5]: multicall3 batchTransferTokens() Broken for Admins — onlyOwner Internal Call Fails
**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✗, R5:✗, R6:✓, R8:✗, R10:✓, R11:✓, R12:✗, R13:✓, R14:✗, R15:✗, R16:✗]
**Severity**: Medium
**Location**: multicall3.sol:446-460, 428-440
**Description**: `batchTransferTokens()` declared `onlyOwnerOrAdmin` internally calls `transferToken()` which is `onlyOwner`. When an admin invokes the batch function, the internal `msg.sender` inside `transferToken()` is the Multicall3 contract address, not the owner, causing every call to revert. Admins cannot use `batchTransferTokens()`, contradicting the `onlyOwnerOrAdmin` modifier's promise.
**Impact**: Batch transfer functionality is silently broken for admin callers. Admins relying on this function will have transactions revert.
**Evidence**: multicall3.sol:457 calls `transferToken(...)` which checks `require(msg.sender == owner)` at L432; when called internally, msg.sender is address(this) ≠ owner.

### [VS-6]: multicall3 aggregate() Accepts Arbitrary External Targets — Admin Can Drain Token Balances
**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✓, R5:✗, R6:✓, R8:✗, R10:✓, R11:✓, R12:✓, R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: Medium
**Location**: multicall3.sol:90-233 (all aggregate functions)
**Description**: Aggregate functions execute `.call()` on arbitrary `target` addresses with no whitelist or validation. An admin (not owner) can encode `(target=tokenAddress, callData=transfer(attacker, balance))` to directly call ERC-20 `transfer()` from Multicall3's context, bypassing the `onlyOwner` restriction of `transferToken()`. The `onlyOwner` guard on `transferToken()` is effectively dead for any attacker who controls an admin key.
**Impact**: Admin can drain all ERC-20 tokens held by Multicall3 without owner approval by using aggregate() with direct ERC-20 transfer calldata.
**Evidence**: multicall3.sol:105 `(success, returnData[i]) = call.target.call(call.callData)` — no target validation; `transferToken()` at L428 is `onlyOwner` but can be bypassed via direct ERC-20 `transfer(attacker, balance)` routed through `aggregate()`.

### [VS-8]: volume24H Accumulator Never Updated — Dead Tracking Infrastructure
**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3 | ✗4(no external deps)
**Rules Applied**: [R4:✗, R5:✗, R6:✗, R8:✗, R10:✗, R11:✗, R12:✗, R13:✓, R14:✗, R15:✗, R16:✗]
**Severity**: Informational
**Location**: BondingV5.sol:437, BondingV2.sol (Data struct)
**Description**: `data.volume24H` is initialized to 0 at preLaunch and never incremented in any buy/sell function across all Bonding versions. Off-chain code or integrators reading this field will receive 0 for all tokens at all times.
**Impact**: Incorrect analytics data; no on-chain financial impact.
**Evidence**: BondingV5.sol:437 `newToken.data.volume24H = 0;` — only write; no increment in BondingV5._buy() (L621-673) or sell() (L581-619).

### [VS-9]: FRouterV3.sell() Calls depositTax() With Potentially Zero Amount
**Verdict**: PARTIAL
**Step Execution**: ✓1,2,3,4 | ?5(depends on IAgentTax implementation)
**Rules Applied**: [R4:✓, R5:✗, R6:✗, R8:✓, R10:✓, R11:✓, R12:✗, R13:✗, R14:✗, R15:✗, R16:✗]
**Severity**: Low
**Location**: FRouterV3.sol:157-170
**Description**: When `factory.sellTax() == 0` or `amountOut` is small enough to round `txFee` to zero, `FRouterV3.sell()` still calls `IAgentTaxForRouter(feeTo).depositTax(tokenAddress, 0)`. If `depositTax` has a `require(amount > 0)` guard, all sells fail when tax rounds to zero. This is an extension of EP-4 covering the zero-amount code path specifically.
**Impact**: All sells through FRouterV3 may revert when sellTax is 0 or amounts are very small, depending on AgentTax implementation.
**Evidence**: FRouterV3.sol:167 — `depositTax(tokenAddress, txFee)` called unconditionally; `txFee` can be 0 when `fee * amountOut / 100 == 0`.

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|-----------|----------|---------------------|---------|----------|-------------------|--------------------|
| VS-4 | FRouterV2.sol:115-129, FRouterV3.sol:122-136 | addInitialLiquidity() lacks nonReentrant while making external calls to user-supplied token contracts | CONFIRMED | Low | ACCESS | POOL_STATE_CORRUPTION |
| VS-5 | multicall3.sol:446-460, 428-440 | batchTransferTokens() calls onlyOwner transferToken() internally — msg.sender mismatch breaks admin access | CONFIRMED | Medium | ACCESS | FUNCTION_NONFUNCTIONAL |
| VS-6 | multicall3.sol:90-233 | aggregate() forwards arbitrary external calls from Multicall3 context — admin can bypass onlyOwner by encoding direct ERC-20 transfer | CONFIRMED | Medium | ACCESS | TOKEN_DRAINAGE |
| VS-8 | BondingV5.sol:437, BondingV2.sol | volume24H never incremented in buy/sell — incomplete accumulator infrastructure | CONFIRMED | Informational | DESIGN | STALE_ANALYTICS |
| VS-9 | FRouterV3.sol:157-170 | depositTax() called unconditionally in sell() — zero amount when tax rounds to 0 may revert | PARTIAL | Low | EXTERNAL | SELL_DOS |
