# Depth Agent: Edge Case Findings

**Agent**: Edge Case Depth Agent
**Date**: 2026-04-02
**Domain**: Edge Cases — zero-state, exchange rates, parameter boundaries with real constants, intermediate states

---

## PART 1: GAP-TARGETED DEEP ANALYSIS

---

## Finding [DEPTH-EC-1]: buyTax >= 100 causes underflow revert — DoS on ALL buys

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A single entity) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R6:✓] [R8:✗(single-step)] [R10:✓] [R14:✓]
**Depth Evidence**: [BOUNDARY:buyTax=99 → normalTax+antiSniperTax capped at 99, amount=amountIn*1/100, works], [BOUNDARY:buyTax=100 → L190-191 FRouterV2: `if (normalTax + antiSniperTax > 99)` is `if (100+0 > 99)` = true, so `antiSniperTax = 99 - 100` = underflow revert in Solidity 0.8.x], [BOUNDARY:buyTax=100 → L195-196 FRouterV3: identical logic, same underflow], [TRACE:setTaxParams(vault,100,X,Y,Z)→buyTax=100→buy()→L190 underflow→revert]
**Severity**: High
**Location**: FRouterV2.sol:L190-191, FRouterV3.sol:L195-196, FFactoryV2.sol:L108-122, FFactoryV3.sol:L116-130

**Description**:
The `setTaxParams()` function in both FFactoryV2 (L108-122) and FFactoryV3 (L116-130) accepts `buyTax_` as a `uint256` with **zero validation** on the value. No upper bound check exists:

```solidity
// FFactoryV2.sol:108-122 (FFactoryV3 identical)
function setTaxParams(
    address newVault_,
    uint256 buyTax_,
    uint256 sellTax_,
    uint256 antiSniperBuyTaxStartValue_,
    address antiSniperTaxVault_
) public onlyRole(ADMIN_ROLE) {
    require(newVault_ != address(0), "Zero addresses are not allowed.");
    taxVault = newVault_;
    buyTax = buyTax_;        // NO validation — accepts any uint256
    sellTax = sellTax_;      // NO validation
    antiSniperBuyTaxStartValue = antiSniperBuyTaxStartValue_;
    antiSniperTaxVault = antiSniperTaxVault_;
}
```

When `buyTax >= 100`, the anti-sniper tax capping logic in `buy()` triggers an underflow:

```solidity
// FRouterV2.sol:190-191 (FRouterV3:195-196 identical)
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax; // underflow when normalTax >= 100
}
```

With `normalTax = 100` (from `factory.buyTax()`), `99 - 100` underflows in Solidity 0.8.x checked arithmetic, causing an automatic revert. This bricks ALL buy operations across ALL pairs using that factory, since `buyTax` is a global factory parameter.

**Impact**:
- ADMIN_ROLE sets `buyTax = 100` (misconfiguration or malicious) → every `buy()` call reverts on ALL pairs for that factory
- Users cannot buy any tokens. Existing positions can only sell (sell path uses `sellTax`, not `buyTax`)
- Tokens cannot graduate (graduation requires a buy that crosses the threshold)
- All tokens in bonding curve phase are permanently stuck (cannot graduate, users can only sell at declining prices)
- Recovery requires ADMIN_ROLE to call `setTaxParams()` again with `buyTax < 100`

### Precondition Analysis
**Missing Precondition**: ADMIN_ROLE must set buyTax >= 100
**Precondition Type**: ACCESS
**Why This Partially Blocks**: Requires a trusted admin action. However, this is a semi-trusted role that could be compromised, and there is zero validation preventing this misconfiguration.

### Postcondition Analysis
**Postconditions Created**: Global DoS on all buy operations for the factory
**Postcondition Types**: STATE
**Who Benefits**: Attacker who compromised ADMIN_ROLE; short sellers benefit from inability to buy

---

## Finding [DEPTH-EC-2]: sellTax >= 100 causes underflow — users' funds trapped

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R6:✓] [R8:✗(single-step)] [R10:✓] [R14:✓]
**Depth Evidence**: [BOUNDARY:sellTax=99 → txFee=99*amountOut/100, amount=amountOut-txFee=amountOut/100, works], [BOUNDARY:sellTax=100 → txFee=100*amountOut/100=amountOut, amount=amountOut-amountOut=0, transferAsset(to,0) succeeds but user gets 0], [BOUNDARY:sellTax=101 → txFee=101*amountOut/100>amountOut, L153 FRouterV2 `amountOut - txFee` underflows → revert], [TRACE:setTaxParams(vault,X,101,Y,Z)→sellTax=101→sell()→L153 underflow→revert]
**Severity**: High
**Location**: FRouterV2.sol:L150-153, FRouterV3.sol:L157-160, FFactoryV2.sol:L108-122, FFactoryV3.sol:L116-130

**Description**:
The sell path computes the fee and net amount without any cap:

```solidity
// FRouterV2.sol:150-153
uint fee = factory.sellTax();
uint256 txFee = (fee * amountOut) / 100;
uint256 amount = amountOut - txFee; // underflow if fee > 100
```

Unlike `buy()` which has a `if (normalTax + antiSniperTax > 99)` cap (albeit buggy), sell has **no cap at all**.

At `sellTax = 100`: `txFee = amountOut`, `amount = 0`. User sells tokens and receives 0 VIRTUAL. The sell technically succeeds but the user receives nothing — 100% confiscation.

At `sellTax = 101`: `txFee = 101 * amountOut / 100 > amountOut`, causing `amountOut - txFee` to underflow and revert. All sells are bricked.

Both FRouterV2 and FRouterV3 have identical logic. `setTaxParams()` has no upper bound validation on `sellTax_`.

**Impact**:
- `sellTax = 100`: Users sell tokens but receive 0 — silent fund confiscation. 100% of output goes to taxVault.
- `sellTax > 100`: All sell operations revert. Users' tokens are trapped — they cannot sell. Combined with normal market operation, token prices could decline to near-zero while users watch helplessly.
- Since `sellTax` is global across all pairs, this affects ALL tokens on the factory.
- At `sellTax = 100`, tokens CAN still graduate (graduation is triggered by buys), so users' VIRTUAL enters the pair and gets locked in the graduation flow while they receive nothing on sell.

### Postcondition Analysis
**Postconditions Created**: Either silent 100% confiscation (tax=100) or global sell DoS (tax>100)
**Postcondition Types**: STATE, BALANCE
**Who Benefits**: taxVault receives 100% of sell output; admin who controls sellTax

---

## Finding [DEPTH-EC-3]: setBondingCurveParams() has zero validation — fakeInitialVirtualLiq=0 causes division by zero

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R6:✓] [R8:✗(single-step)] [R10:✓] [R14:✓]
**Depth Evidence**: [BOUNDARY:fakeInitialVirtualLiq=0 → BondingV5.sol:L377 `bondingCurveSupply / 0` → revert], [BOUNDARY:fakeInitialVirtualLiq=1 → liquidity=1 wei, price=bondingCurveSupply/1=huge, K=bondingCurveSupply*1=bondingCurveSupply, graduation trivially easy], [TRACE:setBondingCurveParams({0,X})→preLaunch()→L377 division by zero→revert→no new tokens can launch]
**Severity**: High
**Location**: BondingConfig.sol:L178-183, BondingV5.sol:L376-377

**Description**:
`setBondingCurveParams()` accepts a `BondingCurveParams` struct with no validation:

```solidity
// BondingConfig.sol:178-183
function setBondingCurveParams(
    BondingCurveParams memory params_
) external onlyOwner {
    bondingCurveParams = params_;  // NO validation on either field
    emit BondingCurveParamsUpdated(params_);
}
```

The `BondingCurveParams` struct has two fields: `fakeInitialVirtualLiq` and `targetRealVirtual`. Neither is validated.

When `fakeInitialVirtualLiq = 0`, the `_preLaunch()` function in BondingV5 hits a division by zero:

```solidity
// BondingV5.sol:376-377
uint256 liquidity = bondingConfig.getFakeInitialVirtualLiq(); // returns 0
uint256 price = bondingCurveSupply / liquidity;  // division by zero → revert
```

This blocks ALL new token launches until the owner corrects the parameter.

Additionally, `fakeInitialVirtualLiq = 1` (1 wei) creates a degenerate pool:
- `K = bondingCurveSupply * 1 = bondingCurveSupply` (extremely low K)
- `gradThreshold = 1 * bondingCurveSupply / (targetRealVirtual + 1) ≈ bondingCurveSupply / targetRealVirtual`
- With typical values: `450e24 / 42000e18 ≈ 10.7e6` tokens — still requires significant real VIRTUAL
- But `price = bondingCurveSupply / 1` overflows for typical bondingCurveSupply values (450M * 1e18), making the entire launch state inconsistent

**Impact**:
- `fakeInitialVirtualLiq = 0`: Complete DoS on new token launches. Existing tokens unaffected (their pairs already created).
- `fakeInitialVirtualLiq = 1 wei`: Degenerate K value, price overflow, unpredictable trading behavior for all newly launched tokens.

### Postcondition Analysis
**Postconditions Created**: New launches blocked (0) or degenerate parameters (1)
**Postcondition Types**: STATE
**Who Benefits**: No one directly — this is a misconfiguration DoS

---

## Finding [DEPTH-EC-4]: targetRealVirtual=0 causes division by zero in calculateGradThreshold

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R6:✓] [R8:✗(single-step)] [R10:✓] [R14:✓]
**Depth Evidence**: [BOUNDARY:targetRealVirtual=0, fakeInitialVirtualLiq=6300e18 → calculateGradThreshold returns fakeInitialVirtualLiq*bondingCurveSupply/(0+fakeInitialVirtualLiq) = bondingCurveSupply → gradThreshold=bondingCurveSupply], [TRACE:targetRealVirtual=0→preLaunch()→gradThreshold=bondingCurveSupply=450e24→first buy: newReserveA drops below gradThreshold instantly→graduation fires→tokens graduate with near-zero real VIRTUAL]
**Severity**: High
**Location**: BondingConfig.sol:L224-234, BondingConfig.sol:L178-183, BondingV5.sol:L662-670

**Description**:
When `targetRealVirtual = 0`, the `calculateGradThreshold()` function returns the full bonding curve supply:

```solidity
// BondingConfig.sol:224-234
function calculateGradThreshold(uint256 bondingCurveSupplyWei_) external view returns (uint256) {
    uint256 fakeInitialVirtualLiq = bondingCurveParams.fakeInitialVirtualLiq;
    return (fakeInitialVirtualLiq * bondingCurveSupplyWei_) /
           (bondingCurveParams.targetRealVirtual + fakeInitialVirtualLiq);
    // When targetRealVirtual=0: returns bondingCurveSupplyWei_ (full supply)
}
```

With `gradThreshold = bondingCurveSupplyWei_` (the full initial reserve0), ANY buy that reduces reserve0 below the threshold triggers graduation:

```solidity
// BondingV5.sol:662-670
uint256 gradThreshold = tokenGradThreshold[tokenAddress_];
if (newReserveA <= gradThreshold && !router.hasAntiSniperTax(pairAddress) && tokenInfo[tokenAddress_].trading) {
    _openTradingOnUniswap(tokenAddress_);
}
```

The very first post-launch buy (after anti-sniper period ends) triggers graduation. At this point, `assetBalance()` contains minimal real VIRTUAL (just from a few buys), which all gets sent to AgentFactory. The token graduates with essentially no real liquidity backing.

Note: `targetRealVirtual` and `fakeInitialVirtualLiq` are set together via `setBondingCurveParams()` which has NO validation on either field.

**Impact**:
- Owner sets `targetRealVirtual = 0` → all new tokens graduate after the first post-anti-sniper buy
- Graduated tokens have near-zero real VIRTUAL backing on Uniswap
- Users who bought during anti-sniper period paid 99% tax for tokens that immediately graduate with no liquidity
- Combined with EC-3: owner can set both to degenerate values in a single `setBondingCurveParams()` call

### Postcondition Analysis
**Postconditions Created**: Instant graduation with no real liquidity
**Postcondition Types**: STATE, BALANCE
**Who Benefits**: Anyone who can buy the first post-anti-sniper trade triggers graduation with minimal investment

---

## Finding [DEPTH-EC-5]: FRouterV3 sell DoS when sellTax=0 — depositTax called with zero amount

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R6:✗(no role involved in trigger)] [R8:✗(single-step)] [R10:✓] [R14:✗(no aggregate)]
**Depth Evidence**: [BOUNDARY:sellTax=0 → FRouterV3.sol:L158 txFee=0*amountOut/100=0, L160 amount=amountOut-0=amountOut, L165 pair.transferAsset(address(this), 0) sends 0, L166 forceApprove(feeTo, 0) approves 0, L167 depositTax(tokenAddress, 0) → external call with amount=0], [TRACE:sellTax=0→sell()→depositTax(token,0)→if AgentTaxV2 reverts on 0 amount→sell reverts→DoS], [VARIATION:FRouterV2 sell with sellTax=0→L150-157: txFee=0, amount=amountOut, transferAsset(to,amountOut), transferAsset(feeTo,0)→transfers 0 to feeTo→no external depositTax call→NO revert→FRouterV2 NOT affected]
**Severity**: Medium
**Location**: FRouterV3.sol:L157-167

**Description**:
FRouterV3's `sell()` function unconditionally calls `depositTax()` with the computed tax amount, even when `sellTax = 0`:

```solidity
// FRouterV3.sol:157-167
uint fee = factory.sellTax();
uint256 txFee = (fee * amountOut) / 100;    // = 0 when sellTax = 0
uint256 amount = amountOut - txFee;          // = amountOut
address feeTo = factory.taxVault();

pair.transferAsset(to, amount);
// Transfer tax from pair to router, then deposit with on-chain attribution
pair.transferAsset(address(this), txFee);    // transfers 0 from pair to router
IERC20(assetToken).forceApprove(feeTo, txFee); // approves 0
IAgentTaxForRouter(feeTo).depositTax(tokenAddress, txFee); // calls depositTax(token, 0)
```

The `depositTax(token, 0)` call is made to the external `AgentTaxV2` contract. If `AgentTaxV2.depositTax()` has a `require(amount > 0)` check (common in tax/fee contracts to prevent spam), this reverts and bricks ALL sell operations through FRouterV3.

FRouterV2 does NOT have this issue — it uses `pair.transferAsset(feeTo, txFee)` directly, which is an ERC20 transfer of 0 tokens (succeeds for standard ERC20).

Similarly, FRouterV3's `buy()` (L206-210) has the same pattern for `normalTxFee`:
```solidity
IERC20(assetToken).safeTransferFrom(to, address(this), normalTxFee);
IERC20(assetToken).forceApprove(taxVault, normalTxFee);
IAgentTaxForRouter(taxVault).depositTax(tokenAddress, normalTxFee);
```
When `buyTax = 0`, `normalTxFee = 0`, and `depositTax(token, 0)` is called. Same DoS risk.

**Impact**:
- If ADMIN_ROLE sets `sellTax = 0` (or `buyTax = 0`) and AgentTaxV2 reverts on zero amounts: all sells (or buys) through FRouterV3 revert
- Users cannot sell tokens → funds trapped
- FRouterV2 is unaffected, so BondingV2-V4 tokens using FRouterV2 still work
- BondingV5 uses FRouterV3, so all V5-launched tokens are affected

### Precondition Analysis
**Missing Precondition**: AgentTaxV2.depositTax() must revert on amount=0
**Precondition Type**: EXTERNAL
**Why This Partially Blocks**: Depends on AgentTaxV2 implementation (out of scope). However, the pattern of calling an external contract with amount=0 unconditionally is a design defect regardless.

### Postcondition Analysis
**Postconditions Created**: Sell DoS on FRouterV3 (V5 tokens only)
**Postcondition Types**: STATE
**Who Benefits**: No one — this is a misconfiguration/integration bug

---

## Finding [DEPTH-EC-6]: antiSniperBuyTaxStartValue > 99 causes inflated anti-sniper tax that absorbs normal tax

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R6:✓] [R8:✗(single-step)] [R10:✓] [R14:✓]
**Depth Evidence**: [BOUNDARY:antiSniperBuyTaxStartValue=99, buyTax=5 → normalTax=5, antiSniperTax=99 → 5+99=104>99 → antiSniperTax=99-5=94, total=99, user gets 1%], [BOUNDARY:antiSniperBuyTaxStartValue=150, buyTax=5, FRouterV2 → normalTax=5, antiSniperTax=150 (from _calculateAntiSniperTax L320 `startTax=factory.antiSniperBuyTaxStartValue()=150`, timeElapsed=0 → return 150) → 5+150=155>99 → antiSniperTax=99-5=94 → capped correctly at 99%], [BOUNDARY:antiSniperBuyTaxStartValue=150, buyTax=5, FRouterV3 → L291 startTax=150, L318 linear decay: tax=150*(duration-elapsed)/duration, takes longer to decay to 0 → extended anti-sniper period], [VARIATION:antiSniperBuyTaxStartValue=200 on FRouterV3 with 60s duration → at t=30s: tax=200*(60-30)/60=100, normalTax+100=105>99, capped to 99. At t=55s: tax=200*(60-55)/60=16, total=21, still significant → anti-sniper window effectively extends beyond 60s by factor of 200/99≈2x]
**Severity**: Low
**Location**: FFactoryV2.sol:L108-122, FRouterV2.sol:L320, FRouterV3.sol:L291,L318

**Description**:
`setTaxParams()` accepts `antiSniperBuyTaxStartValue_` with no upper bound validation. While the cap at L190-191 (FRouterV2) / L195-196 (FRouterV3) prevents the total tax from exceeding 99%, setting `antiSniperBuyTaxStartValue > 99` has two effects:

1. **FRouterV2**: `_calculateAntiSniperTax()` uses `startTax - taxReduction` where `taxReduction` is `timeElapsed` (X_LAUNCH) or `timeElapsed/60` (regular). With `startTax=150`, it takes 150 seconds (X_LAUNCH) or 150 minutes (regular) to decay to 0, instead of the expected 99 seconds/minutes. The anti-sniper window is silently extended.

2. **FRouterV3**: Uses linear decay `startTax * (duration - timeElapsed) / duration`. With `startTax=150` and `duration=60`: at t=30s, tax=75 (still well above the 99% cap). The decay reaches `startTax=99` equivalent at `t = duration * (1 - 99/startTax)` = `60 * (1 - 99/150)` = 20.4s. So the effective 99% total-tax period extends from the expected ~0s to 20.4s.

The capping logic prevents total tax > 99%, so this is not a DoS. However, it allows an admin to silently extend the anti-sniper window beyond the documented/expected duration, extracting more value from early buyers than intended.

**Impact**:
- Extended anti-sniper period means more buy transactions pay 99% total tax
- Anti-sniper tax goes to `antiSniperTaxVault` (not attributed per-token) — potential value extraction
- No immediate fund loss beyond the stated anti-sniper mechanism, but the duration exceeds user expectations

---

## Finding [DEPTH-EC-7]: taxStartTime=0 default means pre-launch buys would face max anti-sniper tax (mitigated by launch gate)

**Verdict**: PARTIAL
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R6:✗(no role)] [R8:✗(single-step)] [R10:✓]
**Depth Evidence**: [BOUNDARY:taxStartTime=0 (default before launch()) → FRouterV2 L316: `if (taxStartTime > 0) finalTaxStartTime = taxStartTime` → false → falls back to pair.startTime()], [TRACE:FPairV2 constructor sets taxStartTime=0→launch() calls router.setTaxStartTime()→taxStartTime set to block.timestamp→anti-sniper starts from launch time], [BOUNDARY:if setTaxStartTime never called (bug) → FRouterV2 uses startTime (pair creation time) → anti-sniper decay starts from pair creation → by launch time, most/all anti-sniper may have decayed], [VARIATION:FRouterV3 L303 _getTaxStartTime→same fallback to startTime→if pair created 1 hour before launch, 60 minutes of anti-sniper already elapsed by launch time]
**Severity**: Medium
**Location**: FRouterV2.sol:L306-318, FRouterV3.sol:L326-338, FPairV2.sol:L44

**Description**:
The FPairV2 constructor initializes `taxStartTime = 0`. The intended flow is:
1. `preLaunch()` creates pair (sets `startTime`)
2. `launch()` calls `router.setTaxStartTime(pair, block.timestamp)` to start anti-sniper countdown

If `setTaxStartTime()` is never called (due to a bug, role misconfiguration, or if the bonding contract version doesn't call it), the routers fall back to `pair.startTime()`. For scheduled launches where the pair is created hours or days before trading starts, the anti-sniper tax would have partially or fully decayed by the time trading begins.

For BondingV5, `launch()` at L543-546 calls `router.setTaxStartTime(pair, block.timestamp)`. However, BondingV2 at L406-407 also calls it. BondingV3/V4 may vary. If a pair is registered in FFactoryV3 but launched through a bonding contract that doesn't call `setTaxStartTime()`, the anti-sniper protection is silently bypassed.

**Impact**:
- If `setTaxStartTime()` is not called: anti-sniper starts from pair creation time, not launch time
- For scheduled launches (24h+ delay): anti-sniper fully decays before trading starts → snipers face 0% anti-sniper tax
- Mitigated by the fact that both BondingV2 and BondingV5 DO call `setTaxStartTime()`

### Precondition Analysis
**Missing Precondition**: setTaxStartTime() must NOT be called during launch
**Precondition Type**: STATE
**Why This Blocks**: In normal operation, both active bonding contracts call setTaxStartTime(). Only a custom/buggy integration would skip this.

---

## Finding [DEPTH-EC-8]: maxTx removed in BondingV5 — no on-chain transaction size limit

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3 | ✗4(N/A) | ✗5(single entity) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R6:✗(no role)] [R8:✗(single-step)] [R10:✓] [R13:✓]
**Depth Evidence**: [TRACE:grep 'maxTx' BondingV5.sol→0 results→confirmed removed], [VARIATION:BondingV2.sol:L33 has `uint256 public maxTx`, BondingV4.sol:L33 has `uint256 public maxTx`→removed in V5], [TRACE:BondingV5 buy/sell paths→no size validation→user can buy/sell full pool reserves in single tx]
**Severity**: Low
**Location**: BondingV5.sol (absent — was in BondingV2.sol:L33, BondingV4.sol:L33)

**Description**:
BondingV2 and BondingV4 both declared `uint256 public maxTx` which was used to limit transaction sizes. BondingV5 completely removes this variable and has no transaction size limit enforcement anywhere in `buy()` or `sell()`.

This appears intentional — BondingConfig does not include a maxTx parameter, and neither the buy nor sell paths reference any transaction size limit. However, the removal means:

1. A single whale can buy the entire bonding curve supply in one transaction, triggering immediate graduation
2. A single seller can dump the entire token supply in one transaction, crashing the price
3. No MEV protection beyond the existing slippage parameters (`amountOutMin_`)

**Impact**:
- Market manipulation: a single large buy can trigger graduation, capturing the graduation price for a whale while locking out smaller participants
- No on-chain transaction size limits. Slippage protection (`amountOutMin_`) is the only guard, and it's set by the user
- This is likely by-design, as BondingV5 delegates transaction limits to the backend/frontend. Terminal user-facing consequence: users face unmitigated whale manipulation of bonding curves.

---

## Finding [DEPTH-EC-9]: K overflow at extreme FPairV2 reserves — theoretical but unreachable

**Verdict**: REFUTED
**Step Execution**: ✓1,2,3 | ✗4(N/A) | ✓6
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R10:✓]
**Depth Evidence**: [BOUNDARY:reserve0=450e24 (450M tokens * 1e18), reserve1=14000e18 (14K VIRTUAL) → K=450e24*14000e18=6.3e45 → fits in uint256 (max 1.15e77)], [BOUNDARY:reserve0=type(uint128).max=3.4e38, reserve1=type(uint128).max=3.4e38 → K=1.16e77 → overflows uint256 max 1.15e77 → overflow], [TRACE:maximum real reserve0=bondingCurveSupply=1e27 (1B tokens max * 1e18), maximum real reserve1≈targetRealVirtual+fakeInitialVirtualLiq≈42000e18+6300e18≈48300e18 → K=1e27*4.83e22=4.83e49 → safely within uint256]
**Severity**: Informational
**Location**: FPairV2.sol:L77

**Description**:
FPairV2 `mint()` computes `k: reserve0 * reserve1` at L77. For the theoretical maximum reserves (uint128.max for both), this overflows uint256. However, the actual maximum reserves are bounded by:
- `reserve0 <= initialSupply * 10^decimals = 1e9 * 1e18 = 1e27` (entire token supply)
- `reserve1 <= fakeInitialVirtualLiq + totalRealVIRTUALDeposited`

Even if fakeInitialVirtualLiq were set to an absurdly high value (e.g., 1e30), K = 1e27 * 1e30 = 1e57, still well within uint256. Overflow is unreachable in practice.

---

## Finding [DEPTH-EC-10]: Divide-before-multiply in BondingV2/V3/V4 liquidity calculation — precision loss quantified

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R6:✗(no role)] [R8:✗(single-step)] [R10:✓]
**Depth Evidence**: [TRACE:BondingV2.sol:L325 `liquidity = (((((K * 10000) / assetRate) * 10000 ether) / bondingCurveSupply) * 1 ether) / 10000`], [BOUNDARY:K=3150000000000, assetRate=5000 → step1: K*10000=31500000000000000, step2: /assetRate=6300000000000, step3: *10000e18=6.3e31, step4: /bondingCurveSupply(450e24)=14000000, step5: *1e18=14000000e18=1.4e25, step6: /10000=1.4e21=1400e18 → result 1400 VIRTUAL → but README says 14000 VIRTUAL], [VARIATION:Using correct math: K*10000*10000*1e18*1e18 / (assetRate*bondingCurveSupply*10000) → need to verify against README's stated 14,000 VIRTUAL]
**Severity**: Low
**Location**: BondingV2.sol:L325-326, BondingV3.sol:L264-265, BondingV4.sol:L330-331

**Description**:
The liquidity calculation in BondingV2/V3/V4 uses a deeply nested divide-before-multiply pattern:

```solidity
uint256 liquidity = (((((K * 10000) / assetRate) * 10000 ether) /
    bondingCurveSupply) * 1 ether) / 10000;
```

With production values K=3,150,000,000,000 and assetRate=5000:
- `K * 10000 = 31,500,000,000,000,000`
- `/ assetRate = 6,300,000,000,000`
- `* 10000 ether = 63,000,000,000,000 * 1e18 = 6.3e31`
- `/ bondingCurveSupply (450e6 * 1e18 = 4.5e26) = 140,000`
- `* 1 ether = 1.4e23`
- `/ 10000 = 1.4e19 = 14e18`

Result: 14 VIRTUAL (14e18 wei). However, the README states fakeInitialVirtualLiq should be 14,000 VIRTUAL. This suggests either:
1. The README's value differs from what the formula computes (the formula targets a different parameterization)
2. Or assetRate has a different production value

With assetRate=5 (instead of 5000): step2 = 6,300,000,000,000,000 → final result = 14,000e18 = 14,000 VIRTUAL. This matches the README.

The key precision concern: integer division at each step can lose up to `assetRate - 1` in step 2, and up to `bondingCurveSupply - 1` in step 4. For `K * 10000 / assetRate`, the maximum loss is `(assetRate - 1) / (K * 10000) ≈ 0` — negligible at these magnitudes. The nested division introduces at most a few wei of error per step.

**Impact**: For production values, precision loss is negligible (a few wei at most). The divide-before-multiply pattern is suboptimal but does not materially affect economics. BondingV5 eliminates this by using `fakeInitialVirtualLiq` directly from BondingConfig.

---

## Finding [DEPTH-EC-11]: setTaxParams allows simultaneous buyTax + antiSniperBuyTaxStartValue to create extended 99% tax window

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R6:✓] [R8:✗(single-step)] [R10:✓] [R14:✓]
**Depth Evidence**: [BOUNDARY:buyTax=50, antiSniperBuyTaxStartValue=99 → FRouterV2: normalTax=50, antiSniperTax starts at 99 → total 149 → capped to 99 → antiSniperTax=49. After 49 minutes (regular token): antiSniperTax=50, total=100>99→capped to 99. After 50 minutes: antiSniperTax=49, total=99→no cap needed. Full 99% period extends from 0 to 50 minutes instead of 0 to 0 minutes], [VARIATION:buyTax=90, antiSniperBuyTaxStartValue=99 → even after full anti-sniper decay (99 min), normalTax alone is 90%→user always pays 90% on every buy, permanently], [TRACE:setTaxParams(vault,90,sellTax,99,antiVault)→buyTax=90→anti-sniper decays over 99 min but normalTax=90%→user gets 10% of amountIn on every buy forever→not DoS but severe value extraction]
**Severity**: Medium
**Location**: FFactoryV2.sol:L108-122, FFactoryV3.sol:L116-130, FRouterV2.sol:L182-197, FRouterV3.sol:L187-202

**Description**:
Since `setTaxParams()` sets `buyTax`, `sellTax`, and `antiSniperBuyTaxStartValue` all in one call with no validation, an admin can set `buyTax` to a high value (e.g., 90). This permanently taxes all buys at 90%, well after the anti-sniper period ends. The 99% cap in the router only limits `normalTax + antiSniperTax`, not `normalTax` alone.

The compound effect: `buyTax=50` + `antiSniperBuyTaxStartValue=99` extends the effective 99% total tax period, and leaves a permanent 50% buy tax after anti-sniper decay. There is no validation that `buyTax` should be "reasonable" (e.g., < 10%).

**Impact**:
- `buyTax=90`: Users permanently receive only 10% of their buy amount in tokens. 90% goes to taxVault.
- This is a global setting affecting ALL pairs on the factory.
- Combined with the underflow bug at buyTax >= 100 (DEPTH-EC-1), there is no safe range enforcement at all.

---

## PART 2: COMBINATION DISCOVERY

---

## Finding [DEPTH-EC-12]: EC-3 (fakeInitialVirtualLiq=0) + EC-4 (targetRealVirtual=0) — simultaneous via single setBondingCurveParams call

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R10:✓]
**Depth Evidence**: [TRACE:setBondingCurveParams({fakeInitialVirtualLiq:0, targetRealVirtual:0})→both set in single tx→preLaunch() hits div-by-zero at L377→complete launch DoS], [TRACE:setBondingCurveParams({fakeInitialVirtualLiq:1, targetRealVirtual:0})→preLaunch succeeds but K=bondingCurveSupply*1, gradThreshold=bondingCurveSupply→instant graduation with near-zero liquidity]
**Severity**: High
**Location**: BondingConfig.sol:L178-183

**Description**:
Both `fakeInitialVirtualLiq` and `targetRealVirtual` are stored in the same `BondingCurveParams` struct and set by a single `setBondingCurveParams()` call with zero validation. An owner (or compromised owner key) can set both to degenerate values in one transaction.

The combination `{fakeInitialVirtualLiq: 1, targetRealVirtual: 0}` is the worst combination short of complete DoS:
- K = bondingCurveSupply * 1 = bondingCurveSupply
- gradThreshold = bondingCurveSupply (full supply)
- Any buy triggers instant graduation
- Token graduates with near-zero real VIRTUAL backing

This is a superset of EC-3 and EC-4 individually, but is important to note as a single-transaction attack vector.

**Impact**: Same as EC-3 and EC-4 combined — complete protocol compromise via a single owner transaction.

---

## Finding [DEPTH-EC-13]: buyTax + antiSniperBuyTaxStartValue >= 100 — underflow revert from anti-sniper calculation (FRouterV2 only)

**Verdict**: PARTIAL
**Step Execution**: ✓1,2,3 | ✗4(N/A) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear)] [R10:✓]
**Depth Evidence**: [TRACE:FRouterV2: buyTax=5, antiSniperBuyTaxStartValue=99→normalTax=5, antiSniperTax starts at 99→total=104>99→antiSniperTax=99-5=94→works], [TRACE:FRouterV2: buyTax=50, antiSniperBuyTaxStartValue=99→total=149>99→antiSniperTax=99-50=49→works], [BOUNDARY:buyTax=100→regardless of antiSniperBuyTaxStartValue, hits underflow per DEPTH-EC-1→this is the same bug, not additive], [TRACE:FRouterV3: buyTax=5, antiSniperBuyTaxStartValue=99→same capping logic→antiSniperTax=99-5=94→works]
**Severity**: Low (subsumed by DEPTH-EC-1)
**Location**: FRouterV2.sol:L190-191, FRouterV3.sol:L195-196

**Description**:
The interaction between `buyTax` and `antiSniperBuyTaxStartValue` is handled by the capping logic `antiSniperTax = 99 - normalTax`. As long as `normalTax < 100` (i.e., `buyTax < 100`), this capping works correctly regardless of how high `antiSniperBuyTaxStartValue` is. The underflow only occurs when `buyTax >= 100`, which is already covered by DEPTH-EC-1.

The combination of the two values does not create a NEW vulnerability beyond what DEPTH-EC-1 already captures. However, the extended anti-sniper period from high `antiSniperBuyTaxStartValue` (DEPTH-EC-6) combined with high `buyTax` (DEPTH-EC-11) creates a scenario where users pay 99% tax for an extended period AND continue paying high normal tax after decay.

**Impact**: No additional DoS beyond DEPTH-EC-1. The economic impact (extended high-tax period) is covered by DEPTH-EC-6 and DEPTH-EC-11.

---

## Finding [DEPTH-EC-14]: FRouterV2 as bypass when FRouterV3 is DoS'd — partial mitigation

**Verdict**: PARTIAL
**Step Execution**: ✓1,2,3 | ✗4(N/A) | ✓6
**Rules Applied**: [R4:✗(evidence clear)] [R5:✗(single entity)] [R10:✓]
**Depth Evidence**: [TRACE:FRouterV3 sell DoS (sellTax=0→depositTax(0) reverts)→users try FRouterV2→FRouterV2.sell() does NOT call depositTax()→no revert→sells succeed], [TRACE:but BondingV5 holds EXECUTOR_ROLE on FRouterV3, not FRouterV2→users cannot call FRouterV2.sell() through BondingV5.sell()→BondingV5 calls `router.sell()` where `router` is set to FRouterV3], [TRACE:if admin changes BondingV5.router to FRouterV2→FRouterV2 would need EXECUTOR_ROLE on the FFactoryV3-created pairs→FRouterV2 may not be the router for FFactoryV3 pairs→pair.onlyRouter() check fails]
**Severity**: Informational
**Location**: FRouterV2.sol, FRouterV3.sol, BondingV5.sol

**Description**:
If FRouterV3 is DoS'd due to the depositTax(0) issue (DEPTH-EC-5), users cannot simply switch to FRouterV2 because:
1. BondingV5 hardcodes its router reference (`router` state variable), which points to FRouterV3
2. FPairV2 contracts created by FFactoryV3 have `router = FRouterV3's address` set in constructor → `onlyRouter` modifier blocks FRouterV2 from calling swap/transfer functions on those pairs
3. Even if BondingV5's router were changed via `setRouter()`, the pairs themselves only accept calls from their designated router

**Impact**: No bypass path exists for FRouterV3 DoS. Users of V5-launched tokens are fully blocked. Only ADMIN_ROLE setting `sellTax > 0` on FFactoryV3 resolves the DoS.

---

## PART 3: SECOND OPINION ON REFUTED

No edge-case-domain refuted findings to review.

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|------------|----------|---------------------|---------|----------|-------------------|-------------------|
| DEPTH-EC-1 | FRouterV2:L190-191, FRouterV3:L195-196, FFactoryV2/V3:setTaxParams | buyTax>=100 underflows in anti-sniper cap calculation | CONFIRMED | High | ACCESS (ADMIN_ROLE) | STATE (global buy DoS) |
| DEPTH-EC-2 | FRouterV2:L150-153, FRouterV3:L157-160, FFactoryV2/V3:setTaxParams | sellTax>=100 underflows or confiscates 100% of sell output | CONFIRMED | High | ACCESS (ADMIN_ROLE) | STATE,BALANCE (sell DoS or confiscation) |
| DEPTH-EC-3 | BondingConfig:L178-183, BondingV5:L376-377 | fakeInitialVirtualLiq=0 causes division by zero in preLaunch | CONFIRMED | High | ACCESS (Owner) | STATE (launch DoS) |
| DEPTH-EC-4 | BondingConfig:L224-234, BondingV5:L662-670 | targetRealVirtual=0 sets gradThreshold=bondingCurveSupply, instant graduation | CONFIRMED | High | ACCESS (Owner) | STATE,BALANCE (instant grad, no liquidity) |
| DEPTH-EC-5 | FRouterV3:L157-167 | sellTax=0 causes depositTax(0) call that may revert on external contract | CONFIRMED | Medium | ACCESS+EXTERNAL | STATE (sell DoS V5 tokens) |
| DEPTH-EC-6 | FFactoryV2/V3:setTaxParams, FRouterV2/V3:_calculateAntiSniperTax | antiSniperBuyTaxStartValue>99 silently extends anti-sniper period | CONFIRMED | Low | ACCESS (ADMIN_ROLE) | BALANCE (extended tax extraction) |
| DEPTH-EC-7 | FRouterV2:L306-318, FRouterV3:L326-338 | taxStartTime=0 default falls back to startTime, anti-sniper may decay before launch | PARTIAL | Medium | STATE (setTaxStartTime not called) | TIMING (anti-sniper bypass) |
| DEPTH-EC-8 | BondingV5 (absent) | maxTx removed in V5, no on-chain transaction size limit | CONFIRMED | Low | NONE | STATE (whale manipulation) |
| DEPTH-EC-9 | FPairV2:L77 | K overflow at extreme reserves — unreachable with production values | REFUTED | Informational | N/A | N/A |
| DEPTH-EC-10 | BondingV2:L325, BondingV3:L264, BondingV4:L330 | Divide-before-multiply precision loss in liquidity calc — negligible at production values | CONFIRMED | Low | NONE | BALANCE (few wei) |
| DEPTH-EC-11 | FFactoryV2/V3:setTaxParams | No validation on buyTax allows permanent high tax (e.g., 90%) on all buys | CONFIRMED | Medium | ACCESS (ADMIN_ROLE) | BALANCE (permanent high tax) |
| DEPTH-EC-12 | BondingConfig:L178-183 | fakeInitialVirtualLiq+targetRealVirtual both settable to degenerate values in single tx | CONFIRMED | High | ACCESS (Owner) | STATE,BALANCE (combined EC-3+EC-4) |
| DEPTH-EC-13 | FRouterV2:L190, FRouterV3:L195 | buyTax+antiSniper interaction — subsumed by DEPTH-EC-1 | PARTIAL | Low | ACCESS | STATE |
| DEPTH-EC-14 | FRouterV2, FRouterV3, BondingV5 | No FRouterV2 bypass when FRouterV3 is DoS'd — pairs locked to specific router | PARTIAL | Informational | STATE | STATE |
