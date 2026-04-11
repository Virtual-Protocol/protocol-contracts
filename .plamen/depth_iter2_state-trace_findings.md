# Depth Iteration 2 — State Trace (Devil's Advocate)

**Agent**: DA State Trace Depth Agent — Iteration 2
**Domain**: Constraint enforcement, cross-function state mutations, cached parameters, initialization ordering, setter regression
**Date**: 2026-04-03

---

## DA Analysis: EP-8 (Critical, 0.69)

**Prior Path Explored**: Iter1 traced buy()→graduate() loop; confirmed that failed graduation creates permanent buy-DoS where every subsequent buy re-triggers failed graduate(). Confirmed via DST-8 there's no admin rescue path. Did NOT explore: (a) admin functions that reset graduation state, (b) cancelLaunch() on post-failed-graduation pair, (c) AgentFactory call wrapping.

**New Path Explored**: I traced three unexplored recovery paths: (a) whether any BondingV5 admin function can reset `trading` or `tradingOnUniswap` or `tokenGradThreshold` for a stuck pair; (b) whether `cancelLaunch()` can be called on a post-graduation-failure token; (c) whether the AgentFactory calls are wrapped in try/catch.

### Path (a): Admin state reset functions

Exhaustive search of BondingV5 for functions that modify `tokenInfo[token].trading`, `tokenInfo[token].tradingOnUniswap`, or `tokenGradThreshold[token]`:

1. `trading` is set at:
   - `_preLaunch()` L410: `newToken.trading = true` (creation)
   - `cancelLaunch()` L488: `tokenRef.trading = false` (cancel)
   - `_openTradingOnUniswap()` L770: `tokenRef.trading = false` (graduation)
   - **No setter function exists.**

2. `tradingOnUniswap` is set at:
   - `_preLaunch()` L411: `newToken.tradingOnUniswap = false` (creation)
   - `_openTradingOnUniswap()` L771: `tokenRef.tradingOnUniswap = true` (graduation)
   - **No setter function exists.**

3. `tokenGradThreshold[token]` is set at:
   - `_preLaunch()` L393: `tokenGradThreshold[token] = gradThreshold` (creation)
   - **No setter function exists.**

4. `setBondingConfig()` L857: changes the config reference but does NOT affect stored per-token `tokenGradThreshold`.

**Conclusion**: No admin recovery path exists through BondingV5 state manipulation. The only way to reset state would be a proxy upgrade of BondingV5.

[TRACE:grep all state writes→trading has 3 write sites (preLaunch, cancelLaunch, _openTradingOnUniswap), NO admin setter→confirmed unrecoverable]

### Path (b): cancelLaunch() on stuck token

`cancelLaunch()` L462-497 has two guards:
```solidity
if (tokenRef.token == address(0) || tokenRef.pair == address(0)) revert InvalidInput(); // L466-468
if (msg.sender != tokenRef.creator) revert InvalidInput(); // L470-472
if (tokenRef.launchExecuted) revert InvalidTokenStatus(); // L475-477
```

For a token that has been through `launch()`:
- L571: `tokenRef.launchExecuted = true`

So `cancelLaunch()` will revert at L475 with `InvalidTokenStatus()` because `launchExecuted = true`.

[TRACE:stuck token→launchExecuted=true (set by launch() L571)→cancelLaunch() L475 reverts→cannot cancel]

### Path (c): AgentFactory call wrapping

In `_openTradingOnUniswap()`, the AgentFactory calls at L731, L737, L748 are all **unwrapped** (no try/catch):

```solidity
// L727-729: safeTransfer — reverts on failure
IERC20(router.assetToken()).safeTransfer(address(agentFactory), assetBalance);

// L731-733: direct call — reverts on failure  
agentFactory.updateApplicationThresholdWithApplicationId(tokenRef.applicationId, assetBalance);

// L737-739: direct call — reverts on failure
agentFactory.removeBlacklistAddress(tokenAddress_, IAgentTokenV2(tokenAddress_).liquidityPools()[0]);

// L746: safeTransfer — reverts on failure
IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance);

// L748-756: direct call — reverts on failure
address agentToken = agentFactory.executeBondingCurveApplicationSalt(...);
```

None of these are wrapped in try/catch. Any single revert propagates up through `_buy()` to the external `buy()` call.

Contrast with FRouterV3.setTaxStartTime() L350 which DOES use try/catch:
```solidity
try pair.setTaxStartTime(_taxStartTime) {} catch { /* ... */ }
```

[TRACE:_openTradingOnUniswap 5 external calls→0 try/catch wrapping→any single failure reverts entire buy()]

### Additionally explored: Can sells move reserves ABOVE gradThreshold to "unstick" the loop?

`sell()` at L581-618 calls `router.sell()` which calls `pair.swap(amountIn, 0, 0, amountOut)`. This increases `_pool.reserve0` (adds tokens back) and decreases `_pool.reserve1` (removes asset). So after a sell, reserve0 (token reserve) increases.

The graduation check in `_buy()` L664: `if (newReserveA <= gradThreshold)`. After sells increase reserve0, the NEXT buy starts with higher reserve0. If enough selling occurs, `newReserveA` after the buy could be ABOVE `gradThreshold`, avoiding the graduation trigger.

HOWEVER: this requires enough users to sell to push reserve0 back above gradThreshold. If the pair is at the graduation boundary, the amount of selling needed is proportional to `gradThreshold - currentReserve0`. Since graduation triggers when `newReserveA <= gradThreshold`, the stuck state means `currentReserve0 ≈ gradThreshold`. A single sell of any amount would push reserve0 above gradThreshold. Then the NEXT buy, if small enough, would keep `newReserveA > gradThreshold` and succeed.

BUT: the graduation failure scenario means the graduation was triggered but `_openTradingOnUniswap()` reverted. The **entire `_buy()` call reverted**, including the swap. So reserve0 was NEVER decreased by the triggering buy. The pair reserves remain at their pre-triggering-buy state. If `newReserveA <= gradThreshold` was true for that buy, it means `reserve0 - buyAmountOut <= gradThreshold`. The current reserve0 could be slightly above or AT gradThreshold.

Key insight: The graduation check uses `newReserveA` (reserve AFTER the buy), not current reserve. So if `currentReserve0 > gradThreshold` but `currentReserve0 - amountOut <= gradThreshold`, ANY buy large enough to push past the threshold will trigger graduation and revert.

Small buys that don't push below gradThreshold would SUCCEED. This is a critical nuance: the DoS is NOT on ALL buys, only on buys large enough to trigger graduation.

[TRACE:sell increases reserve0→small buys that keep newReserveA>gradThreshold succeed→only graduation-triggering buys fail→partial DoS, not total DoS]
[BOUNDARY:if currentReserve0=gradThreshold+1, any buy that gets amountOut>=2 tokens triggers graduation→very small buys (amountOut<=1) still work but are economically useless]

**New Evidence**: [TRACE:small buys below graduation threshold still work — DoS is specifically on graduation-triggering buys, not ALL buys]

**Verdict Update**: CONFIRMED, but with refinement. The DoS is on graduation and on buys that would trigger graduation. Tiny buys below the threshold still work but are economically meaningless when the token is at 99%+ of graduation. Sells also still work. Net effect is still a permanent graduation block with no admin rescue — the severity refinement is that it's not a TOTAL buy DoS but a graduation DoS + large-buy DoS.

**Confidence Change**: INCREASE (from 0.69 to ~0.75). New evidence strengthens the finding by confirming all three unexplored paths are dead ends, while adding the nuance that small buys technically work.

---

## DA Analysis: MG-3 (Medium, 0.63)

**Prior Path Explored**: Iter1 found BondingV5 reads BondingConfig at runtime; classified as retroactive config change risk. Did NOT trace exactly which params are read during buy(), or whether any affect the graduation threshold specifically.

**New Path Explored**: I traced every BondingConfig read inside BondingV5._buy() and the graduation path.

### BondingConfig reads during _buy()

In `_buy()` at L621-673:
```solidity
function _buy(...) internal returns (uint256) {
    // L632-633: factory.getPair() — reads FFactoryV3, NOT BondingConfig
    address pairAddress = factory.getPair(tokenAddress_, router.assetToken());
    
    // L637-638: pair.getReserves() — reads FPairV2
    IFPairV2 pairContract = IFPairV2(pairAddress);
    (uint256 reserveA, uint256 reserveB) = pairContract.getReserves();
    
    // L641-646: router.buy() — reads FRouterV3, which reads factory tax params
    (uint256 amount1In, uint256 amount0Out) = router.buy(...);
    
    // L662: tokenGradThreshold — reads STORAGE mapping, NOT BondingConfig
    uint256 gradThreshold = tokenGradThreshold[tokenAddress_];
    
    // L666: router.hasAntiSniperTax() — reads FRouterV3 which reads bondingV5.tokenAntiSniperType + bondingConfig.getAntiSniperDuration
    if (newReserveA <= gradThreshold && !router.hasAntiSniperTax(pairAddress) && tokenInfo[tokenAddress_].trading) {
        _openTradingOnUniswap(tokenAddress_);
    }
}
```

**Critical finding**: `_buy()` does NOT read `targetRealVirtual` or `fakeInitialVirtualLiq` from BondingConfig. The graduation threshold at L662 reads from `tokenGradThreshold[tokenAddress_]` — a per-token stored mapping set at preLaunch and never updated.

So changing `bondingCurveParams.targetRealVirtual` via `setBondingCurveParams()` does NOT retroactively affect ANY existing token's graduation threshold. It only affects NEW tokens created after the change.

The BondingConfig values that ARE read at runtime during buy/sell flow:
1. **FRouterV3._calculateAntiSniperTax()**: reads `bondingConfig.getAntiSniperDuration()` — PURE function on constants, NOT settable
2. **FRouterV3.buy()/sell()**: reads `factory.buyTax()`, `factory.sellTax()`, `factory.taxVault()` — from FFactoryV3, not BondingConfig
3. **BondingV5._buy() L666**: reads `router.hasAntiSniperTax()` which calls `bondingConfig.getAntiSniperDuration()` — again, pure function

**Conclusion**: The retroactive config change risk for `targetRealVirtual` is ALREADY MITIGATED by the per-token `tokenGradThreshold` storage. The original MG-3 finding overstates the risk — changing `targetRealVirtual` does NOT instantly trigger graduation for existing tokens. It only changes the threshold for future tokens.

However, other BondingConfig values read at preLaunch time (but NOT at runtime) include:
- `initialSupply` (L327)
- `deployParams` (L328-329)
- `fakeInitialVirtualLiq` (L376)
- `calculateBondingCurveSupply` (L252-253)
- `calculateLaunchFee` (L302-305)
- `feeTo` (L317)
- `teamTokenReservedWallet` (L383, L555)

Of these, `teamTokenReservedWallet` IS read at both preLaunch (L383) AND launch (L555) — the race condition identified in DEPTH-ST-7.

[TRACE:_buy() L662 reads tokenGradThreshold[token] from storage mapping, NOT bondingConfig→targetRealVirtual change does NOT retroactively trigger graduation]
[BOUNDARY:setBondingCurveParams(targetRealVirtual=0)→tokenGradThreshold unchanged for existing tokens→graduation threshold unaffected→no instant graduation]

**New Evidence**: [TRACE:exhaustive mapping of BondingConfig reads during buy() shows gradThreshold is storage-cached per-token, immune to runtime config changes]

**Verdict Update**: The specific fear "if admin changes targetRealVirtual to 0, does that instantly trigger graduation for all live pairs" is REFUTED. The graduation threshold is frozen per-token at preLaunch. The remaining retroactive config risk is limited to `teamTokenReservedWallet` (race condition between preLaunch and launch, already captured in DEPTH-ST-7) and factory tax params (changeable but these are in FFactoryV3, not BondingConfig).

**Confidence Change**: INCREASE (from 0.63 to ~0.80). The primary concern is disproven. Residual risk is the already-identified DEPTH-ST-7 race condition.

---

## DA Analysis: MG-1 (Medium, 0.67)

**Prior Path Explored**: Iter1 found FRouterV3.sell() calls setTaxStartTime() on pair; non-V5 pairs lack this function → revert. Did NOT check if FFactoryV3 can register non-V5 pairs at all.

**New Path Explored**: I traced FFactoryV3.createPair() access control to determine whether non-V5 pairs can exist in FFactoryV3.

### Can non-V5 pairs be registered in FFactoryV3?

FFactoryV3.createPair() at L96-103:
```solidity
function createPair(...) external onlyRole(CREATOR_ROLE) nonReentrant returns (address) {
    return _createPair(tokenA, tokenB, startTime, startTimeDelay);
}
```

CREATOR_ROLE is granted ONLY to BondingV5 (per deployment script deployLaunchpadv5_3.ts L358-361). FFactoryV3 is a separate deployment from FFactoryV2 (per the NatSpec: "FFactoryV2 is used by BondingV2/V3/V4 with FRouterV2; FFactoryV3 is used by BondingV5 with FRouterV3").

So the ONLY way a non-V5 token appears in FFactoryV3 is if:
1. DEFAULT_ADMIN_ROLE grants CREATOR_ROLE to another contract (e.g., a future BondingV6), OR
2. BondingV5 itself creates a pair for a token that somehow has different properties

In normal operation, BondingV5 creates the token via `agentFactory.createNewAgentTokenAndApplication()` at L331-352, then immediately creates the pair at L366. The token is guaranteed to be a V5 token because BondingV5 created it.

However, the FRouterV3._calculateAntiSniperTax() path at L293:
```solidity
uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);
```

This calls BondingV5.tokenAntiSniperType() which reverts if `tokenInfo[token_].creator == address(0)`. This would only happen if:
- A future bonding contract (V6+) is given CREATOR_ROLE on FFactoryV3, creating pairs for its own tokens that BondingV5 doesn't know about
- Admin manually grants CREATOR_ROLE to an EOA and creates arbitrary pairs

Both scenarios are admin misconfiguration, NOT possible through normal protocol operation.

Additionally, I checked if FRouterV3.sell() actually has an issue with setTaxStartTime:

FRouterV3.sell() at L138-172:
```solidity
function sell(...) public nonReentrant onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
    // ... (no call to setTaxStartTime here)
}
```

Wait — the original finding says "FRouterV3.sell() calls setTaxStartTime()". Let me re-verify. Searching FRouterV3.sell() ... NO, sell() does NOT call setTaxStartTime(). It is BondingV5.launch() at L531 that calls `router.setTaxStartTime(tokenRef.pair, block.timestamp)`.

FRouterV3.setTaxStartTime() at L344-355 uses try/catch:
```solidity
try pair.setTaxStartTime(_taxStartTime) {} catch {
    // Old pair contract doesn't have setTaxStartTime function
}
```

So even if the pair lacks setTaxStartTime, the try/catch handles it gracefully.

The REAL issue (DEPTH-ST-9) is in `_calculateAntiSniperTax()` L293 which does NOT use try/catch for the `bondingV5.tokenAntiSniperType()` call. This is the hard revert path.

[TRACE:FFactoryV3.createPair() gated by CREATOR_ROLE→only BondingV5 has CREATOR_ROLE→all pairs in FFactoryV3 are V5 pairs under normal operation]
[TRACE:FRouterV3.setTaxStartTime uses try/catch→graceful handling→not the revert path]
[TRACE:FRouterV3._calculateAntiSniperTax L293 no try/catch→hard revert for non-V5 tokens→but non-V5 tokens require admin misconfiguration to appear in FFactoryV3]

**New Evidence**: [TRACE:CREATOR_ROLE on FFactoryV3 is exclusive to BondingV5→non-V5 pairs require explicit admin role grant to another contract→admin misconfiguration only]

**Verdict Update**: The finding's technical root cause is CONFIRMED (no try/catch on tokenAntiSniperType), but the precondition is stronger than initially assessed. It requires admin to grant CREATOR_ROLE to a non-V5 contract AND that contract to create pairs. This is a defense-in-depth gap, not a normal-operation vulnerability. Severity remains Medium (admin misconfiguration + permanent buy DoS for affected tokens).

**Confidence Change**: INCREASE (from 0.67 to ~0.78). Precondition analysis narrows the attack surface to admin misconfiguration only.

---

## DA Analysis: RS2-4 (Medium, 0.67)

**Prior Path Explored**: Iter1 found no duplicate pair prevention in FFactoryV2/V3. Did NOT verify whether BondingV5.preLaunch() deduplicates.

**New Path Explored**: I traced the BondingV5._preLaunch() → factory.createPair() path to check for duplicate pair prevention.

### Can BondingV5 create duplicate pairs?

In `_preLaunch()` L331-352:
```solidity
(address token, uint256 applicationId) = agentFactory.createNewAgentTokenAndApplication(
    name_, ticker_, abi.encode(...), cores_, ...
);
```

Each call to `createNewAgentTokenAndApplication` creates a BRAND NEW token address. The token is freshly deployed. So `factory.createPair(token, assetToken, ...)` at L366 creates a pair for a unique token address each time.

The question "can a second pair be created for the same token?" reduces to: can `_preLaunch()` be called twice with the same token address? NO — because `_preLaunch()` creates the token in the same call, and each call creates a new token.

BUT: what about the overwrite in FFactoryV3._createPair()?

```solidity
_pair[tokenA][tokenB] = address(pair_);  // L86
_pair[tokenB][tokenA] = address(pair_);  // L87
```

If someone with CREATOR_ROLE calls `createPair(existingToken, assetToken, ...)` directly (not through BondingV5), the old pair address is silently overwritten. The old pair still exists (FPairV2 is a standalone contract) but `getPair()` now returns the new pair. This means:
- BondingV5._buy() at L632: `factory.getPair(tokenAddress_, router.assetToken())` would return the NEW pair
- The old pair still holds user funds (tokens + VIRTUAL) that are now orphaned
- All future buys/sells go to the new (empty) pair

However, CREATOR_ROLE is only held by BondingV5, and BondingV5 never calls createPair with an existing token. So this is only exploitable if admin grants CREATOR_ROLE to another entity.

[TRACE:_preLaunch() always creates new token via agentFactory→token address is unique per preLaunch→no duplicate pair from BondingV5 flow]
[TRACE:FFactoryV3._createPair() L86-87 silently overwrites existing pair mapping→if CREATOR_ROLE holder calls createPair with existing token→old pair orphaned→funds stranded]
[BOUNDARY:CREATOR_ROLE exclusive to BondingV5→overwrite requires admin to grant CREATOR_ROLE to another entity]

**New Evidence**: [TRACE:BondingV5 always creates fresh token addresses→duplicate pair impossible through normal flow; factory-level overwrite requires explicit admin role grant]

**Verdict Update**: The factory-level duplicate pair concern is technically valid (no `require(_pair[tokenA][tokenB] == address(0))` check), but it's unreachable through the BondingV5 flow because each preLaunch creates a unique token. The risk is defense-in-depth: if admin grants CREATOR_ROLE to another contract, that contract could overwrite pairs. Downgrade from Medium to Low — the precondition (admin role grant + deliberate duplicate creation) is extremely narrow.

**Confidence Change**: INCREASE (from 0.67 to ~0.82). Normal-flow duplicate pair creation is impossible.

---

## DA Analysis: RS3-3 (Medium, 0.67)

**Prior Path Explored**: Iter1 flagged graduation salt depends on caller. Did NOT trace exact salt/parameters used for DAO address.

**New Path Explored**: I traced the exact salt derivation in BondingV5._openTradingOnUniswap() and how it flows into AgentFactoryV7._createNewDAO().

### Salt derivation in graduation

BondingV5._openTradingOnUniswap() L748-756:
```solidity
address agentToken = agentFactory.executeBondingCurveApplicationSalt(
    tokenRef.applicationId,
    tokenRef.data.supply / 1 ether, // totalSupply
    tokenBalance / 1 ether,         // lpSupply
    pairAddress,                     // vault
    keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress_))  // salt
);
```

The salt is: `keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress_))`

Where:
- `msg.sender` = the external caller of `buy()` (the user who triggers graduation)
- `block.timestamp` = current block timestamp
- `tokenAddress_` = the token being graduated

### How the salt is used in AgentFactoryV7

`executeBondingCurveApplicationSalt()` calls `_executeApplication(id, true, tokenSupplyParams, salt, false)`.

With `needCreateAgentToken=false`, the token creation branch is SKIPPED. The salt is used ONLY at C4:
```solidity
// C4 — _createNewDAO
address payable dao = payable(
    _createNewDAO(daoName, IVotes(veToken), application.daoVotingPeriod, application.daoThreshold, salt)
);
```

`_createNewDAO()` at L316:
```solidity
instance = Clones.cloneDeterministic(daoImplementation, salt);
```

So the salt determines the DAO's deterministic CREATE2 address.

### Can a frontrunner exploit this?

**Scenario**: User A submits a buy() that triggers graduation. Frontrunner sees the pending tx and frontruns with their own buy().

If frontrunner's buy also triggers graduation (same token, same threshold):
- Frontrunner's `msg.sender` is different → different salt → different DAO address
- The DAO is created at a different CREATE2 address

**But**: does the frontrunner get ANY useful control? The DAO is created with:
- `veToken` as its voting token (LP stakers vote)
- `daoThreshold` from the application (set at preLaunch)
- `daoVotingPeriod` from the application

The DAO address itself is where governance actions route to. A different DAO address means:
- Different CREATE2 address but same initialization parameters
- The DAO has no special privileges over the token — it's the governance contract for proposals

The frontrunner does NOT gain control of the DAO by triggering graduation first. The DAO's power is derived from veToken holders (LP stakers), not from its address.

**Additional check**: `_existingAgents` mapping at L318:
```solidity
if (_existingAgents[instance]) {
    revert AgentAlreadyExists();
}
```

If a frontrunner triggers graduation for the same token, and the same salt produces the same DAO address (impossible with different msg.sender), this check would revert. But since different msg.sender → different salt → different address, this doesn't apply.

**Additional check**: Could the frontrunner pre-deploy a malicious contract at the predicted CREATE2 address? The CREATE2 address is deterministic: `keccak256(0xff ++ factory_address ++ salt ++ keccak256(implementation_bytecode))`. For Clones.cloneDeterministic, the bytecode is the minimal proxy bytecode pointing to `daoImplementation`. The salt is `keccak256(abi.encodePacked(frontrunner_address, block.timestamp, tokenAddress_))`. The frontrunner cannot control `block.timestamp` precisely (miner can), and the CREATE2 formula uses the AgentFactory's address. A pre-deployed contract at that address would need to have been deployed by AgentFactory, which is access-controlled. So pre-deployment attack is not feasible.

[TRACE:salt=keccak256(msg.sender,block.timestamp,tokenAddress)→used only for DAO CREATE2 address→different caller=different DAO address]
[TRACE:DAO power comes from veToken governance, not from address→changing DAO address has no economic impact]
[BOUNDARY:frontrunner triggers graduation→gets different DAO address→DAO initialized with same params→no control gained]

**New Evidence**: [TRACE:salt controls DAO CREATE2 address only; DAO power is governance-bound to veToken holders, not to the deployer or address; frontrunner gains no economic advantage from address difference]

**Verdict Update**: The finding's root cause (salt depends on caller) is technically correct, but the IMPACT is negligible. The DAO address difference has no economic consequence because the DAO's authority is derived from veToken governance, not from its address. A frontrunner triggering graduation first gets no advantage — they simply cause the DAO to deploy at a different address, with identical initialization. The graduated token, LP positions, and all economic value are unaffected by which user triggers graduation.

One remaining concern: does the NFT minting at C5 or the TBA creation at C6 depend on the DAO address in a way that benefits the frontrunner? The NFT is minted with the DAO address (L275), and the TBA is created with the application's `tbaSalt` (L291, NOT the graduation salt). Neither gives the frontrunner economic control.

**Confidence Change**: INCREASE (from 0.67 to ~0.85). The frontrunner concern is effectively a non-issue. Recommend downgrade to Low/Informational.

---

## New Finding: Graduation-Triggering Buy's Token Output Sent to teamTokenReservedWallet, Not User

This is NOT a new finding but an unexplored nuance of the graduation flow that I want to document as safe.

When `_buy()` triggers graduation via `_openTradingOnUniswap()`, the buy's token output has already been transferred to the buyer (via `router.buy()` at L641 which calls `IFPairV2(pair).transferTo(to, amountOut)` at FRouterV3 L223). The graduation happens AFTER the buy completes within `_buy()`. So the user who triggers graduation gets their tokens normally. The graduation then moves remaining reserves to Uniswap. This is correct behavior — no tokens are lost for the graduation-triggering buyer.

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Prior Confidence | New Confidence | Change |
|------------|----------|---------------------|---------|----------|-----------------|---------------|--------|
| EP-8 | BondingV5.sol:664-770 | Graduation failure creates permanent DoS — confirmed NO admin recovery path, but small sub-threshold buys still work | CONFIRMED | Critical | 0.69 | ~0.75 | INCREASE |
| MG-3 | BondingConfig.sol, BondingV5.sol | Runtime config risk overstated — gradThreshold is storage-cached per-token, immune to setBondingCurveParams changes | CONFIRMED (refined) | Medium→Low | 0.63 | ~0.80 | INCREASE |
| MG-1 | FRouterV3.sol:293, BondingV5.sol:793-798 | tokenAntiSniperType hard revert for non-V5 tokens — precondition requires admin CREATOR_ROLE grant | CONFIRMED | Medium | 0.67 | ~0.78 | INCREASE |
| RS2-4 | FFactoryV2/V3 createPair() | No duplicate pair check — but BondingV5 always creates unique tokens, so unreachable in normal flow | CONFIRMED (downgraded) | Medium→Low | 0.67 | ~0.82 | INCREASE |
| RS3-3 | BondingV5.sol:748-756 | Salt depends on caller but only affects DAO CREATE2 address — no economic impact, DAO power is governance-bound | CONFIRMED (negligible impact) | Medium→Informational | 0.67 | ~0.85 | INCREASE |

SCOPE: Write ONLY to assigned output file. Do NOT read or write other agents' output files. Do NOT proceed to subsequent pipeline phases (chain analysis, verification, report). Return findings and stop.
