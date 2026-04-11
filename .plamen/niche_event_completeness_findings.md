# Event Completeness Agent Findings

## Processing Log

### Targets Enumerated (30 functions analyzed)
1. BondingV5._preLaunch() — DONE: emits PreLaunched(token, pair, virtualId, initialPurchase, launchParams). Missing bondingCurveSupply and gradThreshold. Info-level only (not finding-worthy alone).
2. BondingV5.launch() — DONE: emits Launched with pre-zero initialPurchase (V5 fixed EVT-1 pattern). SAFE.
3. BondingV5.cancelLaunch() — DONE: V5 correctly captures initialPurchase before zeroing. SAFE (EVT-1 only affects V2/V3/V4).
4. BondingV5._openTradingOnUniswap() — DONE: emits Graduated(indexed token, agentToken). GAP: agentToken not indexed; graduation amounts missing → EVT-12.
5. FRouterV2.graduate() — DONE: NO event emitted → EVT-13 (combined with V3).
6. FRouterV3.graduate() — DONE: NO event emitted → EVT-13.
7. FRouterV2.addInitialLiquidity() — DONE: NO event emitted → EVT-14.
8. FRouterV3.addInitialLiquidity() — DONE: NO event emitted → EVT-14.
9. FPairV2.mint() — DONE: emits Mint(reserve0, reserve1). No token addresses, no indexing → EVT-15.
10. FPairV2.swap() — DONE: emits Swap(amount0In, amount0Out, amount1In, amount1Out). No indexed params. Acceptable (consistent with Uniswap design).
11. FPairV2.syncAfterDrain() — DONE: emits Sync(reserve0, reserve1). Adequate.
12. FPairV2.resetTime() — DONE: emits TimeReset(oldStartTime, newStartTime). Both values included. SAFE.
13. FPairV2.setTaxStartTime() — DONE: emits TaxStartTimeSet(_taxStartTime) only — no old value → EVT-16.
14. FFactoryV2._createPair() — DONE: emits PairCreated(indexed tokenA, indexed tokenB, pair, length). Gap: pair not indexed → EVT-15 (combined).
15. FFactoryV3._createPair() — DONE: same as V2 → EVT-15.
16. BondingV5.setBondingConfig() — N/A (EVT-7 already confirmed).
17. BondingConfig.setScheduledLaunchParams() — N/A (EVT-5 already confirmed).
18. FFactoryV2.setTaxParams() — N/A (EVT-8 already confirmed).
19. FFactoryV2.setRouter() — N/A (EVT-9 already confirmed).
20. FFactoryV3.setTaxParams() — N/A (EVT-8 already confirmed).
21. FFactoryV3.setRouter() — N/A (EVT-9 already confirmed).
22. FRouterV2.setTaxManager() — N/A (EVT-10 already confirmed).
23. FRouterV2.setAntiSniperTaxManager() — N/A (EVT-10 already confirmed).
24. FRouterV2.setBondingV2() — N/A (EVT-10 already confirmed).
25. FRouterV2.setBondingV4() — N/A (EVT-10 already confirmed).
26. FRouterV3.setBondingV5() — N/A (EVT-11 already confirmed).
27. FRouterV2.drainPrivatePool() — DONE: emits PrivatePoolDrained with all relevant data. SAFE.
28. FRouterV3.drainPrivatePool() — DONE: emits PrivatePoolDrained with all relevant data. SAFE.
29. FRouterV2.drainUniV2Pool() — DONE: emits UniV2PoolDrained. SAFE.
30. FRouterV3.drainUniV2Pool() — DONE: emits UniV2PoolDrained. SAFE.

### Coverage Gate: PASSED — All 30 targets processed.

---

## Finding [EVT-12]: Graduated Event Missing agentToken Index and Graduation Amounts

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no external deps)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition), R13:✗(not design-related), R14:✗(no aggregate variables), R15:✗(no flash-loan-accessible state), R16:✗(no oracle dependency)]
**Severity**: Low
**Location**: BondingV5.sol:135-136, BondingV5.sol:769

**Description**:
The `Graduated` event definition and emission in `BondingV5._openTradingOnUniswap()` has two monitoring gaps:

1. **`agentToken` is not indexed**: The event is declared as `event Graduated(address indexed token, address agentToken)`. The `agentToken` field — the newly-minted governance/agent token address — is not indexed. Off-chain indexers and subgraphs cannot efficiently filter graduation events by agent token address.

2. **Graduation amounts are absent**: The event carries only two addresses but omits the economically significant state changes that occur at graduation: `assetBalance` (VIRTUAL transferred to AgentFactory) and `tokenBalance` (pre-agent tokens transferred to the bonding contract). These amounts determine the LP supply and application threshold set in `agentFactory.updateApplicationThresholdWithApplicationId()`. There is no on-chain event record of graduation economics.

```solidity
// BondingV5.sol:135-136 — agentToken not indexed
event Graduated(address indexed token, address agentToken);

// BondingV5.sol:718-719 — amounts read but never emitted
uint256 assetBalance = pairContract.assetBalance();
uint256 tokenBalance = pairContract.balance();
// ...
emit Graduated(tokenAddress_, agentToken); // line 769: no amounts
```

**Impact**:
- Off-chain indexers and monitoring tools cannot query "which token graduated to produce agentToken X?" without full log scanning.
- Graduation economics (LP supply, asset threshold used for application) are not auditable on-chain from events alone. Post-incident analysis of graduation discrepancies (e.g., from the donation attack EP-5/TF-1) requires replaying state, not reading events.
- Monitoring for graduation anomalies (unusually high/low graduation amounts) is impossible from event logs alone.

**Evidence**:
```solidity
// BondingV5.sol:769
emit Graduated(tokenAddress_, agentToken);
// assetBalance and tokenBalance are available at this point (L718-719) but not emitted
```

---

## Finding [EVT-13]: FRouterV2/V3.graduate() Emits No Event (Router-Layer Graduation Silent)

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no external deps)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition), R13:✓, R14:✗(no aggregate variables), R15:✗(no flash-loan-accessible state), R16:✗(no oracle dependency)]
**Severity**: Low
**Location**: FRouterV2.sol:230-239, FRouterV3.sol:230-239

**Description**:
`FRouterV2.graduate()` and `FRouterV3.graduate()` are called by the bonding contract during `_openTradingOnUniswap()` and perform two critical token transfers — draining all asset tokens (`transferAsset`) and all pre-agent tokens (`transferTo`) from the pair to the bonding contract — without emitting any event.

```solidity
// FRouterV2.sol:230-239 and FRouterV3.sol:230-239 (identical)
function graduate(address tokenAddress) public onlyRole(EXECUTOR_ROLE) nonReentrant {
    require(tokenAddress != address(0), "Zero addresses are not allowed.");
    address pair = factory.getPair(tokenAddress, assetToken);
    uint256 assetBalance = IFPairV2(pair).assetBalance();
    uint256 tokenBalance = IFPairV2(pair).balance();
    IFPairV2(pair).transferAsset(msg.sender, assetBalance); // silent large transfer
    IFPairV2(pair).transferTo(msg.sender, tokenBalance);    // silent large transfer
}
```

While the bonding contract's `_openTradingOnUniswap()` does emit `Graduated(tokenAddress_, agentToken)`, that event is on the bonding contract. The actual token drain from the FPairV2 pool — the step where all VIRTUAL and pre-agent tokens move — has no router-level event. The `FPairV2.Swap`, `FPairV2.Sync`, and `FPairV2.Mint` events are not triggered by `graduate()`.

**Impact**:
- The liquidity drain from FPairV2 during graduation generates no event from the router contract. Any monitoring that tracks the FRouter contract for significant liquidity movements will miss graduation drains.
- The `FPairV2` pair itself has no `Sync` or `Burn` event for the drain path (only `transferAsset`/`transferTo` which are internal to the pair contract). The complete value flow during graduation is observable only through token transfer events on the ERC20 contracts, not through DEX-style pair events.

**Evidence**:
```solidity
// FRouterV3.sol:230-239 — no emit statement anywhere in this function
function graduate(address tokenAddress) public onlyRole(EXECUTOR_ROLE) nonReentrant {
    // ...transfers happen...
    // no emit here
}
```

---

## Finding [EVT-14]: FRouterV2/V3.addInitialLiquidity() Emits No Event (Pool Initialization Silent)

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no external deps)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition), R13:✗(not design-related), R14:✗(no aggregate variables), R15:✗(no flash-loan-accessible state), R16:✗(no oracle dependency)]
**Severity**: Low
**Location**: FRouterV2.sol:115-129, FRouterV3.sol:122-136

**Description**:
`FRouterV2.addInitialLiquidity()` and `FRouterV3.addInitialLiquidity()` initialize the bonding curve pool for a newly pre-launched token. The function transfers tokens to the pair and calls `FPairV2.mint()`. No event is emitted at the router layer.

```solidity
// FRouterV3.sol:122-136
function addInitialLiquidity(address token_, uint256 amountToken_, uint256 amountAsset_)
    public onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
    address pairAddress = factory.getPair(token_, assetToken);
    IERC20(token_).safeTransferFrom(msg.sender, pairAddress, amountToken_);
    IFPairV2(pairAddress).mint(amountToken_, amountAsset_);
    return (amountToken_, amountAsset_);
    // no emit
}
```

`FPairV2.mint()` does emit `Mint(reserve0, reserve1)` but this event is on the pair contract and lacks token addresses (see EVT-15). The router-level call — which establishes the initial bonding curve parameters — is completely silent.

The fake initial virtual liquidity (`fakeInitialVirtualLiq`) and initial token supply establishing the starting K value are the economic foundation of the bonding curve price discovery. These parameters are set once and never change, making this initialization the single most economically significant event in a token's lifecycle after `preLaunch`. Its silence means:

**Impact**:
- The initial bonding curve parameters (amountToken, amountAsset) are not recorded in any router event. Auditing the initial price point of a token requires replaying `addInitialLiquidity` calls by scanning EXECUTOR_ROLE transaction history.
- Discrepancies between preLaunch parameters and actual initial liquidity (e.g., if `bondingCurveSupply` was manipulated between preLaunch and addInitialLiquidity) are undetectable from events.

**Evidence**:
```solidity
// FRouterV2.sol:115-129 — identical gap
function addInitialLiquidity(address token_, uint256 amountToken_, uint256 amountAsset_)
    public onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
    // ...
    IFPairV2(pairAddress).mint(amountToken_, amountAsset_);
    return (amountToken_, amountAsset_);
    // no emit at router level
}
```

---

## Finding [EVT-15]: FPairV2.mint() Event Missing Token Address — FFactoryV2/V3 PairCreated pair Not Indexed

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no external deps)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✗(single fixed state), R11:✗(no external tokens), R12:✗(no dangerous precondition), R13:✗(not design-related), R14:✗(no aggregate variables), R15:✗(no flash-loan-accessible state), R16:✗(no oracle dependency)]
**Severity**: Low
**Location**: FPairV2.sol:48, FPairV2.sol:81, FFactoryV2.sol:33-35, FFactoryV3.sol:40-42

**Description**:
Two related indexing gaps reduce off-chain observability:

**Gap 1 — FPairV2.Mint missing token context**:
The `Mint` event emitted when initial liquidity is added contains only reserve amounts, not the token addresses involved:

```solidity
// FPairV2.sol:48
event Mint(uint256 reserve0, uint256 reserve1);
// emitted at L81 — no token address, no pair address
```

Since FPairV2 is a per-pair contract, indexers can correlate by contract address. However, indexed token addresses would enable cross-pair queries (e.g., "find all pairs initialized with tokenX") without requiring a factory lookup first.

**Gap 2 — PairCreated missing indexed pair address**:
The factory event includes tokenA and tokenB as indexed but not the pair address itself:

```solidity
// FFactoryV2.sol:33-35, FFactoryV3.sol:40-42
event PairCreated(
    address indexed tokenA,
    address indexed tokenB,
    address pair,        // NOT indexed
    uint                 // pairs.length at time of creation
);
```

A query "was this pair address created by this factory?" requires scanning all PairCreated logs and filtering by the `pair` field, rather than using an indexed filter. Given that pairs are created per-token (one pair per launch), this is an O(N) scan instead of O(1) indexed lookup for downstream integrations verifying pair provenance.

**Impact**:
- Subgraph/indexer implementations require additional factory lookups or full log scans to associate a pair address with its creation event.
- The unindexed `pair` field in `PairCreated` prevents efficient on-chain and off-chain queries for pair provenance verification.

---

## Finding [EVT-16]: FPairV2.setTaxStartTime() Emits Only New Value — Old Value Missing

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no external deps)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✓(semi-trusted EXECUTOR_ROLE involved in calling router.setTaxStartTime), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition), R13:✗(not design-related), R14:✗(no aggregate variables), R15:✗(no flash-loan-accessible state), R16:✗(no oracle dependency)]
**Severity**: Low
**Location**: FPairV2.sol:198-206, FPairV2.sol:58

**Description**:
The `TaxStartTimeSet` event in `FPairV2.setTaxStartTime()` emits only the new `_taxStartTime` value, without the previous `taxStartTime`:

```solidity
// FPairV2.sol:58
event TaxStartTimeSet(uint256 taxStartTime);

// FPairV2.sol:198-206
function setTaxStartTime(uint256 _taxStartTime) public onlyRouter {
    require(
        _taxStartTime >= startTime,
        "Tax start time must be greater than startTime"
    );
    taxStartTime = _taxStartTime;
    emit TaxStartTimeSet(_taxStartTime);  // no old value
}
```

In contrast, `resetTime()` at the same contract correctly emits both old and new values via `TimeReset(oldStartTime, newStartTime)` (FPairV2.sol:57).

`setTaxStartTime` is called from `BondingV5.launch()` (which legitimately sets it to `block.timestamp`) but also can be called directly by any EXECUTOR_ROLE via `FRouterV2/V3.setTaxStartTime()` — a finding already flagged as AC-5/TE-4 for indefinite anti-sniper tax extension. The absence of the old value in the event means:

1. If EXECUTOR_ROLE resets `taxStartTime` to a future value (extending the anti-sniper window), the event shows only the new value. Off-chain monitors cannot automatically detect that a reset occurred relative to a prior value without storing state themselves.
2. There is no on-chain event trail of "taxStartTime was previously X and was changed to Y by call at block Z." Post-incident reconstruction of tax manipulation requires replaying all `setTaxStartTime` call history in order.

**Impact**:
- Anti-sniper tax manipulation (TE-4/AC-5) via repeated `setTaxStartTime` calls is harder to detect in real-time from event logs alone because each event shows only the destination value, not the delta from prior state.
- Incident response for users affected by unexpectedly high anti-sniper taxes requires full transaction history reconstruction rather than event log analysis.

**Evidence**:
```solidity
// FPairV2.sol:57 — resetTime() gets it right (both values)
event TimeReset(uint256 oldStartTime, uint256 newStartTime);

// FPairV2.sol:58 — setTaxStartTime() only emits new value (inconsistent)
event TaxStartTimeSet(uint256 taxStartTime);
```

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|------------|----------|---------------------|---------|----------|-------------------|-------------------|
| EVT-12 | BondingV5.sol:135-136, :769 | Graduated event lacks indexed agentToken and omits graduation amounts (assetBalance, tokenBalance) | CONFIRMED | Low | N/A | STATE (graduation amounts unrecorded) |
| EVT-13 | FRouterV2.sol:230-239, FRouterV3.sol:230-239 | FRouter.graduate() transfers all pool assets without emitting any event | CONFIRMED | Low | N/A | STATE (silent large value transfer) |
| EVT-14 | FRouterV2.sol:115-129, FRouterV3.sol:122-136 | addInitialLiquidity() establishes bonding curve economics without any router-level event | CONFIRMED | Low | N/A | STATE (pool initialization invisible at router layer) |
| EVT-15 | FPairV2.sol:48,:81, FFactoryV2.sol:33-35, FFactoryV3.sol:40-42 | Mint event missing token addresses; PairCreated.pair not indexed | CONFIRMED | Low | N/A | STATE (off-chain queries degraded) |
| EVT-16 | FPairV2.sol:58,:198-206 | TaxStartTimeSet emits only new value, not old — inconsistent with TimeReset pattern | CONFIRMED | Low | ACCESS (EXECUTOR_ROLE) | STATE (prior taxStartTime unrecoverable from logs) |
