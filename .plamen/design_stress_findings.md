# Design Stress Testing Findings

**Agent:** Design Stress Testing Agent
**Date:** 2026-04-02
**Phase:** Phase 4b — Design Stress Testing (unconditional slot)

---

## Finding [DST-1]: Creator's initialPurchase Has No Cap — Creator Can Capture Near-100% of Bonding Supply Before Public

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3
**Rules Applied**: [R10:✓, R13:✓, R5:✗(single actor path), R8:✗(single-step), R4:✓]
**Depth Evidence**: [BOUNDARY:initialPurchase=bondingCurveSupply_VIRTUAL_equivalent → graduation triggered during launch()], [TRACE:purchaseAmount_-launchFee=initialPurchase→_buy(isInitialPurchase=true)→amountOut→graduation check]
**Severity**: Medium
**Location**: BondingV5.sol:307-313, BondingV5.sol:540-551, FRouterV3.sol:189-196
**Description**: The `preLaunch()` parameter `purchaseAmount_` has no on-chain upper bound beyond `purchaseAmount_ >= launchFee`. The creator can pass an arbitrarily large `purchaseAmount_`, setting `initialPurchase = purchaseAmount_ - launchFee` to any value. When `launch()` executes the creator's buy via `_buy(..., isInitialPurchase=true)`, the initial purchase is exempt from the anti-sniper tax (FRouterV3.sol:189-190: `isInitialPurchase` path skips `_calculateAntiSniperTax`). If the initialPurchase is large enough to reduce `newReserveA <= gradThreshold` (BondingV5.sol:664-665), graduation is triggered atomically inside `launch()`, before any public buyer can trade. A creator who pays enough VIRTUAL can graduate the token without any public participation, receiving all the reserved tokens plus a price-efficient position at the bottom of the bonding curve.

**Impact**:
- Creator sets `purchaseAmount_` large enough to trigger graduation inside `launch()`. No public buyer ever participates in the bonding curve.
- All bonding curve supply (after the initial buy) transfers to Uniswap at graduation, setting the Uniswap price based entirely on the creator's purchase.
- The graduated token has deep creator positioning with zero price competition.
- Users who attempt to buy post-launch on the bonding curve see it already graduated to Uniswap; they must buy at Uniswap prices influenced entirely by creator's bootstrapping.
- Pattern violates the "fairness" assumption that the bonding curve serves as a price discovery mechanism for all participants.

**Evidence**:
```solidity
// BondingV5.sol:307-313
if (purchaseAmount_ < launchFee) {
    revert InvalidInput();
}
// ...
uint256 initialPurchase = (purchaseAmount_ - launchFee); // NO UPPER BOUND

// BondingV5.sol:540-551 (launch())
if (initialPurchase > 0) {
    amountOut = _buy(
        address(this),
        initialPurchase,
        tokenAddress_,
        0,
        block.timestamp + 300,
        true // isInitialPurchase = true — anti-sniper tax skipped
    );
}

// BondingV5.sol:664-669 (inside _buy)
if (
    newReserveA <= gradThreshold &&
    !router.hasAntiSniperTax(pairAddress) &&
    tokenInfo[tokenAddress_].trading
) {
    _openTradingOnUniswap(tokenAddress_); // Graduation triggered during launch()
}
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: Token graduates inside `launch()`, all bonding curve VIRTUAL goes to AgentFactory, tokens sent to Uniswap. Creator holds the full initial buy tokens via `teamTokenReservedWallet`.
**Postcondition Types**: STATE, BALANCE
**Who Benefits**: Token creator (earliest-price position with zero competition)

---

## Finding [DST-2]: antiSniperBuyTaxStartValue + buyTax Sum Not Enforced — Values > 99 Silently Corrupt the Anti-Sniper Cap Logic

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3
**Rules Applied**: [R14:✓, R10:✓, R4:✓, R13:✗(not design-related)]
**Depth Evidence**: [BOUNDARY:antiSniperBuyTaxStartValue=100, buyTax=5 → antiSniperTax=100, cap check: 100+5>99 → antiSniperTax=99-5=94, effective combined=99, OK], [BOUNDARY:antiSniperBuyTaxStartValue=100, buyTax=100 → underflow revert in cap check at normalTax+antiSniperTax>99 branch (EC-1 path)], [TRACE:antiSniperBuyTaxStartValue=200, buyTax=2 → cap normalizes to 99-2=97% anti-sniper, correct but startValue semantics corrupted]
**Severity**: Medium
**Location**: FFactoryV2.sol:108-122, FFactoryV3.sol:116-130, FRouterV2.sol:190-191, FRouterV3.sol:195-196
**Description**: `antiSniperBuyTaxStartValue` and `buyTax` are independently settable in `FFactory.setTaxParams()` with no on-chain constraint that `antiSniperBuyTaxStartValue <= 99 - buyTax`. The cap logic in the router is `if (normalTax + antiSniperTax > 99) { antiSniperTax = 99 - normalTax; }` (FRouterV3.sol:195-196). This means if `antiSniperBuyTaxStartValue` is set above `99 - buyTax`, the anti-sniper tax is silently reduced on every transaction to `99 - buyTax`, effectively rendering the anti-sniper mechanism weaker than configured without any revert or event indicating the desync. The gap is a constraint coherence failure: neither setter validates against the other, and the silently-capped anti-sniper tax creates an undocumented departure from the stated `antiSniperBuyTaxStartValue`.

[BOUNDARY:antiSniperBuyTaxStartValue=99, buyTax=5 → every single buy during the first second is capped at 99-5=94% instead of 99%, giving snipers a 5% discount never announced on-chain]

**Impact**:
- Anti-sniper protection is silently weaker than the configured `antiSniperBuyTaxStartValue` whenever `buyTax > 0`.
- With the typical production value (`antiSniperBuyTaxStartValue=99`, `buyTax=1`), the real peak anti-sniper tax is 98%, not 99%.
- ADMIN can set `antiSniperBuyTaxStartValue` to any value (no cap), and the router silently ignores the excess rather than reverting, providing false security transparency.
- Monitoring systems reading `antiSniperBuyTaxStartValue` from storage believe snipers pay `antiSniperBuyTaxStartValue%` when they actually pay less.

**Evidence**:
```solidity
// FFactoryV2.sol:108-122 — no validation of antiSniperBuyTaxStartValue + buyTax <= 99
function setTaxParams(
    address newVault_, uint256 buyTax_, uint256 sellTax_,
    uint256 antiSniperBuyTaxStartValue_, address antiSniperTaxVault_
) public onlyRole(ADMIN_ROLE) {
    // No require: antiSniperBuyTaxStartValue_ + buyTax_ <= 99
    buyTax = buyTax_;
    antiSniperBuyTaxStartValue = antiSniperBuyTaxStartValue_;
}

// FRouterV3.sol:195-196 — silent cap
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax; // silently discards configured excess
}
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: Anti-sniper buyers pay less than `antiSniperBuyTaxStartValue%` during peak sniper window.
**Postcondition Types**: BALANCE, STATE
**Who Benefits**: First-block buyers who are effectively paying a lower anti-sniper tax than intended

---

## Finding [DST-3]: cancelLaunch() Permanently Locks All bondingCurveSupply Tokens — No Recovery Path Exists

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3
**Rules Applied**: [R13:✓, R10:✓, R5:✗(single actor), R12:✗(no dangerous state enablers)]
**Depth Evidence**: [TRACE:cancelLaunch()→trading=false, launchExecuted=true → no sell path, no router path, no recovery function exists → tokens in FPairV2 are permanently trapped], [BOUNDARY:bondingCurveSupply=1B*0.45=450M tokens → 450M tokens permanently irrecoverable]
**Severity**: Medium
**Location**: BondingV5.sol:462-497, FPairV2.sol (no recovery function)
**Description**: `cancelLaunch()` refunds `initialPurchase` VIRTUAL to the creator but does NOT drain the FPairV2 of its `bondingCurveSupply` tokens. After cancellation, the state machine is: `trading=false`, `launchExecuted=true`, preventing all future `launch()`, `buy()`, and `sell()` calls. The pair contract has no general drain function accessible without EXECUTOR_ROLE; `drainPrivatePool()` (FRouterV3.sol:367-410) is gated on `bondingV5.isProject60days(tokenAddress)` — a flag set at preLaunch and not applicable to cancelled standard tokens. `graduate()` in the router can drain the pair but sends funds to `msg.sender` (EXECUTOR_ROLE), not back to the creator or a legitimate recovery wallet. There is no on-chain path for the creator or protocol to retrieve the cancelled token's bonding curve supply. The design intent acknowledges this (design_context.md: "the pair remains with tokens locked in it permanently if cancelled") but provides no mitigation.

[TRACE:FPairV2.balance()>0 after cancel → no accessible function returns these to creator → permanent lock]

**Impact**:
- For every cancelled token: `bondingCurveSupply = initialSupply * (10000 - totalReservedBips) / 10000` tokens (typically ~450M–1B tokens) are permanently locked in the FPairV2 pair contract.
- The tokens are not burned, not distributed, not recoverable; they inflate the total supply while being inaccessible.
- If the creator intended to relaunch with the same token, they cannot; the token address is also permanently associated with a dead pair.
- Scale: with thousands of launches on the protocol, cancelled tokens accumulate stranded supply that suppresses token value for the creator and any airdrop recipients who received reserved tokens.
- Users who received airdrop tokens from the `teamTokenReservedWallet` hold tokens whose circulating supply is permanently diluted by the locked bonding curve allocation.

**Evidence**:
```solidity
// BondingV5.sol:486-489 — state after cancel
tokenRef.initialPurchase = 0;
tokenRef.trading = false;   // blocks buy/sell
tokenRef.launchExecuted = true; // blocks future launch()
// No: drain of pair, no: token burn, no: recovery mechanism
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: FPairV2 holds stranded bondingCurveSupply forever. Token is non-tradeable on bonding curve.
**Postcondition Types**: STATE, BALANCE
**Who Benefits**: None — this is a value destruction event

---

## Finding [DST-4]: Global bondingCurveParams Change Makes Existing Per-Token gradThresholds Unreachable Without Contract Intervention

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3
**Rules Applied**: [R14:✓, R8:✓, R10:✓, R4:✓]
**Depth Evidence**: [BOUNDARY:targetRealVirtual increased from 42000e18 to 84000e18 post-preLaunch → tokenGradThreshold[token] unchanged (stored at preLaunch), but K constant K=reserve0*reserve1 is also fixed at mint — new users must buy 2x more VIRTUAL to graduate, but the stored threshold still reflects old math], [TRACE:_buy()→newReserveA<=tokenGradThreshold[tokenAddress_]→graduation check uses OLD stored threshold, which is correct → graduation still works at old threshold], [VARIATION:fakeInitialVirtualLiq changed from 6300e18 to 12600e18 → old stored gradThreshold = 6300e18*bondingCurveSupply/(42000e18+6300e18) is unaffected, but new tokens get different threshold → price curve desync between cohorts]
**Severity**: Low
**Location**: BondingConfig.sol:178-183 (setBondingCurveParams), BondingV5.sol:390-393 (tokenGradThreshold storage), BondingV5.sol:662-670 (_buy graduation check)
**Description**: `BondingConfig.setBondingCurveParams()` can change `fakeInitialVirtualLiq` and `targetRealVirtual` at any time. However, `tokenGradThreshold[token]` is calculated and stored immutably at preLaunch. This means tokens launched before a parameter change use a different graduation threshold than tokens launched after the change. This is correct individual behavior but creates a two-tier system: tokens from different cohorts graduate at fundamentally different reserve levels with no visible distinction on-chain. More critically, if `fakeInitialVirtualLiq` (the "fake" reserve seeding the AMM) changes, the K constant (`K = reserve0 * reserve1`) for new pairs will differ, but old pairs keep their original K. A user's ability to push an old pair to graduation is determined by the old K, while a new pair of the same supply requires a different VIRTUAL contribution. This desyncs user expectations when the protocol publishes a single "graduation target" but operates two different regimes simultaneously.

[BOUNDARY:fakeInitialVirtualLiq=6300e18 (old) → gradThreshold = 6300e18 * 450M / 48300e18 ≈ 58.7M tokens; fakeInitialVirtualLiq=12600e18 (new) → gradThreshold = 12600e18 * 450M / 54600e18 ≈ 103.8M tokens — 77% higher threshold, meaning new tokens are 77% harder to graduate than old tokens]

**Impact**:
- Two simultaneously active token cohorts with different graduation requirements are indistinguishable to users looking at the frontend.
- Users who track the "amount needed to graduate" using the current BondingConfig parameters will get incorrect estimates for older tokens.
- Protocol documentation that quotes graduation targets becomes stale whenever parameters change, without any on-chain tracking of which cohort a token belongs to.
- No economic harm unless admin uses this to deliberately make specific tokens harder to graduate (requires semi-trusted actor).

**Evidence**:
```solidity
// BondingConfig.sol:178-183 — unbounded change to curve params
function setBondingCurveParams(BondingCurveParams memory params_) external onlyOwner {
    bondingCurveParams = params_; // immediate global change, no per-token invalidation
    emit BondingCurveParamsUpdated(params_);
}

// BondingV5.sol:390-393 — graduation threshold frozen at preLaunch
uint256 gradThreshold = bondingConfig.calculateGradThreshold(bondingCurveSupply);
tokenGradThreshold[token] = gradThreshold; // stored once, never updated
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: Permanent two-tier graduation system after any bondingCurveParams change
**Postcondition Types**: STATE
**Who Benefits**: Protocol owner (can make specific cohorts easier/harder to graduate)

---

## Finding [DST-5]: FRouterV3 and FRouterV2 bondingV5/bondingV4 References Are Not Cross-Validated — Mismatched Router Configurations Break All BondingV5 Token Operations

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3
**Rules Applied**: [R14:✓, R4:✓, R8:✓, R10:✓]
**Depth Evidence**: [TRACE:FRouterV3.setBondingV5(wrongAddress, correctBondingConfig)→_calculateAntiSniperTax()→bondingV5.tokenAntiSniperType(token)→wrong contract→revert→all buys for BondingV5 tokens revert], [BOUNDARY:bondingV5=address(0) checked in drainPrivatePool but NOT in _calculateAntiSniperTax→unchecked dereference→revert on every non-isInitialPurchase buy]]
**Severity**: Medium
**Location**: FRouterV3.sol:257-262 (setBondingV5), FRouterV3.sol:283-295 (_calculateAntiSniperTax), BondingV5.sol:857-859 (setBondingConfig)
**Description**: FRouterV3 stores two independent references that must be compatible: `bondingV5` (IBondingV5ForRouter) and `bondingConfig` (IBondingConfigForRouter), set via `setBondingV5(bondingV5_, bondingConfig_)`. BondingV5 stores its own `bondingConfig` reference updated via `setBondingConfig(bondingConfig_)`. These are four independently-updatable pointers. If any one is updated without updating the others, the system enters an inconsistent state.

Critical path: `_calculateAntiSniperTax()` calls `bondingV5.tokenAntiSniperType(tokenAddress)` (line 293) and `bondingConfig.getAntiSniperDuration(antiSniperType)` (line 295). If the router's `bondingConfig` reference is updated but the router's `bondingV5` reference is not, calls will mix anti-sniper type (from old bondingV5) with duration (from new bondingConfig), silently computing incorrect tax durations. There is no on-chain validation that `router.bondingV5.bondingConfig == router.bondingConfig`.

[TRACE:BondingV5.setBondingConfig(newConfig)→FRouterV3.bondingConfig unchanged→_calculateAntiSniperTax mixes types from new BondingV5 with durations from old FRouterV3.bondingConfig→wrong anti-sniper window for all new tokens]

**Impact**:
- A routine upgrade (updating BondingConfig or deploying a new BondingV5) that doesn't atomically update all router references creates a window where anti-sniper tax durations are computed against wrong parameters.
- If `FFactoryV3.setRouter()` is called to a new router that doesn't have `setBondingV5()` called yet, all buys during the anti-sniper window will revert, creating a DoS on the new router for BondingV5 tokens.
- There is no on-chain atomic update primitive — the protocol must manually coordinate three separate admin calls without any validation of consistency.

**Evidence**:
```solidity
// FRouterV3.sol:257-262 — independent setters for the pair
function setBondingV5(address bondingV5_, address bondingConfig_) public onlyRole(ADMIN_ROLE) {
    bondingV5 = IBondingV5ForRouter(bondingV5_);
    bondingConfig = IBondingConfigForRouter(bondingConfig_); // router's own copy
}

// BondingV5.sol:857-859 — separate setter, no router notification
function setBondingConfig(address bondingConfig_) public onlyOwner {
    bondingConfig = BondingConfig(bondingConfig_); // BondingV5's copy
}
// No on-chain assertion: router.bondingConfig == bonding.bondingConfig
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: Router uses mismatched contract references; anti-sniper tax calculations use wrong parameters.
**Postcondition Types**: STATE, EXTERNAL
**Who Benefits**: Snipers (if misconfiguration causes shorter anti-sniper window than intended)

---

## Finding [DST-6]: K Overflow Risk at Scale — Realistic High-Supply Tokens Approach uint256 Limit in Bonding Pair

**Verdict**: PARTIAL
**Step Execution**: ✓1,2,3
**Rules Applied**: [R10:✓, R5:✗(single pair), R14:✗(K is read-only after mint), R4:✓]
**Depth Evidence**: [BOUNDARY:reserve0=1_000_000_000e18 (1B tokens, 18 decimals), reserve1=6300e18 (fake liquidity) → K=reserve0*reserve1=1e27*6.3e21=6.3e48 → within uint256 max (~1.16e77, safe)], [BOUNDARY:reserve0=1e27, reserve1=1e27 → K=1e54, still safe], [BOUNDARY:reserve0=type(uint256).max/2, reserve1=3 → K overflows — not reachable with protocol params]
**Severity**: Informational
**Location**: FPairV2.sol:77 (K = reserve0 * reserve1)
**Description**: The K constant `k = reserve0 * reserve1` computed at mint time in FPairV2 is stored as uint256. With the current protocol parameters — `initialSupply = 1B tokens (1e27 in wei)` and `fakeInitialVirtualLiq = 6300e18` — the K value at mint is approximately `bondingCurveSupply_wei * 6300e18`. For the maximum bondingCurveSupply (no reserves), this is `1e27 * 6.3e21 ≈ 6.3e48`, safely within uint256 (max ~1.16e77). However, if `BondingConfig.setBondingCurveParams()` is called to dramatically increase both `initialSupply` and `fakeInitialVirtualLiq`, K could theoretically overflow. The finding EC-5 in the inventory correctly identifies this; this DST confirms the realistic parameter space does not cause overflow under current configured values.

**Impact**: No overflow under current production parameters. Admin would need to set both `initialSupply` and `fakeInitialVirtualLiq` to values over ~1e38 each before overflow occurs. This is not a realistic configuration.

**Evidence**:
```solidity
// FPairV2.sol:77
k: reserve0 * reserve1, // uint256 multiplication, no SafeMath needed in 0.8.x (reverts on overflow)
// With reserve0=bondingCurveSupply_wei ≈ 9e26, reserve1=6300e18 ≈ 6.3e21
// K ≈ 5.67e48 — safely within uint256 range
```

### Precondition Analysis (PARTIAL)
**Missing Precondition**: Admin would need to set initialSupply * fakeInitialVirtualLiq > ~1.16e77 (uint256.max)
**Precondition Type**: STATE
**Why This Blocks**: Current production parameters keep K ≈ 5.67e48, ~29 orders of magnitude below overflow threshold

---

## Finding [DST-7]: Multicall3 Batch Functions Have No Array Length Cap — DoS via Gas Exhaustion on Batch Operations

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3
**Rules Applied**: [R10:✓, R5:✗(single contract), R14:✗(no paired limits), R4:✗(evidence clear)]
**Depth Evidence**: [BOUNDARY:batchTransferTokens(tokens=[10000 entries])→unbounded loop→gas exhaustion→revert, EXECUTOR has no upper bound], [TRACE:aggregate(calls=[5000 entries])→each call.target.call(callData) uses variable gas→could exhaust block gas limit→transaction reverts, any in-flight state is reverted but all gas consumed]
**Severity**: Low
**Location**: multicall3.sol:446-460 (batchTransferTokens), multicall3.sol:494-508 (batchWithdrawERC20Tokens), multicall3.sol:90-111 (aggregate), multicall3.sol:118-137 (tryAggregate)
**Description**: All four batch iteration functions in Multicall3 (`aggregate`, `tryAggregate`, `batchTransferTokens`, `batchWithdrawERC20Tokens`) iterate over caller-provided arrays with no maximum length check. While access is gated to `onlyOwnerOrAdmin`, an admin who mistakenly (or maliciously) submits a batch with thousands of entries will exhaust block gas, causing the transaction to revert with all gas consumed. There is no input validation that enforces a safe upper bound (e.g., 100 calls per batch). The aggregate functions also lack a guard against calls to the Multicall3 contract itself (reentrancy path), though the gas exhaustion issue is the primary design limit concern.

[BOUNDARY:batchTransferTokens with 5000 tokens → each iteration calls transferToken which calls SafeERC20.safeTransfer (~50k gas each) → 250M gas total → exceeds Base/Ethereum block gas limit (~30M) → revert, admin funds remain safe but operational efficiency is zero]

**Impact**:
- Admin batch operations with large arrays silently revert at gas limit, leaving the operation incomplete with no partial-success indicator.
- `aggregate()` uses `require(success, ...)` on failure, so a single failed sub-call in a large batch reverts the entire batch — the owner has no atomic "all-or-nothing with rollback" semantic while also having no partial-success recovery.
- No permanent fund loss — access controls prevent external exploitation. Risk is operational: failed batch operations that the admin assumes succeeded.

**Evidence**:
```solidity
// multicall3.sol:457-459 — no length check
for (uint256 i = 0; i < tokens.length; i++) { // unbounded
    transferToken(tokens[i], recipients[i], amounts[i]);
}

// multicall3.sol:102-110 — no length check
for (uint256 i = 0; i < length; ) {
    (success, returnData[i]) = call.target.call(call.callData); // unbounded calls
    require(success, "Multicall3: call failed");
    unchecked { ++i; }
}
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: Gas exhaustion reverts batch transaction silently; admin may assume operation succeeded.
**Postcondition Types**: EXTERNAL
**Who Benefits**: N/A — operational DoS only

---

## Finding [DST-8]: Graduation Cannot Be Manually Recovered After EP-8 DoS — No Admin Rescue Path for Stuck Pools

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3
**Rules Applied**: [R13:✓, R10:✓, R12:✓, R4:✓]
**Depth Evidence**: [TRACE:buy()→graduation condition met→_openTradingOnUniswap()→agentFactory.executeBondingCurveApplicationSalt() reverts→buy() reverts→graduation not recorded→trading=true, tradingOnUniswap=false→token stuck in bonding curve permanently], [BOUNDARY:all subsequent buy() calls →_openTradingOnUniswap()→revert→all buys permanently DoS'd unless graduation condition is un-met (impossible once newReserveA <= gradThreshold)]]
**Severity**: High (design amplification of EP-8)
**Location**: BondingV5.sol:703-772 (_openTradingOnUniswap), BondingV5.sol:664-670 (_buy), FRouterV3.sol:230-239 (graduate)
**Description**: As documented by EP-8, if any step in `_openTradingOnUniswap()` reverts (AgentFactory call failure, balance mismatch, role issue), the pair remains permanently stuck: `trading=true`, `launchExecuted=true`, `tradingOnUniswap=false`, and `newReserveA <= gradThreshold`. Every subsequent `buy()` call will re-trigger `_openTradingOnUniswap()` and revert again.

The critical design stress finding is: **there is no administrative rescue path**. `FRouterV3.graduate()` (EXECUTOR_ROLE) drains the pair but does NOT call `_openTradingOnUniswap()` — it only sends funds to `msg.sender`. After manual `graduate()`, the token state remains `trading=true, tradingOnUniswap=false` with empty reserves; all buys still revert because `newReserveA (= 0) <= gradThreshold` triggers graduation again, which again fails. Admin would need to:
1. Drain the pair manually via `graduate()` — this works
2. Update token state (`trading=false`) — impossible without a dedicated admin setter that does not exist in BondingV5
3. The only way to clear `trading` is `_openTradingOnUniswap()` (private, auto-triggered) or `cancelLaunch()` (requires `launchExecuted=false` — already true, blocked)

[TRACE:EP-8 DoS occurs → EXECUTOR calls graduate() → pair drained → buy() still reverts (trading=true, reserve0=0 <= gradThreshold) → no on-chain state reset available → permanent DoS]

**Impact**:
- Tokens that enter graduation DoS are permanently non-tradeable on the bonding curve AND cannot graduate to Uniswap.
- Users holding agent tokens bought before the DoS cannot sell (requires `trading=true` to work, which it is, but buys cause graduation revert, and sells also check `trading`).
- Wait — sells do NOT trigger graduation, so sells remain possible. But buys are permanently DoS'd.
- Users cannot increase their position. Token liquidity is trapped in the frozen pair with no on-chain recovery path short of a protocol contract upgrade.
- VIRTUAL contributed by users before the graduation-triggering buy is already in the pair; after manual `graduate()` drains it, recovery requires off-chain coordination and trust in the `msg.sender` EXECUTOR to redistribute.

**Evidence**:
```solidity
// BondingV5.sol:664-670 — graduation re-triggered on every buy after DoS
if (
    newReserveA <= gradThreshold && // 0 <= gradThreshold: always true after drain
    !router.hasAntiSniperTax(pairAddress) &&
    tokenInfo[tokenAddress_].trading // still true, no setter exists
) {
    _openTradingOnUniswap(tokenAddress_); // reverts → buy() reverts
}

// No function exists to set tokenInfo[tokenAddress_].trading = false
// without going through cancelLaunch() (requires launchExecuted=false → blocked)
// or _openTradingOnUniswap() (the reverted function itself)
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: All future buys permanently DoS'd for affected token. Sells still work but buyers cannot enter.
**Postcondition Types**: STATE, TIMING
**Who Benefits**: Sellers who can exit while buyers cannot enter (asymmetric exit)

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|-----------|----------|---------------------|---------|----------|-------------------|-------------------|
| DST-1 | BondingV5.sol:307-313, 540-551 | No upper bound on initialPurchase allows creator to trigger graduation during launch() atomically | CONFIRMED | Medium | ACCESS | STATE, BALANCE |
| DST-2 | FFactoryV2.sol:108-122, FRouterV3.sol:195-196 | antiSniperBuyTaxStartValue + buyTax not validated to stay ≤ 99; silently caps anti-sniper below configured value | CONFIRMED | Medium | STATE | BALANCE |
| DST-3 | BondingV5.sol:462-497, FPairV2.sol | cancelLaunch() refunds VIRTUAL but leaves bondingCurveSupply permanently locked in FPairV2 with no recovery path | CONFIRMED | Medium | STATE | STATE, BALANCE |
| DST-4 | BondingConfig.sol:178-183, BondingV5.sol:390-393 | Global bondingCurveParams change creates two-tier graduation system; per-token stored thresholds unaffected but user expectations diverge | CONFIRMED | Low | STATE | STATE |
| DST-5 | FRouterV3.sol:257-262, BondingV5.sol:857-859 | Four independently-updatable contract references (bondingV5/bondingConfig in router + BondingV5) have no cross-validation, enabling silent anti-sniper misconfiguration | CONFIRMED | Medium | STATE | STATE, EXTERNAL |
| DST-6 | FPairV2.sol:77 | K overflow requires initialSupply * fakeInitialVirtualLiq > uint256.max; not reachable under current production parameters | PARTIAL | Informational | STATE | N/A |
| DST-7 | multicall3.sol:446-460, 90-111 | Batch iteration functions have no array length cap; large batches exhaust gas and revert silently | CONFIRMED | Low | ACCESS | EXTERNAL |
| DST-8 | BondingV5.sol:703-772, 664-670 | No administrative rescue path for graduation DoS; manual graduate() drains pair but leaves trading=true, causing every subsequent buy to re-trigger the failed graduation | CONFIRMED | High | STATE | STATE, TIMING |
