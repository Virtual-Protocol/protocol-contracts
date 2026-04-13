## Medium Findings

---

### [M-01] MAX_UINT Fees in Scheduled Launch Parameters — Admin Misconfiguration DoS [UNVERIFIED]

**Severity**: Medium
**Location**: `BondingConfig.sol:240-244`
**Confidence**: MEDIUM

*Severity adjusted from High — attack requires the BondingConfig owner to violate their stated trust assumption.*

**Description**:
`BondingConfig.setScheduledLaunchParams()` accepts `normalLaunchFee` and `acfFee` with no upper bound validation. If either field is set to a very large value (including `type(uint256).max`), `calculateLaunchFee()` returns that value, and every subsequent call to `_preLaunch()` for a scheduled or ACF-mode launch reverts because `purchaseAmount_ < launchFee` is always true for any realistic purchase amount.

```solidity
// BondingConfig.sol:240-244
function setScheduledLaunchParams(ScheduledLaunchParams memory params_) external onlyOwner {
    scheduledLaunchParams = params_;  // No validation on normalLaunchFee or acfFee values
}

// BondingV5.sol:302-309 (simplified)
launchFee = bondingConfig.calculateLaunchFee(isScheduled, needAcf);
if (purchaseAmount_ < launchFee) revert InvalidInput();
```

Immediate (non-scheduled, non-ACF) launches are unaffected because their fee path returns zero. The vulnerability is limited to the `X_LAUNCH` and `ACP_SKILL` launch modes. Recovery requires the owner to call `setScheduledLaunchParams` again with valid values — if the owner has also called `renounceOwnership()`, recovery becomes impossible (see M-11 regarding the `renounceOwnership` risk).

**Impact**:
All scheduled (`X_LAUNCH`) and ACF-skill (`ACP_SKILL`) token launches are permanently blocked. Creators who already paid the prerequisite fees or whose scheduled windows are open cannot launch their tokens. A separate `renounceOwnership()` call by the owner would make this misconfiguration permanent with no recovery path.

**PoC Result**:
[CODE-TRACE] `setScheduledLaunchParams({normalLaunchFee: type(uint256).max})` → `calculateLaunchFee()` returns `MAX_UINT` → `_preLaunch()`: `purchaseAmount_ < MAX_UINT` is always true → `revert InvalidInput()` for all scheduled launches.

**Recommendation**:
Add an upper bound check in `setScheduledLaunchParams()`:
```solidity
require(params_.normalLaunchFee <= MAX_REASONABLE_FEE, "normalLaunchFee exceeds maximum");
require(params_.acfFee <= MAX_REASONABLE_FEE, "acfFee exceeds maximum");
```
Define `MAX_REASONABLE_FEE` as a protocol constant representing the maximum acceptable launch fee (e.g., the expected graduation-level VIRTUAL amount).

---

### [M-02] EXECUTOR Self-Removal via renounceRole() — Permanent Administrative Halt [UNVERIFIED]

**Severity**: Medium
**Location**: `FRouterV3.sol:118-124`
**Confidence**: MEDIUM

*Severity adjusted from High — attack requires the EXECUTOR_ROLE holder to voluntarily remove their own role, which is within their account's control but constitutes a violation of their operational responsibilities.*

**Description**:
OpenZeppelin's `AccessControlUpgradeable.renounceRole()` is inherited without override in `FRouterV3`. Any `EXECUTOR_ROLE` holder (including `beOpsWallet`) can call `renounceRole(EXECUTOR_ROLE, self)` to immediately and irrevocably remove themselves from the role.

All direct administrative operations gated by `EXECUTOR_ROLE` — including `graduate()`, `drainPrivatePool()`, `drainUniV2Pool()`, `resetTime()`, and `setTaxStartTime()` — become inaccessible to the removed account. Recovery requires the `DEFAULT_ADMIN_ROLE` holder to grant `EXECUTOR_ROLE` to a replacement address.

The severity depends on the deployment configuration. If `BondingV5` itself holds a separate `EXECUTOR_ROLE` grant for routing `buy()`/`sell()` calls through the router, normal user trading would be unaffected by `beOpsWallet` renouncing its own grant. If `beOpsWallet` is the sole `EXECUTOR_ROLE` holder, all trading halts immediately. The deployment configuration is not validated on-chain and no minimum-holder check exists before renounce succeeds.

The finding is also a component of a more severe chain: if combined with `DEFAULT_ADMIN_ROLE` self-revocation (see H-08), there is no on-chain recovery path whatsoever.

**Impact**:
At minimum: all direct EXECUTOR administrative operations (`graduate()`, drain functions, `setTaxStartTime()`) halt until `DEFAULT_ADMIN_ROLE` grants the role to a new address. At maximum (sole-EXECUTOR scenario): complete user trading halt across the entire protocol until role is re-granted.

**PoC Result**:
[CODE-TRACE] `beOpsWallet` calls `FRouterV3.renounceRole(EXECUTOR_ROLE, beOpsWallet)` → OZ `AccessControlUpgradeable` clears the role immediately → subsequent call to any `onlyRole(EXECUTOR_ROLE)` function from `beOpsWallet` reverts with `"AccessControl: account missing role"`.

**Recommendation**:
Override `renounceRole` to prevent the last holder of `EXECUTOR_ROLE` from renouncing:
```solidity
function renounceRole(bytes32 role, address account) public override {
    if (role == EXECUTOR_ROLE) {
        require(getRoleMemberCount(EXECUTOR_ROLE) > 1, "Cannot renounce last EXECUTOR");
    }
    super.renounceRole(role, account);
}
```
Alternatively, maintain at least two independent `EXECUTOR_ROLE` holders and document the minimum-holder requirement.

---

### [M-03] Missing Validation on Critical Factory Setters — Zero-Address DoS Vectors [UNVERIFIED]

**Severity**: Medium
**Location**: `FFactoryV2.sol`, `FFactoryV3.sol`, `BondingConfig.sol`
**Confidence**: HIGH

**Description**:
Five admin setters across `FFactoryV2`, `FFactoryV3`, and `BondingConfig` accept zero addresses without validation, each causing a distinct category of launch or operational failure. All share the same fix pattern (add zero-address guards) and are consolidated here.

| Contract | Function | Parameter | Failure Mode |
|----------|----------|-----------|-------------|
| `FFactoryV2/V3` | `setRouter(address)` | `router_` | All new pair creation reverts at `require(router != address(0))` in `_createPair()`. Existing pairs unaffected. |
| `BondingConfig` | `setCommonParams(...)` | `feeTo` | `safeTransferFrom(msg.sender, address(0), launchFee)` reverts for all paid (scheduled/ACF) launches. |
| `BondingConfig` | `setDeployParams(...)` | `tbaImplementation` | `address(0)` passed to `agentFactory.createNewAgentTokenAndApplication()` — DoS or TBA-absent tokens depending on external AgentFactory behavior. |
| `BondingConfig` | `setTeamTokenReservedWallet(address)` | `wallet` | `safeTransfer(address(0), reservedTokens)` reverts for all `X_LAUNCH` / `ACP_SKILL` launches where `totalReservedSupply > 0`. |

For `setRouter(address(0))` specifically:
```solidity
// FFactoryV3.sol:132-134
function setRouter(address router_) external onlyRole(ADMIN_ROLE) {
    router = router_;  // No zero-address check
}

// FFactoryV3.sol:76 — called during createPair()
require(router != address(0), "No router");  // Reverts on next createPair
```

All four failure modes are recoverable (the owner or admin can call the setter again with a valid value), provided the owner has not also called `renounceOwnership()`.

**Impact**:
Depending on which setter is misconfigured:
- `setRouter(address(0))`: All new token launches blocked until admin corrects the router.
- `setCommonParams(feeTo=0)`: All paid (scheduled and ACF) launches revert; free launches unaffected.
- `setDeployParams(tbaImplementation=0)`: All token launches fail or produce tokens without TBA (token-bound account) functionality.
- `setTeamTokenReservedWallet(0)`: All `X_LAUNCH` and `ACP_SKILL` launches revert; basic immediate launches unaffected.

**PoC Result**:
[CODE-TRACE] for `setRouter(address(0))`: admin calls `FFactoryV3.setRouter(address(0))` → stored successfully → next `createPair()` → `_createPair()` L76: `require(router != address(0), "No router")` → revert. All four setters confirmed via direct code inspection — no zero-address guard present in any.

**Recommendation**:
Add zero-address guards to all four setters:
```solidity
require(router_ != address(0), "Zero address not allowed");
require(params_.feeTo != address(0), "feeTo cannot be zero");
require(params_.tbaImplementation != address(0), "tbaImplementation cannot be zero");
require(wallet_ != address(0), "wallet cannot be zero");
```

---

### [M-04] Multicall3 Admin-Only Functions Bypass Standard Access Control [UNVERIFIED]

**Severity**: Medium
**Location**: `Multicall3.sol:90-111, 191-233`
**Confidence**: MEDIUM

*Severity note: The attack requires a compromised admin account (semi-trusted actor), not an external permissionless attacker.*

**Description**:
`Multicall3`'s aggregate functions (`aggregate()`, `aggregate3()`, `aggregate3Value()`) are gated by `onlyOwnerOrAdmin` and execute arbitrary `(target, callData)` pairs via low-level `call`. When the `Multicall3` contract itself is the owner of another contract, or when `Multicall3` holds token balances, an admin can craft call data that bypasses the `onlyOwner` restriction on `transferToken()`.

Specifically: `transferToken()` at `Multicall3` is `onlyOwner`. However, `aggregate()` is `onlyOwnerOrAdmin`. When an admin calls `aggregate()` with `target = address(Multicall3)` and `callData = abi.encodeWithSelector(transferToken.selector, ...)`, the low-level call executes `transferToken` with `msg.sender = address(Multicall3)`. Since `Multicall3` IS the owner of itself for that check, the `onlyOwner` guard passes and the token transfer executes.

```solidity
// Multicall3.sol:90-111 (simplified)
function aggregate(Call[] calldata calls) public onlyOwnerOrAdmin returns (...) {
    for (uint256 i = 0; i < calls.length; i++) {
        (bool success, bytes memory ret) = calls[i].target.call(calls[i].callData);
        // msg.sender for the downstream call = address(this) = Multicall3
    }
}

// An admin constructs:
// calls[0] = {target: address(multicall3), callData: abi.encodeCall(transferToken, (token, adminAddr, amount))}
// → multicall3.transferToken() runs with msg.sender = Multicall3 → onlyOwner passes → tokens drained
```

**Impact**:
An admin with access to `aggregate()` can drain any ERC20 token balance held by `Multicall3`, including tokens accumulated via protocol operations or direct transfers. The `onlyOwner` restriction on `transferToken()` is rendered ineffective as a boundary between admin and owner privilege levels.

**PoC Result**:
[CODE-TRACE] Admin calls `aggregate([{target: multicall3Addr, callData: encode(transferToken(token, adminAddr, balance))}])` → `Multicall3` makes self-call → `transferToken` executes with `msg.sender == address(Multicall3) == owner()` → `onlyOwner` check passes → tokens transferred to admin-controlled address.

**Recommendation**:
Restrict aggregate functions to `onlyOwner` only, removing admin access from batch execution:
```solidity
function aggregate(...) public onlyOwner returns (...) { ... }
```
Alternatively, add a self-call guard:
```solidity
require(calls[i].target != address(this), "Self-calls not allowed");
```
This preserves admin access for external calls while preventing the privilege escalation path.

---

### [M-05] cancelLaunch Missing State Update Before External Transfer — Reentrancy Risk [UNVERIFIED]

**Severity**: Medium
**Location**: `BondingV5.sol:462-497`, `BondingV2.sol:387-420`, `BondingV3.sol:322-355`
**Confidence**: MEDIUM

**Description**:
All four bonding contract versions (`BondingV5`, `BondingV2`, `BondingV3`, `BondingV4`) violate the Checks-Effects-Interactions pattern in their `cancelLaunch()` function. The `safeTransfer` of `initialPurchase` VIRTUAL to the creator executes before `initialPurchase` is zeroed and `launchExecuted` is set to `true`. None of the V2/V3/V4 versions have a `nonReentrant` modifier on `cancelLaunch`.

```solidity
// BondingV5.sol:479-489 (execution order)
if (tokenRef.initialPurchase > 0) {
    IERC20(router.assetToken()).safeTransfer(
        tokenRef.creator,
        tokenRef.initialPurchase    // INTERACTION: external call ← here
    );
    uint256 initialPurchase = tokenRef.initialPurchase;
    tokenRef.initialPurchase = 0;  // EFFECT: zeroed after call ← too late
    tokenRef.launchExecuted = true; // EFFECT: set after call ← too late
    tokenRef.trading = false;
}
```

If the `assetToken` ever acquires callback capabilities (ERC-777 `tokensReceived` hook, EIP-1363, or if the VIRTUAL proxy is upgraded to include transfer callbacks), a malicious creator could re-enter `cancelLaunch()` before `initialPurchase` is zeroed, draining double the refund amount. The shared VIRTUAL balance pool (all creators' initial purchases are held together in the bonding contract) means a successful double-refund drains funds belonging to other creators.

Under the current deployment where VIRTUAL is a standard ERC-20 with no callbacks, exploitation is not possible. However, the structural flaw persists and will become exploitable if VIRTUAL's implementation changes.

**Impact**:
If VIRTUAL acquires transfer callbacks: a malicious creator could double-claim their `initialPurchase` refund, draining the shared VIRTUAL balance that holds other creators' deposits. The aggregate shared balance may represent millions in VIRTUAL depending on how many concurrent un-launched tokens exist.

**PoC Result**:
[CODE-TRACE] Structural violation confirmed in all four versions. Current VIRTUAL token is standard ERC-20 — no active callback mechanism. Exploitation is conditional on assetToken gaining callback capability. BondingV5 has `nonReentrant` on `buy()` and `sell()` but NOT on `cancelLaunch()`.

**Recommendation**:
Apply the Checks-Effects-Interactions pattern by zeroing state before the transfer, and add `nonReentrant` to `cancelLaunch()` in all versions:
```solidity
function cancelLaunch(address tokenAddress_) external {
    // ... (checks)
    uint256 refundAmount = tokenRef.initialPurchase;
    tokenRef.initialPurchase = 0;      // EFFECT first
    tokenRef.launchExecuted = true;    // EFFECT first
    tokenRef.trading = false;          // EFFECT first
    IERC20(router.assetToken()).safeTransfer(tokenRef.creator, refundAmount); // then INTERACT
}
```

---

### [M-06] Stale Reserve After drainPrivatePool — Permanent Buy DoS on Old FPairV2 Pairs [UNVERIFIED]

**Severity**: Medium
**Location**: `FRouterV3.sol:385-423`, `FRouterV2.sol:411-423`
**Confidence**: MEDIUM

**Description**:
`FRouterV3.drainPrivatePool()` drains asset and agent tokens from an `FPairV2` pair and then attempts to synchronize the pair's tracked reserves via `pair.syncAfterDrain()`. This call is wrapped in a `try/catch` to handle legacy `FPairV2` deployments that predate the `syncAfterDrain` function:

```solidity
// FRouterV3.sol:397-400
try pair.syncAfterDrain(assetAmount, tokenAmount) {}
catch {}   // Silent failure — old FPairV2 pairs have no syncAfterDrain
```

On old `FPairV2` instances that lack `syncAfterDrain`, the catch block swallows the failure silently. The pair's internal `_pool.reserve0` and `_pool.reserve1` remain at their pre-drain values while the actual ERC-20 balances of the pair are now zero (or near-zero). Any subsequent `buy()` or `sell()` call reads the stale reserves via `getReserves()`, computes an `amountOut` that the pair cannot actually deliver, and reverts when `transferAsset`/`transferTo` finds insufficient balance in the pair.

This creates a permanent buy and sell DoS on any old `FPairV2` token that has been drained via `drainPrivatePool`. The old pair is frozen indefinitely with no recovery path from the router.

**Impact**:
All buy and sell operations for affected tokens revert permanently. Users who hold agent tokens for those `Project60days` tokens cannot sell them back through the normal route. The router has no mechanism to mark old pairs as inactive or route around them.

**PoC Result**:
[CODE-TRACE] `drainPrivatePool(oldFPairV2)` → assets transferred out → `syncAfterDrain` reverts (function not present) → caught silently → `pair.reserve0` still shows pre-drain amount → next `buy()`: `getAmountsOut(staleReserve)` returns X → `transferAsset(pair, X)` → `pair` has 0 balance → `safeTransfer` reverts with "ERC20: transfer amount exceeds balance".

**Recommendation**:
When `syncAfterDrain` fails (old pair), mark the pair as frozen to prevent further trade routing:
```solidity
try pair.syncAfterDrain(assetAmount, tokenAmount) {}
catch {
    frozenPairs[address(pair)] = true;  // Add mapping: prevent further routing
    emit PairFrozenAfterDrain(address(pair));
}
```
Alternatively, add a check in `buy()`/`sell()` that skips or reverts early for pairs flagged as drained-without-sync.

---

### [M-07] FRouterV3._calculateAntiSniperTax() Reverts for Non-V5 Tokens — Silent Revert DoS [UNVERIFIED]

**Severity**: Medium
**Location**: `FRouterV3.sol:283-320`, `BondingV5.sol:793-798`
**Confidence**: HIGH

**Description**:
`FRouterV3._calculateAntiSniperTax()` calls `bondingV5.tokenAntiSniperType(tokenAddress)` without a `try/catch` wrapper. `BondingV5.tokenAntiSniperType()` reverts with `InvalidTokenStatus()` for any token whose `creator` field in `tokenInfo` is `address(0)` — which includes every token not registered through that specific `BondingV5` instance:

```solidity
// FRouterV3.sol:293 — no try/catch
uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);

// BondingV5.sol:793-798
function tokenAntiSniperType(address token_) external view returns (uint8) {
    if (tokenInfo[token_].creator == address(0)) {
        revert InvalidTokenStatus();   // Reverts for any non-V5 token
    }
    return tokenInfo[token_].antiSniperType;
}
```

Contrast with `_getTaxStartTime()` in `FRouterV3` at L326-338, which correctly wraps its `pair.taxStartTime()` call in `try/catch`. The anti-sniper type call has no such protection.

If any token pair registered in `FFactoryV3` was not created through the currently-configured `BondingV5` (due to admin misconfiguration, a migration scenario, or a stale `bondingV5` reference after an upgrade), every `buy()` call for that pair reverts at the anti-sniper type lookup. Sell operations are unaffected (the sell path does not call `tokenAntiSniperType`).

Additionally, if `bondingV5` is set to `address(0)` or an incorrect address post-upgrade, all buy operations via `FRouterV3` fail globally.

**Impact**:
Permanently blocks all buy operations for affected token pairs. Users cannot buy; they can only sell. The DoS is silent — no clear error message from the router level. Affected tokens are rendered illiquid for buyers with no admin recovery path other than redeploying a corrected router configuration.

**PoC Result**:
[CODE-TRACE] Non-V5 token pair in `FFactoryV3` → `buy()` → `_calculateAntiSniperTax()` L293: `bondingV5.tokenAntiSniperType(nonV5Token)` → `BondingV5.tokenAntiSniperType()` L796: `tokenInfo[nonV5Token].creator == address(0)` → `revert InvalidTokenStatus()` → propagates up, `buy()` reverts.

**Recommendation**:
Wrap the `tokenAntiSniperType` call in a try/catch with a safe default:
```solidity
uint8 antiSniperType;
try bondingV5.tokenAntiSniperType(tokenAddress) returns (uint8 t) {
    antiSniperType = t;
} catch {
    antiSniperType = 0;  // ANTI_SNIPER_NONE — safe default for unknown tokens
}
```

---

### [M-08] Graduation Reads Raw balanceOf — Donation Attack on Pool Initialization Ratio [UNVERIFIED]

**Severity**: Medium
**Location**: `BondingV5.sol:718-730`, `FPairV2.sol:176-182`
**Confidence**: MEDIUM

**Description**:
`BondingV5._openTradingOnUniswap()` reads `pairContract.assetBalance()` and `pairContract.balance()` at graduation to determine how much VIRTUAL and how many agent tokens to send to the Uniswap V2 pool. Both functions return raw `balanceOf(address(this))` rather than tracked reserves (`_pool.reserve0` / `_pool.reserve1`):

```solidity
// FPairV2.sol:176-182
function balance() external view returns (uint256) {
    return IERC20(tokenA).balanceOf(address(this));   // Raw balanceOf
}
function assetBalance() external view returns (uint256) {
    return IERC20(tokenB).balanceOf(address(this));   // Raw balanceOf
}

// BondingV5.sol:718-730
uint256 assetBalance = pairContract.assetBalance();  // Includes any donated VIRTUAL
uint256 tokenBalance = pairContract.balance();        // Includes any donated agent tokens
// Both values are used to initialize the Uniswap V2 pool ratio
```

An attacker can donate agent tokens directly to the `FPairV2` address immediately before a graduation-triggering buy. This inflates `tokenBalance` at graduation, distorting the Uniswap V2 pool's initial `token:VIRTUAL` ratio toward a lower token price. The attacker can then arbitrage the mispriced initial pool price after graduation.

Note: Donating VIRTUAL is economically irrational (the attacker loses funds with no corresponding gain). Agent token donation is the viable attack vector. The graduation threshold check itself uses tracked reserves (`newReserveA <= gradThreshold`), so donation does not trigger premature graduation — it only affects the pool initialization ratio.

**Impact**:
The initial Uniswap V2 price for graduated tokens is artificially distorted in favor of the attacker. The attacker can profit from the price discrepancy through immediate post-graduation arbitrage. The magnitude depends on the donation amount relative to the total agent token supply. Legitimate buyers at graduation price absorb the price impact of the mispricing.

**PoC Result**:
[CODE-TRACE] `FPairV2.balance()` confirmed to use raw `balanceOf`. Graduation threshold check at `BondingV5.sol:664` uses `newReserveA` (tracked reserve, not donation-susceptible). Pool initialization uses `pairContract.balance()` (donation-susceptible). MEV-capable attacker can sandwich the graduation-triggering buy.

**Recommendation**:
Use tracked reserves rather than raw `balanceOf` at graduation:
```solidity
(uint256 reserveAsset, uint256 reserveToken) = pairContract.getReserves();
uint256 assetBalance = reserveAsset;  // Use tracked reserve
uint256 tokenBalance = reserveToken;  // Use tracked reserve
```
This eliminates the donation attack surface for pool initialization.

---

### [M-09] Deprecated FRouterV2 Storage Slots Must Be Preserved — Upgrade Collision Risk [UNVERIFIED]

**Severity**: Medium
**Location**: `FRouterV2.sol:40-41`
**Confidence**: MEDIUM

**Description**:
`FRouterV2` contains two storage variables marked as deprecated: `taxManager` (slot index following OZ gaps) and `antiSniperTaxManager`. These slots are still present in the storage layout with active setter functions (`setTaxManager()` and `setAntiSniperTaxManager()` at L252-259), even though neither is functionally used in trading logic.

```solidity
// FRouterV2.sol:40-41
address public taxManager;            // deprecated — but still occupies storage
address public antiSniperTaxManager;  // deprecated — but still occupies storage
address public bondingV2;             // L42 — immediately follows deprecated slots
```

No `__gap` storage array exists anywhere in `FRouterV2` (or in any other upgradeable contract in scope — see M-12). This creates a compound risk: if a future `FRouterV2` upgrade removes the deprecated slot declarations (a natural cleanup step), all subsequent storage variables (`bondingV2`, `bondingV4`, and every other field after) shift by two slots. `bondingV2` would read the data stored in the old `taxManager` slot — an arbitrary address — silently corrupting all `BondingV2`-routed token operations.

The presence of setter functions for deprecated storage also expands the unnecessary admin attack surface.

**Impact**:
At the next `FRouterV2` proxy upgrade: if developers remove the deprecated slot declarations (reasonable cleanup), storage layout shifts and `bondingV2` reads stale `taxManager` data. All operations on `FRouterV2` that depend on `bondingV2`/`bondingV4` references silently use wrong addresses, corrupting all legacy token trading routed through `FRouterV2`. The corruption is silent — no revert, no event, just wrong behavior.

**PoC Result**:
[CODE-TRACE] Grep for `__gap` across all `launchpadv2` contracts returns zero matches. `FRouterV2.sol:40-41` confirmed deprecated with active setters. Storage slot shift is mechanical — any variable removal shifts all subsequent variables by the number of removed slots.

**Recommendation**:
Do **not** remove the deprecated slot declarations. Instead, preserve them as explicit storage placeholders and disable the setters:
```solidity
address private _deprecated_taxManager;           // Keep slot, rename for clarity
address private _deprecated_antiSniperTaxManager; // Keep slot, rename for clarity
```
Add a storage gap at the end of `FRouterV2`'s storage declarations:
```solidity
uint256[50] private __gap;
```
Remove or add `revert("Deprecated")` to `setTaxManager()` and `setAntiSniperTaxManager()` to eliminate unnecessary admin surface.

---

### [M-10] teamTokenReservedWallet Read Live at launch() — Race Condition Redirects Creator Tokens [UNVERIFIED]

**Severity**: Medium
**Location**: `BondingV5.sol:473-480, 554-557`, `BondingConfig.sol:250-253`
**Confidence**: MEDIUM

**Description**:
`BondingV5` reads `bondingConfig.teamTokenReservedWallet()` twice at different points in the token lifecycle. The large reserved supply (airdrop, ACF tokens) is transferred during `_preLaunch()` (L473-480), reading the wallet at preLaunch time. The creator's initial buy proceeds (`amountOut`) are transferred again during `launch()` (L554-557), reading the wallet a second time:

```solidity
// BondingV5.sol:473-480 — during _preLaunch (large airdrop supply)
address teamWallet = bondingConfig.teamTokenReservedWallet();
IERC20(token).safeTransfer(teamWallet, totalReservedSupply * ...);

// BondingV5.sol:554-557 — during launch() (creator's initial buy output)
IERC20(tokenAddress_).safeTransfer(
    bondingConfig.teamTokenReservedWallet(),  // Re-reads live — not cached
    amountOut
);
```

The `BondingConfig` owner can call `setTeamTokenReservedWallet(newAddress)` between `preLaunch()` and `launch()`. This changes where the creator's initial buy tokens (`amountOut`) are sent. The creator expects their initial purchase tokens to go to the wallet established at preLaunch, but a wallet change in the window redirects `amountOut` to the owner-controlled address.

The large reserved supply is not affected (it transferred at preLaunch). Only `amountOut` (the creator's initial buy proceeds) is at risk.

**Impact**:
The creator's initial buy tokens (`amountOut`) are redirected to an address controlled by the `BondingConfig` owner rather than the creator-expected wallet. The economic value depends on the initial purchase size and agent token price at launch. This requires malicious action by the trusted `BondingConfig` owner.

**PoC Result**:
[CODE-TRACE] `_preLaunch()` transfers reserved supply with cached wallet value at that block. `launch()` at L554 calls `bondingConfig.teamTokenReservedWallet()` live — this is a separate on-chain read with no caching. Owner calls `setTeamTokenReservedWallet(attackerWallet)` in a transaction between `preLaunch` and `launch`. Creator calls `launch()` — `amountOut` sent to `attackerWallet`.

**Recommendation**:
Cache `teamTokenReservedWallet` in the token's storage struct at `preLaunch` time:
```solidity
// In _preLaunch():
tokenInfo[token].reservedWallet = bondingConfig.teamTokenReservedWallet();
```
Use the cached value in `launch()`:
```solidity
// In launch():
IERC20(tokenAddress_).safeTransfer(tokenInfo[tokenAddress_].reservedWallet, amountOut);
```

---

### [M-11] Admin Setters Accept Zero or Unbounded Values Without Validation [UNVERIFIED]

**Severity**: Medium
**Location**: `FFactoryV2.sol:108-122`, `FFactoryV3.sol:116-130`, `BondingV5.sol:857`, `BondingConfig.sol:159-183`
**Confidence**: HIGH

**Description**:
Several critical admin setters accept values that have no meaningful validation beyond a simple existence check, creating silent misconfiguration paths with operational consequences.

**`antiSniperBuyTaxStartValue` + `buyTax` sum not enforced**:
`setTaxParams()` in `FFactoryV2` and `FFactoryV3` allows `antiSniperBuyTaxStartValue` and `buyTax` to be set independently. The router at `FRouterV3.sol:194-197` silently caps the combined anti-sniper tax to `99 - normalTax` when the sum exceeds 99:

```solidity
// FRouterV3.sol:194-197
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax;  // Silent cap — no error, no event
}
```

If `antiSniperBuyTaxStartValue = 99` and `buyTax = 2`, the peak anti-sniper tax is silently compressed to 97% instead of the configured 99%. Monitoring systems and dashboards show the configured values but buyers experience a different effective tax. The discrepancy can grow depending on `buyTax` values.

**`renounceOwnership()` unguarded on BondingV5 and BondingConfig**:
Both `BondingV5` and `BondingConfig` inherit `OwnableUpgradeable` without overriding `renounceOwnership()`. A single call permanently removes the owner:

```solidity
// BondingV5.sol:88-91 — inherits OwnableUpgradeable without override
// BondingConfig.sol:14 — same
```

After renouncement, all `onlyOwner` setters on `BondingConfig` (`setDeployParams`, `setCommonParams`, `setBondingCurveParams`, `setScheduledLaunchParams`, `setTeamTokenReservedWallet`) and `BondingV5` (`setBondingConfig`) are permanently inaccessible. Protocol configuration is frozen at the last set values with no recovery path.

**Impact**:
- Silent anti-sniper cap corruption: Anti-sniper protection is weaker than configured. Operators monitoring configured values receive misleading data; buyers during the anti-sniper window pay less than the intended rate while snipers benefit.
- Unguarded `renounceOwnership`: One accidental or malicious transaction permanently freezes protocol configuration. This also compounds with M-01 (MAX_UINT fees) — any misconfiguration that requires a setter to fix becomes permanent if `renounceOwnership` is called first.

**PoC Result**:
[CODE-TRACE] Sum validation absent: `setTaxParams(buyTax=2, antiSniperBuyTaxStartValue=99)` → stored successfully → `buy()` during anti-sniper window: `antiSniperTax = 97` (capped from 99) — 2% less protection than configured. `renounceOwnership()` confirmed callable with no guard in either `BondingV5` or `BondingConfig`.

**Recommendation**:
1. Add sum validation in `setTaxParams()`:
```solidity
require(buyTax_ + antiSniperBuyTaxStartValue_ <= 99, "Tax sum exceeds 99%");
```
2. Override `renounceOwnership()` in both `BondingV5` and `BondingConfig`:
```solidity
function renounceOwnership() public override onlyOwner {
    revert("Renouncement disabled — use transferOwnership");
}
```

---

### [M-12] No __gap[] in Any Upgradeable Contract — Storage Layout Collision Risk [UNVERIFIED]

**Severity**: Medium
**Location**: `BondingV5.sol`, `BondingConfig.sol`, `FRouterV2.sol`, `FRouterV3.sol`, `FFactoryV2.sol`, `FFactoryV3.sol`
**Confidence**: HIGH

**Description**:
All six upgradeable contracts in scope inherit from OpenZeppelin upgradeable base contracts (`OwnableUpgradeable`, `AccessControlUpgradeable`, `ReentrancyGuardUpgradeable`) but define no `uint256[N] private __gap` storage padding variable in their own storage layout.

OpenZeppelin's upgradeable contracts include internal `__gap` arrays to reserve storage for future OZ updates. However, the *custom* portion of each contract — the project-specific storage variables declared after the OZ inheritance — has no gap. A comprehensive grep across all `launchpadv2` contract files returns zero `__gap` declarations.

```solidity
// BondingV5.sol:88-98 (storage declarations)
mapping(address => TokenInfo) public tokenInfo;
mapping(address => uint256) public tokenGradThreshold;
// ... more variables ...
// NO uint256[N] private __gap; at the end
```

The risk materializes at upgrade time. If a developer inserts a new state variable between existing variables (a common mistake during iterative development), all variables declared after the insertion point shift by one slot, reading stale or incorrect data. Without a `__gap`, there is also no safe headroom for adding new variables at the end of the custom storage layout if OZ base contracts are upgraded and their own gap sizes change.

The risk is elevated for `FRouterV2`, which already shows evidence of prior layout changes via the deprecated `taxManager`/`antiSniperTaxManager` slots (see M-09), indicating this codebase has undergone iterative storage modifications.

**Impact**:
At the next proxy upgrade for any of these contracts: incorrect insertion of a new state variable silently corrupts all subsequent storage. For `BondingV5`, this could corrupt `tokenInfo` mappings, graduation thresholds, or config references. For `FRouterV3`, this could corrupt `bondingV5`, `factory`, or `bondingConfig` references. Corruption is silent — no revert, no event, behavioral failures only.

**PoC Result**:
[CODE-TRACE] Grep for `__gap` across all launchpadv2 contracts: zero matches. All six upgradeable contracts confirmed without storage gap declarations.

**Recommendation**:
Add a `__gap` storage array at the end of each upgradeable contract's own storage section. Size should be chosen to allow for anticipated future additions (typically 50 slots):
```solidity
// Add at end of each contract's storage declarations:
uint256[50] private __gap;
```
Follow the OZ Upgradeable Storage Gap Convention: when a new storage variable is added, reduce the gap by the number of slots consumed.

---

### [M-13] Graduation Recovery Functions Missing — Failed State Permanently Unrecoverable [UNVERIFIED]

**Severity**: Medium
**Location**: `BondingV5.sol:703-772`
**Confidence**: HIGH

**Description**:
`BondingV5._openTradingOnUniswap()` performs four sequential external calls to `AgentFactory` with no `try/catch` wrapper (documented in detail in H-01). When any of these calls fails, the entire `buy()` transaction reverts, but `tokenInfo[token].trading` remains `true`. Every subsequent graduation-triggering buy re-enters `_openTradingOnUniswap()` and reverts again, creating a permanent per-token DoS.

What this finding highlights is the absence of any admin recovery path from this state. No setter exists to manually transition an affected token out of the graduation loop:

- No function to set `trading = false` on a per-token basis after `launch()` has been called
- No function to set `tradingOnUniswap = true` manually to skip graduation
- No function to adjust `tokenGradThreshold[token]` for specific tokens after preLaunch
- `cancelLaunch()` checks `launchExecuted` before allowing cancellation — once a token has been through `launch()`, `cancelLaunch()` is blocked even though graduation failed

```solidity
// BondingV5.sol:462 — cancelLaunch guard
// tokenRef.launchExecuted is set to true during launch()
// After launch(), cancelLaunch() is blocked: no way to reset state
```

The only recovery path requires a `BondingV5` proxy upgrade that migrates per-token state — a significantly more complex and disruptive operation than adding a targeted setter.

**Impact**:
Any token that encounters a graduation failure (AgentFactory paused, BONDING_ROLE revoked, network congestion causing external call timeout) enters a permanent unrecoverable state. All user VIRTUAL deposited into the bonding curve for that token is effectively trapped in a sell-only market. No admin action short of a proxy upgrade can restore graduation capability.

**PoC Result**:
[CODE-TRACE] `BondingV5` storage: no `onlyOwner` function sets `tokenInfo[x].trading`, `tokenInfo[x].tradingOnUniswap`, or `tokenGradThreshold[x]` after preLaunch. `cancelLaunch()` at L462 checks `launchExecuted` and reverts if `true`. Recovery requires proxy upgrade + state migration.

**Recommendation**:
Add an emergency admin recovery setter:
```solidity
function setTokenTradingState(
    address token_,
    bool trading_,
    bool tradingOnUniswap_
) external onlyOwner {
    tokenInfo[token_].trading = trading_;
    tokenInfo[token_].tradingOnUniswap = tradingOnUniswap_;
    emit TokenTradingStateOverride(token_, trading_, tradingOnUniswap_);
}
```
This allows the protocol owner to manually mark a failed graduation as complete (`tradingOnUniswap = true`) or reset the token to a pre-launch state (`trading = false`) to enable `cancelLaunch()`.

---

### [M-14] "Basis Points" Documentation Mismatch Creates Direct Path to Tax DoS [UNVERIFIED]

**Severity**: Medium
**Location**: `FFactoryV2.sol:27`, `FRouterV3.sol:291`, `FRouterV2.sol:320`
**Confidence**: MEDIUM

**Description**:
`FFactoryV2.sol` contains an incorrect code comment that describes `antiSniperBuyTaxStartValue` as a "basis points" value when the contract actually treats it as a percentage:

```solidity
// FFactoryV2.sol:27
uint256 public antiSniperBuyTaxStartValue; // Starting tax value for anti-sniper (in basis points)

// FRouterV3.sol:291 — actual usage
uint256 startTax = factory.antiSniperBuyTaxStartValue(); // 99%
// Used in: return startTax * (duration - timeElapsed) / duration;
// Compared against: if (normalTax + antiSniperTax > 99)  ← percentage, not bips
```

The comment says "basis points" (where 10000 = 100%), but the code uses the value as a direct percentage (where 99 = 99%). These differ by a factor of 100. An operator or integrator reading the comment would set `antiSniperBuyTaxStartValue = 9900` intending to configure 99% (99 × 100 bips). The contract stores 9900.

When `setTaxParams()` accepts 9900 with no upper bound check (the validation gap documented in M-11), the router's tax computation uses 9900 as a percentage. The cap at `FRouterV3.sol:194-197` (`if (normalTax + antiSniperTax > 99)`) fires immediately, but the upstream arithmetic may have already computed values that trigger an underflow — specifically, if `buyTax` is also misconfigured as described in H-04, the combination reliably reverts all buys.

This is documented as a chain finding: the misleading comment (this finding) enables the tax parameter misconfiguration (H-04), which causes the arithmetic underflow that blocks all buys protocol-wide.

**Impact**:
A protocol operator following the in-code documentation sets `antiSniperBuyTaxStartValue = 9900` (intending 99% protection). Combined with the absence of an upper bound check on `setTaxParams()`, this misconfiguration flows directly into the buy path and activates the same tax arithmetic DoS described in H-04. All buys for all tokens on the factory are blocked until the parameter is corrected.

**PoC Result**:
[CODE-TRACE] `FFactoryV2.sol:27` comment says "in basis points". `FRouterV3.sol:291` comment says "// 99%" treating the same variable as a percentage. The unit discrepancy is confirmed — no scaling occurs between storage and usage. Setting `antiSniperBuyTaxStartValue = 9900` stores 9900; the router uses it as 9900%, triggering the cap logic and potentially the underflow from H-04.

**Recommendation**:
1. Correct the comment in `FFactoryV2.sol:27`:
```solidity
uint256 public antiSniperBuyTaxStartValue; // Anti-sniper starting tax (percentage, e.g. 99 = 99%)
```
2. Add validation in `setTaxParams()` to enforce the valid percentage range:
```solidity
require(antiSniperBuyTaxStartValue_ <= 99, "antiSniperBuyTaxStartValue exceeds 99%");
```
3. Propagate the corrected comment to `FFactoryV3.sol` for consistency.

---

### [M-15] Anti-Sniper Window Duration Inconsistency Between Router Versions [UNVERIFIED]

**Severity**: Medium
**Location**: `FRouterV2.sol:342-345`, `BondingConfig.sol:309-319`, `FRouterV3.sol:277-279`
**Confidence**: HIGH

**Description**:
Tokens launched through `FRouterV2` (legacy `BondingV2/V3/V4` era) and tokens launched through `FRouterV3` (current `BondingV5` era) experience materially different anti-sniper window durations, with different decay algorithms and no documentation of the behavioral change:

| Version | X_LAUNCH Duration | Regular Duration | Decay Algorithm |
|---------|------------------|-----------------|-----------------|
| FRouterV2 | 99 seconds | 99 minutes | Step-down integer (`timeElapsed` in seconds or minutes) |
| FRouterV3/BondingConfig | ANTI_SNIPER_60S = 60 seconds | ANTI_SNIPER_98M = 5880 seconds (98 min) | Continuous interpolation |

```solidity
// FRouterV2.sol:342-345
// X_LAUNCH: 99 seconds; Regular: 99 minutes
uint256 taxReduction = isXLaunch ? timeElapsed : (timeElapsed / 60);

// BondingConfig.sol:309-319
// ANTI_SNIPER_60S: 60 seconds
// ANTI_SNIPER_98M: 5880 seconds (98 min, NOT 99 min)
```

This creates three inconsistencies: (1) X_LAUNCH window is 99 seconds on `FRouterV2` but 60 seconds on `FRouterV3` — a 39-second discrepancy; (2) Regular window is 99 minutes on `FRouterV2` but 98 minutes (5880 seconds) on `FRouterV3`; (3) The decay algorithm differs between versions — `FRouterV2` uses step-down integer division while `FRouterV3` uses continuous proportional interpolation. Frontends, monitoring systems, and users who query `BondingConfig` for the current anti-sniper window parameters receive values that only apply to new tokens, not to legacy tokens still active on `FRouterV2`.

**Impact**:
Users and bots interacting with legacy tokens on `FRouterV2` receive incorrect anti-sniper window estimates if they read from `BondingConfig`. Snipers targeting `FRouterV2` tokens may miscalculate when the anti-sniper window expires, either missing an opportunity or transacting during an active anti-sniper window. The discrepancy also creates unequal treatment of token holders depending on which router version their token uses — a 39-second difference in X_LAUNCH protection is non-trivial in MEV-active environments.

**PoC Result**:
[CODE-TRACE] `FRouterV2.sol:342`: `isXLaunch ? timeElapsed : (timeElapsed / 60)` — confirmed 99-second X_LAUNCH hardcoded. `BondingConfig.sol:309`: `ANTI_SNIPER_60S` duration = 60 seconds. `FRouterV3.sol:277-279` comment: "99 seconds" for BondingV4 X_LAUNCH tokens — discrepancy confirmed vs actual BondingConfig value of 60 seconds. Decay algorithms differ by inspection.

**Recommendation**:
1. Document the version-specific anti-sniper window durations explicitly in both `FRouterV2` and `BondingConfig` — annotate which router version each constant applies to.
2. Consider aligning the `BondingConfig.ANTI_SNIPER_60S` constant to 99 seconds to match legacy behavior, or document the intentional change with a migration note.
3. Update frontends to read the correct constant based on which router version a given token uses.
