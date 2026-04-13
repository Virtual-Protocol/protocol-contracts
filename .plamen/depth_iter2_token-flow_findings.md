# Depth Iteration 2 — Token Flow Domain (Devil's Advocate)

**Agent:** DA Depth Agent — Token Flow
**Date:** 2026-04-03
**Domain:** Token Flow — balanceOf divergence, donation vectors, reserve accounting, cancel/relaunch, tax arithmetic

---

## DA Analysis: TF-2

**Prior Path Explored:** Iter1 found cancelLaunch() zeroes initialPurchase and transfers assetToken back, but leaves bondingCurveSupply agentTokens in FPairV2. Confirmed no burn/drain path exists for non-Project60days tokens (DEPTH-TF-4). Did NOT explore whether re-preLaunch with same agentToken is possible, or FPairV2 state after cancel.

**New Path Explored:** I traced the re-preLaunch path and FPairV2 post-cancel state. Key findings:

1. **Can preLaunch() be called again with the same agentToken?** No. Each `_preLaunch` call at BondingV5.sol:331 calls `agentFactory.createNewAgentTokenAndApplication()` which deploys a NEW token contract. There is no mechanism to pass an existing token address. The old token and pair are permanently orphaned. Iter1 correctly identified this.

2. **FPairV2 state after cancel — the unexplored path:** After cancelLaunch():
   - `tokenRef.trading = false` (BondingV5.sol:488)
   - `tokenRef.launchExecuted = true` (BondingV5.sol:489)
   - The FPairV2 pair still has `_pool.lastUpdated > 0` (set during `mint()`)
   - The FPairV2 still holds `bondingCurveSupply` agent tokens AND has `reserve1` = `fakeInitialVirtualLiq` (virtual, no real VIRTUAL)
   - The pair's `router` is still set to FRouterV3

3. **Can anyone interact with the orphaned FPairV2?** The FPairV2's `swap()`, `transferTo()`, `transferAsset()`, `mint()` are all `onlyRouter`. Only FRouterV3 (with EXECUTOR_ROLE) can call these. But FRouterV3's functions (`buy`, `sell`, `graduate`) are called by BondingV5, which checks `tokenInfo[tokenAddress_].trading == true`. Since cancel sets `trading = false`, no BondingV5 path can reach the pair. Direct FRouterV3 calls require EXECUTOR_ROLE and would bypass BondingV5 checks — but `graduate()` on FRouterV3 just transfers balances to `msg.sender` (the EXECUTOR). So an EXECUTOR could manually call `FRouterV3.graduate(cancelledTokenAddress)` to drain the pair of its agent tokens. This is bounded by the EXECUTOR trust assumption.

4. **Real VIRTUAL in pair after cancel:** The `addInitialLiquidity` at BondingV5.sol:379 calls `router.addInitialLiquidity(token, bondingCurveSupply, liquidity)`. In FRouterV3.addInitialLiquidity (L122-136), `amountToken_` agent tokens are transferred from BondingV5 to the pair, and `mint(amountToken_, amountAsset_)` is called with `amountAsset_ = liquidity` (the virtual amount). **No real VIRTUAL is ever sent to the pair during preLaunch**. Real VIRTUAL only enters via user buys. So if cancelLaunch() is called before `launch()` (and thus before any buys), the pair holds 0 real VIRTUAL. The `assetBalance()` = 0. Only agent tokens are stranded.

5. **If buys happen before cancel?** `cancelLaunch()` does not check `launchExecuted`. Wait — re-reading: `cancelLaunch()` at L475 checks `if (tokenRef.launchExecuted)` → revert. And `launch()` at L509 checks `if (tokenRef.launchExecuted)` → revert. Both prevent re-execution. But `buy()` at L682 checks `tokenRef.trading == true` AND `tokenRef.launchExecuted == true` (L593). So buys require `launchExecuted = true`. Since `launchExecuted` starts as `false` and only becomes `true` via `launch()` or `cancelLaunch()`, NO buys can occur before launch/cancel. Therefore, at cancel time, the pair has 0 real VIRTUAL and only agent tokens.

**New Evidence:** [TRACE:cancelLaunch→pair holds 0 real VIRTUAL (buys impossible before launch)→only bondingCurveSupply agent tokens stranded→agent tokens for cancelled token have zero market value]

**Verdict Update:** CONFIRMED (Medium) — no change from iter1. The stranded tokens are agent tokens with zero market value for a cancelled token. The finding is real but low economic impact. EXECUTOR can recover via direct FRouterV3.graduate() call if needed (trusted role path).

**Confidence Change:** INCREASE — confirmed the additional paths (no re-preLaunch, no buys before launch, 0 real VIRTUAL stranded). The finding is now fully characterized.

---

## DA Analysis: TF-5

**Prior Path Explored:** Iter1 found two reads of reserve/balance in FPairV2.swap() call stack, noted nonReentrant as mitigation. Did NOT verify whether production token implementations could cause divergence between reads within a single call.

**New Path Explored:** I traced the exact code paths where reserves and balances are read during a buy/sell to find the actual "two reads" and whether any within-call divergence is possible.

**For a buy via FRouterV3.buy() (L174-228):**
1. `pair = factory.getPair(tokenAddress, assetToken)` — L184
2. `normalTax = factory.buyTax()` — L187
3. `antiSniperTax = _calculateAntiSniperTax(pair)` — L192
4. `IERC20(assetToken).safeTransferFrom(to, pair, amount)` — L204 ← VIRTUAL sent to pair (changes real balance)
5. `IERC20(assetToken).safeTransferFrom(to, address(this), normalTxFee)` — L208
6. `amountOut = getAmountsOut(tokenAddress, assetToken, amount)` — L221 ← reads `pair.getReserves()` (virtual) and `pair.kLast()`
7. `IFPairV2(pair).transferTo(to, amountOut)` — L223 ← agent tokens sent from pair to buyer
8. `IFPairV2(pair).swap(0, amountOut, amount, 0)` — L225 ← updates virtual reserves

The critical observation: at step 4, real VIRTUAL arrives at the pair. At step 6, `getAmountsOut` reads `_pool.reserve1` (virtual), NOT `assetBalance()`. The virtual `reserve1` has NOT been updated yet (that happens at step 8). So `getAmountsOut` uses the PRE-transfer virtual reserves to compute `amountOut`. This is CORRECT for a constant-product AMM — the output is calculated from the reserves BEFORE the input arrives.

**But here is the path iter1 did NOT explore: what if the VIRTUAL transfer at step 4 triggers a callback that modifies pair state?**

VIRTUAL on Base is the Virtuals Protocol token. It uses SafeERC20's `safeTransferFrom`, which calls the standard ERC20 `transferFrom`. For a standard ERC20, `transferFrom` is a simple balance update with no callbacks. Even if VIRTUAL were ERC777 (which it is not — it is a standard ERC20 deployed on Base), the `nonReentrant` guard on FRouterV3.buy() would prevent re-entry into buy/sell/graduate.

**For the AgentToken (tokenA) transfer at step 7:** `transferTo` calls `IERC20(tokenA).safeTransfer(to, amountOut)`. If the AgentToken is an AgentTokenV3 with transfer tax, and `to` is a liquidity pool, tax could be applied — meaning `to` receives less than `amountOut`. But the FPairV2 pair already transferred `amountOut` tokens and updated its accounting at step 8 assuming full `amountOut` left. This means the pair's `reserve0` is decremented by `amountOut`, but only `amountOut - tax` actually left the pair. **Wait** — let me re-check. `transferTo` at FPairV2.sol:133-137 does `IERC20(tokenA).safeTransfer(recipient, amount)`. This sends FROM the pair TO the buyer. If AgentTokenV3 applies tax on this transfer, the tax is deducted from the `amount` — the pair's balance decreases by `amount` (full), but the buyer receives `amount - tax`. The `safeTransfer` will succeed as long as the pair has sufficient balance. After the transfer, FPairV2's actual token balance decreased by `amount`, which matches `reserve0 -= amountOut` at step 8.

So the pair's real balance and virtual reserve stay in sync for agent tokens. The buyer gets less (tax), but the pair's accounting is correct.

**The VIRTUAL (tokenB) side:** `transferAsset` at FPairV2.sol:124-131 does `IERC20(tokenB).safeTransfer(recipient, amount)`. VIRTUAL has no transfer tax. Pair balance decreases by exactly `amount`.

**Can fee-on-transfer tokens cause divergence?** The agent tokens sent TO the pair during sell (FRouterV3.sell L155: `token.safeTransferFrom(to, pairAddress, amountIn)`) — if the token has a fee-on-transfer, the pair receives less than `amountIn`. Then `getAmountsOut` at L153 computes based on full `amountIn`, and `pair.swap(amountIn, 0, 0, amountOut)` updates reserves using full `amountIn`. Result: `reserve0` is higher than the pair's real balance. Over multiple sells, `reserve0` diverges upward from real balance.

**However:** In the bonding curve context, the agent token IS the AgentToken created by the system. During bonding curve trading (pre-graduation), the AgentToken's transfer tax applies only when `isLiquidityPool(from) || isLiquidityPool(to)` is true. The FPairV2 pair address MAY OR MAY NOT be in the AgentToken's liquidity pool set. Let me check: during `_preLaunch`, at BondingV5.sol:354-357:
```solidity
agentFactory.addBlacklistAddress(token, IAgentTokenV2(token).liquidityPools()[0]);
```
This gets `liquidityPools()[0]` which is the Uniswap V2 pair created during `createNewAgentTokenAndApplication`. The FPairV2 (bonding curve pair) is a DIFFERENT pair — it is NOT added to the AgentToken's LP pool set. So `isLiquidityPool(FPairV2_address)` = false. Therefore, during bonding curve sells, `safeTransferFrom(seller, FPairV2, amountIn)` → `applyTax = (false || false) = false` → no fee deducted → full `amountIn` arrives at pair.

**New Evidence:** [TRACE:FRouterV3.buy→VIRTUAL transfer to pair at L204→getAmountsOut at L221 reads virtual reserves (not real balance)→no divergence because computation is based on pre-transfer virtual reserves, not post-transfer real balance], [TRACE:sell→agent token transfer to pair at L155→FPairV2 is NOT in AgentToken's LP pool set→applyTax=false→no fee-on-transfer→full amountIn arrives], [BOUNDARY:if hypothetical fee-on-transfer agent token: pair.reserve0 would diverge upward from real balance after sells→getAmountsOut would return inflated amountOut→transferAsset would fail when real VIRTUAL balance insufficient→bounded by real balance]

**Verdict Update:** PARTIAL → this is a design concern but NOT exploitable with the current AgentToken implementation. The two reads are: (1) virtual reserves for AMM math, (2) real balanceOf for graduation/drain. These are INTENTIONALLY different by design (virtual initial liquidity). Within a single swap, there is no divergence that causes harm because:
- AMM math uses virtual reserves consistently
- Token transfers use real balances
- nonReentrant prevents cross-call manipulation
- AgentToken does not apply tax on FPairV2 transfers

**Confidence Change:** INCREASE — the finding is now well-characterized. The "two reads" concern is a design feature, not a bug.

---

## DA Analysis: TF-6

**Prior Path Explored:** Iter1 found assetBalance() uses balanceOf(this) while reserve1 is cached; donations can desync. Quantified at 42 VIRTUAL for 1% inflation. Did NOT model whether a sync() function exists or economic incentive analysis.

**New Path Explored:** I explored the specific paths iter1 did NOT: (a) sync mechanism existence, (b) minimum donation for meaningful price impact, (c) economic incentive for the attacker.

**1. Sync mechanism:** FPairV2 has NO `sync()` function. The only reserve-update paths are:
- `mint()` — one-time at pair creation (L68-84)
- `swap()` — on every buy/sell, updates reserves based on input/output amounts (L86-107)
- `syncAfterDrain()` — only called by `drainPrivatePool` (L145-158)

None of these reconcile `reserve1` with `assetBalance()`. The donation amount persists as a permanent divergence. Even after graduation drains the pair, the donated VIRTUAL is extracted alongside legitimate proceeds.

**2. Where reserve1 is read vs where assetBalance() is read:**

| Function | Uses reserve1 (virtual) | Uses assetBalance() (real) |
|----------|------------------------|---------------------------|
| `getAmountsOut()` | YES (AMM pricing) | NO |
| `swap()` | YES (reserve update) | NO |
| `getReserves()` | YES (returns virtual) | NO |
| `kLast()` | YES (computed from virtual) | NO |
| BondingV5._buy() | YES (via getReserves for graduation check) | NO |
| BondingV5._openTradingOnUniswap() | NO | YES (L718) |
| FRouterV3.graduate() | NO | YES (L235) |
| FRouterV3.drainPrivatePool() | NO | YES (L386) |

**Key insight iter1 missed:** The donation does NOT affect AMM pricing during bonding curve trading. Buys/sells use `getAmountsOut()` which reads virtual `reserve1`. A donation ONLY affects the graduation amount and drain amount. The attacker cannot profit during bonding curve trading from the donation — they must wait for graduation.

**3. Economic incentive analysis:**

For the donation to be profitable, the attacker needs:
- Cost: D VIRTUAL donated
- The graduation is triggered; D extra VIRTUAL goes to AgentFactory
- AgentFactory uses assetBalance to set `withdrawableAmount` for the application
- `executeBondingCurveApplicationSalt` is called, creating the real AgentToken and LP
- The extra D VIRTUAL ends up... where exactly?

Let me trace: at BondingV5.sol:727-734:
```solidity
IERC20(router.assetToken()).safeTransfer(address(agentFactory), assetBalance);
agentFactory.updateApplicationThresholdWithApplicationId(tokenRef.applicationId, assetBalance);
```

All `assetBalance` VIRTUAL goes to AgentFactory. The `updateApplicationThresholdWithApplicationId` sets `application.withdrawableAmount = assetBalance`. This is the total VIRTUAL backing for the graduated token.

Then at L748-756, `executeBondingCurveApplicationSalt` is called. This creates the real AgentToken. The LP setup happens inside the AgentFactory — the VIRTUAL in AgentFactory is used to provide liquidity on Uniswap V2.

**If the extra D VIRTUAL is added to the Uniswap V2 LP:** The LP has more VIRTUAL, making the agent token price higher. An attacker who holds agent tokens from early bonding curve buys would benefit from this higher post-graduation price. The profit calculation:
- Early buy: attacker spends X VIRTUAL on bonding curve, gets Y agent tokens
- Donation: spends D VIRTUAL
- Post-graduation: the LP has (targetRealVirtual + D) VIRTUAL, so agent token price is (targetRealVirtual + D) / agentTokenSupply
- Without donation: price would be targetRealVirtual / agentTokenSupply
- Attacker's agent tokens are worth Y * (targetRealVirtual + D) / agentTokenSupply
- Gain from donation: Y * D / agentTokenSupply
- For this to exceed D (cost): Y / agentTokenSupply > 1 → attacker must hold >100% of supply → IMPOSSIBLE

**Wait** — that calculation uses the total supply. Let me refine: if the attacker holds fraction f of total agent tokens:
- Gain = f * D (their share of the price increase from D extra VIRTUAL)
- Cost = D
- Profit = f * D - D = D * (f - 1) < 0 for f < 1

**The donation attack is NOT profitable for the attacker in simple form.** The attacker always loses more than they gain because they hold less than 100% of supply. The economic incentive does not exist for a rational attacker.

**However**, there is one edge case: if the attacker is the token CREATOR who receives a portion of tokens outside the bonding curve (e.g., airdrop allocation, ACF tokens), their effective `f` includes these non-curve tokens. Even so, `f < 1` always holds. The donation is a net loss for the attacker.

**The real risk is griefing/protocol integrity:** Anyone can inflate the graduation amount, making protocol-level accounting inaccurate. The AgentFactory records a higher `withdrawableAmount` than was legitimately earned. This doesn't enable profit extraction but degrades accounting integrity.

**New Evidence:** [TRACE:donation to pair→does NOT affect AMM pricing (getAmountsOut uses virtual reserves)→ONLY affects graduation amount→extra VIRTUAL goes to AgentFactory/LP], [BOUNDARY:attacker profit = D*(f-1) where f=attacker's supply fraction→ALWAYS NEGATIVE for f<1→economically irrational], [VARIATION:donation=0→legitimate accounting; donation=420 VIRTUAL→AgentFactory gets 10% extra→LP price inflated→but attacker's share of inflation < donation cost]

**Verdict Update:** CONFIRMED but severity should be reconsidered. The attack is mechanically possible but economically irrational — the attacker always loses money. The impact is limited to protocol accounting integrity (AgentFactory records inflated withdrawableAmount). No user funds at risk from the donation itself.

**Confidence Change:** INCREASE — now fully characterized including economic incentive (or lack thereof).

---

## DA Analysis: PC1-16

**Prior Path Explored:** Iter1 found BondingV5 calls external contracts without verifying they have code. Did NOT determine which specific calls are affected or whether they could target empty addresses.

**New Path Explored:** I enumerated ALL external calls in BondingV5 and their address sources.

**External calls in BondingV5:**

| Line | Call | Address Source | Can be zero/EOA? |
|------|------|---------------|------------------|
| 252-253 | `bondingConfig.calculateBondingCurveSupply()` | `bondingConfig` storage (set by owner via `setBondingConfig`) | Only if owner sets it wrong |
| 256 | `bondingConfig.isValidAntiSniperType()` | Same | Same |
| 268 | `bondingConfig.getScheduledLaunchParams()` | Same | Same |
| 302 | `bondingConfig.calculateLaunchFee()` | Same | Same |
| 311 | `router.assetToken()` | `router` storage (set at initialize) | Only if initialized wrong |
| 315-319 | `IERC20(assetToken).safeTransferFrom()` | `assetToken` from router | If router returns zero, safeTransferFrom reverts |
| 327 | `bondingConfig.initialSupply()` | Same as bondingConfig | Same |
| 331-352 | `agentFactory.createNewAgentTokenAndApplication()` | `agentFactory` storage (set at initialize) | Only if initialized wrong |
| 354-357 | `agentFactory.addBlacklistAddress()` | Same | Same |
| 366-371 | `factory.createPair()` | `factory` storage (set at initialize) | Only if initialized wrong |
| 376 | `bondingConfig.getFakeInitialVirtualLiq()` | Same | Same |
| 379 | `router.addInitialLiquidity()` | Same as router | Same |
| 390 | `bondingConfig.calculateGradThreshold()` | Same | Same |
| 443-449 | `IAgentTaxMinimal(taxVault).registerToken()` | `factory.taxVault()` external call result | If factory returns zero → revert at L444 (`require(taxVault != address(0))`) |
| 480 | `IERC20(router.assetToken()).safeTransfer()` | Dynamic: `router.assetToken()` | If router's assetToken changed between preLaunch and cancel, could be different address |
| 531 | `router.setTaxStartTime()` | Same as router | Same |
| 541-542 | `IERC20(router.assetToken()).forceApprove()` | Dynamic | Same |
| 545-552 | `router.buy()` | Same as router | Same |
| 554-556 | `IERC20(tokenAddress_).safeTransfer()` | Token address passed by user at launch | Validated: `tokenRef.token != address(0)` at L505 |
| 601 | `router.sell()` | Same as router | Same |
| 632-635 | `factory.getPair()` | Same as factory | Same |
| 711-712 | `factory.getPair()` | Same | Same |
| 718-719 | `pairContract.assetBalance()`, `balance()` | Pair address from factory | If factory returns zero pair → call to zero address |
| 721 | `router.graduate()` | Same as router | Same |
| 727-729 | `IERC20(router.assetToken()).safeTransfer()` | Dynamic | Same |
| 731-733 | `agentFactory.updateApplicationThresholdWithApplicationId()` | Same | Same |
| 737-739 | `agentFactory.removeBlacklistAddress()` | Same | Same |
| 746 | `IERC20(tokenAddress_).safeTransfer()` | tokenAddress_ from tokenInfo | Validated non-zero |
| 748-756 | `agentFactory.executeBondingCurveApplicationSalt()` | Same | Same |

**Solidity 0.8 behavior on call to empty address (EOA):** In Solidity 0.8+, a `call` to an EOA succeeds with empty return data. For functions expecting return data, the ABI decoder may revert depending on the return type. For `SafeERC20.safeTransfer`, it checks the return value — if the target is an EOA with no code, the low-level call succeeds with empty returndata, and SafeERC20 treats empty returndata as success (per OZ implementation). So `safeTransfer` to an EOA would "succeed" without actually transferring anything — the tokens would be lost.

**But** — all contract addresses (router, factory, agentFactory, bondingConfig) are set at `initialize()` by the deployer or by `onlyOwner` functions. These are FULLY TRUSTED operations. If the owner sets bondingConfig to an EOA, the first `bondingConfig.calculateBondingCurveSupply()` call would revert (no code → empty returndata → ABI decode fails for non-void returns). So this self-corrects quickly.

**The only realistic risk:** `router.assetToken()` is called dynamically. If the router is upgraded and the new router has a different `assetToken()` return, the cancelLaunch would use the new assetToken address. But this is a trusted admin operation.

**New Evidence:** [TRACE:all external calls in BondingV5 use addresses from storage set by owner/initializer→all are trusted admin operations→no user-controllable address can be zero/EOA], [BOUNDARY:EOA call in Solidity 0.8→interface calls to EOA revert for non-void returns (ABI decode fails)→self-correcting for most calls], [TRACE:SafeERC20.safeTransfer to EOA→succeeds with empty returndata→tokens lost→but address is from trusted source (owner)]

**Verdict Update:** This is an Informational/Low finding about defense-in-depth. All external call targets in BondingV5 are set by trusted admin operations (owner/initializer). There is no path for an unprivileged user to cause a call to an empty address. The lack of extcodesize checks is a code quality concern, not a security vulnerability.

**Confidence Change:** INCREASE — fully enumerated all external calls, confirmed all address sources are trusted.

---

## DA Analysis: PC1-17

**Prior Path Explored:** Iter1 found preLaunch() accepts buy/sellTax without validation. Noted same root cause as EC-1. Did NOT verify when the overflow is triggered.

**New Path Explored:** I traced the EXACT path of buy/sell tax parameters from preLaunch to first use.

**Critical realization:** BondingV5.preLaunch() does NOT accept buy/sellTax parameters at all. Looking at the `_preLaunch` function signature (BondingV5.sol:234-249):

```solidity
function _preLaunch(
    string memory name_,
    string memory ticker_,
    uint8[] memory cores_,
    string memory desc_,
    string memory img_,
    string[4] memory urls_,
    uint256 purchaseAmount_,
    uint256 startTime_,
    uint8 launchMode_,
    uint16 airdropBips_,
    bool needAcf_,
    uint8 antiSniperTaxType_,
    bool isProject60days_,
    bool isFeeDelegation_
) internal returns (address, address, uint, uint256)
```

There is NO buyTax or sellTax parameter. The buy/sell tax rates are stored on the **FFactoryV2/V3 contracts** as GLOBAL parameters (`factory.buyTax()` and `factory.sellTax()`), not per-token parameters. They are set by ADMIN_ROLE via `setTaxParams()` on the factory.

The `antiSniperTaxType_` IS validated at BondingV5.sol:256:
```solidity
if (!bondingConfig.isValidAntiSniperType(antiSniperTaxType_)) {
    revert InvalidAntiSniperType();
}
```

And the only valid types are 0, 1, 2 (NONE, 60S, 98M). So the anti-sniper type IS validated.

**Where does the "buyTax >= 100" concern come from?** Looking at FRouterV3.buy() L187-202:
```solidity
uint256 normalTax = factory.buyTax();
uint256 antiSniperTax = ...;
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax;
}
uint256 normalTxFee = (normalTax * amountIn) / 100;
uint256 antiSniperTxFee = (antiSniperTax * amountIn) / 100;
uint256 amount = amountIn - normalTxFee - antiSniperTxFee;
```

If `normalTax >= 100` (set by ADMIN on factory), then:
- `normalTax + antiSniperTax > 99` → true → `antiSniperTax = 99 - normalTax`
- If `normalTax = 100`: `antiSniperTax = 99 - 100` → **underflow in Solidity 0.8** → REVERT

This means if ADMIN sets `buyTax = 100` on the factory, ALL buys would revert due to the underflow at `99 - normalTax`. This is a denial-of-service via admin misconfiguration.

**Similarly for sell:** FRouterV3.sell() L157-160:
```solidity
uint fee = factory.sellTax();
uint256 txFee = (fee * amountOut) / 100;
uint256 amount = amountOut - txFee;
```

If `sellTax = 100`: `txFee = amountOut` → `amount = 0` → user receives 0. If `sellTax > 100`: `txFee > amountOut` → underflow → REVERT.

**This is NOT a preLaunch parameter issue — it is a factory ADMIN_ROLE misconfiguration issue.** The factory's `setTaxParams()` has no upper bound validation on `buyTax_` or `sellTax_`:

FFactoryV3.sol:116-130:
```solidity
function setTaxParams(
    address newVault_,
    uint256 buyTax_,
    uint256 sellTax_,
    ...
) public onlyRole(ADMIN_ROLE) {
    require(newVault_ != address(0), "Zero addresses are not allowed.");
    taxVault = newVault_;
    buyTax = buyTax_;      // No upper bound check!
    sellTax = sellTax_;    // No upper bound check!
    ...
}
```

**New Evidence:** [TRACE:BondingV5._preLaunch has NO buyTax/sellTax parameters→tax rates are GLOBAL on FFactoryV3 set by ADMIN_ROLE→PC1-17 misattributes the issue to preLaunch], [TRACE:FFactoryV3.setTaxParams→buyTax_ and sellTax_ accepted without upper bound→if buyTax>=100→FRouterV3.buy reverts at L196 (99-normalTax underflow)→ALL buys for ALL tokens blocked], [BOUNDARY:buyTax=100→99-100 underflows in Solidity 0.8→revert→global DoS on all buys], [BOUNDARY:sellTax=101→txFee>amountOut→underflow at L160→revert→global DoS on all sells]

**Verdict Update:** The finding exists but is mislocated. It is NOT in BondingV5.preLaunch — it is in FFactoryV3.setTaxParams (and FFactoryV2.setTaxParams). The severity is bounded by the ADMIN_ROLE trust assumption: only a trusted admin can set these values. This is an input validation gap on a trusted admin function — severity should be Low (trusted admin misconfiguration → global DoS).

**Confidence Change:** INCREASE — corrected the location and clarified the trust model.

---

## Finding [DA-TF-1]: FRouterV3 sell() Computes amountOut Before Transfer — Stale Reserve if Agent Token Has Fee-on-Transfer

**Verdict**: PARTIAL
**Step Execution**: ✓1,2,3,5 | ✗4(N/A — single entity) | ✗6(no role)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✓, R10:✓, R11:✓]
**Depth Evidence**: [TRACE:FRouterV3.sell()→L153:amountOut=getAmountsOut(full amountIn)→L155:safeTransferFrom(seller,pair,amountIn)→if fee-on-transfer: pair receives amountIn-fee→swap(amountIn,0,0,amountOut) updates reserve0 by full amountIn→reserve0 inflated by fee amount], [BOUNDARY:AgentToken on FPairV2: applyTax=false (FPairV2 not in LP set)→no current impact], [VARIATION:if future token changes LP set or uses different token with fee→reserve0 diverges→overpriced sells→pair eventually insolvent]

**Severity**: Low (Informational with current tokens, Medium if fee-on-transfer tokens used)
**Location**: FRouterV3.sol:138-171, FRouterV2.sol:131-167

**Description**:
In FRouterV3.sell() (L138-171), the output amount is computed BEFORE the token transfer:
```solidity
uint256 amountOut = getAmountsOut(tokenAddress, address(0), amountIn); // L153 — uses full amountIn
token.safeTransferFrom(to, pairAddress, amountIn);                    // L155 — actual transfer
```

`getAmountsOut` uses the virtual `reserve0` and `k` to compute how much VIRTUAL the seller receives for `amountIn` agent tokens. Then `amountIn` agent tokens are transferred to the pair. Finally, `pair.swap(amountIn, 0, 0, amountOut)` updates `reserve0 += amountIn` and `reserve1 -= amountOut`.

If the agent token has a fee-on-transfer (e.g., the AgentTokenV3 with `_tokenHasTax = true` and the pair address is in the LP set), the pair would receive `amountIn - tax`, but the swap updates `reserve0` by the full `amountIn`. Over time, `reserve0` diverges above the pair's real agent token balance.

**Current mitigation**: For the bonding curve FPairV2, the AgentToken does NOT apply tax because FPairV2 is not in the LP pool set. So with current production tokens, this is not exploitable.

**Why this matters**: The router code pattern (compute before transfer, update with nominal amount) is fragile. If future tokens or factory upgrades introduce fee-on-transfer behavior on the bonding curve path, the pricing formula would silently become incorrect.

**Impact**: Currently no impact due to AgentToken not applying tax on FPairV2 transfers. If fee-on-transfer is introduced on this path, sell pricing becomes progressively inaccurate — sellers get more VIRTUAL than they should, draining the pair.

### Precondition Analysis
**Missing Precondition**: FPairV2 must be in AgentToken's LP set OR a different fee-on-transfer token must be used
**Precondition Type**: EXTERNAL
**Why This Blocks**: FPairV2 is not registered as a liquidity pool in AgentTokenV3

---

## Finding [DA-TF-2]: Factory buyTax/sellTax Lack Upper Bound — ADMIN Can Cause Global DoS on All Trades

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✗6(✓ — ADMIN role)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✓, R8:✗(single-step), R10:✓, R14:✓]
**Depth Evidence**: [TRACE:FFactoryV3.setTaxParams(buyTax_=100)→FRouterV3.buy L196: antiSniperTax=99-100→underflow→REVERT→ALL buys blocked globally], [BOUNDARY:buyTax=99→antiSniperTax capped at 0→normalTxFee=99%*amountIn→amount=1%*amountIn→functional but 99% tax], [BOUNDARY:buyTax=100→underflow revert→global DoS], [TRACE:FFactoryV3.setTaxParams(sellTax_=101)→FRouterV3.sell L158: txFee=101*amountOut/100>amountOut→L160: amount=amountOut-txFee→underflow→REVERT→ALL sells blocked]

**Severity**: Low
**Location**: FFactoryV3.sol:116-130, FFactoryV2.sol:108-122, FRouterV3.sol:187-202, FRouterV2.sol:182-197

**Description**:
`FFactoryV3.setTaxParams()` and `FFactoryV2.setTaxParams()` accept `buyTax_` and `sellTax_` as `uint256` without any upper bound validation:

```solidity
// FFactoryV3.sol:116-130
function setTaxParams(
    address newVault_,
    uint256 buyTax_,
    uint256 sellTax_,
    uint256 antiSniperBuyTaxStartValue_,
    address antiSniperTaxVault_
) public onlyRole(ADMIN_ROLE) {
    require(newVault_ != address(0), "Zero addresses are not allowed.");
    taxVault = newVault_;
    buyTax = buyTax_;    // No validation
    sellTax = sellTax_;  // No validation
    ...
}
```

In FRouterV3.buy() (L194-196):
```solidity
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax; // Underflows if normalTax >= 100
}
```

Setting `buyTax = 100` causes `99 - 100` to underflow in Solidity 0.8, reverting ALL buy transactions globally across ALL tokens.

Setting `sellTax = 101` causes `amountOut - txFee` to underflow in FRouterV3.sell(), reverting ALL sell transactions.

**Impact**: ADMIN_ROLE misconfiguration causes global trade DoS. Bounded by the trust assumption that ADMIN_ROLE is trusted. This is an input validation gap for defense-in-depth.

**Recommendation**: Add `require(buyTax_ <= 99, "Buy tax too high"); require(sellTax_ <= 99, "Sell tax too high");` to `setTaxParams()`.

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Confidence Change |
|------------|----------|--------------------:|---------|----------|-------------------|
| TF-2 | BondingV5.sol:462-497 | cancelLaunch strands agent tokens with zero market value; no buys possible pre-launch | CONFIRMED | Medium | INCREASE |
| TF-5 | FPairV2.sol swap, FRouterV3 buy/sell | Two reads (virtual reserve vs real balance) are by design; no within-call divergence with current tokens | PARTIAL | Medium→Low | INCREASE |
| TF-6 | BondingV5.sol:718-729, FPairV2.sol:180 | Donation inflates graduation amount but is economically irrational (attacker always loses money) | CONFIRMED | High→Medium | INCREASE |
| PC1-16 | BondingV5.sol (all external calls) | All call targets are from trusted admin storage; no user-controllable empty address path | CONFIRMED→Informational | Medium→Info | INCREASE |
| PC1-17 | FFactoryV3.sol:116-130, FRouterV3.sol:194-196 | Mislocated: issue is in factory setTaxParams (no upper bound on buyTax/sellTax), not in preLaunch | CONFIRMED (relocated) | Medium→Low | INCREASE |
| DA-TF-1 | FRouterV3.sol:153-155 | sell() computes amountOut before transfer; stale if fee-on-transfer token used (not current) | PARTIAL | Low | NEW |
| DA-TF-2 | FFactoryV3.sol:116-130 | Factory buyTax/sellTax lack upper bound; buyTax>=100 causes global DoS via underflow | CONFIRMED | Low | NEW |
