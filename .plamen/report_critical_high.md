## Critical Findings

### [C-01] EXECUTOR_ROLE Can Graduate Any Pair, Draining All Bonding Curve Pools [VERIFIED]

**Severity**: Critical
**Location**: `FRouterV3.sol:L230-L239`
**Confidence**: HIGH (4 agents confirmed, PoC: PASS)

**Description**:
The `FRouterV3.graduate()` function is gated only by `EXECUTOR_ROLE` and transfers all assets in a bonding curve pair directly to `msg.sender`. The function is designed to be called exclusively by the `BondingV5` contract during the graduation pipeline, but it lacks any restriction enforcing this. Any externally-owned account (EOA) holding `EXECUTOR_ROLE` -- such as the `beOpsWallet` -- can call `graduate()` on any active bonding curve pair and receive all deposited VIRTUAL tokens and agent tokens.

```solidity
// FRouterV3.sol:230-239
function graduate(
    address tokenAddress
) public onlyRole(EXECUTOR_ROLE) nonReentrant {
    require(tokenAddress != address(0), "Zero addresses are not allowed.");
    address pair = factory.getPair(tokenAddress, assetToken);
    uint256 assetBalance = IFPairV2(pair).assetBalance();
    uint256 tokenBalance = IFPairV2(pair).balance();
    IFPairV2(pair).transferAsset(msg.sender, assetBalance); // ALL VIRTUAL to caller
    IFPairV2(pair).transferTo(msg.sender, tokenBalance);    // ALL agent tokens to caller
}
```

The legitimate graduation flow in `BondingV5._openTradingOnUniswap()` calls `router.graduate(tokenAddress_)` so that `BondingV5` (as `msg.sender`) receives the funds and routes them into AgentFactory and Uniswap. When an EXECUTOR EOA calls the function directly, it bypasses this entire pipeline and the caller receives all user-deposited funds.

**Impact**:
- Complete theft of all VIRTUAL tokens deposited by users into any active bonding curve pair
- Complete theft of all agent tokens held in any active bonding curve pair
- A single compromised or malicious `beOpsWallet` EOA can drain every active pair on the protocol with one transaction per pair
- No on-chain recovery mechanism exists for directly stolen funds
- PoC demonstrated: 42,000 VIRTUAL + 450,000,000 agent tokens drained from a single pair in one call

**PoC Result**:
```
=== EXECUTOR_ROLE Graduate Attack ===
VIRTUAL in pair before attack (user deposits): 42000
Agent tokens in pair before attack: 450000000
VIRTUAL drained by attacker: 42000
Agent tokens drained by attacker: 450000000
VIRTUAL remaining in pair: 0
```
Compiled: YES (3 attempts). Result: PASS. Evidence: [POC-PASS]

**Recommendation**:
Add a caller restriction to `graduate()` ensuring only the BondingV5 contract can invoke it:
```diff
  function graduate(
      address tokenAddress
  ) public onlyRole(EXECUTOR_ROLE) nonReentrant {
+     require(msg.sender == address(bondingV5), "FRouterV3: caller must be BondingV5");
      require(tokenAddress != address(0), "Zero addresses are not allowed.");
```

---

## High Findings

### [H-01] Graduation Failure Creates Permanent Per-Token Buy DoS With No Admin Recovery [VERIFIED]

**Severity**: High
**Location**: `BondingV5.sol:L703-L772`
**Confidence**: HIGH (5 agents confirmed, PoC: CODE-TRACE with concrete values)

**Description**:
The `BondingV5._openTradingOnUniswap()` function makes four sequential external calls to `AgentFactory` with no try/catch error handling. If any of these calls reverts (due to AgentFactory being paused, upgraded, or having revoked `BONDING_ROLE` from BondingV5), the entire `buy()` transaction reverts. Critically, the token's state (`trading=true`, `tradingOnUniswap=false`) remains unchanged after the revert, so every subsequent buy that triggers graduation re-enters the same failing code path in an infinite loop.

```solidity
// BondingV5.sol:703-756 (simplified)
function _openTradingOnUniswap(address tokenAddress_) private {
    BondingConfig.Token storage tokenRef = tokenInfo[tokenAddress_];
    if (tokenRef.tradingOnUniswap || !tokenRef.trading) {
        revert InvalidTokenStatus();
    }
    // ...
    router.graduate(tokenAddress_);
    IERC20(router.assetToken()).safeTransfer(address(agentFactory), assetBalance);
    agentFactory.updateApplicationThresholdWithApplicationId(  // <-- no try/catch
        tokenRef.applicationId, assetBalance
    );
    agentFactory.removeBlacklistAddress(                       // <-- no try/catch
        tokenAddress_, IAgentTokenV2(tokenAddress_).liquidityPools()[0]
    );
    address agentToken = agentFactory.executeBondingCurveApplicationSalt( // <-- no try/catch
        tokenRef.applicationId, ...
    );
    // State only updated AFTER all calls succeed:
    tokenRef.trading = false;
    tokenRef.tradingOnUniswap = true;
}
```

The graduation trigger at `BondingV5._buy()` line 664 checks `newReserveA <= gradThreshold && tokenInfo[tokenAddress_].trading`, meaning every buy above the graduation threshold re-triggers `_openTradingOnUniswap()`. BondingV5 has no admin function to reset `trading`, `tradingOnUniswap`, or `tokenGradThreshold`. The `cancelLaunch()` function is blocked by `launchExecuted=true`. The only recovery path is deploying a new BondingV5 implementation via the proxy admin, which is non-trivial emergency operational overhead.

Additionally, this vulnerability has a broader activation path: if `AgentFactory` governance independently revokes `BONDING_ROLE` from the BondingV5 address (a realistic scenario during protocol upgrades or emergency response), ALL tokens at or near graduation threshold become simultaneously stuck in this permanent DoS state. The blast radius scales from a single token (transient factory failure) to every in-flight token on the BondingV5 instance (governance action).

**Impact**:
- Permanent denial-of-service for all buy operations on any token that reaches graduation threshold while the external dependency is failing
- User funds remain locked in the bonding curve with no direct admin recovery function
- When triggered by BONDING_ROLE revocation, ALL graduation-eligible tokens across the entire BondingV5 instance are simultaneously affected
- Selling remains possible, but the token's progression to Uniswap trading is permanently blocked in the current implementation
- Recovery requires deploying a new proxy implementation -- not a single-transaction admin fix

**PoC Result**:
```
=== Graduation Failure Permanent DoS ===
After first revert: trading= true
After first revert: tradingOnUniswap= false
Both graduation attempts reverted - PERMANENT DoS confirmed
BondingV5 has NO admin recovery function for this state
```
Compiled: YES (3 attempts). Result: PASS. Evidence: [CODE-TRACE] -- test mirrors exact execution sequence of `_openTradingOnUniswap()` in a standalone stub; revert propagation mechanically proven.

**Recommendation**:
Wrap all external AgentFactory calls in try/catch blocks and add an emergency admin recovery function:
```diff
+ try agentFactory.executeBondingCurveApplicationSalt(
+     tokenRef.applicationId, ...
+ ) returns (address agentToken_) {
+     tokenRef.agentToken = agentToken_;
+     emit Graduated(tokenAddress_, agentToken_);
+     tokenRef.trading = false;
+     tokenRef.tradingOnUniswap = true;
+ } catch {
+     emit GraduationFailed(tokenAddress_);
+     revert GraduationFailed();
+ }
```
Additionally, add:
- `emergencyResetGraduation(address tokenAddress_)` owner function to reset stuck tokens
- `setAgentFactory(address)` owner function with timelock to allow pointing to a new AgentFactory if BONDING_ROLE is revoked

---

### [H-02] EXECUTOR_ROLE Anti-Sniper Tax Manipulation Enables Permanent 99% Buy Tax [VERIFIED]

**Severity**: High
**Location**: `FRouterV3.sol:L344-L355`, `FRouterV3.sol:L295-L318`
**Confidence**: HIGH (3 agents confirmed, PoC: CODE-TRACE with boundary analysis)

**Description**:
The `FRouterV3.setTaxStartTime()` function allows any `EXECUTOR_ROLE` holder to set the `taxStartTime` on a bonding curve pair. The only validation is a floor check (`_taxStartTime >= startTime`), with no upper bound. By setting `taxStartTime` to `type(uint256).max`, an EXECUTOR permanently locks the anti-sniper tax window open, applying a 99% buy tax to all future purchases on that pair.

```solidity
// FRouterV3.sol:344-354
function setTaxStartTime(
    address pairAddress,
    uint256 _taxStartTime
) public onlyRole(EXECUTOR_ROLE) {
    IFPairV2 pair = IFPairV2(pairAddress);
    try pair.setTaxStartTime(_taxStartTime) {} catch {}
}

// FRouterV3.sol:305-307 (in _calculateAntiSniperTax)
if (block.timestamp < taxStartTime) {
    return startTax;  // Returns 99 (the anti-sniper starting tax value)
}
```

When `taxStartTime = type(uint256).max`, the condition `block.timestamp < taxStartTime` is always true for any realistic timestamp. The anti-sniper tax never decays, and every buy permanently incurs a 99% tax. Combined with the normal `buyTax` (typically 1%), the total effective tax is capped at 99%, leaving buyers receiving approximately 1% of their intended token amount.

The `beOpsWallet` EOA holds `EXECUTOR_ROLE` directly on FRouterV3 and can invoke this function without multisig approval or timelock.

**Impact**:
- Every buy on the targeted pair permanently receives only ~1% of the intended token amount
- The bonding curve token becomes economically untradeable for buyers (no rational actor buys at 99% tax)
- Graduation becomes impossible because buy amounts are too small to meaningfully move reserves toward the graduation threshold
- Existing token holders are effectively trapped -- they can sell, but no new buyers will enter at 99% tax
- The EXECUTOR can target individual pairs selectively or apply this to all pairs

**PoC Result**:
Verification: CODE-TRACE with concrete values. Traced `setTaxStartTime(pair, type(uint256).max)` through `FPairV2.setTaxStartTime()` (floor check passes: MAX_UINT >= any past startTime), then traced a subsequent `buy()` through `_calculateAntiSniperTax()` confirming permanent 99% return value. The cap logic at line 195 prevents total tax from exceeding 99%, so the function does not revert -- it silently delivers 1% of intended tokens. Evidence: [CODE-TRACE] [BOUNDARY:taxStartTime=MAX_UINT -> tax never decays]

**Recommendation**:
Add an upper bound to `setTaxStartTime()`:
```diff
  function setTaxStartTime(
      address pairAddress,
      uint256 _taxStartTime
  ) public onlyRole(EXECUTOR_ROLE) {
+     require(_taxStartTime <= block.timestamp + 365 days, "taxStartTime too far in future");
      IFPairV2 pair = IFPairV2(pairAddress);
      try pair.setTaxStartTime(_taxStartTime) {} catch {}
  }
```

---

### [H-03] AgentFactory BONDING_ROLE Revocation Triggers Systemic Graduation Denial of Service [VERIFIED]

**Severity**: High
**Location**: `BondingV5.sol:L727-L756`
**Confidence**: HIGH (3 agents confirmed, PoC: CODE-TRACE)

**Description**:
The `BondingV5._openTradingOnUniswap()` function requires `BONDING_ROLE` authorization on the external `AgentFactory` contract for three sequential calls: `updateApplicationThresholdWithApplicationId()`, `removeBlacklistAddress()`, and `executeBondingCurveApplicationSalt()`. The AgentFactory has independent governance from BondingV5 -- its `DEFAULT_ADMIN_ROLE` may be held by a completely different multisig.

If the AgentFactory admin revokes `BONDING_ROLE` from the BondingV5 contract address (for any reason: emergency response, migration to BondingV6, or governance error), all calls from BondingV5 to AgentFactory revert with an access control error. Because `_openTradingOnUniswap()` has no try/catch, this triggers the permanent graduation DoS described in H-01 for every token at or near the graduation threshold.

```solidity
// BondingV5.sol:731-733 -- first of three BONDING_ROLE-gated calls
agentFactory.updateApplicationThresholdWithApplicationId(
    tokenRef.applicationId,
    assetBalance
);
// Lines 737-740, 748-756 -- two more BONDING_ROLE-gated calls follow, also unwrapped
```

BondingV5 has no pre-flight role check (e.g., `require(agentFactory.hasRole(BONDING_ROLE, address(this)))`) and no mechanism to restore the role or switch to a new AgentFactory.

**Impact**:
- ALL tokens at graduation threshold on this BondingV5 instance simultaneously enter permanent buy DoS
- The root cause is an external governance action completely outside BondingV5 admin's control
- This is the most realistic activation path for the graduation DoS (see H-01): protocol upgrades from BondingV5 to BondingV6 naturally involve BONDING_ROLE transfer
- Recovery requires proxy upgrade of BondingV5 to add try/catch and AgentFactory setter

**PoC Result**:
Verification: CODE-TRACE. Traced BONDING_ROLE revocation through OpenZeppelin AccessControl, confirmed BondingV5 calls to `agentFactory.updateApplicationThresholdWithApplicationId()` revert, and confirmed the permanent DoS loop: `trading=true`, `tradingOnUniswap=false` unchanged after each revert. Evidence: [CODE-TRACE] [TRACE:agentFactory call reverts on BONDING_ROLE loss -> permanent graduation loop]

**Recommendation**:
Apply the same try/catch fix as H-01. Additionally, add a setter for the AgentFactory reference:
```diff
+ function setAgentFactory(address agentFactory_) external onlyOwner {
+     require(agentFactory_ != address(0), "Zero address");
+     agentFactory = IAgentFactoryV7Minimal(agentFactory_);
+ }
```

---

### [H-04] Global Tax Parameters Lack Upper Bound Validation -- Admin-Settable DoS on All Buys and Sells [VERIFIED]

**Severity**: High
**Location**: `FFactoryV2.sol:L108-L122`, `FFactoryV3.sol:L116-L130`, `FRouterV3.sol:L195-L202`, `FRouterV3.sol:L157-L161`
**Confidence**: HIGH (6 agents confirmed, PoC: CODE-TRACE with boundary analysis)

**Description**:
The `setTaxParams()` function in both `FFactoryV2` and `FFactoryV3` accepts `buyTax`, `sellTax`, and `antiSniperBuyTaxStartValue` without any upper bound validation. These parameters are used globally across ALL bonding curve pairs.

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
    buyTax = buyTax_;           // No upper bound check
    sellTax = sellTax_;         // No upper bound check
    antiSniperBuyTaxStartValue = antiSniperBuyTaxStartValue_;  // No upper bound check
    antiSniperTaxVault = antiSniperTaxVault_;
}
```

**Buy DoS (buyTax >= 100)**: In `FRouterV3.buy()`, the anti-sniper tax cap logic at line 195 computes `antiSniperTax = 99 - normalTax`. When `normalTax = buyTax = 100`, this evaluates to `99 - 100`, which underflows in Solidity 0.8.20 and reverts. All buys on all pairs using this factory revert immediately.

```solidity
// FRouterV3.sol:195-196
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax;  // Underflow when normalTax >= 100
}
```

**Sell DoS (sellTax >= 101)**: In `FRouterV3.sell()`, the fee is computed as `txFee = (sellTax * amountOut) / 100`. When `sellTax = 101`, `txFee` exceeds `amountOut`, and the subtraction `amount = amountOut - txFee` underflows and reverts. All sells on all pairs revert.

```solidity
// FRouterV3.sol:157-160
uint fee = factory.sellTax();
uint256 txFee = (fee * amountOut) / 100;
uint256 amount = amountOut - txFee;  // Underflow when sellTax >= 101
```

This is a defensive coding gap (missing input validation), not solely a trust-model abuse scenario. Misconfiguration by any admin -- even a well-intentioned one -- triggers the same protocol-wide DoS.

**Impact**:
- `buyTax >= 100`: arithmetic underflow reverts ALL buys on ALL pairs globally
- `sellTax >= 101`: arithmetic underflow reverts ALL sells on ALL pairs globally
- Both conditions create an immediate protocol-wide trading halt affecting all users and all active bonding curve tokens
- Recovery requires the admin to call `setTaxParams()` again with valid values

**PoC Result**:
Verification: CODE-TRACE with boundary analysis. Traced `buyTax=100` through the tax cap logic confirming `99 - 100` underflow. Traced `sellTax=101` through sell fee calculation confirming `amountOut - txFee` underflow. Both paths independently cause all-pair trading halt. Evidence: [CODE-TRACE] [BOUNDARY:buyTax=100 -> underflow at L195] [BOUNDARY:sellTax=101 -> underflow at L160]

**Recommendation**:
Add upper bound validation in `setTaxParams()`:
```diff
  function setTaxParams(...) public onlyRole(ADMIN_ROLE) {
      require(newVault_ != address(0), "Zero addresses are not allowed.");
+     require(buyTax_ <= 99, "buyTax exceeds maximum");
+     require(sellTax_ <= 99, "sellTax exceeds maximum");
+     require(antiSniperBuyTaxStartValue_ <= 99, "antiSniper exceeds maximum");
      taxVault = newVault_;
```

---

### [H-05] Zero-Value Bonding Curve Parameters Cause Division-by-Zero and Instant Graduation [VERIFIED]

**Severity**: High
**Location**: `BondingConfig.sol:L178-L183`, `BondingV5.sol:L376-L377`, `BondingConfig.sol:L223-L234`
**Confidence**: HIGH (2 agents confirmed, PoC: CODE-TRACE with boundary analysis)

**Description**:
The `BondingConfig.setBondingCurveParams()` function accepts a struct parameter with no validation on zero values for critical fields:

```solidity
// BondingConfig.sol:178-183
function setBondingCurveParams(
    BondingCurveParams memory params_
) external onlyOwner {
    bondingCurveParams = params_;  // No validation on any field
    emit BondingCurveParamsUpdated(params_);
}
```

**Division-by-zero (fakeInitialVirtualLiq = 0)**: During `BondingV5._preLaunch()`, the bonding curve price is computed as `bondingCurveSupply / fakeInitialVirtualLiq`. When `fakeInitialVirtualLiq = 0`, this triggers a Solidity 0.8 panic (division by zero), reverting every new token launch attempt across the entire protocol.

**Instant graduation (targetRealVirtual = 0)**: The `calculateGradThreshold()` formula computes the graduation threshold as `(fakeInitialVirtualLiq * supply) / (targetRealVirtual + fakeInitialVirtualLiq)`. When `targetRealVirtual = 0`, this simplifies to `supply`, meaning the graduation threshold equals the full bonding curve supply. Any buy that reduces reserves below this threshold triggers graduation immediately -- effectively graduating every token on its first post-anti-sniper buy with near-zero real liquidity collected.

**Impact**:
- `fakeInitialVirtualLiq = 0`: hard revert on ALL new token launches (complete protocol halt for new launches)
- `targetRealVirtual = 0`: every newly launched token graduates immediately with negligible user deposits, creating worthless Uniswap pools
- Both parameters affect all future launches protocol-wide until corrected

**PoC Result**:
Verification: CODE-TRACE with boundary substitution. Traced `fakeInitialVirtualLiq=0` through `_preLaunch()` confirming division-by-zero panic. Traced `targetRealVirtual=0` through `calculateGradThreshold()` confirming `gradThreshold = bondingCurveSupply`, then through first buy confirming instant graduation trigger. Evidence: [CODE-TRACE] [BOUNDARY:fakeInitialVirtualLiq=0 -> division by zero] [BOUNDARY:targetRealVirtual=0 -> gradThreshold=supply -> instant graduation]

**Recommendation**:
Add strict lower bounds in `setBondingCurveParams()`:
```diff
  function setBondingCurveParams(
      BondingCurveParams memory params_
  ) external onlyOwner {
+     require(params_.fakeInitialVirtualLiq > 0, "fakeInitialVirtualLiq cannot be zero");
+     require(params_.targetRealVirtual > 0, "targetRealVirtual cannot be zero");
      bondingCurveParams = params_;
  }
```

---

### [H-06] Zero-Address antiSniperTaxVault Bricks All Buys During Anti-Sniper Window [VERIFIED]

**Severity**: High
**Location**: `FFactoryV2.sol:L108-L122`, `FFactoryV3.sol:L116-L130`, `FRouterV3.sol:L213-L218`
**Confidence**: HIGH (2 agents confirmed, PoC: CODE-TRACE)

**Description**:
The `setTaxParams()` function in both factory contracts validates the `taxVault` parameter against zero-address (`require(newVault_ != address(0))`) but does NOT validate the `antiSniperTaxVault` parameter. If `antiSniperTaxVault` is set to `address(0)`, every buy during the anti-sniper window that incurs a non-zero anti-sniper tax fee attempts a `safeTransferFrom` to the zero address, which reverts.

```solidity
// FFactoryV3.sol:122-129 (abridged)
function setTaxParams(...) public onlyRole(ADMIN_ROLE) {
    require(newVault_ != address(0), "Zero addresses are not allowed.");
    // ...
    antiSniperTaxVault = antiSniperTaxVault_;  // NO zero-address check
}

// FRouterV3.sol:213-218
if (antiSniperTxFee > 0) {
    IERC20(assetToken).safeTransferFrom(
        to,
        factory.antiSniperTaxVault(),  // address(0) -> revert
        antiSniperTxFee
    );
}
```

The inconsistency between the `taxVault` validation (protected) and `antiSniperTaxVault` (unprotected) suggests this is an oversight rather than intentional design. The `setTaxParams()` function accepts five parameters, making it easy for an admin updating only tax rates to inadvertently pass `address(0)` for the anti-sniper vault.

**Impact**:
- ALL buys during the anti-sniper window on ALL pairs using this factory revert
- Anti-sniper windows typically last 60 seconds to 98 minutes after pair creation
- New token launches are particularly affected, as all early buyers are blocked
- Buys after the anti-sniper window expire normally (antiSniperTxFee = 0, transfer skipped)

**PoC Result**:
Verification: CODE-TRACE. Traced `setTaxParams()` confirming no zero-address check on `antiSniperTaxVault_`. Traced a buy during anti-sniper window confirming `safeTransferFrom(to, address(0), fee)` reverts with "ERC20: transfer to the zero address". Evidence: [CODE-TRACE] [TRACE:setTaxParams(antiSniperVault=0) -> buy() in anti-sniper window -> safeTransferFrom to address(0) -> revert]

**Recommendation**:
Add zero-address validation in `setTaxParams()`:
```diff
  function setTaxParams(...) public onlyRole(ADMIN_ROLE) {
      require(newVault_ != address(0), "Zero addresses are not allowed.");
+     require(antiSniperTaxVault_ != address(0), "Zero address not allowed for antiSniperTaxVault");
```

---

### [H-07] drainUniV2Pool Always Reverts Without Off-Chain Founder Pre-Approval [VERIFIED]

**Severity**: High
**Location**: `FRouterV3.sol:L456-L473`
**Confidence**: HIGH (2 agents confirmed, PoC: CODE-TRACE)

**Description**:
The `FRouterV3.drainUniV2Pool()` function is designed to drain all Uniswap V2 liquidity from graduated Project60days tokens. The function reads the founder's full `veToken` balance and calls `agentFactory.removeLpLiquidity()` to remove that liquidity. However, this internal call requires the founder to have pre-approved the AgentFactory to spend their veTokens -- an approval that has no on-chain establishment mechanism.

```solidity
// FRouterV3.sol:455-473
function drainUniV2Pool(
    address agentToken, address veToken, address recipient, uint256 deadline
) public onlyRole(EXECUTOR_ROLE) nonReentrant {
    // ...
    address founder = veTokenContract.founder();
    uint256 veTokenAmount = IERC20(veToken).balanceOf(founder);
    require(veTokenAmount > 0, "No liquidity to drain");

    // This call internally requires founder.approve(agentFactory, veTokenAmount)
    // No on-chain mechanism establishes this approval
    IAgentFactoryV7(agentFactory).removeLpLiquidity(
        veToken, recipient, veTokenAmount,
        0, 0, deadline  // "No slippage protection needed since EXECUTOR_ROLE is trusted"
    );
}
```

The `removeLpLiquidity()` call performs a `transferFrom(founder, ...)` which reverts with `ERC20InsufficientAllowance` because no protocol function ever calls `founder.approve(agentFactory, amount)`. There is no `drainApprove()`, no EIP-2612 permit workflow, and no delegation mechanism in the contract. The code comment at line 464 states "No slippage protection needed since EXECUTOR_ROLE is trusted," indicating the function was designed for autonomous EXECUTOR operation -- which is incompatible with the mandatory off-chain founder cooperation.

**Impact**:
- The `drainUniV2Pool()` function is non-functional as an autonomous EXECUTOR operation
- Project60days token liquidity cannot be programmatically drained after graduation
- EXECUTOR calls to this function silently waste gas and provide no on-chain error context about the approval requirement
- The stated design intent (autonomous privileged drain) is fundamentally broken

**PoC Result**:
Verification: CODE-TRACE. Traced `drainUniV2Pool()` through `removeLpLiquidity()` confirming `transferFrom(founder, agentFactory, veTokenAmount)` requires founder approval. No protocol function calls `IERC20(veToken).approve(agentFactory, amount)` on behalf of the founder. The function always reverts with `ERC20InsufficientAllowance`. Evidence: [CODE-TRACE] [TRACE:drainUniV2Pool -> removeLpLiquidity -> transferFrom(founder,...) -> revert(no approval)]

**Recommendation**:
Either implement an on-chain approval mechanism where founders explicitly pre-approve the AgentFactory as part of the graduation process, or redesign the drain to use a pull pattern where the founder initiates or approves in the same transaction:
```diff
+ // Option A: Establish approval during graduation
+ // In _openTradingOnUniswap(), after creating the veToken:
+ IERC20(veToken).approve(address(agentFactory), type(uint256).max);

+ // Option B: Document the off-chain prerequisite and add a pre-check
+ require(IERC20(veToken).allowance(founder, agentFactory) >= veTokenAmount,
+     "Founder must approve agentFactory before drain");
```

---

### [H-08] DEFAULT_ADMIN_ROLE Self-Revoke Makes EXECUTOR_ROLE Permanently Irrevocable [VERIFIED]

**Severity**: High
**Location**: `FRouterV3.sol:L79`, `FRouterV3.sol:L118-L124`
**Confidence**: HIGH (3 agents confirmed, PoC: CODE-TRACE)

**Description**:
FRouterV3 uses OpenZeppelin's `AccessControlUpgradeable`, where `DEFAULT_ADMIN_ROLE` is its own admin and the admin of all other roles (including `EXECUTOR_ROLE`). Only a single address receives `DEFAULT_ADMIN_ROLE` during initialization:

```solidity
// FRouterV3.sol:79 (in initialize)
_grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
```

The `DEFAULT_ADMIN_ROLE` holder can call `renounceRole(DEFAULT_ADMIN_ROLE, self)`, which irrevocably removes the sole admin from the system. After this action, no address can grant or revoke any role on FRouterV3 -- including `EXECUTOR_ROLE`. If an attacker has already obtained `EXECUTOR_ROLE` (e.g., via a compromised DEFAULT_ADMIN granting it before self-revoking), the attacker's `EXECUTOR_ROLE` becomes permanently irrevocable.

Combined with C-01 (EXECUTOR can drain all pools via `graduate()`), this creates an irrecoverable attack chain:
1. Attacker compromises the DEFAULT_ADMIN EOA
2. Calls `grantRole(EXECUTOR_ROLE, attackerAddress)`
3. Calls `renounceRole(DEFAULT_ADMIN_ROLE, self)`
4. No one can ever revoke the attacker's EXECUTOR_ROLE
5. Attacker calls `graduate()` on every active pair, draining all user funds with no on-chain recovery

*Severity adjusted from Critical -- attack requires DEFAULT_ADMIN (FULLY_TRUSTED actor) to be compromised, which is a key management failure outside the code's control.*

**Impact**:
- Permanent loss of all role management on FRouterV3 after DEFAULT_ADMIN self-revoke
- If combined with C-01: irrecoverable total fund drain from all bonding curve pools
- Recovery requires proxy upgrade of FRouterV3 to restore admin access -- not a standard admin operation
- Even without the drain scenario, loss of DEFAULT_ADMIN makes it impossible to rotate EXECUTOR_ROLE, revoke compromised roles, or make any access control changes

**PoC Result**:
Verification: CODE-TRACE. Traced `renounceRole(DEFAULT_ADMIN_ROLE, self)` through OZ AccessControl confirming role removal. Confirmed `revokeRole(EXECUTOR_ROLE, attacker)` requires caller to hold admin of EXECUTOR_ROLE (= DEFAULT_ADMIN_ROLE, now held by no one) and always reverts. Evidence: [CODE-TRACE] [TRACE:renounceRole(DEFAULT_ADMIN) -> revokeRole(EXECUTOR) = impossible -> attacker EXECUTOR permanent]

**Recommendation**:
Override `renounceRole()` to prevent DEFAULT_ADMIN_ROLE from being renounced, or use OpenZeppelin's `AccessControlDefaultAdminRules` which adds a two-step transfer with delay:
```diff
+ function renounceRole(bytes32 role, address account) public virtual override {
+     require(role != DEFAULT_ADMIN_ROLE, "Cannot renounce DEFAULT_ADMIN_ROLE");
+     super.renounceRole(role, account);
+ }
```

---

### [H-09] Dual Independent Buy-Block Mechanisms Resist Partial Remediation [UNVERIFIED]

**Severity**: High
**Location**: `FRouterV3.sol:L195-L202`
**Confidence**: MEDIUM (2 agents confirmed via chain analysis, PoC: not independently tested)

**Description**:
Two completely independent mechanisms can each block all buy transactions on the protocol, controlled by different roles through different state variables and different code paths:

1. **Tax underflow (see H-04)**: `ADMIN_ROLE` on FFactory sets `buyTax >= 100`, causing an arithmetic underflow at `FRouterV3.sol:196` (`99 - normalTax`) that reverts all buys with a hard revert.

2. **Permanent anti-sniper tax (see H-02)**: `EXECUTOR_ROLE` on FRouterV3 sets `taxStartTime = type(uint256).max`, causing a permanent 99% anti-sniper tax that effectively freezes buys (users receive ~1% of intended tokens).

These two mechanisms use different state variables (`buyTax` vs `taxStartTime`), are set by different roles (`ADMIN_ROLE` vs `EXECUTOR_ROLE`), and execute on different code paths. When both are active simultaneously, the tax underflow (H-04) dominates because the underflow revert occurs before the anti-sniper tax calculation is used. Critically, patching either vulnerability independently leaves the other fully exploitable:

- Fixing H-04 (adding `buyTax <= 99` bound) does not affect H-02's permanent 99% tax
- Fixing H-02 (adding `taxStartTime` upper bound) does not affect H-04's underflow DoS

**Impact**:
- Both vulnerabilities must be independently identified and fixed; remediating only one leaves the protocol vulnerable to the other
- Different role holders can trigger each path independently -- no single-point remediation suffices
- The redundant buy-block mechanisms increase the attack surface for sustained trading disruption

**PoC Result**:
Verification: CODE-TRACE via composition analysis. The independence of the two mechanisms is confirmed by their use of separate state variables and separate code paths in `FRouterV3.buy()`. Not independently PoC-tested as a combined scenario, but both constituent findings (H-02 and H-04) are individually verified. Evidence: [CODE-TRACE] [TRACE:H-04+H-02 simultaneously active -> H-04 causes revert first; patching either alone leaves the other active]

**Recommendation**:
Both H-02 and H-04 must be fixed independently. See recommendations for H-02 (add upper bound to `setTaxStartTime()`) and H-04 (add upper bounds to `setTaxParams()`). Both fixes are required for complete remediation.

---

### [H-10] renounceOwnership Makes BondingConfig Parameter Corruption Permanently Unrecoverable [UNVERIFIED]

**Severity**: High
**Location**: `BondingConfig.sol:L159-L183`
**Confidence**: MEDIUM (3 agents confirmed via chain analysis, PoC: not independently tested)

**Description**:
`BondingConfig` inherits `OwnableUpgradeable` which includes an unoverridden `renounceOwnership()` function. If the BondingConfig owner calls `renounceOwnership()`, the `_owner` is set to `address(0)`, permanently locking all `onlyOwner` functions:

- `setBondingCurveParams()` -- sets fakeInitialVirtualLiq, targetRealVirtual
- `setScheduledLaunchParams()` -- sets launch fees
- `setCommonParams()` -- sets fee recipients, anti-sniper vault
- `setReserveSupplyParams()` -- sets supply parameters
- `setTeamTokenReservedWallet()` -- sets team wallet

If `renounceOwnership()` is called while BondingConfig contains invalid parameters (such as `fakeInitialVirtualLiq = 0` from H-05), the protocol-wide DoS becomes permanently unrecoverable through BondingConfig directly.

A partial recovery path exists: the BondingV5 owner (if still active and separate from BondingConfig owner) can deploy a new BondingConfig instance with correct parameters and call `BondingV5.setBondingConfig(newConfigAddress)`. However, this requires the BondingV5 owner to be operational and aware of the issue, and it does not recover any state accumulated in the old BondingConfig.

**Impact**:
- All BondingConfig parameters become permanently immutable after ownership renouncement
- Combined with H-05: division-by-zero DoS on all new launches with no direct fix path
- Recovery requires deploying a new BondingConfig and updating BondingV5's reference (if BondingV5 owner is intact)
- If both BondingConfig owner and BondingV5 owner renounce: complete permanent protocol halt

**PoC Result**:
Verification: CODE-TRACE via chain composition. Traced `renounceOwnership()` through OZ OwnableUpgradeable confirming `_owner = address(0)`. Confirmed all setter functions become permanently inaccessible. Confirmed partial recovery via `BondingV5.setBondingConfig(newAddress)` if BondingV5 owner is intact. Evidence: [CODE-TRACE] [TRACE:renounceOwnership(BondingConfig) -> owner=0 -> setBondingCurveParams blocked permanently]

**Recommendation**:
Override `renounceOwnership()` in BondingConfig to prevent accidental permanent lockout:
```diff
+ function renounceOwnership() public virtual override onlyOwner {
+     revert("BondingConfig: ownership renouncement disabled");
+ }
```
Alternatively, implement OpenZeppelin's `Ownable2Step` pattern which requires a two-step transfer and prevents accidental renouncement.

---

### [H-11] Transfer Tax on Graduated Tokens Triggers Automatic Permanent Graduation DoS [VERIFIED]

**Severity**: High
**Location**: `BondingV5.sol:L719-L746`
**Confidence**: HIGH (3 agents confirmed, PoC: PASS)

**Description**:
`BondingV5._openTradingOnUniswap()` captures the pair's token balance BEFORE calling `router.graduate()`, then uses this pre-graduation balance for a subsequent `safeTransfer`. When the token being graduated has a transfer tax, the `graduate()` call transfers fewer tokens than expected to BondingV5 (the tax is deducted during transfer), but BondingV5 still attempts to transfer the full original amount -- causing an insufficient balance revert.

```solidity
// BondingV5.sol:718-746 (key lines)
uint256 tokenBalance = pairContract.balance();       // Captures balance BEFORE graduation
router.graduate(tokenAddress_);                       // Transfers tokens to BondingV5 (with tax deduction)
// ... BondingV5 now has tokenBalance * (1 - taxRate), NOT tokenBalance
IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance);  // Attempts full amount -> REVERT
```

For a token with 10% transfer tax: the pair holds 405M tokens, `graduate()` transfers 405M but only 364.5M arrives at BondingV5 (90%). The subsequent `safeTransfer(tokenAddress_, 405M)` reverts because BondingV5 only has 364.5M. This triggers the permanent graduation DoS loop described in H-01 (`trading=true`, `tradingOnUniswap=false`, every subsequent buy re-triggers the same failing path).

This vulnerability requires no attacker action -- it triggers automatically via pure protocol mechanics whenever a fee-on-transfer token reaches the graduation threshold. Current production preTokens appear to be standard ERC20 without transfer tax, but the code contains no guard against fee-on-transfer tokens, and no documentation restricts preTokens from having custom transfer logic.

**Impact**:
- Any fee-on-transfer token launched through BondingV5 automatically enters permanent graduation DoS on its first graduation attempt
- No attacker intervention required -- pure protocol mechanics
- All user funds in that token's bonding curve are locked with no admin recovery (same as H-01)
- The severity is conditional on fee-on-transfer tokens being present; current production tokens appear standard ERC20, but the structural vulnerability exists for any future taxed token integration

**PoC Result**:
```
=== Transfer Tax + Graduation DoS ===
Tax token real balance in pair: 405000000
Token in pair (tokenBalance): 405000000
Would receive after 10% tax (90%): 364500000
Shortfall: 40500000
Graduation reverts due to tax shortfall - Permanent DoS triggered
No attacker needed - pure protocol mechanics with any taxed token
```
Compiled: YES (3 attempts). Result: PASS. Evidence: [POC-PASS]

**Recommendation**:
Capture the token balance AFTER the `graduate()` call to use the actual received amount:
```diff
- uint256 tokenBalance = pairContract.balance();
  router.graduate(tokenAddress_);
+ uint256 tokenBalance = IERC20(tokenAddress_).balanceOf(address(this));
  // ... subsequent transfer uses actual received balance
  IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance);
```
