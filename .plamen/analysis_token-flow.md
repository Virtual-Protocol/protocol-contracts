# Token Flow Analysis — VP Launchpad Suite

**Agent**: B1 Token Flow Analysis
**Date**: 2026-04-02
**Scope**: contracts/launchpadv2/
**Primary Tokens**: VIRTUAL (asset/bonding), AgentToken (launched token), LP tokens (post-graduation)

---

## 1. Token Entry Points

### VIRTUAL Token ($VIRTUAL / assetToken)
| Entry Point | Contract | Mechanism |
|------------|----------|-----------|
| preLaunch() | BondingV5:321 | safeTransferFrom(msg.sender, address(this), initialPurchase) |
| buy() via _buy() | BondingV5:541 -> FRouterV3:204 | safeTransferFrom(to, pair, amount) — asset enters FPairV2 |
| buy() tax | FRouterV3:208 | safeTransferFrom(to, address(this), normalTxFee) — transient in router |
| Unsolicited transfer | FPairV2 | Anyone can transfer VIRTUAL directly to FPairV2 address |
| depositTax() | AgentTaxV2:168 | safeTransferFrom(msg.sender, address(this), amount) |

### AgentToken (pre-graduation bonding curve token)
| Entry Point | Contract | Mechanism |
|------------|----------|-----------|
| preLaunch() creation | BondingV5:331 | agentFactory.createNewAgentTokenAndApplication() mints to BondingV5 |
| addInitialLiquidity() | FRouterV3:131 | safeTransferFrom(BondingV5, pairAddress, amountToken) — agent token enters FPairV2 |
| sell() | FRouterV3:155 | safeTransferFrom(to, pairAddress, amountIn) — user returns tokens to pair |
| Unsolicited transfer | FPairV2 | Anyone can transfer agent tokens directly to FPairV2 address |

### LP Tokens (post-graduation UniswapV2)
| Entry Point | Contract | Mechanism |
|------------|----------|-----------|
| Post-graduation mint | External UniswapV2 | LP tokens minted to veToken contract during executeBondingCurveApplicationSalt() |

---

## 2. Token State Tracking

### FPairV2 — Dual Tracking System (CRITICAL)

| State Variable | Tracks | Updated By | Real Balance Check |
|---------------|--------|-----------|-------------------|
| `_pool.reserve0` | Agent token virtual reserve | swap(), mint(), syncAfterDrain() | NO — purely computed |
| `_pool.reserve1` | VIRTUAL virtual reserve | swap(), mint(), syncAfterDrain() | NO — purely computed |
| `_pool.k` | Constant product invariant | mint(), syncAfterDrain() | NO — set once at mint, NOT validated in swap() |
| `balance()` | Real agent token balance | balanceOf(address(this)) — LIVE READ | YES |
| `assetBalance()` | Real VIRTUAL balance | balanceOf(address(this)) — LIVE READ | YES |

**Key Divergence**: `reserve1` starts at `fakeInitialVirtualLiq` (e.g., 6300 * 1e18) but `assetBalance()` starts at 0. This is intentional virtual liquidity. As users buy, real VIRTUAL enters the pair, so `assetBalance()` grows while `reserve1` also grows (but from a different starting point). They NEVER converge — `reserve1` is always `assetBalance() + fakeInitialVirtualLiq - totalVIRTUALPaidToSellers`.

### BondingV5 — Token Info Tracking

| State Variable | Tracks | Updated By |
|---------------|--------|-----------|
| `tokenInfo[token].initialPurchase` | Creator's initial VIRTUAL deposit | preLaunch() sets, launch() zeroes, cancelLaunch() zeroes |
| `tokenInfo[token].trading` | Whether bonding curve trading is active | preLaunch() = true, _openTradingOnUniswap() = false, cancelLaunch() = false |
| `tokenInfo[token].tradingOnUniswap` | Post-graduation flag | _openTradingOnUniswap() = true |
| `tokenInfo[token].data.supply` | bondingCurveSupply | preLaunch() sets, never updated |

### AgentTaxV2 — Tax Tracking

| State Variable | Tracks | Updated By |
|---------------|--------|-----------|
| `tokenTaxAmounts[token].amountCollected` | Total tax deposited for token | depositTax() increments |
| `tokenTaxAmounts[token].amountSwapped` | Total tax swapped for token | _swapAndDistribute() increments |

---

## 3. Token Exit Points

### VIRTUAL Token
| Exit Point | Contract | Mechanism |
|-----------|----------|-----------|
| cancelLaunch() | BondingV5:480 | safeTransfer(creator, initialPurchase) — refund from BondingV5 |
| sell() | FRouterV3:163-167 | pair.transferAsset(to, amount); pair.transferAsset(this, txFee) |
| graduate() | FRouterV3:237 | pair.transferAsset(msg.sender, assetBalance) — ALL real VIRTUAL exits pair |
| _openTradingOnUniswap() | BondingV5:727 | safeTransfer(agentFactory, assetBalance) |
| drainPrivatePool() | FRouterV3:390 | pair.transferAsset(recipient, assetAmount) |

### AgentToken
| Exit Point | Contract | Mechanism |
|-----------|----------|-----------|
| buy() | FRouterV3:223 | pair.transferTo(to, amountOut) — tokens leave pair to buyer |
| graduate() | FRouterV3:238 | pair.transferTo(msg.sender, tokenBalance) — ALL agent tokens exit pair |
| _openTradingOnUniswap() | BondingV5:746 | safeTransfer(tokenAddress, tokenBalance) — sent to token contract itself |
| preLaunch() reserved | BondingV5:383 | safeTransfer(teamTokenReservedWallet, totalReservedSupply) |
| launch() initial buy | BondingV5:554 | safeTransfer(teamTokenReservedWallet, amountOut) |
| drainPrivatePool() | FRouterV3:394 | pair.transferTo(recipient, tokenAmount) |

### 3b. Self-Transfer Accounting

**BondingV5._openTradingOnUniswap() Line 746:**
```solidity
IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance);
```
This transfers agent tokens TO the agent token contract address itself. This is a deliberate design choice to move tokens back to the token contract for `executeBondingCurveApplicationSalt()` to use as LP supply. However, if the AgentToken has any logic that treats receipt of its own tokens differently (e.g., auto-burn, auto-distribute), this could have side effects. With the mock, this is a no-op transfer. In production, behavior depends on AgentToken implementation.

**FRouterV3.sell() — `to` parameter:**
In sell(), `to` is `msg.sender` (from BondingV5.sell()). The function does:
- `token.safeTransferFrom(to, pairAddress, amountIn)` — tokens from user to pair
- `pair.transferAsset(to, amount)` — VIRTUAL from pair to user

No self-transfer risk here since pair != to.

**FRouterV3.buy() — `to` parameter:**
- `IERC20(assetToken).safeTransferFrom(to, pair, amount)` — VIRTUAL from user to pair
- `IFPairV2(pair).transferTo(to, amountOut)` — agent token from pair to user

No self-transfer risk since pair != to.

---

## 4. Token Type Separation

This protocol handles multiple distinct token types through separate code paths:

| Token Type | Code Path | Confusion Risk |
|-----------|-----------|----------------|
| VIRTUAL (assetToken) | Always referenced via `router.assetToken()` or `assetToken` state var | LOW — address fixed at init |
| AgentToken (pre-grad) | Referenced via `tokenAddress` parameter in buy/sell | LOW — validated via tokenInfo mapping |
| AgentToken (post-grad) | Created by executeBondingCurveApplicationSalt() | MEDIUM — see TF-3 below |
| LP Token (UniV2) | Only in drainUniV2Pool context | LOW — validated via veToken.assetToken() |

**Cross-path check**: The `getAmountsOut()` function uses `assetToken_ == assetToken` to determine direction. If someone passes a different asset token address, the function falls through to the `else` branch, computing a sell instead of a buy. However, this is protected because `getAmountsOut` is always called internally with controlled parameters.

---

## 5. Unsolicited Transfer Analysis

### 5a. VIRTUAL Donation to FPairV2

**Vector**: Anyone can call `VIRTUAL.transfer(FPairV2Address, amount)`.

**Impact**:
1. `assetBalance()` increases by `amount` (real balance increases).
2. `_pool.reserve1` is UNCHANGED (virtual reserve unaffected).
3. `getAmountsOut()` and `swap()` are UNAFFECTED — they use virtual reserves only.
4. **Graduation is affected**: `_openTradingOnUniswap()` reads `assetBalance()` at line 718. The entire real VIRTUAL balance is then:
   - Transferred to BondingV5 via `router.graduate()` (FRouterV3:237)
   - Then transferred to `agentFactory` (BondingV5:727-728)
   - Used as `applicationThreshold` (BondingV5:731-733)

**Consequence**: Donated VIRTUAL is captured by the protocol at graduation. The `applicationThreshold` is set to `assetBalance` (which includes donations), meaning the protocol receives more VIRTUAL than was paid by real buyers. This is a value extraction from the donator to the protocol/token — not a vulnerability per se, but it inflates the graduation economics.

**For drainPrivatePool()**: Same issue — draining reads `assetBalance()` and sends the full real balance to the recipient. Donated VIRTUAL goes to the drain recipient.

### 5b. AgentToken Donation to FPairV2

**Vector**: Anyone can call `agentToken.transfer(FPairV2Address, amount)`.

**Impact**:
1. `balance()` increases by `amount`.
2. `_pool.reserve0` is UNCHANGED.
3. **Graduation is affected**: `_openTradingOnUniswap()` reads `balance()` at line 719.
   - All real agent tokens are sent back to `tokenAddress_` (the token contract itself) at line 746.
   - `executeBondingCurveApplicationSalt()` receives `tokenBalance / 1 ether` as `lpSupply`.

**Consequence**: Donated agent tokens inflate the `lpSupply` parameter, causing more LP tokens to be created on Uniswap. This dilutes existing token holders since more tokens enter the graduated LP pool than should have been available from the bonding curve.

### 5c. Unsolicited Transfer to BondingV5

**Impact**: Minimal. BondingV5 only reads specific token balances for specific operations. Donated tokens sit idle and cannot be extracted (no sweep function for arbitrary tokens). VIRTUAL donations could be confused with `initialPurchase` amounts only during `cancelLaunch()`, but `cancelLaunch()` uses the stored `tokenRef.initialPurchase` value, not `balanceOf`.

### 5b. Unsolicited Transfer Matrix

| Token Type | Can Transfer To FPairV2? | Changes Accounting? | Blocks Operations? | Triggers Side Effects? |
|-----------|-------------------------|--------------------|--------------------|----------------------|
| VIRTUAL | YES | YES: inflates assetBalance() used at graduation/drain | NO | NO |
| AgentToken | YES | YES: inflates balance() used at graduation/drain | NO | UNKNOWN in production (transfer hooks?) |
| Random ERC20 | YES | NO (only tokenA/tokenB balances are queried) | NO | NO |
| VIRTUAL to BondingV5 | YES | NO (uses stored values, not balanceOf) | NO | NO |
| VIRTUAL to AgentTaxV2 | YES | NO (uses stored amountCollected, not balanceOf) | NO | NO |
| AgentToken to BondingV5 | YES | NO | NO | UNKNOWN (production token may have hooks) |
| VIRTUAL to FRouterV3 | YES | NO (router holds no state tracking balances) | NO | Could be swept by next sell() tax transfer if router has leftover balance — but router uses safeTransferFrom from pair, not own balance |

---

## 6. Token Flow Checklist

| Token | Entry Points | Exit Points | Tracking Var | balanceOf(this) Used? | Unsolicited Possible? |
|-------|-------------|-------------|-------------|----------------------|----------------------|
| VIRTUAL | buy(via safeTransferFrom to pair), preLaunch(to BondingV5) | sell(transferAsset), graduate(transferAsset), cancelLaunch(safeTransfer), drain | _pool.reserve1 (virtual) | YES: assetBalance() | YES |
| AgentToken | addInitialLiquidity(to pair), sell(safeTransferFrom to pair) | buy(transferTo), graduate(transferTo), drain | _pool.reserve0 (virtual) | YES: balance() | YES |
| LP Token | post-grad mint | drainUniV2Pool | veToken balance (external) | NO (in this scope) | YES (to veToken) |
| Tax (VIRTUAL subset) | depositTax(safeTransferFrom to AgentTaxV2) | swapAndDistribute(safeTransfer to creator/treasury) | amountCollected/amountSwapped | YES: withdraw() uses balanceOf | YES (but no accounting impact) |

---

## 7. Cross-Token Interactions

1. **AgentToken supply affects VIRTUAL graduation amount**: The `bondingCurveSupply` determines `gradThreshold`, which determines when graduation triggers. At graduation, `assetBalance()` (VIRTUAL) is read and transferred. If agent token supply is manipulated (e.g., via donation), the graduation timing is unaffected (reserve0 is virtual), but the amounts transferred at graduation change.

2. **VIRTUAL tax extraction reduces available VIRTUAL**: During buy(), the normal tax and anti-sniper tax are deducted BEFORE the `amount` enters the pair. This means `assetBalance()` grows only by `amount` (post-tax), not `amountIn`. The tax goes to AgentTaxV2. This is correct accounting.

3. **AgentToken graduation creates new token type**: `executeBondingCurveApplicationSalt()` creates a new `agentToken` (the "real" graduated token). The pre-graduation agent token's `tokenBalance` (from the pair) is sent to the pre-grad token contract address. The new agentToken is a different contract address. Token holders of the pre-grad token need an external migration/unwrap mechanism (not in scope).

---

## Findings

---

**[TF-1]** -- Medium: Donation Attack on FPairV2 Inflates Graduation Amounts
**Location**: FPairV2.sol:180 (assetBalance()), FPairV2.sol:176 (balance()), BondingV5.sol:718-719
**Description**: FPairV2's `assetBalance()` and `balance()` use `balanceOf(address(this))` which includes any unsolicited token transfers. At graduation, `_openTradingOnUniswap()` reads both values:
```solidity
uint256 assetBalance = pairContract.assetBalance(); // L718
uint256 tokenBalance = pairContract.balance();       // L719
```
Then `router.graduate()` transfers ALL real balances out of the pair (FRouterV3:237-238):
```solidity
IFPairV2(pair).transferAsset(msg.sender, assetBalance);
IFPairV2(pair).transferTo(msg.sender, tokenBalance);
```
An attacker can donate VIRTUAL to FPairV2 before graduation to inflate `assetBalance`. This inflated amount is then sent to `agentFactory` as the `applicationThreshold` (BondingV5:727-733). The donated VIRTUAL is permanently captured by the protocol. For agent tokens, donated tokens inflate `lpSupply` in `executeBondingCurveApplicationSalt()`, diluting post-graduation LP.

**Impact**: 
- VIRTUAL donation: Attacker loses funds, protocol gains extra VIRTUAL. Low severity for attacker loss, but could be used to manipulate `applicationThreshold` governance parameter.
- AgentToken donation: Inflates lpSupply, diluting existing holders' share of the graduated Uniswap pool. This could be used to grief token holders.

**Evidence**:
```solidity
// FPairV2.sol:176-181
function balance() public view returns (uint256) {
    return IERC20(tokenA).balanceOf(address(this));
}
function assetBalance() public view returns (uint256) {
    return IERC20(tokenB).balanceOf(address(this));
}

// BondingV5.sol:718-719
uint256 assetBalance = pairContract.assetBalance();
uint256 tokenBalance = pairContract.balance();
```
**Step Execution**: ✓1,2,3,4,5,6,7,8,9

---

**[TF-2]** -- Medium: cancelLaunch() Permanently Locks Agent Tokens and Pair State
**Location**: BondingV5.sol:462-497
**Description**: When `cancelLaunch()` is called:
1. `initialPurchase` VIRTUAL is refunded to creator (L480-483)
2. `tokenRef.trading = false` and `tokenRef.launchExecuted = true` (L488-489)
3. BUT: Agent tokens in FPairV2 are NOT burned or transferred out
4. The FPairV2 pair is NOT destroyed or drained

At preLaunch, `addInitialLiquidity()` transfers `bondingCurveSupply` agent tokens to the pair (FRouterV3:131). After cancel, these tokens remain in the pair forever. The pair's router is still the FRouterV3, but no one can call swap/transfer because:
- BondingV5 gates all buy/sell on `tokenRef.trading == true` (which is now false)
- `drainPrivatePool()` requires `isProject60days()` which may not be true
- There is no generic recovery function

**Exact locked amounts**:
- `bondingCurveSupply` agent tokens (calculated as `initialSupply * (10000 - totalReserved) / 10000` in wei)
- 0 VIRTUAL (no VIRTUAL was sent to the pair during preLaunch — the virtual liquidity is fake)
- The `_pool` state remains initialized (lastUpdated != 0), blocking any future mint()

**Impact**: Permanent token locking. The `bondingCurveSupply` of agent tokens (potentially 45-100% of total supply) is irrecoverably locked in the FPairV2 contract. The `totalReservedSupply` sent to `teamTokenReservedWallet` (BondingV5:382-387) is separate and not affected.

**Evidence**:
```solidity
// BondingV5.sol:462-497 - cancelLaunch
function cancelLaunch(address tokenAddress_) public {
    // ... validation ...
    if (tokenRef.initialPurchase > 0) {
        IERC20(router.assetToken()).safeTransfer(tokenRef.creator, tokenRef.initialPurchase);
    }
    tokenRef.initialPurchase = 0;
    tokenRef.trading = false;
    tokenRef.launchExecuted = true;
    // NO token burn, NO pair drain, NO agent token recovery
}
```
**Step Execution**: ✓1,2,3,✗4(single-token),5,6,✗7(N/A at cancel),8,9

---

**[TF-3]** -- High: AgentToken Transfer Tax Causes Graduation Accounting Mismatch
**Location**: BondingV5.sol:746, FRouterV3.sol:131,155,223
**Description**: The MockAgentToken has NO transfer tax, but production AgentTokens apply `projectBuyTaxBasisPoints` and `projectSellTaxBasisPoints` on transfers involving LP pools (per external_production_behavior.md). Throughout the protocol, agent token transfers assume 1:1 delivery:

1. **addInitialLiquidity()** (FRouterV3:131): `safeTransferFrom(msg.sender, pairAddress, amountToken_)` — if taxed, pair receives less than `amountToken_`. But `mint()` is called with `amountToken_` as `reserve0`, creating immediate divergence between `reserve0` (virtual) and `balance()` (real).

2. **buy() transferTo** (FRouterV3:223): `pair.transferTo(to, amountOut)` — this is a transfer FROM the pair. If taxed, user receives less than `amountOut`. The pair's real balance decreases by `amountOut` but the virtual `reserve0` decreases by `amountOut` (via swap()). So `balance()` drops by `amountOut`, but user receives `amountOut - tax`. This means fewer tokens leave circulation than the virtual reserves track. Over time, `balance()` > expected, meaning more tokens remain in the pair than virtual reserves suggest.

3. **Graduation transfer** (BondingV5:746): `safeTransfer(tokenAddress_, tokenBalance)` — transfers agent tokens to the token contract itself. If taxed, the token contract receives less than `tokenBalance`. But `executeBondingCurveApplicationSalt()` uses `tokenBalance / 1 ether` as `lpSupply`, which is the PRE-TAX amount. This causes more LP to be configured than actually received, leading to a failed or under-collateralized LP creation.

4. **sell() safeTransferFrom** (FRouterV3:155): `safeTransferFrom(to, pairAddress, amountIn)` — user sends tokens to pair. If taxed, pair receives less than `amountIn`. But `swap()` is called with `amountIn` as `amount0In`, updating virtual reserve0 by the full pre-tax amount. Virtual reserves diverge from reality.

**Impact**: With a taxed token, the virtual reserve tracking (`_pool.reserve0`) progressively diverges from the real balance (`balance()`). This leads to:
- Incorrect pricing (virtual reserves suggest fewer tokens than actually in pair)
- Graduation may fail or create under-collateralized LP
- The `lpSupply` parameter passed to `executeBondingCurveApplicationSalt()` may exceed actual tokens received

**Evidence**:
```solidity
// FRouterV3.sol:223 - buy transfers full amountOut
IFPairV2(pair).transferTo(to, amountOut);
// FRouterV3.sol:225 - swap records full amountOut as leaving
IFPairV2(pair).swap(0, amountOut, amount, 0);
// If tax applies: pair.balance() decreased by amountOut, user got amountOut-tax
// But reserve0 decreased by amountOut (correct for pair, but user got less)

// BondingV5.sol:746-751 - graduation uses pre-tax tokenBalance
IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance);
address agentToken = agentFactory.executeBondingCurveApplicationSalt(
    tokenRef.applicationId,
    tokenRef.data.supply / 1 ether,
    tokenBalance / 1 ether, // lpSupply: PRE-TAX amount
    pairAddress,
    ...
);
```
**Step Execution**: ✓1,2,3,4,5,6,7,8,9

---

**[TF-4]** -- Low: FPairV2.swap() Does Not Validate K Invariant
**Location**: FPairV2.sol:86-107
**Description**: The `swap()` function updates reserves based on router-provided amounts without any K invariant validation:
```solidity
function swap(uint256 amount0In, uint256 amount0Out, uint256 amount1In, uint256 amount1Out) public onlyRouter returns (bool) {
    require(block.timestamp >= startTime, "Swap not started");
    uint256 _reserve0 = (_pool.reserve0 + amount0In) - amount0Out;
    uint256 _reserve1 = (_pool.reserve1 + amount1In) - amount1Out;
    _pool = Pool({ reserve0: _reserve0, reserve1: _reserve1, k: _pool.k, lastUpdated: block.timestamp });
    // ...
}
```
The new `_reserve0 * _reserve1` is NOT compared against `_pool.k`. The router is the sole enforcer of pricing correctness. If the router has a bug in `getAmountsOut()`, or if a new EXECUTOR_ROLE address is compromised, the pair offers zero protection.

Note: `_pool.k` is preserved but never checked. The `lastUpdated` field is written but never read (dead storage write, wasting gas).

**Impact**: Trust model is entirely on the router. No defense-in-depth. A single router bug or EXECUTOR_ROLE compromise drains all pairs instantly. The missing K check means the pair cannot detect or prevent economic violations.

**Evidence**:
```solidity
// FPairV2.sol:94-101 — K is preserved but never validated
uint256 _reserve0 = (_pool.reserve0 + amount0In) - amount0Out;
uint256 _reserve1 = (_pool.reserve1 + amount1In) - amount1Out;
_pool = Pool({
    reserve0: _reserve0,
    reserve1: _reserve1,
    k: _pool.k,           // kept the same, but...
    lastUpdated: block.timestamp  // ...never validated that _reserve0 * _reserve1 >= k
});
```
**Step Execution**: ✓1,2,3,✗4(N/A),5,6,7,8,9

---

**[TF-5]** -- Medium: Graduate() Double-Read of assetBalance()/balance() Creates TOCTOU Window
**Location**: BondingV5.sol:718-720, FRouterV3.sol:235-238
**Description**: `_openTradingOnUniswap()` reads balances BEFORE calling `router.graduate()`:
```solidity
uint256 assetBalance = pairContract.assetBalance(); // BondingV5:718
uint256 tokenBalance = pairContract.balance();       // BondingV5:719
router.graduate(tokenAddress_);                       // BondingV5:720
```
Then `router.graduate()` ALSO reads the same balances:
```solidity
uint256 assetBalance = IFPairV2(pair).assetBalance(); // FRouterV3:235
uint256 tokenBalance = IFPairV2(pair).balance();       // FRouterV3:236
IFPairV2(pair).transferAsset(msg.sender, assetBalance);
IFPairV2(pair).transferTo(msg.sender, tokenBalance);
```
The BondingV5 then uses its own cached values at lines 727 and 746:
```solidity
IERC20(router.assetToken()).safeTransfer(address(agentFactory), assetBalance); // L727
IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance);               // L746
```

Since `router.graduate()` transfers ALL real balances out of the pair to BondingV5, the BondingV5's cached `assetBalance` and `tokenBalance` should match what it actually received. However, if there were a reentrancy attack vector between the reads and the transfers (there isn't due to nonReentrant), or if the VIRTUAL token has transfer hooks, the values could diverge.

**Current protection**: `_openTradingOnUniswap()` is called from `_buy()` which is internal to BondingV5 (which has nonReentrant on buy()/launch()). FRouterV3.graduate() also has nonReentrant. So reentrancy is blocked.

**Residual risk**: If the exact same amounts are read twice (BondingV5 and FRouterV3 both read from pair), they should match because no state changes between the two reads within the same transaction. But the double-read is wasteful and could diverge if an intermediate operation modifies balances (none currently do).

**Impact**: LOW under current code. The nonReentrant guards prevent exploitation. But the pattern is fragile — any future modification that adds operations between BondingV5:718-720 and FRouterV3:235-238 could introduce TOCTOU bugs.

**Evidence**: See description.
**Step Execution**: ✓1,2,3,4,5,6,7,8,9

---

**[TF-6]** -- Medium: drainPrivatePool() Captures Donated Tokens Without Reserve Sync Awareness
**Location**: FRouterV3.sol:367-410
**Description**: `drainPrivatePool()` reads real balances and transfers everything:
```solidity
uint256 assetAmount = pair.assetBalance();  // L386
uint256 tokenAmount = pair.balance();       // L387
pair.transferAsset(recipient, assetAmount); // L390
pair.transferTo(recipient, tokenAmount);    // L394
pair.syncAfterDrain(assetAmount, tokenAmount); // L398
```
Then `syncAfterDrain()` subtracts from virtual reserves:
```solidity
_pool.reserve0 = _pool.reserve0 >= tokenAmount ? _pool.reserve0 - tokenAmount : 0;
_pool.reserve1 = _pool.reserve1 >= assetAmount ? _pool.reserve1 - assetAmount : 0;
```
Because virtual reserves can differ from real balances (due to fake initial liquidity and donations), `syncAfterDrain` may underflow-protect to 0 even when virtual reserves should be higher. Specifically:
- `assetAmount` (real) could be LESS than `reserve1` (virtual, which includes fake liquidity). In this case, `reserve1` correctly subtracts. Good.
- `assetAmount` could be MORE than `reserve1` if someone donated more VIRTUAL than the fake liquidity offset. In this case, `reserve1` becomes 0. The pool is now in an inconsistent state if trading were to resume (k would be 0, breaking pricing).
- `tokenAmount` (real) could be MORE than `reserve0` if someone donated agent tokens. `reserve0` becomes 0.

**Impact**: After drain, if trading somehow resumes (it shouldn't for Project60days, but no hard barrier exists beyond `isProject60days` check on drain itself), the k value of 0 would cause division by zero in `getAmountsOut()`.

**Evidence**:
```solidity
// FPairV2.sol:146-158
function syncAfterDrain(uint256 assetAmount, uint256 tokenAmount) public onlyRouter {
    _pool.reserve0 = _pool.reserve0 >= tokenAmount ? _pool.reserve0 - tokenAmount : 0;
    _pool.reserve1 = _pool.reserve1 >= assetAmount ? _pool.reserve1 - assetAmount : 0;
    _pool.k = _pool.reserve0 * _pool.reserve1; // Could be 0
}
```
**Step Execution**: ✓1,2,3,✗4(N/A),5,6,7,8,9

---

**[TF-7]** -- Low: Pool.lastUpdated Written But Never Read (Dead Storage)
**Location**: FPairV2.sol:78,101
**Description**: `_pool.lastUpdated` is set to `block.timestamp` in both `mint()` and `swap()`, but is NEVER read by any function in the protocol. The only place it has any effect is the `require(_pool.lastUpdated == 0, "Already minted")` check in `mint()`, which uses it as a "has been initialized" flag. A simple boolean would be more gas-efficient.

**Impact**: Wasted gas on every swap. Each swap writes `block.timestamp` to storage (5000/20000 gas for SSTORE) for no purpose.

**Evidence**:
```solidity
// FPairV2.sol:78 - written in mint()
lastUpdated: block.timestamp

// FPairV2.sol:101 - written in EVERY swap()
lastUpdated: block.timestamp

// No function ever reads _pool.lastUpdated except mint()'s require
```
**Step Execution**: ✓1,2,3,✗4(N/A),5,6,7,8,9

---

**[TF-8]** -- Medium: Graduation Sends Agent Tokens to Token Contract Address — Production Side Effects Unknown
**Location**: BondingV5.sol:746
**Description**: At graduation, the bonding contract sends ALL agent tokens from the pair to the agent token contract itself:
```solidity
IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance);
```
This is a self-transfer to the token contract. In the mock, this is a simple ERC20 transfer with no side effects. In production:
1. The real AgentToken may treat this as a taxable transfer (if the sender or receiver is a liquidity pool address). BondingV5 is not a liquidity pool, but the token contract itself could be on a list.
2. The token contract may auto-distribute received tokens (e.g., reflection tokens, auto-LP).
3. The token's internal accounting of its own balance could trigger threshold-based operations (e.g., `distributeTaxTokens()`).
4. If the token has a blacklist and BondingV5 is blacklisted (it was added to blacklist at preLaunch L354, then removed at L738-739 for the LP pool address, but not for BondingV5 itself), this transfer could revert.

Wait — examining BondingV5:354: `agentFactory.addBlacklistAddress(token, IAgentTokenV2(token).liquidityPools()[0])`. This blacklists the LP pool address (the UniswapV2 pair), not BondingV5. And at L738: `agentFactory.removeBlacklistAddress(tokenAddress_, IAgentTokenV2(tokenAddress_).liquidityPools()[0])`. This removes the LP pool from blacklist. BondingV5 is never blacklisted, so the safeTransfer at L746 should not revert due to blacklist.

**However**, if the production token has transfer restrictions that prevent receiving its own tokens, this would revert, blocking graduation entirely.

**Impact**: CONTESTED — depends entirely on production AgentToken behavior. If the production token reverts on self-receipt, graduation is permanently blocked for that token. All user funds (VIRTUAL in the pair) would be locked.

**Evidence**:
```solidity
// BondingV5.sol:746
IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance);
```
**Step Execution**: ✓1,2,3,4,5,6,7,8,✓9

---

## 8. External Call Return Type Verification

| External Call | Expected Return | Verified Production Return | Match? |
|--------------|----------------|---------------------------|--------|
| `agentFactory.createNewAgentTokenAndApplication()` | (address token, uint256 applicationId) | UNVERIFIED (mock) | ? |
| `agentFactory.executeBondingCurveApplicationSalt()` | address agentToken | UNVERIFIED (mock) | ? |
| `IAgentTokenV2(token).decimals()` | uint8 | Standard ERC20, likely correct | ✓ |
| `IAgentTokenV2(token).liquidityPools()` | address[] | UNVERIFIED (mock returns manually set array) | ? |
| `router.buy()` | (uint256 amount1In, uint256 amount0Out) | Verified (in-scope contract) | ✓ |
| `router.sell()` | (uint256 amount0In, uint256 amount1Out) | Verified (in-scope contract) | ✓ |
| `router.graduate()` | void | Verified (in-scope contract) | ✓ |
| `IERC20(assetToken).safeTransferFrom()` | void (reverts on failure) | Standard VIRTUAL ERC20 | ✓ |
| `IERC20(tokenAddress_).safeTransfer()` | void (reverts on failure) | UNVERIFIED — production token may have hooks | ? |
| `IAgentTaxMinimal(taxVault).registerToken()` | void | Verified (AgentTaxV2 in scope) | ✓ |
| `IAgentTaxForRouter(feeTo).depositTax()` | void | Verified (AgentTaxV2 in scope) | ✓ |
| `IAgentVeTokenV2(veToken).assetToken()` | address (LP pair) | UNVERIFIED (mock) | ? |
| `IAgentVeTokenV2(veToken).founder()` | address | UNVERIFIED (mock) | ? |
| `IAgentFactoryV7(agentFactory).removeLpLiquidity()` | void | UNVERIFIED (mock) | ? |

**UNVERIFIED calls**: 7 out of 14 external calls return values or trigger behavior that is only tested against mocks. Finding verdict for production-dependent issues cannot be REFUTED. Use CONTESTED.

---

## 9. Transfer Side Effects Analysis

| Token | On Transfer Side Effect | Verified? | Assumed Impact |
|-------|------------------------|-----------|----------------|
| VIRTUAL | Standard ERC20 transfer — no hooks expected | NO (testnet only) | Likely clean, but unverified for mainnet |
| AgentToken (pre-grad) | Production has transfer tax, blacklist, swap threshold, valid caller checks | NO (mock has none) | Tax reduces received amounts; blacklist could block transfers; swap threshold could trigger auto-swaps |
| AgentToken self-transfer (L746) | Token contract receives its own tokens | NO | Could trigger distributeTaxTokens() or reflection logic |
| LP Token (UniV2) | Standard UniV2 LP — no hooks | YES (well-known) | Clean transfer |
| veToken | Production may be non-transferable, have maturity locks | NO | drainUniV2Pool reads veToken.balanceOf(founder) — if veToken is locked, drain fails |
| Tax deposit to AgentTaxV2 | depositTax() updates amountCollected | YES (in scope) | No side effects beyond accounting |

### 9d. Side Effect Token Type Analysis

| External Call / Event | Side Effect | Token Type Produced | Protocol Handles This Type? | Mismatch? |
|----------------------|-------------|--------------------|-----------------------------|-----------|
| buy() -> transferTo (agent token from pair to user) | Production tax may reduce received amount | Agent Token (taxed) | NO — protocol assumes 1:1 delivery | YES |
| sell() -> safeTransferFrom (agent token from user to pair) | Production tax may reduce amount received by pair | Agent Token (taxed) | NO — protocol assumes 1:1 delivery | YES |
| graduation -> safeTransfer(tokenAddress_, tokenBalance) | Token contract may trigger internal operations | UNKNOWN | NO | YES (CONTESTED) |
| depositTax -> safeTransferFrom to AgentTaxV2 | Updates amountCollected | VIRTUAL (taxToken) | YES | NO |
| drainUniV2Pool -> removeLpLiquidity | Returns token0 + token1 to recipient | AgentToken + VIRTUAL | Not handled by this protocol (goes to recipient) | N/A |

**Adversarial Default Applied**:
- AgentToken transfer tax: ASSUMED YES. Impact: progressive reserve/balance divergence, graduation accounting mismatch (TF-3).
- AgentToken self-receipt side effects: ASSUMED YES. Impact: graduation could fail or trigger unexpected token redistribution (TF-8).
- veToken non-transferability: ASSUMED POSSIBLE. Impact: drainUniV2Pool could fail if founder's veTokens are locked.

---

## Step Execution Checklist

| Section | Required | Completed? | Notes |
|---------|----------|------------|-------|
| 1. Token Entry Points | YES | ✓ | All entry points for VIRTUAL, AgentToken, LP tokens mapped |
| 2. Token State Tracking | YES | ✓ | Virtual vs real reserve divergence fully documented |
| 3. Token Exit Points | YES | ✓ | All exit points mapped including self-transfer at graduation |
| 3b. Self-Transfer Accounting | YES | ✓ | L746 self-transfer identified and analyzed |
| 4. Token Type Separation | IF multi-token | ✓ | VIRTUAL/AgentToken/LP separation analyzed |
| 5. Unsolicited Transfer Analysis | YES | ✓ | Donation attacks on FPairV2 fully analyzed |
| 5b. Unsolicited Transfer Matrix | **YES** | ✓ | Full matrix for all token types across all contracts |
| 6. Token Flow Checklist | YES | ✓ | Complete table for all 4 token types |
| 7. Cross-Token Interactions | IF multi-token | ✓ | AgentToken<->VIRTUAL interactions at graduation |
| 8. External Call Return Type | **YES** | ✓ | 14 external calls verified/flagged |
| 9. Transfer Side Effects | **YES** | ✓ | All tokens analyzed for side effects |
| 9d. Side Effect Token Type | **YES** | ✓ | 5 side effect scenarios analyzed |

---

## Finding Summary

| ID | Severity | Title |
|----|----------|-------|
| TF-1 | Medium | Donation attack on FPairV2 inflates graduation amounts |
| TF-2 | Medium | cancelLaunch() permanently locks agent tokens and pair state |
| TF-3 | High | AgentToken transfer tax causes graduation accounting mismatch |
| TF-4 | Low | FPairV2.swap() does not validate K invariant (trust-router-completely model) |
| TF-5 | Medium | Graduate() double-read of balances creates fragile TOCTOU pattern |
| TF-6 | Medium | drainPrivatePool() captures donated tokens, may break pool state |
| TF-7 | Low | Pool.lastUpdated written but never read (dead storage waste) |
| TF-8 | Medium (CONTESTED) | Graduation sends agent tokens to token contract — production side effects unknown |
