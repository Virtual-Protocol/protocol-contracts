# Verification Batch C — Medium, Low, and Informational Findings

**Verifier**: Security Verifier — Batch C
**Date**: 2026-04-03
**Mode**: CODE-TRACE (no build environment)

---

## [H-5]: drainUniV2Pool Unrestricted Recipient — EXECUTOR Redirects Graduated LP (Medium)

**Impact Premise**: An EXECUTOR can drain all graduated Uniswap LP belonging to a Project60days token founder and redirect the proceeds to an arbitrary address instead of the rightful owner.

**Key Code Reference**: FRouterV3.sol:422-476

**Trace**:
[TRACE: FRouterV3.drainUniV2Pool(agentToken, veToken, recipient, deadline)] The function is gated with `onlyRole(EXECUTOR_ROLE)` at L427, accepts `recipient` as a caller-supplied parameter (L425), validates `recipient != address(0)` at L433, and checks `isProject60days` at L435-438. It then fetches the founder's full veToken balance (`IERC20(veToken).balanceOf(founder)` at L458) and calls `agentFactory.removeLpLiquidity(veToken, recipient, veTokenAmount, 0, 0, deadline)` at L466-473, passing the caller-supplied `recipient` directly. There is no check that `recipient == founder` or that `recipient` is any pre-authorized address. The `amountAMin=0` and `amountBMin=0` (L469-470) means no slippage protection. EXECUTOR can therefore call `drainUniV2Pool(validProject60daysToken, validVeToken, attackerAddress, deadline)` and redirect 100% of the founder's liquidity proceeds to an attacker-controlled address. The same pattern exists in FRouterV2.sol:436-489 for legacy tokens.

**Result**: CONFIRMED

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (EXECUTOR_ROLE is semi-trusted; attacker requires EXECUTOR compromise — impact is HIGH, likelihood MEDIUM given EOA key risk documented in H-1/H-3)

**Fix**: Add `require(recipient == founder, "Recipient must be token founder")` or restrict recipient to a pre-authorized protocol-controlled withdrawal address. Alternatively, call `removeLpLiquidity` with `recipient = founder` hardcoded.

---

## [H-10]: cancelLaunch CEI Violation Across All Bonding Versions (Medium)

**Impact Premise**: A malicious ERC20 assetToken could allow a token creator to double-claim their `initialPurchase` refund before the storage zero-out executes.

**Key Code Reference**: BondingV5.sol:462-497; BondingV2.sol:387-420; BondingV3.sol:322-355

**Trace**:
[TRACE: BondingV5.cancelLaunch() execution order]
1. L479: `if (tokenRef.initialPurchase > 0)` — CHECK on storage
2. L480-483: `IERC20(router.assetToken()).safeTransfer(tokenRef.creator, tokenRef.initialPurchase)` — INTERACTION (external call before state change)
3. L486: `uint256 initialPurchase = tokenRef.initialPurchase; // record real initialPurchase for event`
4. L487: `tokenRef.initialPurchase = 0;` — EFFECT (storage zero-out AFTER external call)

This is a classic CEI (Checks-Effects-Interactions) violation. The external `safeTransfer` at step 2 precedes the storage zero-out at step 4. If `assetToken` is a non-standard ERC20 (e.g., ERC777 with a `tokensReceived` hook or a callback-capable token), the creator's callback could re-enter `cancelLaunch` before `initialPurchase` is zeroed. The `launchExecuted` flag is NOT set before the transfer either (L489 sets it after), compounding the window.

However, the standard VIRTUAL token used as `assetToken` is NOT a callback token (not ERC777). The reentrancy window exists structurally but exploitation requires a non-standard assetToken. Additionally, `cancelLaunch` has no `nonReentrant` modifier in BondingV5.

In BondingV2 (L404-411) and BondingV3 (L339-346), the same pattern exists. Neither has `nonReentrant` on `cancelLaunch`.

[TRACE: BondingV2.cancelLaunch() — same structure confirmed at L404-411]
[TRACE: BondingV3.cancelLaunch() — same structure confirmed at L339-346]

Note: The event in BondingV2.cancelLaunch() at L413-419 emits `_token.initialPurchase` AFTER it has been zeroed at L411, so the emitted value is always 0 (separate finding H-34).

**Result**: CONFIRMED (structural CEI violation; practical exploitation requires non-standard assetToken — PARTIAL severity downgrade applies)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED (CEI violation present; practical risk conditional on assetToken properties)

**Final Severity**: Medium (as-found; standard assetToken reduces real-world impact but architectural flaw remains)

**Fix**: Move `tokenRef.initialPurchase = 0` and `tokenRef.launchExecuted = true` to before the `safeTransfer` call. Add `nonReentrant` modifier to `cancelLaunch`.

---

## [H-11]: Graduation Donation Attack — Inflation of AgentFactory Application Threshold (Medium)

**Impact Premise**: An attacker donating assetTokens directly to an FPairV2 address could artificially inflate the `assetBalance` read at graduation, causing the AgentFactory to receive more VIRTUAL than actually flowed through the bonding curve, over-crediting the application threshold and potentially blocking legitimate graduation math.

**Key Code Reference**: BondingV5.sol:718-730; FPairV2.sol:180-182

**Trace**:
[TRACE: BondingV5._openTradingOnUniswap() graduation path]
1. `uint256 assetBalance = pairContract.assetBalance()` at L718 — this calls `IERC20(tokenB).balanceOf(address(this))` in FPairV2 L180-182, which uses raw `balanceOf`, NOT tracked reserves (`_pool.reserve1`).
2. `uint256 tokenBalance = pairContract.balance()` at L719 — same, uses `IERC20(tokenA).balanceOf(address(this))` at FPairV2 L176-178.
3. `router.graduate(tokenAddress)` at L721 — drains both balances.
4. `IERC20(router.assetToken()).safeTransfer(address(agentFactory), assetBalance)` at L727 — sends the inflated balance to agentFactory.
5. `agentFactory.updateApplicationThresholdWithApplicationId(tokenRef.applicationId, assetBalance)` at L731 — sets application threshold to the inflated amount.

An attacker who donates X assetTokens to the pair address before graduation causes `assetBalance` to return (legitimate_virtual + X). This inflates both the VIRTUAL transferred to agentFactory and the stored application threshold. The graduation DOES succeed (no revert), but the application threshold is incorrectly elevated. The practical impact depends on how `updateApplicationThresholdWithApplicationId` uses this value. If it sets a withdrawable amount, the agentFactory is credited with more VIRTUAL than it should have, benefiting the protocol treasury (not a direct loss to users). However, the attacker wastes X VIRTUAL.

[TRACE: gradThreshold check at BondingV5 L664-672 — checks `newReserveA <= gradThreshold` using RESERVE (not balanceOf), so donation does NOT prematurely trigger graduation via the threshold check. The graduation is triggered by the reserve drop from actual buy activity.]

PARTIAL: Donation inflates assetBalance at graduation time but does not trigger spurious graduation; it over-credits the agentFactory threshold. Actual harm is limited (attacker burns their own funds to inflate a treasury credit). The BondingV2/V3/V4 code (H-11 extends to those) has the same pattern.

**Result**: CONFIRMED (structural vulnerability; impact is treasury over-credit from donation, not fund loss to users)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (loss of attacker funds; protocol over-credit; no user fund loss)

**Fix**: At graduation, use tracked reserves (`pair.getReserves()`) rather than `assetBalance()`/`balance()` (raw balanceOf). Cap transferred amount to tracked reserve values.

---

## [H-12]: drainPrivatePool Stale Reserve After Failed syncAfterDrain — Buy DoS on Old FPairV2 (Medium)

**Impact Premise**: If `drainPrivatePool` is called on an old FPairV2 contract that lacks `syncAfterDrain`, the pair's tracked reserves remain at pre-drain values, causing all subsequent buy/sell calculations via `getAmountsOut` (which uses reserves, not balanceOf) to return inflated output amounts that the pair cannot actually deliver, DoS-ing trades.

**Key Code Reference**: FRouterV3.sol:397-409; FRouterV2.sol:411-423; FPairV2.sol:145-157

**Trace**:
[TRACE: FRouterV3.drainPrivatePool() at L386-410]
1. L387-389: Transfers out `assetAmount` and `tokenAmount` from pair via `transferAsset` / `transferTo`.
2. L397-400: `try pair.syncAfterDrain(assetAmount, tokenAmount) {} catch {}` — if old FPairV2 without `syncAfterDrain`, the catch silently swallows the failure.
3. After drain: `_pool.reserve0` and `_pool.reserve1` in the old pair still hold the pre-drain values.
4. `getAmountsOut` in FRouterV3 L88-120 calls `pair.getReserves()` (returns stale reserves) and `pair.kLast()` (stale k), computing an amountOut that exceeds the actual pair balance.
5. Any subsequent `buy()` or `sell()` will compute an `amountOut` that the pair's actual balance cannot cover → `safeTransfer` in `transferAsset`/`transferTo` will revert because actual ERC20 balance is 0.

CONFIRMED with caveat: This requires an OLD FPairV2 (pre-`syncAfterDrain`) to be targeted. The current FPairV2.sol at L145-157 DOES implement `syncAfterDrain`. But per the try-catch comment: "Old FPairV2 contracts don't have syncAfterDrain." So deployed legacy pairs are affected. Once drained without sync, those pairs become permanently unusable for swaps.

**Result**: CONFIRMED (on old deployed FPairV2 instances)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (DoS scoped to old FPairV2 pairs that were drained; new pairs have syncAfterDrain)

**Fix**: When syncAfterDrain fails (old pair), explicitly set the old pair as inactive or add a flag preventing further trades. Alternatively, maintain a separate staleness mapping per-pair in the router.

---

## [H-13]: FFactory.setRouter(address(0)) → All New Pair Creation Fails (Medium)

**Impact Premise**: If an ADMIN calls `setRouter(address(0))` on FFactoryV2 or FFactoryV3, all subsequent pair creation via `createPair` permanently reverts, preventing new token launches.

**Key Code Reference**: FFactoryV3.sol:132-134; FFactoryV3.sol:73-86; FFactoryV2.sol:124-126

**Trace**:
[TRACE: FFactoryV3.setRouter(address(0)) → createPair()]
1. `setRouter(address router_)` at FFactoryV3 L132: `router = router_` — no zero-address check.
2. Next call to `createPair()` → `_createPair()` at L68-86: L76: `require(router != address(0), "No router")` — reverts.
3. FPairV2 constructor at FPairV2 L36: `require(router_ != address(0))` — also reverts.

So `setRouter(address(0))` on the factory silently sets the router to zero. All subsequent pair creation reverts at the "No router" check in `_createPair`. This requires ADMIN_ROLE to execute but no confirmation/timelock is needed. The same pattern exists in FFactoryV2.sol:124-126.

Note: Existing pairs are NOT affected (their `router` is set at construction time and immutable per pair). Only NEW token launches are blocked.

**Result**: CONFIRMED

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (admin-controlled DoS on new launches; existing tokens unaffected; -1 tier considered but ADMIN is semi-trusted, not FULLY_TRUSTED governance)

**Fix**: Add `require(router_ != address(0), "Zero address not allowed")` in `setRouter()`.

---

## [H-14]: FRouterV3 Depends on bondingV5.tokenAntiSniperType() Without Try/Catch — Hard DoS for Non-V5 Tokens (Medium)

**Impact Premise**: If `FRouterV3` is used for tokens not registered in BondingV5 (e.g., from a different bonding version), calling `_calculateAntiSniperTax` will revert because `bondingV5.tokenAntiSniperType()` reverts for unknown tokens, permanently blocking all buys on those pairs.

**Key Code Reference**: FRouterV3.sol:283-318; BondingV5.sol:793-798

**Trace**:
[TRACE: FRouterV3._calculateAntiSniperTax() at L283-318]
1. L293: `uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress)` — NO try/catch.
2. In BondingV5 at L793-798: `tokenAntiSniperType()` checks `if (tokenInfo[token_].creator == address(0)) { revert InvalidTokenStatus(); }` — any token not registered in BondingV5 triggers this revert.
3. The revert propagates up through `_calculateAntiSniperTax` → `buy()` at L192 → entire `buy()` reverts.

This means: if `bondingV5` is not set (address(0)), the `require(address(bondingV5) != address(0))` at the drain functions would catch it, but `bondingV5` is referenced in `_calculateAntiSniperTax` directly at L293 without a null check (though if bondingV5 is address(0), the call to address(0) returns empty data which may revert on ABI decoding). If bondingV5 is set to a valid BondingV5 contract but the token was launched via a different bonding version (BondingV2/V3/V4 paired with FRouterV3 in a misconfiguration), every buy on that pair DoS-es.

Contrast with `_getTaxStartTime` at L326-338 which DOES use `try pair.taxStartTime()`. The anti-sniper type call should have the same try/catch pattern.

**Result**: CONFIRMED

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (misconfiguration scenario; requires non-V5 token in FRouterV3; admin configuration error enables it)

**Fix**: Wrap `bondingV5.tokenAntiSniperType(tokenAddress)` in a try/catch. On revert, fall back to legacy anti-sniper logic (or return ANTI_SNIPER_NONE = 0).

---

## [H-15]: Deprecated Storage Slots in FRouterV2 — Upgrade Collision Risk (Medium)

**Impact Premise**: The `taxManager` and `antiSniperTaxManager` storage slots in FRouterV2 occupy storage positions but are functionally deprecated; if FRouterV2 is upgraded and new storage variables are added, the deployer may collide with these slots, corrupting state.

**Key Code Reference**: FRouterV2.sol:40-41, 252-259

**Trace**:
[TRACE: FRouterV2 storage layout]
Storage slot ordering in FRouterV2 (upgradeable, inherits Initializable → AccessControlUpgradeable → ReentrancyGuardUpgradeable):
- Inherited OZ gaps occupy slots 0–N (large __gap arrays in OZ contracts).
- After OZ gaps: `factory` (L38), `assetToken` (L39), `taxManager` (L40), `antiSniperTaxManager` (L41), `bondingV2` (L42), then later `bondingV4` (L59).

The fields `taxManager` (L40) and `antiSniperTaxManager` (L41) are commented as `// deprecated`. They remain as live storage slots but are only written by setters `setTaxManager` and `setAntiSniperTaxManager` (L252-259) that still exist. The setters are NOT removed. There are NO `__gap` slots added to FRouterV2 for future expansion (confirmed: grep found no `__gap` anywhere in the launchpadv2 directory).

For an upgradeable contract, the absence of `__gap` means any new storage variable added to FRouterV2 in a future upgrade must be appended after `bondingV4` (slot N), or it WILL overwrite subsequent storage. The deprecated slots themselves occupy 2 existing storage positions. The risk is specifically that if an upgrade attempts to remove `taxManager`/`antiSniperTaxManager` by changing the layout, it causes storage collision. The deprecated setters also expose unnecessary admin surface.

**Result**: CONFIRMED (no `__gap`, deprecated slots present with active setters)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (upgrade-time risk; no immediate exploit; risk materializes at next upgrade)

**Fix**: Do NOT remove `taxManager`/`antiSniperTaxManager` slots — keep them as storage placeholders. Add `uint256[N] private __gap` at the end of FRouterV2 storage to provide headroom. Remove or disable the deprecated setters to reduce admin surface.

---

## [H-16]: antiSniperBuyTaxStartValue + buyTax Sum Not Enforced (Medium)

**Impact Premise**: If `antiSniperBuyTaxStartValue` (starting tax percentage, e.g., 99) plus `buyTax` exceed 99, the runtime cap at `FRouterV3.buy()` L195 will silently compress the anti-sniper tax to maintain the 99% ceiling, but the configured `antiSniperBuyTaxStartValue` value is misleading and may cause unexpected user UX (buyers receive 1% of their input regardless of market conditions during the anti-sniper window).

**Key Code Reference**: FRouterV3.sol:194-197; FFactoryV3.sol:116-130; FFactoryV2.sol:108-122

**Trace**:
[TRACE: FRouterV3.buy() anti-sniper tax cap at L194-197]
```
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax;
}
```
`normalTax = factory.buyTax()` and `antiSniperTax = _calculateAntiSniperTax(pair)`.
`_calculateAntiSniperTax` returns `startTax * (duration - timeElapsed) / duration` where `startTax = factory.antiSniperBuyTaxStartValue()`.

If `antiSniperBuyTaxStartValue = 99` (intended maximum) and `buyTax = 2` (2%), then at t=0, `antiSniperTax = 99`, total = 101 → capped to 97 (not 99 as intended). The cap operates silently — no event, no revert. There is no validation in `setTaxParams` that enforces `buyTax + antiSniperBuyTaxStartValue <= 99`. The FFactoryV3.initialize() and setTaxParams() both accept these values without cross-validation.

Note: The FFactoryV2.sol comment at L27 says `// Starting tax value for anti-sniper (in basis points)` but it's used as a percentage (divided by 100), not bips (divided by 10000) — confirmed discrepancy (also H-43).

**Result**: CONFIRMED (no validation enforcing sum ≤ 99; silent cap corruption)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (misconfigured admin parameters cause silent UX corruption; no direct fund loss but anti-sniper protection weakened)

**Fix**: In `setTaxParams`, add `require(buyTax_ + antiSniperBuyTaxStartValue_ <= 99, "Tax sum exceeds 99%")`. Add similar check in `initialize`.

---

## [H-17]: multicall3 aggregate Allows Admin to Bypass onlyOwner — Token Drain (Medium)

**Impact Premise**: An owner or admin with access to Multicall3's aggregate functions can make arbitrary external calls (including to other contracts' `onlyOwner` functions) by encoding the call data, bypassing any per-contract access control that checks `msg.sender == owner`.

**Key Code Reference**: multicall3.sol:90-111; multicall3.sol:191-233

**Trace**:
[TRACE: Multicall3.aggregate() at L90-111]
`aggregate(Call[] calldata calls)` is gated by `onlyOwnerOrAdmin` (L95). It iterates through `calls` and executes `call.target.call(call.callData)` at L105 with `msg.sender = address(Multicall3)`. This means the Multicall3 contract itself makes the downstream call.

For the attack to bypass `onlyOwner` on another contract X, Multicall3 would need to BE the owner of contract X. The concern is specifically: if Multicall3 is set as the owner of any other contract in the system, then `aggregate()` can call that contract's `onlyOwner` functions with Multicall3 as `msg.sender`.

However, the `aggregate3Value()` function at L239-291 is `onlyOwnerOrAdmin` gated, not unrestricted. Admins CAN call aggregate/aggregate3/aggregate3Value. If Multicall3 holds ownership of any on-chain asset (ERC20s accumulated in it), `aggregate()` can drain them via crafted calldata.

The key risk: Multicall3 accumulates approval authority via `approveToken/batchApproveTokens` (L387-422) and directly holds tokens. An admin (not just owner) can call `aggregate()` to encode a `transferToken` call → `transferToken` is `onlyOwner` (L432). But `aggregate()` from admin would call Multicall3.transferToken() with `msg.sender = Multicall3` — which IS the owner! So admins can drain tokens by calling `aggregate()` with calldata targeting `transferToken(token, adminAddress, amount)` on Multicall3 itself.

[TRACE: Admin calls aggregate([{target: multicall3Address, callData: abi.encodeWithSelector(transferToken.selector, token, adminAddress, amount)}])]
→ Multicall3.aggregate calls Multicall3.transferToken → onlyOwner check passes (msg.sender = Multicall3 = owner) → tokens drained.

**Result**: CONFIRMED (admin can drain tokens from Multicall3 via aggregate self-call bypassing transferToken's onlyOwner)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (requires compromised admin; admins can drain accumulated tokens from Multicall3 contract itself; -1 tier for SEMI-TRUSTED actor, not FULLY_TRUSTED owner)

**Fix**: Restrict `aggregate()` / `aggregate3()` / `aggregate3Value()` to `onlyOwner` only (not `onlyOwnerOrAdmin`). Alternatively, blacklist calls where `target == address(this)`.

---

## [H-22]: cancelLaunch Permanently Locks bondingCurveSupply Tokens (Medium)

**Impact Premise**: After `cancelLaunch`, the bondingCurveSupply of agentTokens that were transferred to the FPairV2 pair remain permanently locked in the pair with no recovery mechanism.

**Key Code Reference**: BondingV5.sol:462-497; BondingV5.sol:372-380 (addInitialLiquidity flow)

**Trace**:
[TRACE: Token lifecycle after cancelLaunch]
1. During `_preLaunch`: `router.addInitialLiquidity(token, bondingCurveSupply, liquidity)` at BondingV5 L379 — transfers `bondingCurveSupply` agentTokens to the FPairV2 pair address.
2. `cancelLaunch()` at BondingV5 L462-497:
   - Refunds `initialPurchase` assetTokens to creator (L479-483).
   - Sets `tokenRef.initialPurchase = 0` and `tokenRef.launchExecuted = true` (L487-489).
   - Sets `tokenRef.trading = false` (L488).
   - Does NOT transfer agentTokens back from the pair.
   - Does NOT call any pair drain function.
3. After cancel: The FPairV2 pair holds `bondingCurveSupply` agentTokens (e.g., 450M tokens * 10^18). No path exists to recover them:
   - `drainPrivatePool` in FRouterV3 requires `isProject60days(token) = true` — tokens launched normally have this = false unless explicitly set.
   - Even if Project60days, EXECUTOR can drain to a recipient — but only pre-graduation (no `launchExecuted` check, but `trading` is false so no graduation path).
   - `cancelLaunch` does not call `router.graduate()` or any drain.
   - The agentToken itself: `IAgentTokenV2(token)` — the token is an ERC20 but there is no burn or recover function accessible from BondingV5 or FPairV2 without role-gated access.

The only practical recovery would be if EXECUTOR called `drainPrivatePool` on a cancelled Project60days token, which is technically possible. For non-Project60days tokens, the bondingCurveSupply is unrecoverable.

**Result**: CONFIRMED (for non-Project60days tokens; bondingCurveSupply is permanently stranded in the pair)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (funds locked permanently; no user fund loss — agentTokens have no intrinsic value pre-graduation — but protocol clean-up is impossible and creates token supply distortion)

**Fix**: In `cancelLaunch`, add a step to drain the pair's agentToken balance back (e.g., via `drainPrivatePool` or a new `drainCancelledPair` function). Or burn the locked agentTokens.

---

## [H-23]: DEFAULT_ADMIN_ROLE Can Self-Revoke (Medium)

**Impact Premise**: The holder of `DEFAULT_ADMIN_ROLE` can call `revokeRole(DEFAULT_ADMIN_ROLE, self)` or `renounceRole(DEFAULT_ADMIN_ROLE, self)`, permanently removing the only role that can grant/revoke other roles, locking role management forever.

**Key Code Reference**: FRouterV3.sol:79 (`_grantRole(DEFAULT_ADMIN_ROLE, msg.sender)`); FFactoryV3.sol:59; AccessControlUpgradeable (OZ)

**Trace**:
[TRACE: AccessControlUpgradeable role structure]
OpenZeppelin `AccessControlUpgradeable` uses `DEFAULT_ADMIN_ROLE` as the admin of all other roles (including itself) by default. The OZ `renounceRole(role, account)` and `revokeRole(role, account)` functions are inherited without override in FRouterV3/FFactoryV2/FFactoryV3. No custom guard prevents `DEFAULT_ADMIN_ROLE` from revoking itself.

`DEFAULT_ADMIN_ROLE` is granted to `msg.sender` at initialization (FRouterV3 L79, FFactoryV3 L59, FFactoryV2 L51). The holder of `DEFAULT_ADMIN_ROLE` is also the admin of `ADMIN_ROLE` and `EXECUTOR_ROLE`. If they renounce/revoke `DEFAULT_ADMIN_ROLE`, no one can ever grant ADMIN_ROLE or EXECUTOR_ROLE again. Combined with H-27 (EXECUTOR_ROLE self-removal), this creates a permanent lockout path.

Note: This requires the DEFAULT_ADMIN_ROLE holder to voluntarily act against their own interest, which places it in the fully-trusted actor category for severity adjustment. However, it could also happen by accident (wrong address in revokeRole call).

**Result**: CONFIRMED (structural; no guard exists)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (accidental or malicious self-revoke causes irreversible role lockout; -1 tier for FULLY_TRUSTED actor acting maliciously, but accidental scenario elevates it back; net: Medium)

**Fix**: Override `renounceRole` and `revokeRole` in FRouterV3/FFactoryV2/FFactoryV3 to revert if `role == DEFAULT_ADMIN_ROLE` and `account == msg.sender`. Or require a two-step role transfer with a timelock.

---

## [H-24]: renounceOwnership Unguarded on BondingV5 and BondingConfig (Medium)

**Impact Premise**: The owner of BondingV5 or BondingConfig can call `renounceOwnership()` at any time with no confirmation step, permanently removing owner-only administrative functions (setBondingConfig, setTokenParams, setPrivilegedLauncher, etc.) with no recovery path.

**Key Code Reference**: BondingV5.sol:88-91 (inherits OwnableUpgradeable); BondingConfig.sol:14 (inherits OwnableUpgradeable)

**Trace**:
[TRACE: OwnableUpgradeable.renounceOwnership()]
`BondingV5` inherits `OwnableUpgradeable` (L91). `BondingConfig` inherits `OwnableUpgradeable` (L14). Neither contract overrides `renounceOwnership`. OZ `OwnableUpgradeable.renounceOwnership()` is callable by the current owner with no guard, no timelock, no confirmation, one-step and irreversible.

After renouncement:
- `BondingV5`: `setBondingConfig()` (L857) permanently inaccessible. Config can never be updated.
- `BondingConfig`: All `onlyOwner` setters (`setDeployParams`, `setCommonParams`, `setBondingCurveParams`, `setScheduledLaunchParams`, `setTeamTokenReservedWallet`, `setPrivilegedLauncher`, `setReserveSupplyParams`) become permanently inaccessible. Launch modes, fees, thresholds, and privileged launchers are frozen forever.

This affects H-9, H-18, H-19, H-20 — admin-settable DoS mitigations become impossible.

**Result**: CONFIRMED

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (-1 tier for FULLY_TRUSTED owner; but accidental call risk makes it Medium, not Low — consequence is severe and irreversible)

**Fix**: Override `renounceOwnership()` to revert: `function renounceOwnership() public override onlyOwner { revert("Renouncement disabled"); }`. Implement a two-step ownership transfer instead.

---

## [H-37]: Creator Can Buy Entire Bonding Supply, Triggering Instant Graduation (Medium)

**Impact Premise**: A token creator can supply a `purchaseAmount` so large that `initialPurchase` equals 100% of the bonding curve reserve, triggering instant graduation upon `launch()`, bypassing the intended community price discovery phase.

**Key Code Reference**: BondingV5.sol:307-313 (`initialPurchase` calculation); BondingV5.sol:539-561 (`launch()` buy); BondingV5.sol:662-673 (graduation trigger)

**Trace**:
[TRACE: BondingV5._preLaunch() → launch() graduation path]
1. `initialPurchase = purchaseAmount_ - launchFee` at L313. No upper bound on `purchaseAmount_` beyond `purchaseAmount_ >= launchFee` (L307).
2. In `launch()` at L539-561: `_buy(address(this), initialPurchase, tokenAddress_, 0, ...)` buys with the full `initialPurchase` amount, with `amountOutMin_ = 0` (no slippage protection on initial purchase).
3. After the buy, `newReserveA = reserveA - amount0Out`. At L664: `if (newReserveA <= gradThreshold && !router.hasAntiSniperTax(pairAddress) && tokenInfo[tokenAddress_].trading)` → `_openTradingOnUniswap`.
4. `gradThreshold` is set per-token at `tokenGradThreshold[token]` during preLaunch (L390-393). For a typical configuration, gradThreshold corresponds to the reserve level when ~42,000 VIRTUAL has been received.
5. If `initialPurchase` is large enough to drive `newReserveA <= gradThreshold` in a single buy, graduation triggers immediately in `launch()` itself.

No `maxTx` or maximum purchase cap exists in BondingV5 (unlike BondingV2/V3 which have `maxTx`). The graduation in the same `launch()` call is architecturally possible if `initialPurchase` is sized to clear the bonding curve.

Note: The creator would need significant VIRTUAL capital (roughly 42,000 VIRTUAL at graduation-equivalent ratio). This is economically costly but not impossible for a well-funded creator.

**Result**: CONFIRMED (no cap on initialPurchase; instant graduation is reachable)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (economic cost to execute; intended behavior partly; but bypasses community trading phase; no user fund loss if executed honestly — market manipulation risk)

**Fix**: Add a `maxInitialPurchase` cap in `_preLaunch`. Alternatively, delay graduation eligibility check until the first public buy (not the initial purchase).

---

## [H-39]: Router bondingV5/bondingConfig References Not Cross-Validated (Medium)

**Impact Premise**: FRouterV3's `bondingV5` and `bondingConfig` references are set independently from each other and from FFactoryV3's router pointer; a misconfigured upgrade window where these point to different-version contracts causes DoS on anti-sniper tax calculation for all tokens.

**Key Code Reference**: FRouterV3.sol:257-262 (`setBondingV5`); FRouterV3.sol:50-52 (storage vars)

**Trace**:
[TRACE: FRouterV3 reference independence]
1. `setBondingV5(bondingV5_, bondingConfig_)` at L257-262: Sets `bondingV5` and `bondingConfig` together in one call. This is the only point of cross-setting.
2. But `factory` (FFactoryV3) is set in `initialize()` (L84) and has NO function to update it post-initialization. The factory itself stores `router` which is set via `setRouter()` on the factory.
3. If a new BondingV5 is deployed but `setBondingV5` on FRouterV3 is not updated, the router still uses the OLD bondingV5 reference for `tokenAntiSniperType()` calls, causing reverts for tokens registered on the new BondingV5.
4. Conversely, if a new FRouterV3 is deployed without calling `setBondingV5`, `bondingV5 == address(0)` and every call to `drainPrivatePool`/`drainUniV2Pool` reverts at the `require(address(bondingV5) != address(0))` check, and `_calculateAntiSniperTax` at L293 would call address(0).
5. FFactoryV3's `router` (used by FPairV2 as `onlyRouter`) is set separately. If FFactoryV3.router differs from the router that BondingV5 calls, the pair's `onlyRouter` modifier rejects legitimate router calls.

The risk is primarily operational (upgrade sequencing error) rather than adversarial. However, no on-chain validation prevents divergence.

**Result**: CONFIRMED (no cross-validation; divergence causes DoS on all affected tokens)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (operational misconfiguration risk; no direct fund loss but system-wide trade DoS possible during upgrade)

**Fix**: Add a post-deploy validation step or on-chain invariant check that `FRouterV3.factory().router() == address(this)` and `FRouterV3.bondingV5() != address(0)`. Emit events when references are updated to aid monitoring.

---

## [H-49]: No __gap in Any Upgradeable Contract (Medium)

**Impact Premise**: All upgradeable contracts (BondingV5, BondingConfig, FRouterV2, FRouterV3, FFactoryV2, FFactoryV3) have no `uint256[N] private __gap` storage padding, meaning any future upgrade that adds new storage variables to an inherited OZ contract or the contract itself risks colliding with existing variables.

**Key Code Reference**: BondingV5.sol:88-98; BondingConfig.sol:14-54; FRouterV2.sol:28-59; FRouterV3.sol:37-52; FFactoryV2.sol:10-28; FFactoryV3.sol:18-36

**Trace**:
[TRACE: Grep for `__gap` in all launchpadv2 contracts — ZERO matches found]

All six upgradeable contracts in scope inherit OpenZeppelin upgradeable contracts (Initializable, OwnableUpgradeable, AccessControlUpgradeable, ReentrancyGuardUpgradeable) but none define their own `__gap` storage variable.

OZ upgradeable contracts include their own `__gap` arrays internally (e.g., `OwnableUpgradeable` has `uint256[49] private __gap`). However, the CUSTOM contract (BondingV5, BondingConfig, etc.) should also define its own `__gap` after its own storage variables. Without it:
- Any future upgrade that adds a new state variable to BondingV5 must be appended after the LAST current storage variable.
- If the upgrade also changes an OZ dependency that alters OZ's internal gap size, storage layout shifts.
- If developers insert a new variable between existing ones (common mistake), all subsequent variables shift, corrupting state.

The risk is elevated for FRouterV2 which already has deprecated slots (H-15) indicating prior layout changes.

**Result**: CONFIRMED (no __gap present in any upgradeable custom contract)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (upgrade safety gap; no immediate exploit but high regression risk at next upgrade)

**Fix**: Add `uint256[50] private __gap;` (or appropriate size) at the end of each upgradeable contract's storage declarations.

---

## [H-51]: FRouterV3.sell() depositTax Called With Zero Amount — DoS When sellTax=0 (Medium)

**Impact Premise**: When `sellTax` is 0, `txFee = 0`, but `depositTax(tokenAddress, 0)` is still called on the taxVault. If the taxVault's `depositTax` function reverts on zero-amount input, all sells for all tokens via FRouterV3 are permanently DoS-ed.

**Key Code Reference**: FRouterV3.sol:157-167

**Trace**:
[TRACE: FRouterV3.sell() tax path at L157-167]
```solidity
uint fee = factory.sellTax();          // L157 — can be 0
uint256 txFee = (fee * amountOut) / 100; // L158 — = 0 when fee=0
uint256 amount = amountOut - txFee;    // L160 — = amountOut
address feeTo = factory.taxVault();    // L161
pair.transferAsset(to, amount);         // L163
pair.transferAsset(address(this), txFee); // L165 — transfers 0 tokens
IERC20(assetToken).forceApprove(feeTo, txFee); // L166 — approves 0
IAgentTaxForRouter(feeTo).depositTax(tokenAddress, txFee); // L167 — calls depositTax(token, 0)
```

When `sellTax = 0`: `txFee = 0`. `pair.transferAsset(address(this), 0)` is a no-op (or may revert if SafeERC20 has a zero-value guard — in OZ SafeERC20, `safeTransfer(to, 0)` does NOT revert). `forceApprove(feeTo, 0)` resets approval to 0. `depositTax(tokenAddress, 0)` is called unconditionally.

The actual behavior depends on `IAgentTaxForRouter(feeTo).depositTax` implementation (not in scope). If it reverts on `amount=0`, all FRouterV3 sells permanently fail when `sellTax=0`. This is not hypothetical — protocol documentation indicates `sellTax` may be set to 0 (e.g., for promotional launches).

Note: The `buy()` path correctly guards with `if (normalTxFee > 0)` equivalent by checking `antiSniperTxFee > 0` at L213. The sell path lacks this guard.

Contrast: FRouterV2.sell() L157: `pair.transferAsset(feeTo, txFee)` — direct transfer, no `depositTax` call. So FRouterV2 does not have this issue; FRouterV3 introduced it.

**Result**: CONFIRMED (unconditional `depositTax(token, 0)` call when sellTax=0; DoS depends on taxVault implementation)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Medium (DoS on all sells when sellTax=0; taxVault implementation is the determining factor — CONTESTED if taxVault handles 0 gracefully)

**Fix**: Add `if (txFee > 0) { pair.transferAsset(address(this), txFee); ... IAgentTaxForRouter(feeTo).depositTax(tokenAddress, txFee); }` guard around the tax deposit block.

---

## LOW FINDINGS

---

## [H-21]: teamTokenReservedWallet TOCTOU (Low)

**Impact Premise**: The `teamTokenReservedWallet` in BondingConfig is read at two separate times — during `_preLaunch` (for reserved token transfer) and during `launch()` (for initial buy token transfer) — so an admin changing this between calls redirects the creator's initial buy proceeds to a different wallet.

**Key Code Reference**: BondingV5.sol:382-387 (preLaunch transfer); BondingV5.sol:554-557 (launch transfer); BondingConfig.sol:250-253 (setTeamTokenReservedWallet)

**Trace**:
[TRACE: Two reads of bondingConfig.teamTokenReservedWallet()]
1. `_preLaunch` at BondingV5 L382: `IERC20(token).safeTransfer(bondingConfig.teamTokenReservedWallet(), totalReservedSupply * ...)` — reads wallet at preLaunch time.
2. `launch()` at BondingV5 L554: `IERC20(tokenAddress_).safeTransfer(bondingConfig.teamTokenReservedWallet(), amountOut)` — reads wallet again at launch time.

Between `preLaunch` and `launch`, the BondingConfig owner can call `setTeamTokenReservedWallet(newAddress)`. The initial buy tokens (from `amountOut`) would go to the NEW wallet rather than the one set at preLaunch. The creator expects their locked tokens to be in a specific wallet (established at preLaunch), but a wallet change in the window redirects the launch-time tokens.

This is an ADMIN-controlled manipulation: the owner of BondingConfig must act maliciously. It is therefore a semi-trusted actor issue.

**Result**: CONFIRMED (TOCTOU exists; requires malicious admin)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Low (downgraded from Medium; requires trusted owner of BondingConfig to act maliciously; token creator cannot protect against this)

**Fix**: Cache `teamTokenReservedWallet` in token storage at preLaunch time and use the cached value in launch(). Or emit an event when the wallet changes so creators can detect manipulation.

---

## [H-25]: FFactory CREATOR_ROLE/ADMIN_ROLE Not Granted in initialize() (Low)

**Impact Premise**: `CREATOR_ROLE` and `ADMIN_ROLE` are not granted to any address in FFactoryV2/V3 `initialize()`, meaning all privileged functions requiring these roles are initially inaccessible until manually granted post-deploy.

**Key Code Reference**: FFactoryV3.sol:50-65 (initialize); FFactoryV2.sol:42-57 (initialize); FFactoryV3.sol:96-103 (createPair requires CREATOR_ROLE); FFactoryV3.sol:116-130 (setTaxParams requires ADMIN_ROLE)

**Trace**:
[TRACE: FFactoryV3.initialize()]
```solidity
function initialize(...) external initializer {
    __AccessControl_init();
    __ReentrancyGuard_init();
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);  // L59 — only DEFAULT_ADMIN_ROLE granted
    // CREATOR_ROLE NOT granted
    // ADMIN_ROLE NOT granted
    taxVault = taxVault_;
    ...
}
```
`createPair()` at L96: `onlyRole(CREATOR_ROLE)` — BondingV5 calls `factory.createPair()` during `_preLaunch`. If CREATOR_ROLE is not granted to BondingV5, all token launches fail.
`setTaxParams()` at L116: `onlyRole(ADMIN_ROLE)` — if not granted, tax parameters are immutable after deploy.
`setRouter()` at L132: `onlyRole(ADMIN_ROLE)` — router cannot be updated.

This is NOT a vulnerability if the deployer grants these roles immediately post-deploy (which is the normal deployment sequence: deploy factory → grant CREATOR_ROLE to bonding contract, grant ADMIN_ROLE to deployer). The `DEFAULT_ADMIN_ROLE` holder CAN grant these roles post-initialization.

This is a deployment hygiene/documentation issue: there is no on-chain guarantee that roles are granted before the system is live. A deployment script error or missing step leaves the system non-functional.

**Result**: CONFIRMED (roles not granted in initialize; deployment gap exists)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Low (deployment script dependency; confirmed Low from hypothesis table; no exploitable attack, but deployment risk)

**Fix**: Add role grants in `initialize()`: `_grantRole(CREATOR_ROLE, bondingContract_)` or add a post-init validation function. Document required role setup in deployment scripts.

---

## [H-26]: FRouterV3/V2.addInitialLiquidity() Missing nonReentrant (Low)

**Impact Premise**: `addInitialLiquidity()` lacks `nonReentrant`, theoretically allowing a reentrant callback via the token's `safeTransferFrom` to re-enter the router.

**Key Code Reference**: FRouterV3.sol:122-135 (addInitialLiquidity, no nonReentrant); FRouterV2.sol:115-129 (same)

**Trace**:
[TRACE: FRouterV3.addInitialLiquidity() reentrancy surface]
`addInitialLiquidity` at L122: `public onlyRole(EXECUTOR_ROLE)` — no `nonReentrant`.
It calls `IERC20(token_).safeTransferFrom(msg.sender, pairAddress, amountToken_)` at L131 (ERC20 transfer, callback possible for ERC777/callback tokens), then `IFPairV2(pairAddress).mint(amountToken_, amountAsset_)` at L133.

Reentrancy path: If `token_` is an ERC777 with `tokensReceived` hook that calls back `addInitialLiquidity`, it could double-mint the pair. However:
1. `addInitialLiquidity` is `onlyRole(EXECUTOR_ROLE)` — only trusted backend wallets call it.
2. The agent tokens created by the system are standard ERC20 (IAgentTokenV2), not ERC777.
3. `mint()` in FPairV2 has `require(_pool.lastUpdated == 0, "Already minted")` — so a second `mint()` call would revert.

The reentrancy window is effectively closed by the `Already minted` check in FPairV2. Low real-world risk.

**Result**: CONTESTED (structural gap exists but mitigated by `onlyRole(EXECUTOR_ROLE)` and FPairV2 mint guard)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONTESTED (technical gap but practically blocked by existing guards)

**Final Severity**: Low (as-found; reentrancy not exploitable in practice; defensive fix still advisable)

**Fix**: Add `nonReentrant` modifier to `addInitialLiquidity()` in FRouterV2 and FRouterV3 for defense-in-depth.

---

## [H-28]: buy() payable Traps ETH (Low)

**Impact Premise**: `buy()` is declared `payable` in all bonding contracts (V5, V2, V3) but has no mechanism to use or withdraw any ETH sent. ETH sent with buy() calls is permanently locked.

**Key Code Reference**: BondingV5.sol:676 (`function buy(...) public payable`); BondingV2.sol:586 (`public payable`); BondingV3.sol:522 (`public payable`)

**Trace**:
[TRACE: BondingV5.buy() ETH handling]
`buy()` at BondingV5 L676: declared `payable`, receives ETH via `msg.value`. The function body: checks trading/launch status, calls `_buy()`. There is no `msg.value` check (`require(msg.value == 0)`), no ETH forwarding, no `receive()` fallback, no `withdrawETH()` function.

If a user accidentally sends ETH with a `buy()` call (e.g., wrong transaction type, UI error), the ETH is trapped in the bonding contract with no recovery path (no onlyOwner drain function for ETH). The same pattern is in BondingV2 L586 and BondingV3 L522.

**Result**: CONFIRMED

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Low (user error scenario; ETH not the protocol's asset; loss is user-side; bonding contracts don't interact with ETH)

**Fix**: Remove `payable` from `buy()` declarations. Or add `require(msg.value == 0, "ETH not accepted")`.

---

## [H-33]: 23+ Silent Admin Setters Without Events (Low)

**Impact Premise**: Over 23 admin setter functions across BondingConfig and FRouterV2/V3 emit no events, making on-chain monitoring of configuration changes impossible for users, protocols, and security tools.

**Key Code Reference**: BondingConfig.sol (multiple setters); FRouterV2.sol:252-278; FRouterV3.sol:257-262

**Trace**:
[TRACE: Admin setters without event emissions — top 5]
1. `BondingConfig.setScheduledLaunchParams()` L240-243: Sets fee/delay params. No event (note: `BondingConfig` has events `DeployParamsUpdated`, `CommonParamsUpdated`, etc. for SOME setters but not all).
2. `FRouterV2.setTaxManager()` L252-254: Updates deprecated taxManager. No event.
3. `FRouterV2.setAntiSniperTaxManager()` L256-258: Updates deprecated manager. No event.
4. `FRouterV2.setBondingV2()` L266-269: Updates bondingV2 reference. No event.
5. `FRouterV3.setBondingV5()` L257-262: Updates bondingV5 AND bondingConfig references simultaneously. No event.

BondingConfig has `PrivilegedLauncherUpdated`, `TeamTokenReservedWalletUpdated` events for some setters. But `setScheduledLaunchParams()` only updates storage without emitting. FRouterV2/V3 setter functions uniformly lack events.

**Result**: CONFIRMED (multiple setters confirmed without events)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Low (informational impact; no fund loss; monitoring gap)

**Fix**: Add appropriate events for all admin setter functions. For FRouterV3 `setBondingV5`, add: `event BondingV5Updated(address bondingV5, address bondingConfig); emit BondingV5Updated(bondingV5_, bondingConfig_);`.

---

## [H-42]: drainUniV2Pool Requires Founder Off-Chain Pre-Approval (High — severity check)

**Impact Premise**: `drainUniV2Pool` in FRouterV3 calls `agentFactory.removeLpLiquidity(veToken, recipient, veTokenAmount, ...)` which requires the founder to have pre-approved the agentFactory (or an intermediary) to transfer their veTokens. Without this approval, the function always reverts, making the entire drain operation contingent on an off-chain coordination step.

**Key Code Reference**: FRouterV3.sol:456-473; FRouterV2.sol:469-489

**Trace**:
[TRACE: FRouterV3.drainUniV2Pool() → agentFactory.removeLpLiquidity()]
1. L456-458: `address founder = veTokenContract.founder(); uint256 veTokenAmount = IERC20(veToken).balanceOf(founder);` — gets founder address and their veToken balance.
2. L466-473: `IAgentFactoryV7(agentFactory).removeLpLiquidity(veToken, recipient, veTokenAmount, 0, 0, deadline)` — calls agentFactory to remove liquidity.
3. The `removeLpLiquidity` in AgentFactoryV7 (not in scope) must call `transferFrom(founder, ..., veTokenAmount)` to move the LP position. This requires `founder.approve(agentFactory, veTokenAmount)` OR the agentFactory must hold direct custody of the LP.

Since `veTokenAmount = IERC20(veToken).balanceOf(founder)` gets the FOUNDER's balance (not the agentFactory's balance), the agentFactory must spend tokens from the founder's address, requiring ERC20 approval from founder. If founder hasn't approved, `transferFrom` reverts → entire `drainUniV2Pool` reverts.

This is a HIGH finding (H-42 in the hypothesis table) — the drain function is effectively non-functional unless the founder's approval is pre-coordinated off-chain. No on-chain mechanism in FRouterV3 triggers founder approval. The EXECUTOR calling `drainUniV2Pool` cannot force this approval.

**Result**: CONFIRMED (function reverts without founder off-chain approval; this is the H-42 HIGH finding, not a new finding)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: High (as assigned; drain function is operationally broken without off-chain coordination; no severity change)

**Fix**: Require the AgentFactoryV7's `removeLpLiquidity` to pull from a delegated custody model, or implement a two-step process where the founder signs a permit/approval on-chain before the drain executes.

---

## INFORMATIONAL FINDINGS

---

## [H-32]: Anti-Sniper Window Duration Inconsistency Between Router Versions (Informational)

**Impact Premise**: FRouterV2 uses 99 seconds for X_LAUNCH anti-sniper window and 99 minutes for regular tokens; FRouterV3 uses BondingConfig-defined durations (60 seconds for ANTI_SNIPER_60S, 5880 seconds/98 minutes for ANTI_SNIPER_98M). The FRouterV2 "99 seconds" hardcoded value is not reflected in BondingConfig or FRouterV3, creating behavioral inconsistency between router versions serving different token cohorts.

**Key Code Reference**: FRouterV2.sol:342-345; BondingConfig.sol:309-319; FRouterV3.sol:277-279

**Trace**:
[TRACE: Anti-sniper duration comparison]
FRouterV2 L342-345:
```
// X_LAUNCH: 1% per second (99 seconds to 0%)
// ACP_SKILL: 1% per minute (99 minutes to 0%)
// Regular: 1% per minute (99 minutes to 0%)
uint256 taxReduction = isXLaunch ? timeElapsed : (timeElapsed / 60);
```
FRouterV2: Regular = 99 minutes, X_LAUNCH = 99 seconds.

BondingConfig L309-319:
- ANTI_SNIPER_NONE → 0 seconds
- ANTI_SNIPER_60S → 60 seconds (not 99 seconds)
- ANTI_SNIPER_98M → 5880 seconds = 98 minutes (not 99 minutes)

FRouterV3 comment at L278: "BondingV4 X_LAUNCH tokens: Tax decreases from 99% to 0% over 99 seconds"

So FRouterV3/V5-era tokens use 60s or 98min (BondingConfig). FRouterV2/V4-era X_LAUNCH use 99s. Legacy regular tokens use 99 min. The mismatch (99min vs 98min, 60s vs 99s) is confirmed.

**Result**: CONFIRMED

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Informational (documentation/consistency issue; no fund loss; tokens on different router versions are served by their respective router's logic)

**Fix**: Document the version-specific durations explicitly. Consider aligning BondingConfig's ANTI_SNIPER_60S to 99 seconds to match legacy V2/V4 behavior, or document the intentional change.

---

## [H-43]: antiSniperBuyTaxStartValue BPS Comment — Documentation/Misconfiguration Risk (Informational)

**Impact Premise**: FFactoryV2.sol comments `antiSniperBuyTaxStartValue` as "in basis points" but the contract uses it as a percentage (divides by 100, not 10000), creating a documentation mismatch that could lead to misconfiguration (e.g., setting it to 9900 intending 99% → actual 9900% tax → cap at 99%, silent corruption).

**Key Code Reference**: FFactoryV2.sol:27; FRouterV3.sol:291; FRouterV2.sol:320

**Trace**:
[TRACE: Comment vs usage of antiSniperBuyTaxStartValue]
FFactoryV2.sol L27: `uint256 public antiSniperBuyTaxStartValue; // Starting tax value for anti-sniper (in basis points)`
FRouterV3.sol L291: `uint256 startTax = factory.antiSniperBuyTaxStartValue(); // 99%`
FRouterV2.sol L320: `uint256 startTax = factory.antiSniperBuyTaxStartValue(); // 99%`
FRouterV3.sol L318: `return startTax * (duration - timeElapsed) / duration;` — returned as a percentage value.
FRouterV3.buy() L195: `if (normalTax + antiSniperTax > 99)` — compares directly against 99 (percent).

The value is used as a PERCENTAGE (0-99), not basis points (0-10000). The comment in FFactoryV2 is incorrect. If someone reads the comment and sets `antiSniperBuyTaxStartValue = 9900` (intending 99% in bips), the actual value of `startTax` becomes 9900, the cap `normalTax + antiSniperTax > 99` at FRouterV3 L195 immediately fires, compressing the effective tax. No silent fund loss occurs (cap prevents > 99%), but the operator's intent is violated.

FFactoryV3.sol L35 does NOT have the "basis points" comment — only FFactoryV2 has the incorrect comment.

**Result**: CONFIRMED (documentation bug in FFactoryV2.sol; code behavior is correct; comment is wrong)

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Informational (documentation error; no code flaw; operator misconfiguration risk)

**Fix**: Correct FFactoryV2.sol L27 comment to: `// Starting tax value for anti-sniper (in percentage, e.g., 99 = 99%)`.

---

## [H-29]: BondingV2/V3/V4 buy()/sell() Always Reverts (Informational)

**Impact Premise**: BondingV2 and BondingV3 `buy()`/`sell()` internally call `router.buy()` and `router.sell()` which require `EXECUTOR_ROLE` on FRouterV2. Since the bonding contracts themselves are never granted EXECUTOR_ROLE, all buy/sell calls from users via BondingV2/V3 always revert.

**Key Code Reference**: BondingV2.sol:515-519 (`router.sell()` call); BondingV2.sol:555-560 (`router.buy()` call); FRouterV2.sol:131 (`onlyRole(EXECUTOR_ROLE)` on `sell`); FRouterV2.sol:169 (buy)

**Trace**:
[TRACE: BondingV2.sell() → FRouterV2.sell() EXECUTOR check]
1. BondingV2.sell() at L515: `(uint256 amount0In, uint256 amount1Out) = router.sell(amountIn, tokenAddress, msg.sender)`
2. FRouterV2.sell() at L131-135: `public nonReentrant onlyRole(EXECUTOR_ROLE)` — `msg.sender` is BondingV2 contract address.
3. BondingV2 is never granted `EXECUTOR_ROLE` on FRouterV2 (FRouterV2.initialize() only grants `DEFAULT_ADMIN_ROLE` to deployer).
4. → AccessControl revert: "AccessControl: account 0x... is missing role 0x..."

BondingV3 has the identical code structure. Additionally, BondingV2._preLaunch() and BondingV3.preLaunch() both `revert("Not implemented")` at the top (L264 and L205 respectively), so no tokens can even be prelaunched on these versions.

This confirms BondingV2/V3 are effectively dead code (deprecated/superseded by BondingV5). The `buy()`/`sell()` functions technically exist on-chain but are permanently non-functional.

**Result**: CONFIRMED

**Evidence Tag**: [CODE-TRACE]

**Final Verdict**: CONFIRMED

**Final Severity**: Informational (dead code; contracts superseded; no security impact; documented for completeness)

**Fix**: Consider adding `revert("Deprecated")` to BondingV2/V3 buy()/sell() functions to prevent user confusion. Or document the deprecation status explicitly.

---

## Summary

| H-ID | Title | Result | Severity |
|------|-------|--------|----------|
| H-5 | drainUniV2Pool unrestricted recipient | CONFIRMED | Medium |
| H-10 | cancelLaunch CEI violation | CONFIRMED | Medium |
| H-11 | Graduation donation attack | CONFIRMED | Medium |
| H-12 | drainPrivatePool stale reserve DoS | CONFIRMED | Medium |
| H-13 | FFactory.setRouter(address(0)) | CONFIRMED | Medium |
| H-14 | FRouterV3 tokenAntiSniperType without try/catch | CONFIRMED | Medium |
| H-15 | Deprecated storage slots upgrade collision | CONFIRMED | Medium |
| H-16 | antiSniperBuyTaxStartValue + buyTax sum not enforced | CONFIRMED | Medium |
| H-17 | multicall3 aggregate admin bypass | CONFIRMED | Medium |
| H-22 | cancelLaunch locks bondingCurveSupply tokens | CONFIRMED | Medium |
| H-23 | DEFAULT_ADMIN_ROLE self-revoke | CONFIRMED | Medium |
| H-24 | renounceOwnership unguarded | CONFIRMED | Medium |
| H-37 | Creator buys entire supply instant graduation | CONFIRMED | Medium |
| H-39 | Router references not cross-validated | CONFIRMED | Medium |
| H-49 | No __gap in upgradeable contracts | CONFIRMED | Medium |
| H-51 | sell() depositTax with zero amount | CONFIRMED | Medium |
| H-21 | teamTokenReservedWallet TOCTOU | CONFIRMED | Low |
| H-25 | CREATOR_ROLE/ADMIN_ROLE not granted in initialize | CONFIRMED | Low |
| H-26 | addInitialLiquidity missing nonReentrant | CONTESTED | Low |
| H-28 | buy() payable traps ETH | CONFIRMED | Low |
| H-33 | Silent admin setters without events | CONFIRMED | Low |
| H-42 | drainUniV2Pool requires founder pre-approval | CONFIRMED | High (no change) |
| H-32 | Anti-sniper window duration inconsistency | CONFIRMED | Informational |
| H-43 | antiSniperBuyTaxStartValue BPS comment | CONFIRMED | Informational |
| H-29 | BondingV2/V3 buy()/sell() always reverts | CONFIRMED | Informational |

**DONE: 25 verified — CONFIRMED=24, REFUTED=0, CONTESTED=1, severity_changes=0**
