# Security Audit Report — VP Launchpad Suite

**Date**: 2026-04-04
**Auditor**: Automated Security Analysis (Claude Opus 4.6 / Sonnet 4.6)
**Scope**: BondingV5, BondingV2/V3/V4, FPairV2, FRouterV2/V3, FFactoryV2/V3, BondingConfig, Multicall3
**Language/Version**: Solidity ^0.8.20 (solc 0.8.26, via-ir)
**Build Status**: Compiled successfully (Foundry)
**Static Analysis Status**: Unavailable (Slither MCP timeout during analysis — fallback to manual verification)

---

## Executive Summary

The VP Launchpad Suite is a pump.fun-style bonding curve launchpad deployed on Base, enabling creators to launch AI agent tokens that trade along a bonding curve priced in VIRTUAL tokens. When a token accumulates sufficient VIRTUAL deposits (the "graduation threshold"), the protocol automatically migrates it to a Uniswap V2 pool, transferring reserve assets to the AgentFactory contract for managed liquidity provision. The system spans nine contracts across four bonding versions, two router versions, and two factory versions — a multi-version architecture that reflects active protocol evolution.

The audit identified 42 findings across all severity tiers: 1 Critical, 11 High, 15 Medium, 11 Low, and 4 Informational. The most severe finding (C-01) is that `FRouterV3.graduate()` is accessible to any `EXECUTOR_ROLE` holder with no restriction requiring the caller to be the BondingV5 contract. The `beOpsWallet` EOA currently holds `EXECUTOR_ROLE` directly, meaning a single compromised private key can drain every active bonding curve pool on the protocol in one transaction per pair — with no on-chain recovery. This vulnerability was mechanically proven by a passing proof-of-concept test.

The graduation pathway contains a systemic design risk (H-01): `BondingV5._openTradingOnUniswap()` makes four sequential external calls to `AgentFactory` with no error handling. If any call fails — due to AgentFactory pausing, a network disruption, or the `BONDING_ROLE` being revoked from BondingV5 during an upgrade — the affected token enters a permanent denial-of-service state where every buy re-triggers the failing graduation and reverts. No admin function exists to reset this state; recovery requires a proxy upgrade. Because the `BONDING_ROLE` revocation scenario (H-03) is the most realistic trigger during BondingV5→BondingV6 migration, this graduation DoS represents both an immediate robustness gap and a foreseeable operational hazard. Several parameter setters also lack input bounds validation (H-04, H-05, H-06), enabling denial-of-service through misconfiguration — either malicious or accidental — that blocks all trading or all launches protocol-wide.

The multi-version architecture (V2/V3/V4/V5 bonding, V2/V3 router and factory) creates a broad inconsistency surface: legacy contracts have dead or broken APIs (L-09, L-10), deprecated storage slots risk future upgrade collisions (M-09, M-12), and anti-sniper window parameters diverge between versions in ways that are not documented (M-15). Role management is fragile across the board — `DEFAULT_ADMIN_ROLE` can self-revoke (H-08), making `EXECUTOR_ROLE` irrevocable, and no upgradeable contract in scope includes `__gap` storage padding (M-12). Immediate remediation priorities are: restrict `graduate()` to BondingV5 callers, add try/catch to the graduation external calls, add an emergency graduation-state recovery setter, and bound all unbounded admin parameter setters.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 11 |
| Medium | 15 |
| Low | 11 |
| Informational | 4 |
| **Total** | **42** |

---

### Components Audited

| Component | Path | Lines | Description |
|-----------|------|-------|-------------|
| BondingV5 | `contracts/launchpadv2/BondingV5.sol` | ~980 | Core bonding curve logic; token launch, trading, graduation to Uniswap. Upgradeable via proxy. |
| BondingV2/V3/V4 | `contracts/launchpadv2/BondingV*.sol` | ~900 (each) | Legacy bonding implementations; deprecated but in scope. |
| FRouterV3 | `contracts/launchpadv2/FRouterV3.sol` | ~530 | Token trading router; manages buy/sell with tax, anti-sniper window, graduation. |
| FRouterV2 | `contracts/launchpadv2/FRouterV2.sol` | ~380 | Legacy router; deprecated storage slots. |
| FFactoryV3 | `contracts/launchpadv2/FFactoryV3.sol` | ~260 | Factory for token pair creation; manages tax parameters globally. |
| FFactoryV2 | `contracts/launchpadv2/FFactoryV2.sol` | ~250 | Legacy factory; tax parameter initialization. |
| FPairV2 | `contracts/launchpadv2/FPairV2.sol` | ~380 | Bonding curve pair; asset/token balance tracking, tax accumulation. |
| BondingConfig | `contracts/launchpadv2/BondingConfig.sol` | ~290 | Configuration for bonding curve parameters (graduation threshold, initial liquidity, etc.). |
| Multicall3 | `contracts/launchpadv2/Multicall3.sol` | ~180 | Batch call aggregator; ownership simplified to single owner with no revoke path. |

---

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

### [H-04] Global Tax Parameters Lack Upper Bound Validation — Admin-Settable DoS on All Buys and Sells [VERIFIED]

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

This is a defensive coding gap (missing input validation), not solely a trust-model abuse scenario. Misconfiguration by any admin — even a well-intentioned one — triggers the same protocol-wide DoS.

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

*Severity adjusted from Critical -- attack requires DEFAULT_ADMIN (fully trusted actor) to be compromised, which is a key management failure outside the code's control.*

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

---

## Medium Findings

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

Immediate (non-scheduled, non-ACF) launches are unaffected because their fee path returns zero. The vulnerability is limited to the `X_LAUNCH` and `ACP_SKILL` launch modes. Recovery requires the owner to call `setScheduledLaunchParams` again with valid values — if the owner has also called `renounceOwnership()`, recovery becomes impossible (see H-10 regarding the `renounceOwnership` risk).

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
        tokenRef.initialPurchase    // INTERACTION: external call <- here
    );
    uint256 initialPurchase = tokenRef.initialPurchase;
    tokenRef.initialPurchase = 0;  // EFFECT: zeroed after call <- too late
    tokenRef.launchExecuted = true; // EFFECT: set after call <- too late
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

If `antiSniperBuyTaxStartValue = 99` and `buyTax = 2`, the peak anti-sniper tax is silently compressed to 97% instead of the configured 99%. Monitoring systems and dashboards show the configured values but buyers experience a different effective tax.

**`renounceOwnership()` unguarded on BondingV5 and BondingConfig**:
Both `BondingV5` and `BondingConfig` inherit `OwnableUpgradeable` without overriding `renounceOwnership()`. A single call permanently removes the owner:

```solidity
// BondingV5.sol:88-91 — inherits OwnableUpgradeable without override
// BondingConfig.sol:14 — same
```

After renouncement, all `onlyOwner` setters on `BondingConfig` and `BondingV5` are permanently inaccessible. Protocol configuration is frozen at the last set values with no recovery path.

**Impact**:
- Silent anti-sniper cap corruption: Anti-sniper protection is weaker than configured. Operators monitoring configured values receive misleading data.
- Unguarded `renounceOwnership`: One accidental or malicious transaction permanently freezes protocol configuration. This also compounds with M-01 — any misconfiguration that requires a setter to fix becomes permanent if `renounceOwnership` is called first.

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
// Compared against: if (normalTax + antiSniperTax > 99)  <- percentage, not bips
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

---

## Low Findings

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

---

## Priority Remediation Order

1. **C-01** — EXECUTOR_ROLE Can Graduate Any Pair: **Immediate** — A single compromised `beOpsWallet` key can drain all active bonding curve pools. Add `require(msg.sender == address(bondingV5))` to `FRouterV3.graduate()` immediately.

2. **H-01** — Graduation Failure Permanent DoS: **Immediate** — Wrap all AgentFactory calls in try/catch and add an emergency graduation-state recovery setter to BondingV5.

3. **H-03** — BONDING_ROLE Revocation Triggers Systemic DoS: **Immediate** — This is the most likely trigger for H-01. Add `setAgentFactory()` setter and try/catch simultaneously with H-01 fix.

4. **H-11** — Transfer Tax Graduation DoS: **Immediate** — Fix by capturing `tokenBalance` after `graduate()` call. One-line fix, high-impact.

5. **H-04** — Tax Parameters No Upper Bound: **Before mainnet operations** — Add `require(buyTax_ <= 99)` and `require(sellTax_ <= 99)` to both factory `setTaxParams()` functions.

6. **H-05** — Zero-Value Bonding Config Division-by-Zero: **Before mainnet operations** — Add zero-value guards to `setBondingCurveParams()`.

7. **H-06** — Zero-Address antiSniperTaxVault: **Before mainnet operations** — Add `require(antiSniperTaxVault_ != address(0))` to `setTaxParams()`.

8. **H-02** — Permanent 99% Buy Tax via MAX_UINT timestamp: **Before mainnet operations** — Add upper bound to `setTaxStartTime()`.

9. **H-08** — DEFAULT_ADMIN Self-Revoke: **Before mainnet operations** — Override `renounceRole()` to block DEFAULT_ADMIN_ROLE renouncement.

10. **H-07** — drainUniV2Pool Always Reverts: **Before mainnet operations** — Implement on-chain founder approval mechanism or redesign with pull pattern.

11. **H-09** — Dual Buy-Block Mechanisms: **Before mainnet operations** — Both H-02 and H-04 must be fixed; this finding confirms neither fix alone is sufficient.

12. **H-10** — renounceOwnership Permanently Locks BondingConfig: **Before mainnet operations** — Override `renounceOwnership()` in BondingConfig.

13. **M-13** — No Emergency Graduation Recovery: **Before mainnet operations** — Add `setTokenTradingState()` emergency setter (pairs with H-01 fix).

14. **M-12** — No __gap[] in Upgradeable Contracts: **Before next upgrade** — Add `uint256[50] private __gap` to all six upgradeable contracts.

15. **M-09** — Deprecated FRouterV2 Storage Slots: **Before next FRouterV2 upgrade** — Preserve slots, add `__gap`, disable deprecated setters.

---

## Appendix A: Internal Audit Traceability

> This appendix is for the audit team's internal reference only. It maps internal pipeline IDs to report IDs and is not required for client-facing deliverables.

### Master Finding Index

| Report ID | Title | Severity | Verification | Internal Hypothesis | Agent Sources |
|-----------|-------|----------|--------------|---------------------|--------------|
| C-01 | EXECUTOR_ROLE Can Graduate Any Pair | Critical | VERIFIED | H-1 | AC-1, verify_batch_A |
| H-01 | Graduation Failure Permanent DoS | High | VERIFIED | H-2, CH-1 | EP-8, DE-3, DEPTH-ST-1, verify_batch_A |
| H-02 | Anti-Sniper Tax Permanent 99% | High | VERIFIED | H-3 | AC-5, DEPTH-ST-6, verify_batch_B |
| H-03 | BONDING_ROLE Revocation Graduation DoS | High | VERIFIED | H-4 | EP-14, EP-14-R, verify_batch_B |
| H-04 | Tax Parameters No Upper Bound | High | VERIFIED | H-6 | EC-1, EC-2, SP-1, SP-2, DA-TF-2, verify_batch_B |
| H-05 | Zero-Value Bonding Config Params | High | VERIFIED | H-7 | EC-3, verify_batch_B |
| H-06 | Zero-Address antiSniperTaxVault | High | VERIFIED | H-8 | BLIND-A1, verify_batch_B |
| H-07 | drainUniV2Pool Always Reverts | High | VERIFIED | H-42 | DE-1, verify_batch_B |
| H-08 | DEFAULT_ADMIN Self-Revoke Chain | High | VERIFIED | CH-2, H-23, H-27 | BLIND-C1, BLIND-C4, verify_batch_B |
| H-09 | Dual Buy-Block Mechanisms | High | UNVERIFIED | CH-4 | H-3, H-6 chain |
| H-10 | renounceOwnership Unrecoverable | High | UNVERIFIED | CH-5, H-24 | BLIND-B2, BLIND-C2 |
| H-11 | Transfer Tax Graduation DoS | High | VERIFIED | CH-7, EP-10, H-11 | verify_batch_A |
| M-01 | MAX_UINT Scheduled Launch Fees | Medium | UNVERIFIED | H-9 | BLIND-A2 |
| M-02 | EXECUTOR Self-Removal | Medium | UNVERIFIED | H-27 | BLIND-C4 |
| M-03 | Zero-Address Factory Setters | Medium | UNVERIFIED | H-13, H-16, H-18, H-19, H-20 | BLIND-A3, BLIND-A4, BLIND-A5 |
| M-04 | Multicall3 Admin Privilege Escalation | Medium | UNVERIFIED | H-17 | VS-6 |
| M-05 | cancelLaunch Reentrancy Risk | Medium | UNVERIFIED | H-10 | RS2-3, DEPTH-ST-2, SP-3, BLIND-B1 |
| M-06 | Stale Reserve After drainPrivatePool | Medium | UNVERIFIED | H-12 | DA-EP12-1 |
| M-07 | Non-V5 Token Buy DoS | Medium | UNVERIFIED | H-14 | DEPTH-ST-9, DE-5, BLIND-B3 |
| M-08 | Donation Attack Pool Ratio | Medium | UNVERIFIED | H-11 | EP-5, TF-1, DEPTH-TF-3, DE-4, SP-4 |
| M-09 | FRouterV2 Deprecated Storage Slots | Medium | UNVERIFIED | H-15 | DEPTH-ST-8, MG-2 |
| M-10 | teamTokenReservedWallet Race Condition | Medium | UNVERIFIED | H-21 | SP-5, TE-1, MG-4, DEPTH-ST-7 |
| M-11 | Unbounded Admin Setter Values | Medium | UNVERIFIED | H-13, H-16 | DEPTH-ST-4 |
| M-12 | No __gap[] in Upgradeable Contracts | Medium | UNVERIFIED | H-49 | SLS-1 |
| M-13 | No Graduation Recovery Functions | Medium | UNVERIFIED | H-2 variant | Implicit in H-2 |
| M-14 | Basis Points Documentation Mismatch | Medium | UNVERIFIED | CH-6, H-43 | SC-1 |
| M-15 | Anti-Sniper Window Version Mismatch | Medium | UNVERIFIED | H-32 | SC-2, SC-3, SC-4, RS2-8 |
| L-01 | Multicall3 One-Step Ownership | Low | UNVERIFIED | H-47 | BLIND-C3, PC1-3 |
| L-02 | buy() payable ETH Trap | Low | UNVERIFIED | H-28 | CBS-1 |
| L-03 | Duplicate Pair Overwrite | Low | UNVERIFIED | H-48 | RS2-4 |
| L-04 | CREATOR_ROLE Not Initialized | Low | UNVERIFIED | H-25 | DEPTH-ST-3, PC1-10 |
| L-05 | cancelLaunch Missing trading=false | Low | UNVERIFIED | H-41 | DEPTH-ST-10, SC-5 |
| L-06 | addInitialLiquidity Missing nonReentrant | Low | UNVERIFIED | H-26 | VS-4 |
| L-07 | batchTransferTokens Non-Functional | Low | UNVERIFIED | H-45 | VS-5 |
| L-08 | sell() amountOut Before Transfer | Low | UNVERIFIED | H-40 | DA-TF-1 |
| L-09 | BondingV2/V3/V4 buy/sell Always Revert | Low | UNVERIFIED | H-29 | BLIND-C6 |
| L-10 | BondingV3/V4 preLaunch Dead API | Low | UNVERIFIED | H-44 | BLIND-C7 |
| L-11 | setRouter() Zero-Address DoS | Low | UNVERIFIED | H-13 | DEPTH-ST-4 |
| I-01 | FPairV2 Price Precision Loss | Informational | UNVERIFIED | H-31 | DA-1, DA-2, DA-3 |
| I-02 | Graduated Event Missing Fields | Informational | UNVERIFIED | H-36 | EVT-12 |
| I-03 | graduate() Missing Events | Informational | UNVERIFIED | H-30 | EVT-13, EVT-14 |
| I-04 | Silent Admin State Changes | Informational | UNVERIFIED | H-33 | EVT-4 through EVT-11, EVT-16 |

### Consolidation Map

| Report ID | Consolidated From | Consolidation Reason |
|-----------|------------------|----------------------|
| H-01 | H-2 + CH-1 | H-2 is the permanent DoS consequence; CH-1 is the BONDING_ROLE trigger. Both have identical fix (try/catch + recovery setter). |
| H-08 | CH-2, H-23, H-27 | H-23 (DEFAULT_ADMIN self-revoke), H-27 (EXECUTOR self-removal), and CH-2 (combination enabling irrecoverable EXECUTOR) all lead to role management lockout. |
| M-03 | H-13, H-16, H-18, H-19, H-20 | All are zero-address DoS vectors in factory setters. Same fix class. |
| M-11 | H-13, H-16 | Both lack validation on bounds checking for tax/router params. Separate from M-03 (zero-value only). |
| I-04 | H-33, EVT-4 through EVT-11, EVT-16 | 23+ admin state-changing functions emit no events. Consolidated under single finding. |

### Excluded Findings

| Internal ID | Severity | Title | Exclusion Reason |
|-------------|----------|-------|-----------------|
| VS-1 | Info | Graduation uses <= threshold | REFUTED — intentional design; no vulnerability |
| VS-3 | Medium | graduate() validates no pair origin | REFUTED — duplicate of H-1 scope but mechanism already confirmed |
| DE-2 | Medium | AgentFactory.createNewAgentToken reverts on failure | REFUTED — defense-in-depth, not vulnerability |
| DEPTH-TF-1 | Medium | Graduation self-transfer | REFUTED — applyTax=false in normal case |
| DEPTH-TF-2 | Medium | Graduation LP setup issue | REFUTED — design behavior confirmed |
| TF-5 | Medium | Two reads intentionally different | REFUTED — design behavior |
| TF-6 | Low | Donation attack economically irrational | REFUTED — attacker always loses money |
| MG-3 | Medium | tokenGradThreshold not updated at BondingConfig change | REFUTED — stored mapping frozen at preLaunch; not runtime issue |
| EP-3 | Medium | AtomicEVM factory always reverts | REFUTED — rolls back; factory always reverts; no vulnerability |
| EP-4 | Medium | Pair injection impossible | REFUTED — CREATOR_ROLE only BondingV5; pair injection not feasible |
| EC-11 | Low | maxTx dead code | REFUTED — confirmed dead code in all Bonding versions; no active vulnerability |
