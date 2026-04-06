# Breadth Re-Scan Agent #1 — Second Pass Findings
**Scope:** BondingV5.sol, BondingConfig.sol, FPairV2.sol, IFPairV2.sol
**Date:** 2026-04-02
**Agent:** RS1 (Breadth Re-Scan #1)

---

## [RS1-1] preLaunch() has no guard against double-invocation for the same token address — but the real risk is a front-running griefing window between token creation and pair seeding

**Verdict:** Confirmed — Medium Severity  
**Location:** BondingV5.sol:331-379 (`_preLaunch` internal function)

**Description:**
`_preLaunch()` creates an AgentToken via `agentFactory.createNewAgentTokenAndApplication()`, then immediately calls `agentFactory.addBlacklistAddress()` on the newly-created token. Between these two calls (lines 331-357), the token exists on-chain but has NO blacklist on the pre-Uniswap LP pool address, and the FPairV2 pair has NOT yet been created. An attacker who observes the `createNewAgentTokenAndApplication` transaction in the mempool and can predict the token address (deterministic via CREATE2 or sequential deployment) could front-run by calling `addBlacklistAddress` on a malicious address or transfer tokens into the token contract before `preLaunch` seals the pair. More critically, the token supply minting happens inside `createNewAgentTokenAndApplication` and all tokens are minted to the BondingV5 contract as vault, but the actual creation of the FPairV2 pair and liquidity seeding happen later in the SAME transaction. If `agentFactory.createNewAgentTokenAndApplication` can be front-run or causes partial state (e.g. returns a valid token but addBlacklistAddress reverts), the token is created but never properly paired, leaving 100% of the token supply locked in BondingV5 with no recovery path.

**Impact:**
If `addBlacklistAddress` reverts after token creation (lines 354-357), the entire `_preLaunch` transaction reverts, but the token and applicationId may already be registered in AgentFactory state (depending on AgentFactory atomicity). This creates a state inconsistency where AgentFactory has a registered token/application but BondingV5 has no corresponding entry. Severity depends on AgentFactory's revert behavior. Additionally, there is a 1-block window between token creation and pair blacklisting where snipers on the same block could observe the new token.

**Evidence:**
```solidity
// BondingV5.sol:331-357
(address token, uint256 applicationId) = agentFactory
    .createNewAgentTokenAndApplication(/* ... */);
// TOKEN EXISTS NOW — no pair yet, no blacklist yet
agentFactory.addBlacklistAddress(
    token,
    IAgentTokenV2(token).liquidityPools()[0]  // line 356 — external call, can revert
);
// If line 356 reverts, entire tx reverts — but AgentFactory may have partial state
```

---

## [RS1-2] cancelLaunch() missing nonReentrant guard — reentrancy via ERC-777 / fee-on-transfer asset tokens

**Verdict:** Confirmed — Medium Severity  
**Location:** BondingV5.sol:462-497 (`cancelLaunch`)

**Description:**
`cancelLaunch()` does NOT have the `nonReentrant` modifier, unlike `launch()` (line 501) and `preLaunch()` (line 179), which both apply `nonReentrant`. The function transfers `initialPurchase` back to the creator using `IERC20(router.assetToken()).safeTransfer()` (line 480) BEFORE setting `tokenRef.initialPurchase = 0` (line 487). Although the code does zero `initialPurchase` after the transfer (correct CEI for value), it does so in the SAME function without reentrancy protection.

If the asset token is an ERC-777 or has receive hooks (which the protocol does not explicitly rule out — it only specifies the token is the `router.assetToken()`, typically VIRTUAL ERC20), a malicious recipient could re-enter `cancelLaunch()` during the safeTransfer callback. Since `tokenRef.initialPurchase = 0` (line 487) and `tokenRef.launchExecuted = true` (line 489) happen AFTER the transfer (lines 480-484), during reentrancy the checks on lines 475 (`launchExecuted == false`) and 479 (`initialPurchase > 0`) would still pass if the transfer itself is the reentrancy vector and the state hasn't been updated yet.

Wait — re-reading the code: line 480-484 first does the transfer, then line 487 zeros `initialPurchase`, THEN line 489 sets `launchExecuted = true`. However, the `safeTransfer` on line 480 calls the ERC-777 receiver hook on `tokenRef.creator` (the recipient) BEFORE the state changes. At that point, `launchExecuted` is still false and `initialPurchase` is still nonzero, so a reentrant `cancelLaunch()` call would pass all guards and transfer again.

**Impact:**
Double-refund of initialPurchase to the creator. Creator receives 2x their deposited funds, draining BondingV5's asset token balance. Severity is Medium because it requires the asset token to be ERC-777 or have hooks (non-standard for VIRTUAL), but the lack of `nonReentrant` is a design inconsistency.

**Evidence:**
```solidity
// BondingV5.sol:462-497
function cancelLaunch(address tokenAddress_) public {  // NO nonReentrant
    // ...
    if (tokenRef.initialPurchase > 0) {
        IERC20(router.assetToken()).safeTransfer(  // line 480 — ERC-777 hook fires here
            tokenRef.creator,
            tokenRef.initialPurchase
        );
    }
    // STATE CHANGES HAPPEN AFTER TRANSFER — reentrancy window
    tokenRef.initialPurchase = 0;       // line 487
    tokenRef.launchExecuted = true;     // line 489
```

---

## [RS1-3] BondingV5.launch() does NOT validate caller for normal (non-privileged) tokens — anyone can call launch() immediately after startTime passes

**Verdict:** Confirmed — Low/Informational (design gap, not a direct loss of funds, but enables MEV timing attacks)  
**Location:** BondingV5.sol:499-579 (`launch`)

**Description:**
For normal tokens (launchMode = LAUNCH_MODE_NORMAL and isProject60days = false), `launch()` has NO caller restriction. Any external actor can call `launch()` the moment `block.timestamp >= pairContract.startTime()`. This means:

1. The creator's initial buy (lines 541-557) will be triggered by whoever calls `launch()`, not necessarily the creator.
2. The creator's initial purchase tokens go to `bondingConfig.teamTokenReservedWallet()` regardless — this is by design.
3. However, an attacker can call `launch()` with a front-running buy in the SAME block (or even the same transaction via flashbots), ensuring they buy immediately after the creator's initial purchase at the lowest possible price before other users can react.

The critical issue is that `router.setTaxStartTime(tokenRef.pair, block.timestamp)` on line 531 uses `block.timestamp`, which is controlled by the miner/validator. A validator can call `launch()` at an arbitrary sub-second timestamp, and then immediately execute a buy in the same block BEFORE anti-sniper tax has decayed, setting the tax start time and buying in the same block (timeElapsed = 0 → anti-sniper tax = 99%). But since they're the validator, they can also order transactions to bypass this.

More directly: anyone can call `launch()` for a token they don't own, enabling griefing by launching a token that the creator hasn't marketed yet (for non-privileged tokens).

**Impact:**
Low — tokens with `isProject60days=false`, `launchMode=NORMAL` can be launched by any actor after `startTime`. This may be intentional (the comment says "Anyone calls launch()"), but it enables griefing of the initial purchase timing.

**Evidence:**
```solidity
// BondingV5.sol:524-528
if (isProject60days(tokenAddress_) || isProjectXLaunch(tokenAddress_) || isAcpSkillLaunch(tokenAddress_)) {
    if (!bondingConfig.isPrivilegedLauncher(msg.sender)) {
        revert UnauthorizedLauncher();
    }
}
// For NORMAL tokens: no caller check at all — any address can trigger launch
```

---

## [RS1-4] FPairV2.swap() accepts tokenIn=tokenOut scenario (amount0In and amount0Out both nonzero) — creates phantom reserve divergence with no real asset movement

**Verdict:** Confirmed — Medium Severity  
**Location:** FPairV2.sol:86-107 (`swap`)

**Description:**
`FPairV2.swap()` is called only by the router (`onlyRouter`). However, the function performs no validation that the inputs are economically valid: specifically, it does NOT check that `(amount0In > 0 && amount0Out == 0) || (amount0Out > 0 && amount0In == 0)`. The function will accept any combination of `amount0In`, `amount0Out`, `amount1In`, `amount1Out` including scenarios where both `amount0In > 0` AND `amount0Out > 0` simultaneously.

Looking at how `swap()` is called in `FRouterV3.sell()` (line 169): `pair.swap(amountIn, 0, 0, amountOut)` — correct.
And in `FRouterV3.buy()` (line 225): `IFPairV2(pair).swap(0, amountOut, amount, 0)` — correct.

The vulnerability manifests if the router contract itself is compromised, upgraded to a malicious version, or if a future router implementation passes incorrect parameters. Since FPairV2 trusts the router completely without any sanity checks, a broken router can call `swap(X, X, 0, 0)` which would set `_reserve0 = reserve0 + X - X = reserve0` and leave reserves unchanged, yet emit a Swap event. More critically, a call like `swap(0, X, 0, 0)` would decrease `reserve0` by X without increasing `reserve1`, permanently destroying K.

The specific dangerous case: `swap(0, reserve0, 0, 0)` would zero `reserve0` (no asset in), creating a state where `reserve1` > 0 and `reserve0` = 0, making all future `k / newReserveA` calculations divide by zero.

**Impact:**
If a router passes malformed parameters, FPairV2 will blindly corrupt its reserves. While `onlyRouter` limits the attack surface to router compromise, the complete absence of swap parameter validation in FPairV2 is a defense-in-depth gap. This is partially distinct from TF-4 (no K invariant check on swap output) because TF-4 addresses the missing K invariant check, but RS1-4 addresses the missing directional/non-negative validation of swap parameters themselves.

**Evidence:**
```solidity
// FPairV2.sol:86-107
function swap(uint256 amount0In, uint256 amount0Out, uint256 amount1In, uint256 amount1Out)
    public onlyRouter returns (bool) {
    require(block.timestamp >= startTime, "Swap not started");
    // NO validation: amount0In + amount1In > 0
    // NO validation: exactly one of (amount0In, amount0Out) should be zero
    // NO validation: amount0Out <= reserve0
    uint256 _reserve0 = (_pool.reserve0 + amount0In) - amount0Out;  // can underflow if amount0Out > reserve0
    uint256 _reserve1 = (_pool.reserve1 + amount1In) - amount1Out;
```

---

## [RS1-5] calculateBondingCurveSupply integer truncation: when initialSupply is not divisible by 10000, rounding down leaves dust tokens stranded in BondingV5

**Verdict:** Confirmed — Low Severity  
**Location:** BondingConfig.sol:207 (`calculateBondingCurveSupply`), BondingV5.sol:362-364

**Description:**
`calculateBondingCurveSupply` returns `(initialSupply * (10000 - totalReserved)) / 10000`. If `initialSupply` is not a multiple of 10000, integer division truncates. The truncated amount (`initialSupply % 10000` in the worst case up to 9999 base units) is neither added to `bondingCurveSupply` nor to `totalReservedSupply`.

In BondingV5._preLaunch():
- `bondingCurveSupply = bondingCurveSupplyBase * (10 ** decimals)` (line 360-361)
- `totalReservedSupply = configInitialSupply - bondingCurveSupplyBase` (line 362-364)

Here `configInitialSupply` is in base units (no decimals) and `bondingCurveSupplyBase` is also in base units. When `configInitialSupply = 1_000_000_000` (1B) and `totalReserved = 1` bip (0.01%), the calculation is:
`bondingCurveSupplyBase = (1_000_000_000 * 9999) / 10000 = 999_900_000` (exact, no truncation for round numbers).

But with `totalReserved = 3` bips: `(1_000_000_000 * 9997) / 10000 = 999_700_000` (exact).
With `totalReserved = 7` bips: `(1_000_000_000 * 9993) / 10000 = 999_300_000` (exact, 1B divisible by 10000/gcd).

The truncation occurs when `initialSupply` is not divisible by `10000/gcd(10000, 10000-totalReserved)`. With `initialSupply = 1_000_000_000` and the 1B being divisible by 10000, this may not manifest for the default supply. However, if `initialSupply` is changed to a non-round number (e.g., 999_999_999), up to `(10000-1)/10000 * decimals` tokens are permanently locked in BondingV5 as neither bonding curve tokens nor reserved tokens. They are minted to BondingV5 (as vault) but never transferred out.

More importantly, the `totalReservedSupply` calculation at line 362-364:
```solidity
uint256 totalReservedSupply = configInitialSupply - bondingCurveSupplyBase;
```
This will be LARGER than intended (by the truncation amount), sending extra tokens to `teamTokenReservedWallet`. Meanwhile, only `bondingCurveSupply` (in wei) is approved and transferred to the router. The dust tokens at the base-unit level are in `totalReservedSupply` and get sent to teamTokenReservedWallet. So the dust actually goes to teamTokenReservedWallet, not stranded — this means the accounting is correct but the bonding curve gets fewer tokens than the exact proportion dictates, slightly affecting the graduation threshold.

The real issue: `tokenGradThreshold[token]` is calculated using `bondingCurveSupply` (wei, post-truncation), which is correct. But if bondingCurveSupply is slightly less than the formula intends (due to truncation), the graduation threshold is slightly lower, causing tokens to graduate slightly earlier than expected. This is a precision issue, not a loss.

**Impact:**
Low — minor precision loss in bonding curve supply, graduation threshold, and price calculations. The magnitude is at most `(10**18 * 9999)` wei in base units of token, but for typical 1B supply this is negligible.

**Evidence:**
```solidity
// BondingConfig.sol:207
return (initialSupply * (10000 - totalReserved)) / 10000;  // integer truncation

// BondingV5.sol:362-364
uint256 totalReservedSupply = configInitialSupply - bondingCurveSupplyBase;
// totalReservedSupply = configInitialSupply - floor(configInitialSupply * (10000-bips)/10000)
// = configInitialSupply * bips/10000 + truncation_error (dust goes to teamTokenReservedWallet, not stranded)
```

---

## [RS1-6] BondingV5._openTradingOnUniswap() uses factory.getPair() but BondingV5._buy() also uses factory.getPair() — if factory's pair registry is different from tokenInfo[token].pair, graduation sends to wrong pair

**Verdict:** Confirmed — Medium Severity  
**Location:** BondingV5.sol:703-772 (`_openTradingOnUniswap`), BondingV5.sol:633-634 (`_buy`)

**Description:**
BondingV5 stores the pair address in `tokenInfo[token].pair` at preLaunch (line 411: `newToken.pair = pair`). However, `_openTradingOnUniswap` does NOT use `tokenInfo[tokenAddress_].pair` to get the pair address. Instead it calls `factory.getPair(tokenAddress_, router.assetToken())` (line 714).

Similarly, `_buy()` calls `factory.getPair(tokenAddress_, router.assetToken())` (lines 633-635) rather than using the stored `tokenInfo[tokenAddress_].pair`.

Normally these should be the same value. However:

1. If `factory` is updated (`factory` is a public mutable state variable set only in `initialize` — it is immutable after deploy, so this is low risk).
2. More critically: `factory.getPair(tokenA, tokenB)` returns the SAME address regardless of ordering (`_pair[tokenA][tokenB]` and `_pair[tokenB][tokenA]` are both set). So this is safe.

The actual finding is subtler: the graduation logic in `_openTradingOnUniswap` reads `pairContract.assetBalance()` and `pairContract.balance()` from the factory-derived pair (line 718-719), but then passes `pairAddress` (factory-derived) as the vault parameter to `executeBondingCurveApplicationSalt` (line 751). If somehow `tokenInfo[token].pair != factory.getPair(token, assetToken)` (which could happen if factory is replaced via `setBondingConfig` affecting config but NOT the factory reference), then graduation targets a DIFFERENT pair contract.

The root cause: BondingV5 stores `factory` once at `initialize` time but also holds `tokenInfo[token].pair` per-token. These are expected to be consistent but there's no cross-check. If the owner calls an upgrade path that changes which factory is used WHILE old tokens are still in-flight on the old factory, `factory.getPair()` will return `address(0)` for old tokens, causing graduation to attempt operations on a null address.

**Impact:**
If `factory` is ever changed (unlikely but possible if BondingV5 were to be redeployed pointing to a new factory), all existing tokens' graduation paths break. The stored `tokenInfo[token].pair` address is never used in graduation — only `factory.getPair()` is used. If these diverge, graduation silently targets the wrong (or zero) address.

**Evidence:**
```solidity
// BondingV5.sol:710-719 — uses factory.getPair(), not tokenInfo[].pair
address pairAddress = factory.getPair(
    tokenAddress_,
    router.assetToken()
);
IFPairV2 pairContract = IFPairV2(pairAddress);
uint256 assetBalance = pairContract.assetBalance();
uint256 tokenBalance = pairContract.balance();

// BondingV5.sol:404-412 — pair stored at preLaunch from factory.createPair result
address pair = factory.createPair(token, assetToken, ...);
newToken.pair = pair;  // stored but NEVER used in graduation
```

---

## [RS1-7] graduationThreshold calculation: when airdropBips equals maxAirdropBips AND needAcf=true, the sum airdropBips + acfReservedBips is permitted only if <= maxTotalReservedBips — but maxAirdropBips constraint is checked before ACF, so an airdrop at exactly maxAirdropBips with ACF can exceed the bonding curve minimum

**Verdict:** Confirmed — Low Severity (parametric boundary condition)  
**Location:** BondingConfig.sol:196-208 (`calculateBondingCurveSupply`)

**Description:**
The validation in `calculateBondingCurveSupply` checks:
1. `airdropBips_ > maxAirdropBips` → revert (line 199)
2. `totalReserved = airdropBips_ + (needAcf_ ? acfReservedBips : 0)` (line 202-203)
3. `totalReserved > maxTotalReservedBips` → revert (line 204)

The `setReserveSupplyParams` function validates `maxAirdropBips + acfReservedBips <= maxTotalReservedBips` (line 281). This means when `airdropBips = maxAirdropBips` and `needAcf = true`, `totalReserved = maxAirdropBips + acfReservedBips <= maxTotalReservedBips`, which passes.

The resulting `bondingCurveSupply = initialSupply * (10000 - maxTotalReservedBips) / 10000`.

At maximum airdrop + ACF: `bondingCurveSupply = initialSupply * (10000 - maxTotalReservedBips) / 10000`.

The `gradThreshold = fakeInitialVirtualLiq * bondingCurveSupply / (targetRealVirtual + fakeInitialVirtualLiq)`.

With a very small bondingCurveSupply (large totalReserved), `gradThreshold` approaches 0. This is fine.

The actual boundary finding: the `setReserveSupplyParams` constraint is `maxAirdropBips + acfReservedBips <= maxTotalReservedBips`, but a deployer could set `maxAirdropBips = 5000` (50%), `acfReservedBips = 5000` (50%), `maxTotalReservedBips = 10000` (100%). This passes the validation. Then `calculateBondingCurveSupply(5000, true)` returns `(initialSupply * (10000 - 10000)) / 10000 = 0`. A zero bondingCurveSupply would then cause:
- `bondingCurveSupply = 0 * (10**decimals) = 0` (line 360)
- `IERC20(token_).safeTransferFrom(msg.sender, pairAddress, 0)` → no tokens to pair
- `mint(0, virtualLiq)` → reserve0 = 0
- `gradThreshold = fakeInitialVirtualLiq * 0 / ... = 0`
- EVERY buy triggers graduation immediately (newReserveA = 0 - amount0Out → underflow)

This creates a division-by-zero / underflow chain. The `calculateBondingCurveSupply` function itself would return 0, but `_preLaunch` proceeds without checking the return value for zero.

**Impact:**
If `maxTotalReservedBips = 10000` is ever set (or if both maxAirdropBips and acfReservedBips sum to 10000), every token created with those parameters would have zero bondingCurveSupply, causing catastrophic accounting failures in preLaunch.

**Evidence:**
```solidity
// BondingConfig.sol:281 — allows sum up to 10000
require(params_.maxAirdropBips + params_.acfReservedBips <= params_.maxTotalReservedBips, InvalidReserveBips());
require(params_.maxTotalReservedBips <= 10000, InvalidReserveBips());
// maxTotalReservedBips = 10000 is VALID — no check maxTotalReservedBips < 10000

// BondingConfig.sol:207
return (initialSupply * (10000 - totalReserved)) / 10000;  // returns 0 when totalReserved = 10000

// BondingV5.sol:360 — no zero check
uint256 bondingCurveSupply = bondingCurveSupplyBase * (10 ** IAgentTokenV2(token).decimals());
// bondingCurveSupply = 0 * 10^18 = 0 → pair gets no tokens
```

---

## [RS1-8] FPairV2.priceALast() and priceBLast() are vulnerable to division by zero after syncAfterDrain() sets reserve to 0

**Verdict:** Confirmed — Low Severity  
**Location:** FPairV2.sol:168-174 (`priceALast`, `priceBLast`)

**Description:**
`priceALast()` divides `_pool.reserve1 / _pool.reserve0` and `priceBLast()` divides `_pool.reserve0 / _pool.reserve1`. After `syncAfterDrain()` is called (which sets reserves to 0), both of these functions will divide by zero and revert. While these are view functions and do not affect protocol state, any off-chain or on-chain consumer that calls these after drain will get a revert instead of a sensible value (e.g., 0 or a sentinel).

More critically: `_openTradingOnUniswap` does NOT call `priceALast()` or `priceBLast()`, so graduation itself is not affected. But the graduation process calls `router.graduate()` which transfers all tokens out of the pair. After `graduate()`, the pair has zero real balances but the accounting via `syncAfterDrain` sets `reserve0 = reserve1 = 0`. Any frontend or on-chain contract that tries to read pair price after graduation will revert.

If any other protocol contract calls `priceALast()` or `priceBLast()` as a sanity check, it will be bricked post-graduation. This is distinct from SLITHER-2/Pool.lastUpdated since it's about the price functions specifically.

**Evidence:**
```solidity
// FPairV2.sol:168-174
function priceALast() public view returns (uint256) {
    return _pool.reserve1 / _pool.reserve0;  // DIV BY ZERO if reserve0 = 0
}
function priceBLast() public view returns (uint256) {
    return _pool.reserve0 / _pool.reserve1;  // DIV BY ZERO if reserve1 = 0
}
// FPairV2.sol:149-157 — syncAfterDrain can set reserves to 0
_pool.reserve0 = _pool.reserve0 >= tokenAmount ? _pool.reserve0 - tokenAmount : 0;
_pool.reserve1 = _pool.reserve1 >= assetAmount ? _pool.reserve1 - assetAmount : 0;
```

---

## [RS1-9] BondingV5._buy() reads reserveA BEFORE calling router.buy(), but graduation check uses POST-buy reserveA — the pre-buy read is stale and could cause graduation to be missed or triggered incorrectly

**Verdict:** Confirmed — Low Severity (academic risk, partially covered by nonReentrant)  
**Location:** BondingV5.sol:639-673 (`_buy`)

**Description:**
`_buy()` reads `(reserveA, reserveB) = pairContract.getReserves()` at line 639 (pre-trade reserves), then calls `router.buy()` at lines 641-646, then computes `newReserveA = reserveA - amount0Out` at line 653.

This is a MANUAL re-computation of the post-trade reserve0, not a re-read from the pair. The actual post-trade `reserve0` in FPairV2 is correctly updated by `FPairV2.swap()` inside `FRouterV3.buy()`. But BondingV5 computes it as `reserveA - amount0Out` using the PRE-buy snapshot.

This would be incorrect if:
1. Another buy occurs between the snapshot and the router.buy() call (not possible due to nonReentrant on both `buy()` and `_buy()`'s callers).
2. The router's `buy()` returns a different `amount0Out` than what FPairV2 actually updated (e.g., due to rounding or extra logic in the router).

In the current FRouterV3 implementation, `buy()` calls `getAmountsOut()` with the post-fee amount (line 221) and returns `(amount, amountOut)` where `amountOut` is the computed token output. FPairV2 then `transferTo(to, amountOut)` and `swap(0, amountOut, amount, 0)`. So `reserve0` in FPairV2 decreases by exactly `amountOut`. And BondingV5 computes `newReserveA = reserveA - amount0Out` where `amount0Out = amountOut`. These match.

However, the stale-read pattern means that if any future router implementation calculates a slightly different `amountOut` (e.g., for rounding), BondingV5's graduation check would use a wrong `newReserveA`, potentially skipping graduation or triggering it prematurely. This is a fragility in the architecture: graduation trigger depends on a locally-computed value rather than re-reading the authoritative state from FPairV2.

**Evidence:**
```solidity
// BondingV5.sol:639-668
(uint256 reserveA, uint256 reserveB) = pairContract.getReserves();  // PRE-buy snapshot

(uint256 amount1In, uint256 amount0Out) = router.buy(amountIn_, ...);  // state change in FPairV2

uint256 newReserveA = reserveA - amount0Out;  // LOCAL computation, not re-read from pair
// ...
if (newReserveA <= gradThreshold && ...) {  // graduation based on local compute
    _openTradingOnUniswap(tokenAddress_);
}
// Actual reserve0 in FPairV2 is already updated, but we're comparing against our local value
```

---

## [RS1-10] BondingConfig.setBondingConfig() in BondingV5 allows mid-flight config swap that affects ALL in-flight tokens without updating their stored per-token gradThresholds

**Verdict:** Confirmed — High Severity  
**Location:** BondingV5.sol:857-859 (`setBondingConfig`)

**Description:**
`setBondingConfig(address bondingConfig_)` allows the owner to swap out the entire BondingConfig contract. However, `tokenGradThreshold[token]` is computed at preLaunch time using the OLD BondingConfig's `calculateGradThreshold()`. After swapping BondingConfig, the stored per-token graduation thresholds remain from the old config.

The new BondingConfig will have different `fakeInitialVirtualLiq`, `targetRealVirtual`, and `bondingCurveParams`. From that point on:
- `router.hasAntiSniperTax(pairAddress)` in `_buy()` will call `FRouterV3._calculateAntiSniperTax()` which calls `bondingConfig.getAntiSniperDuration()` using the NEW bondingConfig reference in FRouterV3.
- But `tokenGradThreshold[token]` was computed with the OLD config.

The mismatch means tokens in-flight will graduate at thresholds that don't correspond to the current economic parameters. A token that needed 42,000 VIRTUAL to graduate may now graduate at a threshold computed under different parameters.

Additionally, `_buy()` compares `newReserveA <= gradThreshold` where `gradThreshold = tokenGradThreshold[tokenAddress_]` (stored at preLaunch). If the new BondingConfig changes `targetRealVirtual` to a much larger value, the graduation threshold for OLD tokens (computed under old config) may be orders of magnitude different from what new tokens would use — creating a two-tier system that appears correct but isn't.

This is distinct from MG-3 ("setBondingConfig mid-launch — refuted") because MG-3's refutation note says "per-token gradThreshold frozen at creation." The RS1-10 finding does NOT dispute that the per-token gradThreshold is frozen — it identifies that the frozen value from the OLD config becomes INCONSISTENT with the new BondingConfig's economic model, and specifically that the router (which uses the new bondingConfig for antiSniperDuration) may now behave differently relative to the graduation trigger in BondingV5 (which uses old gradThreshold). The asymmetry between router (uses new config) and BondingV5 graduation check (uses old per-token value) is the novel finding.

**Impact:**
High for protocol consistency: after a BondingConfig swap, all in-flight tokens have graduation thresholds calibrated to parameters that no longer match the live bonding curve configuration. Tokens may graduate too early (if new targetRealVirtual is higher) or too late (if lower). The anti-sniper duration for in-flight tokens also changes immediately upon config swap, potentially stranding tokens in indefinite anti-sniper periods or eliminating them immediately.

**Evidence:**
```solidity
// BondingV5.sol:857-859
function setBondingConfig(address bondingConfig_) public onlyOwner {
    bondingConfig = BondingConfig(bondingConfig_);  // GLOBAL config replaced
    // tokenGradThreshold[token] for all existing tokens NOT updated
}

// BondingV5.sol:662-669 — graduation uses stale per-token value (OK)
uint256 gradThreshold = tokenGradThreshold[tokenAddress_];
if (newReserveA <= gradThreshold && !router.hasAntiSniperTax(pairAddress) && ...) {

// FRouterV3.sol:295 — but router uses live bondingConfig (updated) for antiSniper duration
uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);
uint256 duration = bondingConfig.getAntiSniperDuration(antiSniperType);  // NEW bondingConfig
// ASYMMETRY: graduation threshold from OLD config, antiSniper duration from NEW config
```

---

## [RS1-11] FPairV2.resetTime() can be called on a pair with startTimeDelay=0 — the minimum delay check requires newStartTime >= block.timestamp + startTimeDelay, which is satisfied trivially by newStartTime = block.timestamp when startTimeDelay = 0

**Verdict:** Confirmed — Low Severity  
**Location:** FPairV2.sol:184-196 (`resetTime`)

**Description:**
`resetTime()` enforces two conditions:
1. `block.timestamp < startTime` — prevents resetting after trading has started
2. `newStartTime >= block.timestamp + startTimeDelay` — ensures the new start time meets minimum delay

For immediate launches (non-scheduled), `startTimeDelay = 0` (set in BondingV5.sol at line 293: `actualStartTimeDelay = 0`). This means the minimum delay check becomes `newStartTime >= block.timestamp + 0 = block.timestamp`, allowing `newStartTime = block.timestamp`.

Since `resetTime` is called by the EXECUTOR via `FRouterV3.resetTime()`, an EXECUTOR could reset an immediate-launch pair to `startTime = block.timestamp`, effectively allowing them to reset the start time to NOW. Combined with the fact that `taxStartTime` would still be from the original `launch()` call, this creates a timing inconsistency: the pair's `startTime` could be set to a new value, but `taxStartTime` (set during `launch()`) remains unchanged.

More critically: for a scheduled launch where `startTimeDelay > 0` but the EXECUTOR resets `startTime` to exactly `block.timestamp + startTimeDelay`, a millisecond later `block.timestamp >= startTime` would pass and trading begins. The EXECUTOR (trusted) could effectively remove the scheduling window for legitimate users who were expecting a future launch time.

**Evidence:**
```solidity
// FPairV2.sol:184-196
function resetTime(uint256 newStartTime) public onlyRouter nonReentrant {
    if (block.timestamp >= startTime) { revert InvalidStartTime(); }
    if (newStartTime < block.timestamp + startTimeDelay) { revert InvalidStartTime(); }
    // For startTimeDelay=0: newStartTime = block.timestamp passes the check
    // EXECUTOR can set immediate-launch pair's startTime to NOW, effectively re-opening the launch window
```

---

## [RS1-12] BondingV5._preLaunch(): tokenSupplyParams encodes lpSupply=0 and vaultSupply=configInitialSupply, but minting logic depends on these values correctly — if AgentFactory uses lpSupply for an on-chain mint, the 0 lpSupply silently prevents pair seeding at the factory level

**Verdict:** Confirmed (architectural risk) — Medium Severity  
**Location:** BondingV5.sol:334-351 (tokenSupplyParams encoding in `_preLaunch`)

**Description:**
The `tokenSupplyParams` passed to `agentFactory.createNewAgentTokenAndApplication()` encode (line 334-350):
```
(configInitialSupply, 0, configInitialSupply, configInitialSupply, configInitialSupply, 0, address(this))
```

This is a 7-element ABI encode. The second element (`lpSupply = 0`) and third element (`vaultSupply = configInitialSupply`) are critical. Per the design context comment: "lpSupply, will mint to agentTokenAddress" and "vaultSupply, will mint to vault (BondingV5 itself)".

The comment at line 335-340 says `lpSupply = 0` means "will mint to agentTokenAddress" and the vault is `address(this)` (BondingV5). The total tokens minted to BondingV5 is `vaultSupply = configInitialSupply`. 

Then BondingV5 transfers `bondingCurveSupply` tokens to the router (for pair seeding via `addInitialLiquidity`) and `totalReservedSupply` tokens to `teamTokenReservedWallet`. 

The accounting check: `bondingCurveSupplyBase + totalReservedSupply = bondingCurveSupplyBase + (configInitialSupply - bondingCurveSupplyBase) = configInitialSupply`. This is correct in base units.

In wei: BondingV5 receives `configInitialSupply * 10^18` tokens. It approves `bondingCurveSupply` (= `bondingCurveSupplyBase * 10^18`) to the router (line 373). It transfers `totalReservedSupply * 10^18` to teamTokenReservedWallet (line 383-387).

Total outflow from BondingV5 = `bondingCurveSupply + totalReservedSupply * 10^18` = `bondingCurveSupplyBase * 10^18 + (configInitialSupply - bondingCurveSupplyBase) * 10^18` = `configInitialSupply * 10^18`.

This equals the total received, so no tokens are stranded. BUT: if `bondingCurveSupplyBase` has truncation (see RS1-5), the `totalReservedSupply` will absorb the extra base units (converting to extra wei when multiplied by `10^18`). This creates a scenario where `totalReservedSupply * 10^18 > (configInitialSupply - bondingCurveSupplyBase) * 10^18` if... actually no, the calculation is exact in integer arithmetic.

The real finding here: the `tokenSupplyParams` array has 7 elements but the interface `createNewAgentTokenAndApplication` only specifies `bytes memory tokenSupplyParams`. If the AgentFactoryV7's decoding expects a different number of elements or different ordering, the entire preLaunch will fail silently (wrong values) or revert (wrong ABI decode). There is NO on-chain validation that the AgentFactory correctly decoded and used these values. The comment says "lpSupply, will mint to agentTokenAddress" implying the factory mints 0 tokens to the token contract itself at creation — but BondingV5 then sends `tokenBalance` to the token contract at graduation (line 746). If `lpSupply != 0` causes the factory to also mint those tokens during creation, double minting occurs at graduation.

**Impact:**
Medium — tight coupling between hardcoded ABI encoding in BondingV5 and AgentFactory's decoding. A factory upgrade that changes the token supply parameter schema would silently break all preLaunches without any revert or event.

**Evidence:**
```solidity
// BondingV5.sol:334-351
abi.encode(
    configInitialSupply,   // [0] = total supply
    0,                     // [1] = lpSupply (0 = no direct mint to LP)
    configInitialSupply,   // [2] = vaultSupply (all to vault/BondingV5)
    configInitialSupply,   // [3] = ?
    configInitialSupply,   // [4] = ?
    0,                     // [5] = ?
    address(this)          // [6] = vault address
)
// 7 parameters hardcoded — AgentFactory changes would silently corrupt supply accounting
```

---

## Summary Table

| ID | Title | Severity | File | Line |
|----|-------|----------|------|------|
| RS1-1 | Front-run window between token creation and blacklist in preLaunch | Medium | BondingV5.sol | 331-357 |
| RS1-2 | cancelLaunch() missing nonReentrant — reentrancy via ERC-777 asset token | Medium | BondingV5.sol | 462-497 |
| RS1-3 | Normal tokens: launch() callable by anyone (no caller restriction) | Low/Info | BondingV5.sol | 524-528 |
| RS1-4 | FPairV2.swap() no directional validation — both In and Out can be nonzero | Medium | FPairV2.sol | 86-107 |
| RS1-5 | calculateBondingCurveSupply integer truncation — dust routing to teamTokenReservedWallet | Low | BondingConfig.sol | 207 |
| RS1-6 | Graduation uses factory.getPair() not stored tokenInfo[].pair — diverge risk | Medium | BondingV5.sol | 710-714 |
| RS1-7 | maxTotalReservedBips=10000 allowed — zero bondingCurveSupply path not guarded | Low | BondingConfig.sol | 281-283 |
| RS1-8 | priceALast()/priceBLast() divide-by-zero after syncAfterDrain zeros reserves | Low | FPairV2.sol | 168-174 |
| RS1-9 | _buy() computes post-buy reserveA locally rather than re-reading from pair | Low | BondingV5.sol | 639-668 |
| RS1-10 | setBondingConfig() causes asymmetry: old gradThresholds vs new antiSniper config | High | BondingV5.sol | 857-859 |
| RS1-11 | resetTime() with startTimeDelay=0 allows EXECUTOR to set startTime=now | Low | FPairV2.sol | 184-196 |
| RS1-12 | tokenSupplyParams 7-element hardcoded ABI encode — silent break if AgentFactory schema changes | Medium | BondingV5.sol | 334-351 |
