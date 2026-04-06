# Second-Pass Re-Scan Analysis (Breadth Re-Scan Agent #2)

**Scope:** FRouterV2.sol, FRouterV3.sol, FFactoryV2.sol, FFactoryV3.sol, multicall3.sol, test/launchpadv5/
**Focus:** Gaps missed by first pass; multicall3.sol was completely uncovered.

---

## [RS2-1] FRouterV3.buy() and FRouterV3.sell() DoS when buyTax/sellTax is zero — AgentTaxV2.depositTax reverts on zero amount

**Severity:** High

**File:** `contracts/launchpadv2/FRouterV3.sol` lines 157–167 (sell) and 199–210 (buy)

**Description:**

In `FRouterV3.sell()`, the tax fee is calculated as:
```solidity
uint fee = factory.sellTax();
uint256 txFee = (fee * amountOut) / 100;
// ...
pair.transferAsset(address(this), txFee);
IERC20(assetToken).forceApprove(feeTo, txFee);
IAgentTaxForRouter(feeTo).depositTax(tokenAddress, txFee);  // line 167
```

When `sellTax == 0`, `txFee == 0`. The call to `AgentTaxV2.depositTax(tokenAddress, 0)` unconditionally reverts with `"Amount must be greater than 0"` (see `AgentTaxV2.sol:166`).

The same pattern exists in `FRouterV3.buy()`:
```solidity
uint256 normalTxFee = (normalTax * amountIn) / 100;
// ...
IERC20(assetToken).safeTransferFrom(to, address(this), normalTxFee);  // line 208
IERC20(assetToken).forceApprove(taxVault, normalTxFee);
IAgentTaxForRouter(taxVault).depositTax(tokenAddress, normalTxFee);  // line 210
```

When `buyTax == 0`, `normalTxFee == 0`, and `depositTax` reverts.

**Impact:** If a privileged admin ever sets `buyTax` or `sellTax` to 0 via `FFactoryV3.setTaxParams()`, **all trading through FRouterV3 is completely bricked** — no buys, no sells, no graduation. This is a permanent DoS until the tax is changed back to non-zero.

**Contrast with FRouterV2:** `FRouterV2.sell()` (line 157) directly calls `pair.transferAsset(feeTo, txFee)` — a direct transfer that succeeds even when `txFee == 0`. No depositTax call. FRouterV2 is unaffected by zero tax.

**Root Cause:** Missing guard `if (txFee > 0)` before the `depositTax` call in both `buy()` and `sell()` of FRouterV3.

**References:**
- `FRouterV3.sol:158–167` (sell tax path)
- `FRouterV3.sol:199–210` (buy tax path)
- `AgentTaxV2.sol:166` (`require(amount > 0, "Amount must be greater than 0")`)

---

## [RS2-2] Multicall3.batchTransferTokens() and batchWithdrawERC20Tokens() silently fail for admin callers — broken access control design

**Severity:** Medium

**File:** `contracts/launchpadv2/multicall3.sol` lines 446–460 (`batchTransferTokens`) and 494–508 (`batchWithdrawERC20Tokens`)

**Description:**

`batchTransferTokens` is declared `onlyOwnerOrAdmin` (line 450), so admins can call it. However, it delegates to `transferToken` which is `onlyOwner` (line 432). When an admin (non-owner) calls `batchTransferTokens`, the outer `onlyOwnerOrAdmin` check passes, but the inner `transferToken()` call checks `onlyOwner` against `msg.sender` (still the admin), and **reverts**.

The same inconsistency applies to `batchWithdrawERC20Tokens` (`onlyOwnerOrAdmin` at line 498) calling `withdrawERC20Token` (`onlyOwner` at line 476).

This means:
1. Admins believe they have batch transfer privileges (from the function signature) but every call silently fails
2. The `onlyOwnerOrAdmin` modifier on the batch functions is misleading — they are effectively owner-only

There is **no test coverage** for Multicall3 in the entire test suite (`test/` has zero references to `Multicall3`, `multicall3`, or any of these batch functions).

**Impact:** Operational failure — backend admins who are not the owner cannot execute batch operations. If admin wallets are granted to automation infrastructure expecting batch transfer rights, all such operations will revert unexpectedly. Admins could potentially be granted expanded roles thinking they can batch-withdraw, exposing an unmonitored operational gap.

**References:**
- `multicall3.sol:446–460` (`batchTransferTokens`)
- `multicall3.sol:428–440` (`transferToken`, `onlyOwner`)
- `multicall3.sol:494–508` (`batchWithdrawERC20Tokens`)
- `multicall3.sol:472–488` (`withdrawERC20Token`, `onlyOwner`)

---

## [RS2-3] BondingV5.cancelLaunch() violates Checks-Effects-Interactions — reentrancy possible before state is updated

**Severity:** Medium

**File:** `contracts/launchpadv2/BondingV5.sol` lines 462–497

**Description:**

`cancelLaunch()` has **no `nonReentrant` modifier** and performs an external call (`safeTransfer`) before updating critical state:

```solidity
function cancelLaunch(address tokenAddress_) public {  // No nonReentrant!
    // ...
    if (tokenRef.launchExecuted) { revert InvalidTokenStatus(); }  // Check

    if (tokenRef.initialPurchase > 0) {
        IERC20(router.assetToken()).safeTransfer(            // External call (line 480)
            tokenRef.creator,
            tokenRef.initialPurchase
        );
    }

    uint256 initialPurchase = tokenRef.initialPurchase;
    tokenRef.initialPurchase = 0;        // Effect (line 487) — AFTER call
    tokenRef.trading = false;
    tokenRef.launchExecuted = true;      // Effect (line 489) — AFTER call
```

The `tokenRef.initialPurchase` is zeroed and `tokenRef.launchExecuted` is set to `true` ONLY AFTER the external `safeTransfer` call. A reentrant call during the token transfer callback (e.g., ERC777 tokensReceived hook, or if the protocol replaces assetToken with a hook-bearing token) can re-enter `cancelLaunch()` and trigger another refund.

**Contrast with `launch()`:** `launch()` (line 499) correctly uses `nonReentrant`, and `_buy()` delegate path is protected. Only `cancelLaunch()` is unprotected.

**Current Risk:** The VIRTUAL token is a standard ERC20 without callback hooks, mitigating immediate exploitability. However, any future assetToken rotation to an ERC777/callback-bearing token makes this trivially exploitable: an attacker deploys a contract as the token creator that reenters `cancelLaunch()` from its `tokensReceived` hook.

**References:**
- `BondingV5.sol:462–497` (`cancelLaunch`)
- `BondingV5.sol:479–483` (external call before state update)
- `BondingV5.sol:487–489` (state update after external call)

---

## [RS2-4] FFactoryV2 and FFactoryV3 allow duplicate pair creation — existing pair overwritten in mapping, stranding funds

**Severity:** Medium

**File:** `contracts/launchpadv2/FFactoryV2.sol` lines 60–86 and `contracts/launchpadv2/FFactoryV3.sol` lines 68–94

**Description:**

Neither `_createPair` implementation checks whether a pair already exists for `(tokenA, tokenB)` before deploying a new one:

```solidity
function _createPair(...) internal returns (address) {
    require(tokenA != address(0), "Zero addresses are not allowed.");
    require(tokenB != address(0), "Zero addresses are not allowed.");
    require(router != address(0), "No router");

    FPairV2 pair_ = new FPairV2(...);

    _pair[tokenA][tokenB] = address(pair_);   // Overwrites existing entry!
    _pair[tokenB][tokenA] = address(pair_);
    // ...
```

If `createPair(tokenA, tokenB, ...)` is called twice with the same token pair:
1. The old FPairV2 contract remains deployed and holds any tokens that were minted to it
2. The `_pair` mapping now points to the new (empty) pair
3. The old pair's assets become **permanently stranded** — no way to recover them via router functions since the router queries `factory.getPair()` which now returns the new pair address
4. The `pairs` array grows unboundedly

**Precondition:** A malicious or misconfigured holder of `CREATOR_ROLE` (the bonding contract) would need to call `createPair` twice for the same agent token. In the normal BondingV5 flow, `tokenA` is always a fresh deployment, so this is not directly exploitable via a single bonding contract. However, if multiple BondingVX contracts share the same factory and can assign CREATOR_ROLE, or if a BondingVX has a bug that calls preLaunch logic twice, funds would be stranded.

There is also **no check for `tokenA == tokenB`** — a pair with identical tokens could be created, creating undefined AMM behavior.

**References:**
- `FFactoryV2.sol:60–86` (`_createPair`, no uniqueness check, no identical token check)
- `FFactoryV3.sol:68–94` (same issue)

---

## [RS2-5] Multicall3.aggregate3Value() post-hoc ETH balance check — ETH already forwarded before invariant is verified

**Severity:** Low/Medium

**File:** `contracts/launchpadv2/multicall3.sol` lines 239–291

**Description:**

In `aggregate3Value()`, ETH is forwarded to individual target contracts in the loop (line 255) BEFORE the invariant check at line 290:

```solidity
for (uint256 i = 0; i < length; ) {
    // ...
    (result.success, result.returnData) = calli.target.call{value: val}(  // ETH sent here
        calli.callData
    );
    unchecked {
        valAccumulator += val;  // Accumulation is UNCHECKED
    }
    // ...
}
// Finally, make sure the msg.value = SUM(call[0...i].value)
require(msg.value == valAccumulator, "Multicall3: value mismatch");  // Check AFTER sends
```

Two issues:
1. **ETH is sent to targets before verification.** If the accumulated `valAccumulator` overflows (though cosmically unlikely) or if any sub-call fails with `allowFailure=true`, ETH can be sent to an unintended target without a corresponding balance check having passed.
2. **The `unchecked` addition of `valAccumulator`** (lines 252–254) is a deliberate design from the original Multicall3 library. However in this custom deployment where `aggregate3Value` is restricted to `onlyOwnerOrAdmin`, a misconfigured admin could craft calls where `val` values sum to overflow `uint256`, bypassing the `msg.value == valAccumulator` check and forwarding more ETH than was sent (since the check would pass with a wrapped-around value).

**Note:** The `valAccumulator` overflow requires sending `~10^77 WEI` which is physically impossible with current ETH supply. The post-hoc check issue (item 1) is more practically relevant — if a call with `allowFailure=true` fails and ETH has been sent, the ETH remains with the target and is not refunded.

**References:**
- `multicall3.sol:252–254` (unchecked accumulation)
- `multicall3.sol:255` (ETH forwarded before check)
- `multicall3.sol:290` (invariant check happens after all sends)

---

## [RS2-6] FFactoryV2 and FFactoryV3 setTaxParams() allows antiSniperTaxVault to be zero address — silent no-op

**Severity:** Low

**File:** `contracts/launchpadv2/FFactoryV2.sol` lines 108–122 and `contracts/launchpadv2/FFactoryV3.sol` lines 116–130

**Description:**

`setTaxParams()` validates that `newVault_` (taxVault) is non-zero but does **not validate** `antiSniperTaxVault_`:

```solidity
function setTaxParams(
    address newVault_,
    uint256 buyTax_,
    uint256 sellTax_,
    uint256 antiSniperBuyTaxStartValue_,
    address antiSniperTaxVault_  // No zero-address check!
) public onlyRole(ADMIN_ROLE) {
    require(newVault_ != address(0), "Zero addresses are not allowed.");

    taxVault = newVault_;
    buyTax = buyTax_;
    sellTax = sellTax_;
    antiSniperBuyTaxStartValue = antiSniperBuyTaxStartValue_;
    antiSniperTaxVault = antiSniperTaxVault_;  // Can be set to address(0)
```

If `antiSniperTaxVault` is set to `address(0)`:
- In `FRouterV2.buy()` (line 206–211): `safeTransferFrom(to, address(0), antiSniperTxFee)` will revert (SafeERC20 prevents transfers to zero address), bricking all non-initial buys when anti-sniper tax is active
- In `FRouterV3.buy()` (line 213–218): Same revert

**Impact:** An admin misconfiguration could DoS all buys during the anti-sniper period for all tokens on that factory.

**References:**
- `FFactoryV2.sol:108–122` (`setTaxParams`, missing antiSniperTaxVault validation)
- `FFactoryV3.sol:116–130` (same)
- `FRouterV2.sol:206–211` (antiSniperTaxVault used as transfer recipient)
- `FRouterV3.sol:213–218` (same)

---

## [RS2-7] Multicall3 has zero test coverage — entire contract uncovered

**Severity:** Informational (Coverage Gap)

**File:** All of `contracts/launchpadv2/multicall3.sol`

**Description:**

The Multicall3 contract (529 lines) has **zero test coverage** in the test suite. No test file in the repository references `Multicall3`, `multicall3`, `aggregate`, `batchTransferTokens`, `batchWithdrawERC20Tokens`, `withdrawETH`, or any other Multicall3 function.

This contract holds:
- Privileged `aggregate()`, `aggregate3()`, `aggregate3Value()` functions that can make arbitrary external calls to any contract on behalf of the owner/admin
- Token approval functions (`approveToken`, `batchApproveTokens`) callable by admins
- Token withdrawal functions (`withdrawERC20Token`, `withdrawETH`)
- ETH forwarding in loops with assembly

The complete lack of tests means:
- The broken admin access control in batch functions (RS2-2) was never caught
- The post-hoc ETH check in aggregate3Value (RS2-5) was never tested
- No regression protection for any of the privileged operations

**References:**
- `multicall3.sol` (entire file — 529 lines, zero test coverage)

---

## [RS2-8] FRouterV3._calculateAntiSniperTax linear rounding — tax systematically truncates toward 0, favoring early large buyers

**Severity:** Low

**File:** `contracts/launchpadv2/FRouterV3.sol` line 318

**Description:**

The anti-sniper tax calculation uses integer division at the end:

```solidity
return startTax * (duration - timeElapsed) / duration;  // line 318
```

This is a divide-at-end calculation (better than divide-before-multiply), but the result always rounds DOWN. In the worst case, a buyer buying at the last second before full decay pays 0 tax instead of a fractional percentage. This is a minor economic imprecision.

More importantly, the FRouterV2 anti-sniper tax calculation uses a different approach:

```solidity
// FRouterV2 (line 345)
uint256 taxReduction = isXLaunch ? timeElapsed : (timeElapsed / 60);
if (startTax <= taxReduction) { return 0; }
return startTax - taxReduction;
```

FRouterV2 decreases by 1% per minute (stepped, not linear), FRouterV3 uses a smooth linear decay. This is an intentional behavioral difference but means tokens migrated from V2 factory to V3 factory would experience different anti-sniper behavior even with the same `antiSniperBuyTaxStartValue`. There is no test verifying that the V2→V3 transition preserves expected tax behavior at boundary conditions.

**References:**
- `FRouterV3.sol:318` (linear tax calculation with floor rounding)
- `FRouterV2.sol:345–351` (step-based decay, different algorithm)

---

## [RS2-9] FFactory pair creation: tokenA == tokenB allowed — degenerate pair with self-referential reserves

**Severity:** Low

**File:** `contracts/launchpadv2/FFactoryV2.sol` line 60–86 and `contracts/launchpadv2/FFactoryV3.sol` lines 68–94

**Description:**

Neither factory checks for `tokenA == tokenB`. A pair created with the same token for both sides would result in a degenerate AMM state where:
- `_pair[token][token] = address(pair)` — self-referential mapping
- The pair's `getAmountsOut` would compute against itself, creating infinite AMM loops
- `balance()` and `assetBalance()` call `balanceOf(address(this))` for the SAME token — identical values

While CREATOR_ROLE is restricted to bonding contracts and the bonding contracts always create fresh agent tokens with the asset token as the second argument (making `tokenA == tokenB` very unlikely in production), any future misconfiguration or attack vector on CREATOR_ROLE could result in this degenerate state.

**References:**
- `FFactoryV2.sol:66–67` (only zero-address checks, no identity check)
- `FFactoryV3.sol:74–75` (same)

---

## Summary Table

| ID | Title | Severity | File |
|----|-------|----------|------|
| RS2-1 | FRouterV3 buy/sell DoS when tax is zero (depositTax reverts) | High | FRouterV3.sol:158–210 |
| RS2-2 | Multicall3 batch functions silently fail for admins (broken access control) | Medium | multicall3.sol:446–508 |
| RS2-3 | BondingV5.cancelLaunch() CEI violation — reentrancy before state update | Medium | BondingV5.sol:462–497 |
| RS2-4 | FFactory duplicate pair creation overwrites mapping, strands funds | Medium | FFactoryV2.sol:60–86, FFactoryV3.sol:68–94 |
| RS2-5 | Multicall3.aggregate3Value() post-hoc ETH check — ETH already forwarded | Low/Med | multicall3.sol:239–291 |
| RS2-6 | FFactory setTaxParams allows antiSniperTaxVault=address(0) | Low | FFactoryV2.sol:108–122, FFactoryV3.sol:116–130 |
| RS2-7 | Multicall3 has zero test coverage | Info | multicall3.sol (all) |
| RS2-8 | FRouterV3 anti-sniper tax rounds toward zero; V2/V3 algorithm mismatch | Low | FRouterV3.sol:318, FRouterV2.sol:345 |
| RS2-9 | FFactory allows tokenA == tokenB degenerate pair creation | Low | FFactoryV2.sol:66, FFactoryV3.sol:74 |
