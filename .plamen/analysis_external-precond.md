# External Precondition Audit — LaunchpadV2

**Agent:** Analysis Agent B6
**Date:** 2026-04-02
**Scope:** contracts/launchpadv2/ (BondingV5, FRouterV3, FRouterV2, BondingConfig)
**Method:** Interface-level inference only (no production contract fetch)

---

## Step 1: Interface-Level Requirement Inference

| # | External Function Called | Parameters Passed | Likely Preconditions (from interface) | Our Protocol Validates? |
|---|-------------------------|-------------------|---------------------------------------|------------------------|
| 1 | `AgentFactory.createNewAgentTokenAndApplication()` | name, symbol, tokenSupplyParams (encoded), cores, tbaSalt, tbaImplementation, daoVotingPeriod, daoThreshold, 0, msg.sender | Factory must be deployed and accessible; caller must have appropriate role (BONDING_ROLE or similar); ERC6551Registry must be configured in factory; tokenSupplyParams encoding must match factory's expected decode format; tbaSalt + tbaImplementation must be valid for CREATE2 | **NO** -- BondingV5 does not verify factory is operational before calling; no validation that returned token address is non-zero |
| 2 | `AgentFactory.addBlacklistAddress(token, addr)` | token from step 1, liquidityPools()[0] from new token | Factory must own/control the token; token must exist; blacklist address must not already be blacklisted | **NO** -- no validation; relies on token being freshly created in same tx |
| 3 | `AgentFactory.removeBlacklistAddress(token, addr)` | token, liquidityPools()[0] | Same as above; address must be currently blacklisted | **NO** |
| 4 | `AgentFactory.updateApplicationThresholdWithApplicationId(id, assetBalance)` | applicationId from tokenInfo, assetBalance from pair | Application must exist with matching ID; caller must have role on factory; applicationThreshold update must be allowed (not already executed) | **PARTIAL** -- `require(tokenRef.applicationId != 0)` is checked only for executeBondingCurveApplicationSalt, NOT for updateApplicationThresholdWithApplicationId |
| 5 | `AgentFactory.executeBondingCurveApplicationSalt(id, totalSupply, lpSupply, vault, salt)` | applicationId, supply/1e18, tokenBalance/1e18, pairAddress, keccak256(sender,timestamp,token) | Application must exist and not already executed; totalSupply/lpSupply must be valid; salt must not collide; vault must be a valid address; internal CREATE2 deployment must succeed | **PARTIAL** -- checks applicationId != 0, but does not validate returned address |
| 6 | `AgentFactory.removeLpLiquidity(veToken, recipient, veTokenAmount, 0, 0, deadline)` | veToken from caller, recipient, full founder balance, no slippage, deadline | Factory must have REMOVE_LIQUIDITY_ROLE; veToken must contain LP tokens; founder must have approved factory to spend veTokens; underlying Uniswap router must be able to remove liquidity; LP pair must have sufficient reserves | **NO** -- no validation that factory has required role; amountAMin/amountBMin = 0 means any manipulation is accepted |
| 7 | `IAgentTokenV2(token).liquidityPools()[0]` | None (view call on newly created token) | Token must have at least one liquidity pool registered | **NO** -- if token is created without LP pool pre-registered, this would revert with index-out-of-bounds |
| 8 | `IAgentTaxMinimal(taxVault).registerToken(token, creator, creator)` | token address, creator as both TBA and creator | taxVault must implement IAgentTaxMinimal; token must not already be registered; caller must have appropriate role | **PARTIAL** -- checks taxVault != address(0), but does not validate the call succeeds beyond revert |
| 9 | `IAgentTaxForRouter(taxVault).depositTax(tokenAddress, amount)` | tokenAddress, tax amount | taxVault must implement depositTax; token must be registered; caller must have approved taxVault for the amount; token must be recognized | **PARTIAL** -- forceApprove is called before depositTax, but if token is not registered the depositTax may revert, bricking all buys/sells |
| 10 | `IFPairV2(pair).setTaxStartTime(taxStartTime)` | block.timestamp | Pair must support setTaxStartTime (newer pairs only) | **YES** -- wrapped in try/catch in both FRouterV2 and FRouterV3 |
| 11 | `IFPairV2(pair).syncAfterDrain(assetAmount, tokenAmount)` | drain amounts | Pair must support syncAfterDrain (newer pairs only) | **YES** -- wrapped in try/catch |
| 12 | `IAgentVeTokenV2(veToken).assetToken()` | None | veToken must implement IAgentVeTokenV2 | **NO** -- caller-supplied veToken is cast without validation; malicious contract could return any address |
| 13 | `IAgentVeTokenV2(veToken).founder()` | None | veToken must implement IAgentVeTokenV2 | **NO** -- same as above |
| 14 | `IUniswapV2Pair(lpPair).token0()` / `token1()` | None | lpPair must be a valid Uniswap V2 pair | **NO** -- lpPair comes from attacker-supplied veToken.assetToken() |

---

## Step 2: Return Value Consumption

| # | External Call | Return Type | How Protocol Uses Return | Failure Mode if Return Unexpected |
|---|--------------|-------------|-------------------------|----------------------------------|
| 1 | `agentFactory.createNewAgentTokenAndApplication(...)` | `(address token, uint256 applicationId)` | `token` used as the new fun-token address throughout; `applicationId` stored and used during graduation | **[EP-1] CRITICAL**: If factory returns `(address(0), 0)` — protocol stores address(0) as token, subsequent operations on it will fail or behave unpredictably. No zero-address check on returned token. No check that applicationId > 0 at creation time. |
| 2 | `factory.createPair(token, assetToken, startTime, delay)` | `address pair` | Stored as `tokenInfo[token].pair`; used for all trading | **[EP-2] HIGH**: If factory returns address(0) — pair is stored as zero address. All subsequent pair operations (buy, sell, graduate) will call functions on address(0), which may succeed silently for non-existent contracts (returning zero bytes) or revert. No zero-address check. |
| 3 | `agentFactory.executeBondingCurveApplicationSalt(...)` | `address agentToken` | Stored as `tokenRef.agentToken`; emitted in Graduated event | **[EP-3] HIGH**: Return value is stored but never validated. If it returns address(0), the graduation event emits address(0) as the agentToken. Downstream consumers (indexers, UI) would get invalid data. Token is already transferred to `tokenAddress` before this call, so tokens are lost if this returns incorrectly. |
| 4 | `router.buy(amountIn, tokenAddress, buyer, isInitialPurchase)` | `(uint256 amount1In, uint256 amount0Out)` | `amount0Out` checked against slippage minimum | **OK** -- zero check exists (`amount0Out == 0` reverts) |
| 5 | `router.sell(amountIn, tokenAddress, to)` | `(uint256 amount0In, uint256 amount1Out)` | `amount1Out` checked against slippage minimum | **OK** -- zero check exists |
| 6 | `router.assetToken()` | `address` | Used throughout for VIRTUAL token address | **LOW** -- if misconfigured, all operations fail immediately. Single point of truth. |
| 7 | `factory.taxVault()` | `address` | Used as tax destination in BondingV5.preLaunch and FRouterV3 buy/sell | **[EP-4] MEDIUM**: In BondingV5.preLaunch, `require(taxVault != address(0))` is checked. But in FRouterV3.buy/sell, taxVault is fetched from factory without zero-check — if factory.taxVault() returns address(0), the `depositTax` call would target address(0). |
| 8 | `pairContract.assetBalance()` / `pairContract.balance()` | `uint256` | Used to determine how much to transfer during graduation | **[EP-5] HIGH**: These read `balanceOf(address(pair))` — vulnerable to donation attacks. An attacker can send tokens to the pair to inflate these values. During graduation, inflated `assetBalance` is transferred to agentFactory, and inflated `tokenBalance` is sent to the token contract. See State Dependency section. |
| 9 | `pairContract.getReserves()` | `(uint256 reserveA, uint256 reserveB)` | Used in `_buy()` to compute `newReserveA` for graduation check | **OK** -- reserves are internal accounting, not manipulable by donation. |
| 10 | `veTokenContract.founder()` | `address` | Used to look up `balanceOf(founder)` on veToken | **[EP-6] MEDIUM**: Return is used without validation. If founder is address(0), balanceOf(address(0)) returns 0, and the require(veTokenAmount > 0) catches it. Safe by accident. |
| 11 | `IERC20(veToken).balanceOf(founder)` | `uint256` | Passed as veTokenAmount to removeLpLiquidity | **[EP-7] HIGH**: The veToken balance of the founder is read, but the actual removeLpLiquidity call needs the founder to have approved the factory to spend those veTokens. The protocol does NOT ensure this approval exists. If founder hasn't approved, removeLpLiquidity reverts. |

---

## Step 3: State Dependency Mapping

| # | Protocol State | Depends on External State | External State Can Change Without Our Knowledge? |
|---|---------------|--------------------------|--------------------------------------------------|
| A | `tokenInfo[token].trading` = true (trading enabled) | AgentFactory successfully created token and pair | **YES** -- AgentFactory could be upgraded/paused after token creation but before graduation. Token creation is in preLaunch; graduation happens later in a separate tx triggered by a buy crossing the threshold. |
| B | Graduation atomicity | AgentFactory.executeBondingCurveApplicationSalt must succeed | **[EP-8] CRITICAL**: If AgentFactory is paused, upgraded, or the application state is modified between preLaunch and graduation, the graduation call will revert. Since graduation is triggered atomically within a user's buy() tx, that user's buy reverts too. **Worse**: once `newReserveA <= gradThreshold`, EVERY subsequent buy attempt triggers graduation and reverts. The pool becomes permanently stuck — users cannot buy (graduation reverts) and can only sell (but reserves won't recover above threshold due to token distribution). This creates a **permanent denial of service for the pool**. |
| C | `assetBalance` transferred to AgentFactory at graduation | Actual VIRTUAL balance in FPairV2 | **[EP-9] HIGH**: Between the last buy that triggers graduation and the graduation execution (same tx, so front-running within tx is not possible for balance, BUT donation before the triggering buy IS possible). An attacker who donates VIRTUAL to the pair before the graduation-triggering buy causes more VIRTUAL to be sent to AgentFactory than earned from trading. This extra VIRTUAL is captured by the application threshold update and becomes part of the Uniswap pool seed. |
| D | Token transfer tax at graduation | AgentToken production behavior (transfer tax on non-whitelisted transfers) | **[EP-10] CRITICAL**: In `_openTradingOnUniswap()`, line 746: `IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)`. This transfers `tokenBalance` tokens to the token contract itself. If the production AgentToken has a transfer tax (buy/sell basis points apply when destination is a liquidity pool or general transfer), the token contract receives `tokenBalance * (1 - taxRate)`. However, `executeBondingCurveApplicationSalt` is called with `tokenBalance / 1 ether` as `lpSupply`. The factory then attempts to use these tokens to seed the Uniswap V2 pool, but the actual balance is less than `lpSupply * 1 ether`. **This creates a mismatch between expected and actual token amounts in the Uniswap pool**, potentially causing the pool creation to fail or be initialized with wrong ratios. |
| E | `tokenLaunchParams[token].isProject60days` for drain authorization | BondingV5 state (immutable per token after preLaunch) | **NO** -- this is set at preLaunch and never changes. Safe. |
| F | veToken.assetToken() -> LP pair verification | AgentVeToken contract state | **[EP-11] HIGH**: The `drainUniV2Pool` function verifies that the veToken's `assetToken()` points to an LP pair containing the expected tokens. However, this verification chain is: `veToken.assetToken()` -> `IUniswapV2Pair(lpPair).token0/token1()`. A **malicious contract** implementing IAgentVeTokenV2 could return a crafted LP pair address that passes token0/token1 checks but is not a legitimate Uniswap pair. The attacker could: (1) deploy a contract that returns the correct token addresses for token0/token1, (2) set `founder()` to return an address they control with a veToken balance, (3) cause removeLpLiquidity to operate on the wrong pool. **However**, the EXECUTOR_ROLE restriction limits this — only trusted callers can invoke drainUniV2Pool, so the risk depends on backend validation. |
| G | `pair.taxStartTime()` for anti-sniper calculation | FPairV2 state (set via setTaxStartTime) | **[EP-12] MEDIUM**: If `setTaxStartTime()` fails silently (try/catch), the pair uses `startTime` instead of `taxStartTime`. For new BondingV5 pairs, `startTime` is set during `preLaunch` and could be in the future (scheduled launch). `taxStartTime` is set during `launch()` to `block.timestamp`. If the try/catch swallows the failure, anti-sniper tax calculation uses `startTime` (which may be earlier or later than intended), causing either: (a) shorter anti-sniper window than expected (if startTime was in the past), or (b) permanent maximum anti-sniper tax until startTime passes (if startTime is in the future and taxStartTime was not set). |
| H | `factory.taxVault()` consistency across buy/sell operations | FFactoryV3 state (admin-configurable) | **[EP-13] MEDIUM**: The taxVault address is fetched from factory on every buy/sell. If factory admin changes taxVault mid-operation or between registerToken (which uses the old taxVault) and subsequent buys/sells (which use the new taxVault), the depositTax call may fail because the token was registered on the old taxVault, not the new one. |
| I | AgentFactory role permissions for BondingV5 | AgentFactory access control state | **[EP-14] HIGH**: BondingV5 calls multiple functions on AgentFactory (createNewAgentTokenAndApplication, addBlacklistAddress, removeBlacklistAddress, updateApplicationThresholdWithApplicationId, executeBondingCurveApplicationSalt). Each requires BondingV5 to have the appropriate role on AgentFactory. If any role is revoked or AgentFactory is upgraded to change role requirements, the corresponding operation fails. Graduation is particularly vulnerable because it makes 4 sequential AgentFactory calls — if any fails mid-sequence, the graduation reverts but the pool is now stuck (see EP-8). |

---

## Findings Summary

### [EP-1] No Validation of AgentFactory.createNewAgentTokenAndApplication Return Value
**Severity:** HIGH
**Location:** BondingV5.sol `_preLaunch()`, line 331-352
**Description:** The returned `(token, applicationId)` is used directly without checking `token != address(0)` or `applicationId != 0`. If the factory returns zero values (e.g., due to internal failure that doesn't revert), the protocol stores invalid data and all subsequent operations on this "token" will behave unpredictably.
**Impact:** Protocol stores address(0) as a token, corrupting state for that slot.

### [EP-2] No Validation of factory.createPair Return Value
**Severity:** HIGH
**Location:** BondingV5.sol `_preLaunch()`, line 366-371
**Description:** The returned pair address is stored without zero-address validation. Subsequent pair operations would target address(0).
**Impact:** Broken trading for the affected token launch.

### [EP-3] executeBondingCurveApplicationSalt Return Value Not Validated
**Severity:** HIGH
**Location:** BondingV5.sol `_openTradingOnUniswap()`, line 748-756
**Description:** The returned `agentToken` address is stored and emitted but never checked for address(0). Tokens have already been transferred to `tokenAddress` at this point (line 746), so the transfer is non-reversible.
**Impact:** Graduation succeeds with invalid agentToken; downstream indexers get bad data; actual Uniswap pool creation inside AgentFactory may have failed.

### [EP-4] taxVault Zero-Check Inconsistency
**Severity:** MEDIUM
**Location:** FRouterV3.sol buy() line 207, sell() line 161
**Description:** BondingV5.preLaunch checks `require(taxVault != address(0))`, but FRouterV3 buy/sell calls `factory.taxVault()` without zero-check before using it as the target for `depositTax()`.
**Impact:** If taxVault is set to address(0) after preLaunch, all buys/sells revert or send tax to address(0).

### [EP-5] Graduation Amounts Based on balanceOf (Donation Attack Surface)
**Severity:** HIGH
**Location:** BondingV5.sol `_openTradingOnUniswap()`, lines 718-719 (via FRouterV3.graduate reading pair.assetBalance/balance)
**Description:** Graduation amounts are derived from `pair.assetBalance()` and `pair.balance()`, which read `balanceOf(address(pair))`. These can be inflated by direct token transfers to the pair address. The inflated amounts are then used to seed the Uniswap V2 pool via AgentFactory.
**Impact:** Attacker can donate tokens to the pair before the graduation-triggering buy, causing the Uniswap pool to be seeded with incorrect ratios. This could create arbitrage opportunities at graduation or waste tokens.

### [EP-6] veToken founder() Return Not Validated (Safe by Accident)
**Severity:** LOW
**Location:** FRouterV2/V3.sol `drainUniV2Pool()`, line 457-458 (V3)
**Description:** `founder()` return value is not checked, but `require(veTokenAmount > 0)` catches the case where founder is address(0) (balance would be 0).
**Impact:** None due to implicit check, but fragile pattern.

### [EP-7] drainUniV2Pool Assumes Founder Has Approved Factory for veToken Spend
**Severity:** HIGH
**Location:** FRouterV2.sol line 480, FRouterV3.sol line 466
**Description:** `removeLpLiquidity(veToken, recipient, veTokenAmount, ...)` is called with the founder's full veToken balance. This requires the founder to have approved the AgentFactory to spend their veTokens. The protocol does not ensure or verify this approval.
**Impact:** `drainUniV2Pool` will always revert if the founder hasn't pre-approved the factory, making the drain function non-functional. Given this is a privileged EXECUTOR_ROLE function, the backend must ensure approval exists, but no on-chain enforcement exists.

### [EP-8] Graduation Failure Creates Permanent Pool DoS
**Severity:** CRITICAL
**Location:** BondingV5.sol `_buy()` lines 664-670 and `_openTradingOnUniswap()` lines 703-772
**Description:** Once `newReserveA <= gradThreshold` and anti-sniper tax has expired, every `_buy()` call triggers `_openTradingOnUniswap()`. If graduation fails (due to AgentFactory being paused, upgraded, role revoked, or any of the 4+ external calls reverting), the buy transaction reverts. Critically, sells do NOT reduce `reserveA` below the graduation threshold (sells increase reserveA). So once the threshold is crossed, EVERY future buy will attempt graduation and fail, while sells can only move reserves further from the threshold. **The pool is permanently bricked.**
**Mitigating factor:** The protocol owner can potentially update the AgentFactory address or fix the underlying issue, but this requires admin intervention and the pool remains stuck until then. Users' funds in the bonding curve (as token balances) cannot be fully recovered via sells if reserves have depleted.

### [EP-9] Donation to Pair Before Graduation-Triggering Buy
**Severity:** MEDIUM
**Location:** BondingV5.sol `_openTradingOnUniswap()`, lines 718-729
**Description:** An attacker can front-run the graduation-triggering buy by sending extra VIRTUAL or agent tokens directly to the pair contract. The graduation flow reads `pair.assetBalance()` and `pair.balance()` (which use `balanceOf`), so donated amounts are included. Extra VIRTUAL is sent to AgentFactory and used to update the application threshold; extra agent tokens are sent to the token contract for Uniswap pool seeding.
**Impact:** Distorted Uniswap V2 pool initialization. The attacker loses donated tokens but can manipulate the initial pool ratio. Medium severity because the economic cost to the attacker scales with the impact.

### [EP-10] Transfer Tax on Agent Token at Graduation — Amount Mismatch
**Severity:** CRITICAL
**Location:** BondingV5.sol `_openTradingOnUniswap()`, line 746 and 748-754
**Description:** Line 746: `IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)` — transfers `tokenBalance` of agent tokens to the token contract. Line 750: `agentFactory.executeBondingCurveApplicationSalt(..., tokenBalance / 1 ether, ...)` — tells the factory that `lpSupply = tokenBalance / 1 ether`.

In production, AgentToken has transfer tax (buy/sell basis points). If the transfer from BondingV5 to the token contract triggers a tax, the token contract receives less than `tokenBalance`. But the factory is told `lpSupply = tokenBalance / 1 ether` and will attempt to use that full amount to seed the Uniswap pool.

**Potential outcomes:**
1. If AgentToken's tax-on-transfer applies to this self-transfer, the Uniswap pool receives fewer tokens than expected, breaking the K invariant or causing `addInitialLiquidity` to fail.
2. If BondingV5 is whitelisted as a "valid caller" in AgentToken, no tax applies and this is safe. But this whitelist dependency is not validated on-chain.
3. The mock tests use MockAgentToken with no transfer tax, so this path is completely untested.

**Impact:** Graduation may fail in production if transfer tax applies, creating the permanent DoS described in EP-8. Or if it somehow succeeds, the Uniswap pool is initialized with wrong ratios.

### [EP-11] Interface Spoofing in drainUniV2Pool veToken Verification
**Severity:** MEDIUM (mitigated by EXECUTOR_ROLE)
**Location:** FRouterV2/V3.sol `drainUniV2Pool()`, lines 441-473 (V3)
**Description:** The verification chain `veToken.assetToken()` -> `pair.token0()` / `pair.token1()` can be spoofed by a malicious contract that implements these interfaces. A crafted veToken could return a crafted LP pair address that passes the token0/token1 checks.
**Mitigation:** EXECUTOR_ROLE restriction means only trusted backend can call this. However, if the backend is compromised or passes unvalidated user input, the spoofing becomes exploitable.
**Impact:** Could potentially drain liquidity from the wrong pool or cause unexpected behavior in removeLpLiquidity.

### [EP-12] Silent Failure of setTaxStartTime May Cause Wrong Anti-Sniper Window
**Severity:** MEDIUM
**Location:** FRouterV3.sol `setTaxStartTime()`, lines 344-355; called from BondingV5.sol `launch()` line 531
**Description:** `setTaxStartTime()` uses try/catch. If the pair contract doesn't support `setTaxStartTime()` (old contract), the failure is silent. For BondingV5-created pairs, this should never happen (new pairs always support it). But if a pair is upgraded or replaced, the anti-sniper tax calculation falls back to `pair.startTime()`.
**Impact:** For scheduled launches, `startTime` may be significantly earlier than the actual launch time. If `setTaxStartTime` fails, the anti-sniper window may have already expired by the time `launch()` is called, providing zero sniper protection.

### [EP-13] taxVault Address Can Change Between registerToken and depositTax
**Severity:** MEDIUM
**Location:** BondingV5.sol line 443-448 (registerToken), FRouterV3.sol lines 207-210 (depositTax on buy)
**Description:** During preLaunch, the token is registered with `IAgentTaxMinimal(taxVault).registerToken(...)` using the current taxVault. During subsequent buys/sells, taxVault is re-fetched from `factory.taxVault()`. If the admin changes the taxVault between preLaunch and first trade, depositTax targets the new taxVault where the token is not registered.
**Impact:** All buy/sell operations for the token revert if the new taxVault requires token registration.

### [EP-14] AgentFactory Role Dependency for Multi-Step Graduation
**Severity:** HIGH
**Location:** BondingV5.sol `_openTradingOnUniswap()`, lines 727-756
**Description:** Graduation makes 4 sequential AgentFactory calls: (1) `updateApplicationThresholdWithApplicationId`, (2) `removeBlacklistAddress`, (3) implicit transfer via `IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)`, (4) `executeBondingCurveApplicationSalt`. BondingV5 must maintain multiple roles on AgentFactory for all of these. Role revocation for any one of them bricks graduation with the DoS from EP-8.
**Impact:** Single point of failure across multiple permission boundaries.

---

## Step Execution Checklist

| Section | Required | Completed? |
|---------|----------|------------|
| 1. Interface-Level Requirement Inference | YES | Y |
| 2. Return Value Consumption | YES | Y |
| 3. State Dependency Mapping | YES | Y |

---

## Cross-Reference to Investigation Questions

| Question | Finding(s) | Summary |
|----------|-----------|---------|
| 1. Graduation atomicity risk | EP-8, EP-14 | If AgentFactory is paused/upgraded/role-revoked, graduation permanently fails. Every subsequent buy reverts (graduation is auto-triggered). Pool is bricked. |
| 2. AgentToken transfer tax at graduation | EP-10 | `tokenBalance` sent to token contract may be reduced by transfer tax. Factory is told the full amount. Mismatch breaks Uniswap pool seeding. Completely untested with mocks. |
| 3. Try/catch on setTaxStartTime | EP-12 | Silent failure causes fallback to `startTime`. For scheduled launches, anti-sniper window may already be expired. |
| 4. veToken pair verification in drain | EP-11 | Verification checks token0/token1 of the LP pair returned by veToken.assetToken(). Spoofable by malicious contract, but mitigated by EXECUTOR_ROLE. |
| 5. AgentFactory.removeLpLiquidity interface | EP-7 | Parameters match interface. But the founder must have pre-approved the factory — protocol does not ensure this. amountAMin/amountBMin = 0 accepts any slippage. |
| 6. ERC6551Registry at graduation | N/A | ERC6551Registry is called inside AgentFactory.createNewAgentTokenAndApplication() during preLaunch, not during graduation. If it fails, preLaunch reverts (naked call, no try/catch inside factory). Not a graduation risk directly. |
| 7. Return value handling | EP-1, EP-2, EP-3 | Three critical return values (token address, pair address, agentToken address) are not validated for address(0). |
| 8. External call ordering at graduation | EP-8, EP-14 | Order: (1) router.graduate() drains pair, (2) transfer VIRTUAL to factory, (3) updateApplicationThreshold, (4) removeBlacklistAddress, (5) transfer tokens to token contract, (6) executeBondingCurveApplicationSalt. Failure at any step after (1) means pair is drained but graduation incomplete — tokens and VIRTUAL are stuck in BondingV5 with no recovery path. |
