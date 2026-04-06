# Temporal Parameter Staleness + Economic Design Analysis

Agent: B4 | Scope: contracts/launchpadv2/ | Date: 2026-04-02

---

## Part 1: TEMPORAL PARAMETER STALENESS

### Step 1: Multi-Step Operations

| Operation | Step 1 (Initiate) | Wait Condition | Step N (Complete) |
|---|---|---|---|
| Token Launch | preLaunch() | startTime reached | launch() |
| Scheduled Launch | preLaunch() with startTime_ >= now + scheduledLaunchStartTimeDelay | Time passes until startTime | launch() |
| Buy (post-launch) | launch() sets taxStartTime | Anti-sniper decay (60s / 98min) | buy() with reduced/zero anti-sniper tax |
| Graduation | buy() accumulates VIRTUAL | gradThreshold reached | _openTradingOnUniswap() |

### Step 2: Cached Parameters

| Parameter | Read At Step | Cached? | Governance-Changeable? | Re-Validated At Completion? |
|---|---|---|---|---|
| bondingCurveParams.fakeInitialVirtualLiq | preLaunch() L376-377 | YES (baked into pair K) | YES (setBondingCurveParams) | NO |
| bondingCurveParams.targetRealVirtual | preLaunch() L390-393 (via calculateGradThreshold) | YES (stored in tokenGradThreshold[token]) | YES (setBondingCurveParams) | NO |
| initialSupply | preLaunch() L327 | YES (baked into token supply) | YES (setCommonParams) | NO |
| reserveSupplyParams | preLaunch() L252-253 | YES (baked into bondingCurveSupply) | YES (setReserveSupplyParams) | NO |
| teamTokenReservedWallet | preLaunch() L383, launch() L555 | NO - read fresh each call | YES (setTeamTokenReservedWallet) | YES (but from different step) |
| scheduledLaunchParams.startTimeDelay | preLaunch() L268-270 | YES (used for isScheduledLaunch check) | YES (setScheduledLaunchParams) | NO |
| buyTax / sellTax | buy()/sell() in router | NO - read fresh from factory | YES (setTaxParams) | N/A (single-tx) |
| antiSniperBuyTaxStartValue | buy() -> _calculateAntiSniperTax() | NO - read fresh from factory | YES (setTaxParams) | N/A (single-tx) |
| taxStartTime | launch() L531 sets it | YES (stored on-chain in FPairV2) | YES (setTaxStartTime by EXECUTOR) | N/A (immutable after set, but resettable) |

### Step 3: Staleness Impact Analysis

#### [TE-1] teamTokenReservedWallet Changes Between preLaunch() and launch() - HIGH

**Evidence**: 
- preLaunch() reads `bondingConfig.teamTokenReservedWallet()` at BondingV5.sol:383 to send reserved tokens (airdrop + ACF supply).
- launch() reads `bondingConfig.teamTokenReservedWallet()` at BondingV5.sol:555 to send initial-purchase tokens.

**Scenario A: Wallet changes between preLaunch and launch**
1. Creator calls preLaunch(). Reserved tokens (airdrop/ACF) sent to wallet_A.
2. Owner calls setTeamTokenReservedWallet(wallet_B).
3. Creator calls launch(). Initial purchase tokens sent to wallet_B.
4. **Impact**: Reserved tokens and initial-purchase tokens end up in different wallets. If wallet_A is compromised or decommissioned, the reserved tokens are lost. If wallet_B is a new operational wallet, it will receive initial purchase tokens but not the reserved supply.

**Scenario B: Wallet changes to address(0)**
- setTeamTokenReservedWallet has NO zero-address check. If set to address(0), the next launch() would attempt `safeTransfer` to address(0), which would revert (SafeERC20 reverts on transfer to zero for most ERC20s). This would brick all pending launches.

**Severity**: HIGH - Split of token reserves across wallets breaks expected flow. Setting to zero address bricks launches.

#### [TE-2] scheduledLaunchStartTimeDelay Changes After Scheduled Launch Registration - MEDIUM

**Evidence**: BondingV5.sol:267-271
```solidity
BondingConfig.ScheduledLaunchParams memory scheduledParams = bondingConfig.getScheduledLaunchParams();
uint256 scheduledThreshold = block.timestamp + scheduledParams.startTimeDelay;
bool isScheduledLaunch = startTime_ >= scheduledThreshold;
```

The `isScheduledLaunch` determination uses current `startTimeDelay` at preLaunch() time. The pair's `startTime` is set and immutable (except via resetTime). However:

**Scenario A: startTimeDelay INCREASES after preLaunch**
1. startTimeDelay = 24h. User preLaunches with startTime = now + 25h. Classified as scheduled launch, pays normalLaunchFee.
2. Admin increases startTimeDelay to 48h.
3. For the NEXT user with identical startTime (now+25h), this would be classified as immediate launch (no fee). But the already-created token is unaffected since classification was done at preLaunch time.
4. **Impact**: Inconsistent classification between tokens. However, the already-launched token's fee was already paid, so no direct loss. LOW impact on existing tokens.

**Scenario B: startTimeDelay DECREASES after preLaunch**
1. startTimeDelay = 48h. User preLaunches with startTime = now + 25h. Classified as immediate (no fee).
2. Admin decreases startTimeDelay to 12h.
3. **Impact**: The user avoided paying a fee that should have been charged under the new rules. But since the fee was determined at preLaunch-time, this is by design. No retroactive impact.

**True risk**: The `startTimeDelay` is also stored in the pair's `startTimeDelay` field (BondingV5.sol:366-371). This is used in `resetTime()` to validate new start times: `newStartTime >= block.timestamp + startTimeDelay`. If the global config changes, the per-pair delay remains as it was at creation. This is actually CORRECT behavior (immutability at creation).

**Severity**: MEDIUM - Inconsistent fee classification across tokens if param changes, but no direct funds-at-risk.

#### [TE-3] Anti-Sniper Tax Bypass via Validator Timestamp Manipulation - MEDIUM

**Evidence**: FRouterV3.sol:310-318
```solidity
uint256 timeElapsed = block.timestamp - taxStartTime;
if (timeElapsed >= duration) { return 0; }
return startTax * (duration - timeElapsed) / duration;
```

For ANTI_SNIPER_60S (duration=60s):
- At t=0: tax = 99%
- At t=12: tax = 99 * 48/60 = 79.2% (truncated to 79%)
- At t=60: tax = 0%

**Validator manipulation window**: Ethereum validators can manipulate `block.timestamp` within approximately +/- 12 seconds of the true time (must be >= parent timestamp and <= current wall time + some drift tolerance).

**Attack scenario**:
1. Token launches at taxStartTime = T.
2. Validator includes the first buy transaction in a block with `block.timestamp = T + 12`.
3. Tax at T+12 for 60s duration: `99 * (60-12)/60 = 79%` instead of `99 * (60-0)/60 = 99%`.
4. For a 1000 VIRTUAL buy, the sniper saves (99% - 79%) * 1000 = 200 VIRTUAL in taxes.

For ANTI_SNIPER_98M (duration=5880s):
- At t=12: tax = 99 * 5868/5880 = 98.8% -- negligible difference.

**Severity**: MEDIUM for 60s window (up to 20% tax reduction on first blocks), LOW for 98min window (< 0.2% tax difference). The 60s anti-sniper window is the most vulnerable since 12 seconds is 20% of the total duration.

#### [TE-4] EXECUTOR_ROLE Can Reset taxStartTime Arbitrarily - HIGH

**Evidence**: 
- FRouterV2.sol:358-369 and FRouterV3.sol:344-355: `setTaxStartTime(address pairAddress, uint256 _taxStartTime)` callable by EXECUTOR_ROLE.
- FPairV2.sol:198-206: Validates `_taxStartTime >= startTime`, but no upper bound.

**Attack scenario**:
1. Token launches normally. Anti-sniper tax decays from 99% to 0% over 60s.
2. After 30s (tax at ~49.5%), EXECUTOR calls `setTaxStartTime(pair, block.timestamp)` to restart the decay.
3. All buyers for the next 60s face renewed 99% tax.
4. Alternatively, EXECUTOR sets `taxStartTime` to a far-future timestamp. Now `block.timestamp < taxStartTime` returns `startTax` (99%) for all future buys indefinitely.

**Also**: EXECUTOR can call `resetTime(tokenAddress, newStartTime)` to change pair startTime, but this is constrained: must be called before current startTime and new time must respect startTimeDelay. The `setTaxStartTime` has weaker constraints (only `>= startTime`).

**Severity**: HIGH - EXECUTOR_ROLE (beOpsWallet EOA) can arbitrarily manipulate anti-sniper tax timing for any pair, effectively taxing users at 99% indefinitely or resetting decay at will. This is a trusted-role assumption but the capability is extreme.

#### [TE-5] taxStartTime = 0 Default and Backward Compatibility Risks - MEDIUM

**Evidence**: FPairV2.sol:45 initializes `taxStartTime = 0`.

In FRouterV3._getTaxStartTime() (L326-338):
```solidity
uint256 finalTaxStartTime = pair.startTime();
try pair.taxStartTime() returns (uint256 _taxStartTime) {
    if (_taxStartTime > 0) {
        finalTaxStartTime = _taxStartTime;
    }
} catch { }
return finalTaxStartTime;
```

If taxStartTime is never set (token never launched via launch()):
- Falls back to pair.startTime().
- For scheduled launches, startTime could be far in the future.
- If someone calls buy() directly on BondingV5 for a token that was preLaunched but not yet launched, it would revert due to `launchExecuted` check. So this is not exploitable.

However, if EXECUTOR calls `setTaxStartTime(pair, 0)` -- the FPairV2.setTaxStartTime requires `_taxStartTime >= startTime`, so 0 would revert for any pair with startTime > 0. Safe.

**Edge case**: If pair.startTime() = 0 (somehow), then `block.timestamp - 0 = block.timestamp` which is a very large number, so anti-sniper tax = 0. This could only happen if createPair was called with startTime=0, which BondingV5 prevents (uses block.timestamp for immediate launches).

**Severity**: MEDIUM - The fallback logic is sound for the normal path, but the try/catch backward compatibility pattern means old pairs without taxStartTime get their startTime used, which could have been set before the tax mechanism was even deployed.

### Step 3b: Update Source Audit

| Parameter | Source | Correct Representation? | Should Be Fixed Per Period? | Updated By | Should Be Updated By | Mismatch? |
|---|---|---|---|---|---|---|
| taxStartTime | block.timestamp at launch() | YES - marks when trading begins | YES - should be set once at launch | launch() via setTaxStartTime | launch() | NO (but EXECUTOR can override) |
| buyTax/sellTax | factory state variable | YES | NO - should apply to new txs only | setTaxParams (ADMIN) | Same | NO |
| antiSniperBuyTaxStartValue | factory state variable | Partially - this is a GLOBAL parameter but tax is per-pair | Should be per-pair or per-type | setTaxParams (ADMIN) | Should be set at pair creation time | YES - see [TE-6] |

#### [TE-6] antiSniperBuyTaxStartValue is Global but Should Be Per-Token - MEDIUM

**Evidence**: FFactoryV2.sol:27, FFactoryV3.sol:35 store `antiSniperBuyTaxStartValue` as a single global value. FRouterV3._calculateAntiSniperTax() reads it at L291: `uint256 startTax = factory.antiSniperBuyTaxStartValue()`.

If ADMIN changes `antiSniperBuyTaxStartValue` from 99 to 50 via setTaxParams, ALL tokens (including those currently in their anti-sniper window) immediately see their starting tax drop. A token that launched 10 seconds ago with intended 99% starting tax now has max 50%.

**Scenario**: ADMIN lowers antiSniperBuyTaxStartValue for legitimate reasons (e.g., new policy). But tokens currently in their anti-sniper window retroactively get weaker protection.

**Severity**: MEDIUM - Retroactive parameter change affects active anti-sniper windows. Since the parameter is global across all pairs, changing it is a blunt instrument.

### Step 4: Retroactive Application Analysis

| Parameter | Applies To | Retroactive? | Impact |
|---|---|---|---|
| buyTax | All future buy txs | YES - affects already-launched tokens | Existing token holders face new tax rate on sells; new buyers face new rate |
| sellTax | All future sell txs | YES - affects already-launched tokens | Same |
| antiSniperBuyTaxStartValue | All tokens in anti-sniper window | YES - changes mid-window | Weakens/strengthens protection retroactively (see [TE-6]) |
| fakeInitialVirtualLiq | New tokens only | NO - baked in at preLaunch | N/A |
| targetRealVirtual | New tokens only | NO - baked into tokenGradThreshold | N/A |
| initialSupply | New tokens only | NO - baked into token | N/A |
| scheduledLaunchParams fees | New preLaunches only | NO - fee paid at preLaunch | N/A |

### Step 5: Severity Summary

| Finding | Severity | Exploitable? | Recovery? |
|---|---|---|---|
| [TE-1] teamTokenReservedWallet split | HIGH | By admin (unintentional) | Manual token recovery from both wallets |
| [TE-2] scheduledLaunchStartTimeDelay classification drift | MEDIUM | No direct exploit | N/A - cosmetic inconsistency |
| [TE-3] Validator timestamp manipulation on 60s anti-sniper | MEDIUM | By validators/builders | No mitigation within protocol |
| [TE-4] EXECUTOR can reset taxStartTime | HIGH | By trusted EXECUTOR_ROLE | Admin can change EXECUTOR |
| [TE-5] taxStartTime=0 fallback edge cases | MEDIUM | Not exploitable in normal path | N/A |
| [TE-6] Global antiSniperBuyTaxStartValue retroactivity | MEDIUM | By admin (unintentional) | Would need per-token storage |

---

## Part 2: ECONOMIC DESIGN AUDIT

### Section 1: Parameter Boundary Analysis

| Parameter | Setter | Min Value | Max Value | Enforced? | Impact at Min | Impact at Max |
|---|---|---|---|---|---|---|
| buyTax | FFactoryV2/V3.setTaxParams | 0 | uint256 MAX (no cap) | NO | Zero buy fee | 99% cap in router, BUT if buyTax >= 100: underflow in `99 - normalTax` |
| sellTax | FFactoryV2/V3.setTaxParams | 0 | uint256 MAX (no cap) | NO | Zero sell fee | `(fee * amountOut) / 100` could exceed amountOut; underflow in `amountOut - txFee` |
| antiSniperBuyTaxStartValue | FFactoryV2/V3.setTaxParams | 0 | uint256 MAX (no cap) | NO | No anti-sniper tax | Capped at 99 in router... but see [EC-1] |
| fakeInitialVirtualLiq | BondingConfig.setBondingCurveParams | 0 | uint256 MAX | NO | Division by zero at BondingV5:377 | Extremely low token price; K overflow possible |
| targetRealVirtual | BondingConfig.setBondingCurveParams | 0 | uint256 MAX | NO | gradThreshold = bondingCurveSupply (grad never reached); see [EC-2] | gradThreshold approaches 0 (immediate graduation) |
| initialSupply | BondingConfig.setCommonParams | 0 | uint256 MAX | NO | Zero supply; entire protocol breaks | Overflow in supply * decimals multiplication |
| maxAirdropBips | BondingConfig.setReserveSupplyParams | 0 | 10000 | YES | No airdrop allowed | 100% airdrop cap (but maxTotalReservedBips enforces combined) |
| maxTotalReservedBips | BondingConfig.setReserveSupplyParams | >= maxAirdropBips + acfReservedBips | 10000 | YES | All supply goes to bonding curve | All supply reserved; bonding curve supply = 0 |
| acfReservedBips | BondingConfig.setReserveSupplyParams | 0 | 10000 | YES (individual) | No ACF reserve | 100% ACF reserve cap |

#### [EC-1] buyTax >= 100 Causes Underflow in Anti-Sniper Tax Cap - HIGH

**Evidence**: FRouterV2.sol:190-191, FRouterV3.sol:195-196:
```solidity
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax;
}
```

If ADMIN sets `buyTax = 100` (or higher) via setTaxParams (no cap enforced in factory):
- `99 - normalTax` = `99 - 100` = underflow in unchecked Solidity 0.8.x = REVERT.
- Wait... Solidity 0.8+ has checked arithmetic. So `99 - 100` would revert.
- Actually, `99 - normalTax` where normalTax > 99 causes a panic revert.
- But only if `normalTax + antiSniperTax > 99` branch is taken. If antiSniperTax = 0 (e.g., after decay), then the branch is skipped and `normalTxFee = (100 * amountIn) / 100 = amountIn`, then `amount = amountIn - amountIn - 0 = 0`. The buy would proceed with amount=0, getting 0 tokens out. In BondingV5._buy() L649: `if (amount0Out == 0 || amount0Out < amountOutMin_)` reverts.
- If antiSniperTax > 0, then `normalTax + antiSniperTax` > 99 is true (100 + anything > 99), hitting the underflow revert.

**Impact**: If buyTax >= 100, ALL buys revert during anti-sniper window. After anti-sniper window, buys proceed but user gets 0 tokens (100% tax). Effectively bricks buying.

**Severity**: HIGH - No validation on buyTax in setTaxParams. ADMIN_ROLE can accidentally or maliciously set buyTax >= 100, bricking all buys.

#### [EC-2] targetRealVirtual = 0 Causes Near-Zero Graduation Threshold - HIGH

**Evidence**: BondingConfig.sol:224-233:
```solidity
function calculateGradThreshold(uint256 bondingCurveSupplyWei_) external view returns (uint256) {
    uint256 fakeInitialVirtualLiq = bondingCurveParams.fakeInitialVirtualLiq;
    return (fakeInitialVirtualLiq * bondingCurveSupplyWei_) /
        (bondingCurveParams.targetRealVirtual + fakeInitialVirtualLiq);
}
```

If `targetRealVirtual = 0`:
- `gradThreshold = (fakeInitialVirtualLiq * bondingCurveSupplyWei_) / fakeInitialVirtualLiq = bondingCurveSupplyWei_`
- This means gradThreshold equals the initial reserve0. Since reserve0 starts at bondingCurveSupply and only decreases with buys, `newReserveA <= gradThreshold` at BondingV5:664 is true immediately.
- The FIRST buy (or even the initial purchase in launch()) would trigger graduation.

If BOTH `targetRealVirtual = 0` AND `fakeInitialVirtualLiq = 0`:
- Division by zero revert in calculateGradThreshold.

**Severity**: HIGH - Can cause immediate graduation on first buy, bypassing the bonding curve entirely.

#### [EC-3] sellTax Has No Cap; Can Exceed 100% - HIGH

**Evidence**: FRouterV2.sol:150-153, FRouterV3.sol:157-160:
```solidity
uint fee = factory.sellTax();
uint256 txFee = (fee * amountOut) / 100;
uint256 amount = amountOut - txFee;
```

Unlike buyTax which has the 99% anti-sniper cap check (even if broken for buyTax>99), sellTax has NO cap check at all.

If `sellTax = 101`:
- `txFee = (101 * amountOut) / 100` = slightly more than amountOut.
- `amount = amountOut - txFee` underflows => REVERT (Solidity 0.8 checked math).
- ALL sells permanently revert. Users cannot exit positions.

If `sellTax = 100`:
- `txFee = amountOut`. `amount = 0`. Transfer of 0 to user succeeds. Transfer of amountOut to taxVault succeeds.
- User receives nothing. Effective 100% sell tax.

**Severity**: HIGH - No validation on sellTax. ADMIN_ROLE can set sellTax >= 100, trapping all user funds (sells revert or yield 0).

### Section 2: Economic Invariant Identification

| Invariant | Parameters Involved | Can Admin Break It? | Functions That Assume It |
|---|---|---|---|
| K = reserve0 * reserve1 (constant product) | Initial K from mint() | NO - K is set once at mint and never recalculated on swap | getAmountsOut(), swap() |
| reserve0 > 0 AND reserve1 > 0 | fakeInitialVirtualLiq, bondingCurveSupply | YES - if fakeInitialVirtualLiq = 0, reserve1 = 0 at mint | getAmountsOut() (division by zero in `k / newReserveB`) |
| totalTax <= 99% for buys | buyTax, antiSniperBuyTaxStartValue | PARTIALLY - cap exists but breaks if buyTax >= 100 (see [EC-1]) | buy() |
| totalTax < 100% for sells | sellTax | YES - no cap at all (see [EC-3]) | sell() |
| gradThreshold < initial reserve0 | targetRealVirtual, fakeInitialVirtualLiq | YES - if targetRealVirtual = 0 (see [EC-2]) | _buy() graduation check |
| bondingCurveSupply > 0 | initialSupply, reserveSupplyParams | YES - if maxTotalReservedBips = 10000, supply = 0 | preLaunch() division by zero at L377 |

#### [EC-4] fakeInitialVirtualLiq = 0 Causes Division by Zero - HIGH

**Evidence**: BondingV5.sol:376-377:
```solidity
uint256 liquidity = bondingConfig.getFakeInitialVirtualLiq();
uint256 price = bondingCurveSupply / liquidity;
```

If `fakeInitialVirtualLiq = 0`: division by zero REVERT. No tokens can be preLaunched.

Additionally, FPairV2.mint() would be called with `amountAsset_ = 0`:
- `k = reserve0 * 0 = 0`
- All subsequent getAmountsOut calls: `k / newReserveB = 0 / X = 0`, so `amountOut = reserveA - 0 = reserveA`. First buyer gets ALL tokens.

**Severity**: HIGH - Admin can set fakeInitialVirtualLiq = 0 via setBondingCurveParams, bricking preLaunch or creating degenerate pricing.

### Section 3: Rate/Supply Interaction Matrix

| Parameter A | Parameter B | Interaction | Can A*B Produce Extreme Output? |
|---|---|---|---|
| fakeInitialVirtualLiq | bondingCurveSupply | K = fakeInitialVirtualLiq * bondingCurveSupply | YES - if both are very large, K overflows uint256 |
| fakeInitialVirtualLiq | targetRealVirtual | gradThreshold = fakeInitialVirtualLiq * supply / (targetRealVirtual + fakeInitialVirtualLiq) | YES - if targetRealVirtual >> fakeInitialVirtualLiq, gradThreshold -> 0 (instant graduation) |
| buyTax | antiSniperBuyTaxStartValue | Combined tax capped at 99% | Partially safe, but buyTax > 99 breaks cap (see [EC-1]) |
| maxTotalReservedBips | initialSupply | bondingCurveSupply = initialSupply * (10000 - totalReserved) / 10000 | If totalReserved = 10000, bondingCurveSupply = 0 |
| initialSupply | token.decimals() | bondingCurveSupply = bondingCurveSupplyBase * 10**decimals | Can overflow if initialSupply is very large |

#### [EC-5] K Overflow Risk with Large Parameters - LOW

**Evidence**: FPairV2.sol:77: `k: reserve0 * reserve1`

If `bondingCurveSupply = 1e9 * 1e18 = 1e27` (1 billion tokens with 18 decimals) and `fakeInitialVirtualLiq = 1e6 * 1e18 = 1e24`, then `K = 1e27 * 1e24 = 1e51`. This is well within uint256 range (max ~1.15e77).

However, if initialSupply is set to an extreme value (e.g., 1e30 base units), then `bondingCurveSupply = 1e30 * 1e18 = 1e48`, and `K = 1e48 * 1e24 = 1e72`. Still within uint256. Overflow would require truly astronomical values.

**Severity**: LOW - Theoretical overflow possible with extreme parameter values, but practically unlikely.

### Section 4: Fee Formula Verification

#### 4a. Concrete Examples

**Buy tax (FRouterV3.sol:199-202)**:
Formula: `normalTxFee = (normalTax * amountIn) / 100`

| buyTax | amountIn | Expected Fee | Actual Fee (integer div) | Effective Rate |
|---|---|---|---|---|
| 1 (1%) | 1e18 | 1e16 | 1e16 | 1.00% |
| 5 (5%) | 1e18 | 5e16 | 5e16 | 5.00% |
| 10 (10%) | 1e18 | 1e17 | 1e17 | 10.00% |
| 1 (1%) | 99 | 0.99 | 0 (truncated) | 0.00% |

Note: Fee is in percentage (not BPS). `fee / 100` means 1% granularity. For small amounts, rounding favors the user (floor division).

**Anti-sniper tax (FRouterV3.sol:318)**:
Formula: `startTax * (duration - timeElapsed) / duration`

| startTax | duration | timeElapsed | Expected | Actual |
|---|---|---|---|---|
| 99 | 60 | 0 | 99.0 | 99 |
| 99 | 60 | 1 | 97.35 | 97 (floor) |
| 99 | 60 | 30 | 49.5 | 49 (floor) |
| 99 | 60 | 59 | 1.65 | 1 (floor) |
| 99 | 60 | 60 | 0 | 0 (caught by >= check) |

Rounding consistently floors, slightly favoring the buyer during anti-sniper period. This is ACCEPTABLE but worth noting.

**Sell tax (FRouterV3.sol:158)**:
Formula: `txFee = (fee * amountOut) / 100`

| sellTax | amountOut | Expected Fee | Actual Fee | Effective Rate |
|---|---|---|---|---|
| 1 | 1e18 | 1e16 | 1e16 | 1.00% |
| 5 | 1e18 | 5e16 | 5e16 | 5.00% |

Note: Sell tax is applied to OUTPUT (amountOut from the curve), not INPUT. Buy tax is applied to INPUT (amountIn from user). This is an asymmetry.

#### [EC-6] Buy/Sell Tax Asymmetry: Input-Based vs Output-Based - INFO

**Evidence**:
- Buy: tax on `amountIn` (user's VIRTUAL input). Net amount goes to pair. Tokens out are computed on net.
- Sell: tax on `amountOut` (VIRTUAL output from curve). User receives net.

This means:
- For buys: user pays `amountIn`. Protocol takes `buyTax%` of `amountIn`. Remaining goes to curve.
- For sells: curve outputs `amountOut`. Protocol takes `sellTax%` of `amountOut`. User gets remainder.

A buy-then-immediate-sell cycle at 1% buy + 1% sell tax:
- Buy 100 VIRTUAL: 1 VIRTUAL tax, 99 goes to curve, get X tokens.
- Sell X tokens: curve outputs ~99 VIRTUAL (ignoring price impact), 0.99 tax, user gets ~98.01.
- Total loss: ~1.99% (buy tax on gross, sell tax on net). This is standard and correct.

**Severity**: INFO - Asymmetry is standard AMM design. No bug, but documenting for clarity.

#### 4b. Fee Interaction Matrix

| Fee A | Fee B | A Output Feeds B Input? | Combined Effective Rate | Independent Rate Sum | Discrepancy? |
|---|---|---|---|---|---|
| buyTax | antiSniperTax | NO - both computed on amountIn independently | buyTax% + antiSniperTax% (capped at 99%) | Same | NO |
| buyTax | sellTax | NO - applied in separate transactions | N/A | N/A | NO |

The buy fee computation is clean: both normalTxFee and antiSniperTxFee are computed as percentages of the ORIGINAL amountIn, then subtracted. There is no fee-on-fee compounding.

```solidity
normalTxFee = (normalTax * amountIn) / 100;
antiSniperTxFee = (antiSniperTax * amountIn) / 100;
amount = amountIn - normalTxFee - antiSniperTxFee;
```

#### [EC-7] Rounding Dust: normalTxFee + antiSniperTxFee + amount May Not Equal amountIn - LOW

**Evidence**: Due to integer division, `(normalTax * amountIn) / 100 + (antiSniperTax * amountIn) / 100` may not equal `((normalTax + antiSniperTax) * amountIn) / 100`.

Example: amountIn = 101, normalTax = 1, antiSniperTax = 1:
- normalTxFee = (1 * 101) / 100 = 1
- antiSniperTxFee = (1 * 101) / 100 = 1
- amount = 101 - 1 - 1 = 99
- Total accounted: 1 + 1 + 99 = 101. OK in this case.

Example: amountIn = 99, normalTax = 1, antiSniperTax = 1:
- normalTxFee = 0 (99/100 = 0)
- antiSniperTxFee = 0
- amount = 99
- Tax = 0 for a 2% intended tax. Rounding completely eliminates tax for small amounts.

**Severity**: LOW - Rounding dust favors users on small transactions. No funds-at-risk for protocol (worst case: slightly less tax collected).

### Section 5: Graduation Math Verification

#### [EC-8] Graduation Threshold Check Uses reserve0 (Token Reserve), Not assetBalance - INFO

**Evidence**: BondingV5.sol:639-668:
```solidity
(uint256 reserveA, uint256 reserveB) = pairContract.getReserves();
(uint256 amount1In, uint256 amount0Out) = router.buy(...);
uint256 newReserveA = reserveA - amount0Out;
// ...
if (newReserveA <= gradThreshold && !router.hasAntiSniperTax(pairAddress) && tokenInfo[tokenAddress_].trading) {
    _openTradingOnUniswap(tokenAddress_);
}
```

The graduation check compares remaining TOKEN reserve (reserve0 = agent tokens) against gradThreshold (also in token units). This is mathematically consistent with the formula:

`gradThreshold = fakeInitialVirtualLiq * bondingCurveSupply / (targetRealVirtual + fakeInitialVirtualLiq)`

At graduation, when `reserve0 = gradThreshold`:
- From K = reserve0 * reserve1: `reserve1 = K / gradThreshold = (bondingCurveSupply * fakeInitialVirtualLiq) / gradThreshold`
- Substituting: `reserve1 = (bondingCurveSupply * fakeInitialVirtualLiq) * (targetRealVirtual + fakeInitialVirtualLiq) / (fakeInitialVirtualLiq * bondingCurveSupply) = targetRealVirtual + fakeInitialVirtualLiq`
- Real VIRTUAL in pair = reserve1 - fakeInitialVirtualLiq (since fakeInitialVirtualLiq was phantom) = but wait, assetBalance() is the REAL balance...

**Critical nuance**: reserve1 is a VIRTUAL (computed) reserve that includes the fakeInitialVirtualLiq. The REAL VIRTUAL balance is tracked by `assetBalance()` = `IERC20(tokenB).balanceOf(address(this))`. The difference: `reserve1 = assetBalance() + fakeInitialVirtualLiq` (the phantom reserve was never actually deposited as tokens).

So at graduation: `assetBalance() = reserve1 - fakeInitialVirtualLiq = targetRealVirtual`. This confirms the graduation threshold is correctly calibrated to trigger when the pair has accumulated `targetRealVirtual` in real VIRTUAL tokens.

**Severity**: INFO - Graduation math is correct and consistent with bonding curve invariants.

#### [EC-9] Graduation Blocked During Anti-Sniper Window - DESIGN CHOICE

**Evidence**: BondingV5.sol:666:
```solidity
if (newReserveA <= gradThreshold && !router.hasAntiSniperTax(pairAddress) && ...) {
```

Graduation requires `hasAntiSniperTax == false`. For 60s tokens, graduation is impossible in the first 60 seconds. For 98min tokens, graduation is impossible for 98 minutes.

**Implication**: If enough VIRTUAL flows in during the anti-sniper window to reach gradThreshold, graduation is deferred. The extra buys continue accumulating VIRTUAL beyond targetRealVirtual. When anti-sniper tax expires and the next buy triggers graduation, the pair has MORE VIRTUAL than expected.

This excess VIRTUAL goes to the graduated pool. From `_openTradingOnUniswap()`: `assetBalance = pairContract.assetBalance()` captures ALL real VIRTUAL. The excess is a bonus for the graduated token's liquidity pool.

**Severity**: INFO/DESIGN - Not a bug, but graduation may occur at a higher real VIRTUAL level than targetRealVirtual for heavily-traded tokens during anti-sniper window.

#### [EC-10] BPS Precision in calculateBondingCurveSupply - LOW

**Evidence**: BondingConfig.sol:207:
```solidity
return (initialSupply * (10000 - totalReserved)) / 10000;
```

For small initialSupply values:
- initialSupply = 1, totalReserved = 5000 (50%): `(1 * 5000) / 10000 = 0` (truncated). Bonding curve supply = 0.
- initialSupply = 9999, totalReserved = 1: `(9999 * 9999) / 10000 = 9998` (correct to within 1 unit).

The truncation at small values could produce zero bondingCurveSupply if initialSupply * (10000 - totalReserved) < 10000. This would then cause division by zero at BondingV5:377.

**Practical impact**: initialSupply is expected to be ~1 billion (1e9). At this scale, precision loss is < 1 basis point, completely negligible.

**Severity**: LOW - Only relevant for pathological initialSupply values (< 10000 base units).

#### [EC-11] maxTx Is Set But Never Enforced - MEDIUM

**Evidence**: From constraint_variables.md: "maxTx in BondingV2-V4 is set but never checked."

In BondingV5, there is no maxTx parameter at all. In the router buy/sell functions, there is no transaction size limit.

**Impact**: Whales can make arbitrarily large single transactions. During the anti-sniper window, this is mitigated by the high tax. After the window, a single transaction could theoretically buy up the entire remaining supply or drain the pair.

**Splitting defense**: Since there's no per-block limit either, splitting transactions offers no advantage over a single large transaction. The lack of maxTx is consistently absent (no partial enforcement to bypass).

**Severity**: MEDIUM - No transaction size limits exist. While consistent (cannot be bypassed by splitting since there's nothing to bypass), large single trades can cause significant price impact and potentially trigger graduation in one transaction.

### Step Execution Checklist

#### Temporal Parameter Staleness
| Step | Required | Completed? | Notes |
|------|----------|------------|-------|
| 1. Enumerate Multi-Step Operations | YES | YES | 4 operations identified |
| 2. Identify Cached Parameters | YES | YES | 10 parameters analyzed |
| 3. Model Staleness Impact (both directions) | YES | YES | TE-1 through TE-6 |
| 3b. Update Source Audit | YES | YES | 3 sources audited |
| 4. Retroactive Application Analysis | YES | YES | 7 parameters checked |
| 5. Assess Severity | YES | YES | 2 HIGH, 4 MEDIUM |

#### Economic Design Audit
| Section | Required | Completed? |
|---------|----------|------------|
| 1. Parameter Boundary Analysis | YES | YES |
| 2. Economic Invariant Identification | YES | YES |
| 3. Rate/Supply Interaction Matrix | YES | YES |
| 4. Fee Formula Verification | YES | YES |
| 5. Emission/Inflation Sustainability | N/A | N/A (no emission/rebase mechanics) |

---

## Findings Summary

### HIGH Severity
| ID | Title | Category |
|---|---|---|
| [TE-1] | teamTokenReservedWallet changes between preLaunch() and launch() splits reserves | Temporal |
| [TE-4] | EXECUTOR_ROLE can reset taxStartTime arbitrarily, enabling indefinite 99% tax | Temporal |
| [EC-1] | buyTax >= 100 causes underflow revert in anti-sniper cap, bricks all buys | Economic |
| [EC-2] | targetRealVirtual = 0 causes immediate graduation on first buy | Economic |
| [EC-3] | sellTax has no cap; >= 100 traps user funds (sells revert or yield 0) | Economic |
| [EC-4] | fakeInitialVirtualLiq = 0 causes division by zero, bricks preLaunch | Economic |

### MEDIUM Severity
| ID | Title | Category |
|---|---|---|
| [TE-2] | scheduledLaunchStartTimeDelay changes cause inconsistent fee classification | Temporal |
| [TE-3] | Validator timestamp manipulation can reduce 60s anti-sniper tax by up to 20% | Temporal |
| [TE-5] | taxStartTime=0 fallback edge cases in backward compatibility | Temporal |
| [TE-6] | Global antiSniperBuyTaxStartValue retroactively affects active windows | Temporal |
| [EC-11] | maxTx is never enforced; no transaction size limits exist | Economic |

### LOW / INFO
| ID | Title | Category |
|---|---|---|
| [EC-5] | K overflow risk with extreme parameter values | Economic |
| [EC-6] | Buy/sell tax asymmetry (input vs output based) - standard design | Economic |
| [EC-7] | Rounding dust: small transactions may pay zero tax | Economic |
| [EC-8] | Graduation math verified correct | Economic |
| [EC-9] | Graduation blocked during anti-sniper window - design choice | Economic |
| [EC-10] | BPS precision loss for pathological initialSupply values | Economic |

---

## Cross-References
- [TE-1] overlaps with B3 agent's wallet-change analysis (from temporal perspective, the gap between preLaunch and launch is the vulnerability window)
- [EC-1] and [EC-3] are related: both stem from missing validation in FFactoryV2/V3.setTaxParams()
- [TE-4] relates to the 23 SILENT SETTERS finding: setTaxStartTime emits TaxStartTimeSet event on the pair, but the router call is by EXECUTOR_ROLE with no event at router level
- [EC-4] referenced in constraint_variables.md observation #3
