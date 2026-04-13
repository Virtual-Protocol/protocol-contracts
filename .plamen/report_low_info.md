# Low and Informational Findings — VP Launchpad Suite

---

## Low Findings

---

### [L-01] Multicall3 One-Step Ownership Transfer — No Emergency Revoke Path

**Severity**: Low
**Location**: `Multicall3.sol` (transferOwnership function)

**Description**:
The `Multicall3` contract implements ownership with a custom `owner` state variable and a one-step `transferOwnership(address newOwner)` function, but provides no revocation or freezing mechanism. If the owner's EOA is compromised, an attacker who gains control of the private key retains permanent access to all privileged functions — including `transferToken`, `withdrawETH`, `approveToken`, and `batchWithdrawERC20Tokens` — until a new `transferOwnership` is called. Since `transferOwnership` is itself `onlyOwner`, a compromised owner can transfer ownership to an attacker-controlled address and lock out the legitimate team permanently. Unlike the OpenZeppelin `Ownable2Step` pattern, there is no pending-owner confirmation step and no on-chain way to cancel an in-flight transfer if the new owner address is entered incorrectly.

**Impact**:
If the Multicall3 owner EOA is compromised, an attacker can drain all ERC20 tokens accumulated in the contract, withdraw ETH balances, and re-grant themselves ownership permanently. There is no on-chain freeze, pause, or revocation mechanism available to the team once the key is lost.

**Recommendation**:
Replace the custom one-step ownership pattern with OpenZeppelin's `Ownable2Step`, which requires the new owner to explicitly accept the transfer. This prevents accidental or malicious misdirection of ownership. Consider also adding a `renounceOwnership` override that reverts, so ownership can only be transferred (not abandoned).

---

### [L-02] buy() Declared payable — ETH Permanently Trapped in Bonding Contracts

**Severity**: Low
**Location**: `BondingV5.sol:676`, `BondingV2.sol:586`, `BondingV3.sol:522`

**Description**:
The `buy()` function is declared `payable` in BondingV5, BondingV2, and BondingV3, but `msg.value` is never read, used, or forwarded within the function body. None of these contracts implement a `receive()` fallback, a `withdrawETH()` function, or any other mechanism to recover native ETH. If a user sends ETH alongside a `buy()` transaction — for example due to a UI error, wrong transaction type, or scripting mistake — that ETH is permanently locked in the contract with no recovery path for the user or the protocol operator.

```solidity
// BondingV5.sol:676
function buy(uint256 purchaseAmount_, address tokenAddress_, uint256 amountOutMin_)
    public payable { // 'payable' with no msg.value handling
    ...
}
```

**Impact**:
Any ETH accidentally sent with a `buy()` call is irrecoverably lost. The bonding contracts hold no ETH-based logic, making the `payable` declaration purely a hazard.

**Recommendation**:
Remove the `payable` modifier from `buy()` in all Bonding contract versions, or add an explicit guard: `require(msg.value == 0, "ETH not accepted")`. As a defense-in-depth measure, add a `withdrawETH(address recipient)` function callable by the owner to rescue any ETH that enters the contract through other paths.

---

### [L-03] FFactory createPair() Allows Duplicate Pair Overwrite

**Severity**: Low
**Location**: `FFactoryV2.sol`, `FFactoryV3.sol` (`_createPair` internal function)

**Description**:
The internal `_createPair()` function in FFactoryV2 and FFactoryV3 does not check whether a pair for the given token addresses already exists before overwriting the `_pair[tokenA][tokenB]` mapping entry. The function is gated by `CREATOR_ROLE`, which under normal operation is held exclusively by BondingV5; BondingV5 verifies that a token has not been previously registered before calling `createPair()`. However, the factory-level guard is absent, meaning that if CREATOR_ROLE is ever granted to an additional address — through an administrative mistake or future upgrade — duplicate pair creation becomes possible. The old pair address would be silently overwritten in the factory mapping, rendering the old pair unreachable through the factory's public interface while its funds remain locked inside it.

**Impact**:
If a duplicate pair is created for an existing token, the original pair becomes unreachable via the factory mapping. Funds (agent tokens and VIRTUAL tokens) in the original pair can no longer be accessed through normal protocol flows, effectively locking them permanently.

**Recommendation**:
Add a zero-address check on the existing pair entry before overwriting: `require(_pair[tokenA][tokenB] == address(0), "Pair already exists")`. This ensures the factory-level guard is enforced independently of BondingV5's upstream checks.

---

### [L-04] CREATOR_ROLE and ADMIN_ROLE Not Initialized in FFactory — Deployment Gap

**Severity**: Low
**Location**: `FFactoryV2.sol:42-57`, `FFactoryV3.sol:50-65` (`initialize` function)

**Description**:
The `initialize()` function in FFactoryV2 and FFactoryV3 grants only `DEFAULT_ADMIN_ROLE` to the deployer. `CREATOR_ROLE` (required for `createPair()`) and `ADMIN_ROLE` (required for `setTaxParams()` and `setRouter()`) are not granted to any address during initialization. The system relies on the deployer performing separate post-deployment transactions to grant these roles. If those post-deployment transactions are omitted — due to a script error, deployment interruption, or documentation gap — the factory is permanently non-functional: BondingV5 cannot create pairs, and tax parameters cannot be updated.

```solidity
// FFactoryV3.sol:50-65 — only DEFAULT_ADMIN_ROLE granted
function initialize(...) external initializer {
    __AccessControl_init();
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    // CREATOR_ROLE not granted
    // ADMIN_ROLE not granted
    ...
}
```

Recovery is possible — the `DEFAULT_ADMIN_ROLE` holder can grant the missing roles at any time — but there is no on-chain guarantee that this step was completed before the system went live.

**Impact**:
A deployment where post-initialization role grants are skipped leaves the factory permanently unable to create pairs or update parameters. Token launches are blocked entirely until an administrator manually grants the missing roles.

**Recommendation**:
Grant `CREATOR_ROLE` to the BondingV5 contract address and `ADMIN_ROLE` to the deployer directly within `initialize()`. This eliminates the post-deployment step and ensures the factory is functional immediately upon proxy deployment.

---

### [L-05] cancelLaunch on BondingV2/V3/V4 Does Not Set trading=false

**Severity**: Low
**Location**: `BondingV2.sol`, `BondingV3.sol`, `BondingV4.sol` (`cancelLaunch` function)

**Description**:
In BondingV5, `cancelLaunch()` explicitly sets `trading = false` before returning, which correctly reflects the cancelled state of the token pair. In BondingV2, BondingV3, and BondingV4, `cancelLaunch()` sets `launchExecuted = true` but does NOT set `trading = false`. This leaves cancelled tokens in a state where the `trading` flag remains `true`, while `launchExecuted` is also `true`. Any logic that gates on `trading` (rather than `launchExecuted`) may incorrectly treat a cancelled token as tradeable. Because the underlying pair retains whatever liquidity was added before cancellation, it is technically possible for trades to proceed via the router path if the router's EXECUTOR gates are met — contrary to the expected post-cancel behavior.

**Impact**:
Inconsistent post-cancel state between BondingV5 and legacy Bonding versions creates a state where a cancelled token appears tradeable to external monitoring tools, indexers, and any logic that inspects the `trading` flag. In edge cases where residual pair liquidity exists and EXECUTOR_ROLE is held, trades on cancelled tokens may be unintentionally enabled.

**Recommendation**:
Add `tokenInfo[token].trading = false` to `cancelLaunch()` in BondingV2, BondingV3, and BondingV4, mirroring the BondingV5 behavior. Ensure the post-cancel state is consistent across all versions.

---

### [L-06] addInitialLiquidity() Missing nonReentrant Guard

**Severity**: Low
**Location**: `FRouterV3.sol:122-135`, `FRouterV2.sol:115-129`

**Description**:
`addInitialLiquidity()` in both FRouterV2 and FRouterV3 lacks the `nonReentrant` modifier despite performing external ERC20 transfers before committing pair state. The function calls `IERC20(token_).safeTransferFrom(msg.sender, pairAddress, amountToken_)` followed by `IFPairV2(pairAddress).mint(amountToken_, amountAsset_)`. If the transferred token supports a callback (e.g., ERC777 `tokensReceived`), a reentrant call to `addInitialLiquidity` could attempt to double-initialize the pair. In practice, the risk is mitigated by two independent guards: the function requires `EXECUTOR_ROLE`, and FPairV2's `mint()` has a `require(_pool.lastUpdated == 0, "Already minted")` check that prevents double initialization. Nevertheless, the absence of `nonReentrant` represents a defense-in-depth gap that should be closed as the protocol evolves.

**Impact**:
Under current conditions with standard ERC20 agent tokens and EXECUTOR_ROLE enforcement, the reentrancy path is blocked. If future token types with callbacks are registered, or if the FPairV2 mint guard is ever relaxed, the gap becomes exploitable for double-initialization of pair reserves.

**Recommendation**:
Add the `nonReentrant` modifier to `addInitialLiquidity()` in both FRouterV2 and FRouterV3 as a defense-in-depth measure. This is a low-cost change that eliminates the structural gap regardless of token type.

---

### [L-07] batchTransferTokens() Admin Function Non-Functional

**Severity**: Low
**Location**: `FRouterV3.sol` (`batchTransferTokens` / `Multicall3.sol`)

**Description**:
The `batchTransferTokens()` function in Multicall3 is protected by `onlyOwnerOrAdmin` and internally calls `transferToken()` for each batch entry. However, `transferToken()` is itself protected by `onlyOwner`. When `batchTransferTokens()` is called by an admin (not the owner), the internal call to `transferToken()` executes with `msg.sender = address(Multicall3)` — not the original admin caller. The `onlyOwner` check in `transferToken()` then fails because Multicall3 itself is not the owner. As a result, every admin call to `batchTransferTokens()` reverts unconditionally. The function is effectively dead for all non-owner callers.

**Impact**:
Admins who attempt batch token transfers via `batchTransferTokens()` receive a revert on every call, receiving no indication that the function will never work for their permission level. Batch transfer operations must be performed individually by the owner, which undermines the utility of the batch function.

**Recommendation**:
Either remove `batchTransferTokens()` and document that only the owner can transfer tokens, or refactor `transferToken()` to accept calls from the Multicall3 contract itself (i.e., treat `address(this)` as authorized), or consolidate the permission check to `onlyOwner` on the outer batch function and remove it from the inner call.

---

### [L-08] FRouterV3.sell() Computes amountOut Before Transfer — Theoretical Reserve Inconsistency

**Severity**: Low
**Location**: `FRouterV3.sol:157-161`

**Description**:
`FRouterV3.sell()` calculates `amountOut` via `getAmountsOut()` — which reads the pair's virtual reserve state — before the actual token transfer from the seller arrives at the pair. In the current deployment, agent tokens are standard ERC20 with no fee-on-transfer, and FPairV2 is not registered in the agent token's LP pool set. This means the actual token amount received by the pair equals the nominal amount, and the reserve computation remains valid. However, if a future agent token is registered with fee-on-transfer behavior, or FPairV2 is added to the LP pool set, the pair would receive fewer tokens than `amountOut` was computed for, causing the pair's actual balance to diverge from its tracked virtual reserves across repeated sell operations.

**Impact**:
Under current deployment conditions, no incorrect behavior occurs. If fee-on-transfer agent tokens are introduced in the future, sell operations would progressively diverge the pair's tracked reserves from its real balances, leading to incorrect pricing and potential trade failures.

**Recommendation**:
Compute `amountOut` after confirming the actual token amount received by the pair, or add a guard that reverts if fee-on-transfer tokens are detected. Document that FPairV2 must not be included in agent token LP pool sets.

---

### [L-09] BondingV2/V3/V4 buy() and sell() Always Revert — Deprecated Contracts

**Severity**: Low
**Location**: `BondingV2.sol`, `BondingV3.sol`, `BondingV4.sol`

**Description**:
BondingV2 and BondingV3 route all `buy()` and `sell()` calls through FRouterV2, which requires the caller to hold `EXECUTOR_ROLE`. Neither BondingV2 nor BondingV3 are ever granted `EXECUTOR_ROLE` on FRouterV2, so every user call to `buy()` or `sell()` via these contracts reverts with an access control error. BondingV2 and BondingV3 also have `revert("Not implemented")` at the top of their `preLaunch()` functions, meaning no new tokens can ever be created on these versions. BondingV4 similarly cannot launch new tokens because `preLaunch()` reverts unconditionally. These contracts represent deprecated-but-deployed code that remains callable on-chain, which may confuse integrators or users who discover them through on-chain inspection.

**Impact**:
No security impact — all calls simply revert. The risk is operational: integrators or users who attempt to interact with these legacy contracts will receive unhelpful revert messages with no indication that the contracts are deprecated. Historical tokens created on these versions before deprecation are also permanently frozen in a state where their bonding curve buy/sell paths are blocked.

**Recommendation**:
Add explicit `revert("Deprecated: use BondingV5")` guards at the top of `buy()` and `sell()` in BondingV2, BondingV3, and BondingV4. Document the deprecation status prominently in protocol documentation and any contract deployment registries.

---

### [L-10] BondingV3/V4 preLaunch() Always Reverts — Dead API Surface

**Severity**: Low
**Location**: `BondingV3.sol`, `BondingV4.sol` (`preLaunch` function)

**Description**:
`BondingV3.preLaunch()` begins with `revert("Not implemented")`, and `BondingV4.preLaunch()` similarly reverts unconditionally. Despite this, `BondingV4.setXLauncher()` writes to an `isXLauncher` mapping that is never consumed anywhere in the contract — a dead state write. Both contracts present a public API surface that appears functional from an ABI perspective but is actually non-operational. Integrators, indexers, or developers inspecting the ABI without testing will find what appears to be a fully-featured bonding system that silently fails on any launch attempt.

**Impact**:
No security impact. The risk is integrator confusion: any system that attempts to create tokens via BondingV3 or BondingV4 will fail silently or with a generic revert. The `setXLauncher` dead write in BondingV4 wastes gas and adds confusion.

**Recommendation**:
Replace `revert("Not implemented")` with a clearer message: `revert("Deprecated: this Bonding version is no longer supported. Use BondingV5.")`. Remove or mark the `setXLauncher` function and `isXLauncher` mapping as deprecated in BondingV4.

---

### [L-11] BondingV5.setRouter() — No Zero-Address Guard Allows Full Trading DoS

**Severity**: Low
**Location**: `FRouterV3.sol:340-343` (BondingV5 setRouter equivalent path)

**Description**:
BondingV5 exposes an `onlyOwner`-gated setter for the router address used in all bonding operations. This setter accepts `address(0)` without validation. If the owner calls `setRouter(address(0))` — whether by accident (entering the wrong parameter) or by design — all subsequent buy, sell, and graduation operations that reference the router will revert when attempting to call functions on `address(0)`. The owner can recover from this by re-setting the router to a valid address, but there is a recovery window during which the protocol is non-functional for all users.

**Impact**:
Setting the router to address(0) causes a complete DoS on all trading for all tokens managed by this BondingV5 instance until the owner corrects the misconfiguration. No funds are lost, but user transactions will fail during the window.

**Recommendation**:
Add `require(router_ != address(0), "Zero address not allowed")` to the router setter function. This prevents accidental zero-address assignment and requires the owner to intentionally bypass the check if they wish to remove the router.

---

## Informational Findings

---

### [I-01] FPairV2.priceALast() / priceBLast() Integer Division Returns Zero — Precision Loss

**Severity**: Informational
**Location**: `FPairV2.sol:267-272`

**Description**:
`FPairV2.priceALast()` computes `reserve1 / reserve0` and `priceBLast()` computes `reserve0 / reserve1` using plain integer division with no WAD (1e18) scaling. In a typical bonding curve configuration, `reserve1` (VIRTUAL tokens) is substantially smaller than `reserve0` (agent tokens), so `priceALast()` returns zero for virtually every real reserve state. `priceBLast()` returns a raw integer ratio (e.g., 158730) rather than a WAD-scaled price, resulting in a value that is 1e18 times smaller than an 18-decimal-aware consumer would expect. Any off-chain system that reads these view functions to obtain the current pair price receives either zero or a severely underscaled value.

```solidity
// FPairV2.sol:267-272
function priceALast() public view returns (uint256) {
    return _pool.reserve1 / _pool.reserve0;  // always 0 when reserve1 < reserve0
}
function priceBLast() public view returns (uint256) {
    return _pool.reserve0 / _pool.reserve1;  // raw integer, not WAD-scaled
}
```

**Impact**:
Off-chain integrators, price oracles, and monitoring dashboards that consume `priceALast()` or `priceBLast()` will receive incorrect price data — always zero for `priceALast` and a factor of 1e18 too small for `priceBLast`. On-chain logic does not consume these views (graduation uses direct `balanceOf` reads), so there is no direct on-chain impact.

**Recommendation**:
Scale the output by 1e18: `return (_pool.reserve1 * 1e18) / _pool.reserve0` for `priceALast()` and `return (_pool.reserve0 * 1e18) / _pool.reserve1` for `priceBLast()`. Alternatively, remove these functions if they are not intended for external consumption and document their absence.

---

### [I-02] Graduated Event Missing AgentToken Index and Transfer Amounts

**Severity**: Informational
**Location**: `BondingV5.sol:605`

**Description**:
The `Graduated` event emitted by BondingV5 at graduation includes the token address and the agentToken address but does not index `agentToken` and does not include the VIRTUAL balance transferred to AgentFactory or the agent token balance used to initialize the Uniswap pool. Without indexed `agentToken`, off-chain indexers cannot efficiently filter graduation events by the resulting agent token. Without the transferred amounts, post-graduation economic analysis requires replaying all intermediate state rather than reading events directly. This creates an observability gap for protocol analytics, security monitoring, and integration dashboards.

**Impact**:
No on-chain security impact. Off-chain monitoring systems cannot efficiently filter graduation events by agent token address, and post-graduation economic audits require state replay rather than event log analysis.

**Recommendation**:
Update the `Graduated` event to index `agentToken` and include the VIRTUAL amount transferred to AgentFactory and the agent token amount added to the Uniswap pool as additional parameters:
```solidity
event Graduated(
    address indexed token,
    address indexed agentToken,
    uint256 assetBalance,
    uint256 tokenBalance
);
```

---

### [I-03] graduate() and addInitialLiquidity() Missing Event Emission — Observability Gap

**Severity**: Informational
**Location**: `FRouterV2.sol`, `FRouterV3.sol` (`graduate` and `addInitialLiquidity` functions)

**Description**:
`FRouterV3.graduate()` and `FRouterV3.addInitialLiquidity()` (and their FRouterV2 equivalents) perform large token movements — draining all VIRTUAL and agent tokens from a bonding pair and initializing the Uniswap V2 liquidity pool — without emitting any events at the router layer. The graduation drain transfers all of a pair's accumulated VIRTUAL balance to AgentFactory and all agent tokens to the Uniswap pool, but these transfers are invisible from the router's event log. External monitoring systems watching FRouterV3 events cannot detect when graduation or initial liquidity events occur without parsing the raw token transfer logs from FPairV2 and the ERC20 contracts themselves.

**Impact**:
Security monitoring tools, protocol dashboards, and integration partners that listen to router events for operational awareness cannot detect graduation or pool initialization events. Detection requires scanning lower-level ERC20 transfer events, which is more complex and error-prone.

**Recommendation**:
Add events to both `graduate()` and `addInitialLiquidity()` in FRouterV2 and FRouterV3:
```solidity
event TokenGraduated(address indexed token, uint256 assetAmount, uint256 tokenAmount);
event LiquidityInitialized(address indexed token, uint256 assetAmount, uint256 tokenAmount);
```
Emit these events at the conclusion of each function with the relevant amounts.

---

### [I-04] Missing Event Emission on Critical Admin State Changes (Consolidated)

**Severity**: Informational
**Location**: `FFactoryV2.sol`, `FFactoryV3.sol`, `BondingConfig.sol`, `FRouterV2.sol`, `FRouterV3.sol`, `FPairV2.sol`

**Description**:
More than 23 admin setter functions across the protocol emit no events when they modify critical configuration state. This creates a complete monitoring blind spot: an administrator (or an attacker who has compromised an admin key) can silently alter tax rates, vault addresses, graduation thresholds, router references, and anti-sniper parameters with no on-chain record accessible via event logs. The affected functions include all of the following, none of which emit events:

| Contract | Function | State Changed |
|----------|----------|---------------|
| FFactoryV2/V3 | `setTaxParams()` | buyTax, sellTax, antiSniperBuyTaxStartValue, taxVault, antiSniperTaxVault |
| FRouterV2 | `setTaxManager()` | deprecated taxManager reference |
| FRouterV2 | `setAntiSniperTaxManager()` | deprecated antiSniperTaxManager reference |
| FRouterV2 | `setBondingV2()` | bondingV2 contract reference |
| FRouterV2 | `setBondingV4()` | bondingV4 contract reference |
| FRouterV3 | `setBondingV5()` | bondingV5 and bondingConfig references (simultaneously) |
| BondingConfig | `setScheduledLaunchParams()` | normalLaunchFee, acfFee, scheduledLaunchDelay |
| FPairV2 | `setTaxStartTime()` | per-pair anti-sniper tax start time |
| BondingV5 | `setBondingConfig()` | bondingConfig reference |

Several of these silent changes are directly linked to high-severity vulnerabilities identified elsewhere in this report. For example, a silent `setTaxParams()` call setting `buyTax >= 100` triggers the tax underflow DoS (see H-04). Silent `setBondingV5()` updates that misconfigure contract references enable the router reference mismatch DoS (see M-15). Without events, these changes are undetectable until a user transaction fails.

**Impact**:
No direct on-chain security impact from the missing events themselves. However, the absence of events eliminates the ability to detect misconfiguration attacks, compromised admin key activity, or routine operational errors in real time. Post-incident forensics require full state replay rather than event log analysis.

**Recommendation**:
Add `emit` statements to all listed setter functions. Define appropriate events for each category:
- `event TaxParamsUpdated(uint256 buyTax, uint256 sellTax, uint256 antiSniperStart, address taxVault, address antiSniperVault)` for factory tax setters.
- `event RouterReferenceUpdated(address bondingV5, address bondingConfig)` for `FRouterV3.setBondingV5()`.
- `event ScheduledLaunchParamsUpdated(uint256 normalFee, uint256 acfFee, uint256 delay)` for `BondingConfig.setScheduledLaunchParams()`.
- `event TaxStartTimeUpdated(address indexed pair, uint256 taxStartTime)` for `FPairV2.setTaxStartTime()`.

Prioritize events on setters that directly affect fund flows (tax rates, vault addresses) as these are the highest-value monitoring targets.
