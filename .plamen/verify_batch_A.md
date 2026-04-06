# Verification Batch A -- Critical Findings

**Test file**: `test/verify_batch_A.t.sol`
**Compiled**: YES (attempts: 3 — fixed Unicode characters, visibility modifier)
**All tests**: 4/4 PASS

---

## H-1 Verification

**Impact Premise**: An address holding EXECUTOR_ROLE (e.g., beOpsWallet EOA) can call `FRouterV3.graduate()` directly on any bonding-curve pair, receiving ALL user-deposited VIRTUAL and ALL agent tokens — draining every active bonding curve pool with a single call per pair.

**Compiled**: YES (attempts: 3)
**Result**: PASS
**Output**:
```
=== H-1: EXECUTOR_ROLE Graduate Attack ===
VIRTUAL in pair before attack (user deposits): 42000
Agent tokens in pair before attack: 450000000
VIRTUAL drained by attacker: 42000
Agent tokens drained by attacker: 450000000
VIRTUAL remaining in pair: 0
H-1: [POC-PASS] graduate() accessible by any EXECUTOR_ROLE - drains user funds
```

**Evidence Tag**: [POC-PASS]

**Verdict**: CONFIRMED

**Final Severity**: Critical

**Root cause (confirmed)**:
`FRouterV3.graduate()` (line 231-239) is gated only by `onlyRole(EXECUTOR_ROLE)`. It calls:
```solidity
IFPairV2(pair).transferAsset(msg.sender, assetBalance); // ALL VIRTUAL to caller
IFPairV2(pair).transferTo(msg.sender, tokenBalance);    // ALL agent tokens to caller
```
`msg.sender` is the EXECUTOR_ROLE holder — any EOA with this role drains the pair entirely. No check verifies that the caller is BondingV5 or that graduation was legitimately triggered.

### Suggested Fix
```diff
- function graduate(address tokenAddress) public onlyRole(EXECUTOR_ROLE) nonReentrant {
+ function graduate(address tokenAddress) public onlyRole(EXECUTOR_ROLE) nonReentrant {
+     require(msg.sender == address(bondingV5), "FRouterV3: caller must be BondingV5");
      require(tokenAddress != address(0), "Zero addresses are not allowed.");
      address pair = factory.getPair(tokenAddress, assetToken);
      uint256 assetBalance = IFPairV2(pair).assetBalance();
      uint256 tokenBalance = IFPairV2(pair).balance();
      IFPairV2(pair).transferAsset(msg.sender, assetBalance);
      IFPairV2(pair).transferTo(msg.sender, tokenBalance);
  }
```
**Fix scope**: Restrict `graduate()` to only be callable by the BondingV5 contract address, eliminating the ability for any arbitrary EXECUTOR_ROLE holder to drain pairs directly.
**Verified**: NO (fix not mechanically re-run)

---

## H-2 Verification

**Impact Premise**: After a single failed graduation attempt (where `agentFactory.executeBondingCurveApplicationSalt()` reverts), every subsequent `buy()` call on the affected token reverts permanently — user funds are permanently locked with no admin recovery path.

**Compiled**: YES (attempts: 3)
**Result**: PASS
**Output**:
```
=== H-2: Graduation Failure Permanent DoS ===
After first revert: trading= true
After first revert: tradingOnUniswap= false
H-2: Both graduation attempts reverted - PERMANENT DoS confirmed
H-2: BondingV5 has NO admin recovery function for this state
H-2: [CODE-TRACE] Permanent buy() DoS after graduation failure CONFIRMED
```

**Evidence Tag**: [CODE-TRACE]

**Note on evidence tag**: H-2 uses CODE-TRACE rather than POC-PASS because BondingV5 is an upgradeable contract that requires full AgentFactory and BondingConfig infrastructure to deploy end-to-end. The test mirrors the exact execution sequence of `_openTradingOnUniswap()` in a standalone `BondingV5Stub` contract (replicating lines 706-770 of BondingV5.sol). The revert propagation is mechanically proven: two sequential calls both revert with the factory error, and state (`trading=true`, `tradingOnUniswap=false`) is confirmed unchanged after each revert.

**Verdict**: CONFIRMED

**Final Severity**: Critical

**Root cause (confirmed)**:
`BondingV5._openTradingOnUniswap()` (lines 703-772) contains no try/catch around any of its external calls, including `agentFactory.executeBondingCurveApplicationSalt()` at line 748. If this call reverts:
1. The entire `_buy()` transaction reverts
2. `tokenRef.trading` stays `true`, `tokenRef.tradingOnUniswap` stays `false`
3. The graduation condition (`newReserveA <= gradThreshold`) still holds on the next buy
4. Every future buy triggers graduation again -> same revert -> permanent DoS
5. BondingV5 has no admin reset function (`setBondingConfig()` at line 857 is the only owner function — it cannot reset trading state)

### Suggested Fix
```diff
  // Line 748 in BondingV5._openTradingOnUniswap():
- address agentToken = agentFactory.executeBondingCurveApplicationSalt(
-     tokenRef.applicationId,
-     tokenRef.data.supply / 1 ether,
-     tokenBalance / 1 ether,
-     pairAddress,
-     keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress_))
- );
+ try agentFactory.executeBondingCurveApplicationSalt(
+     tokenRef.applicationId,
+     tokenRef.data.supply / 1 ether,
+     tokenBalance / 1 ether,
+     pairAddress,
+     keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress_))
+ ) returns (address agentToken_) {
+     tokenRef.agentToken = agentToken_;
+     emit Graduated(tokenAddress_, agentToken_);
+     tokenRef.trading = false;
+     tokenRef.tradingOnUniswap = true;
+ } catch (bytes memory reason) {
+     // Revert graduation state so admin can retry or cancel
+     // Restore pair assets (or add emergencyResetGraduation() admin function)
+     emit GraduationFailed(tokenAddress_, reason);
+     revert GraduationFailed();
+ }
```
Additionally, add an admin function:
```diff
+ function emergencyResetGraduation(address tokenAddress_) external onlyOwner {
+     BondingConfig.Token storage tokenRef = tokenInfo[tokenAddress_];
+     require(tokenRef.trading && !tokenRef.tradingOnUniswap, "Not in failed graduation state");
+     // Allow admin to set a new agentFactory or retry graduation
+     tokenRef.trading = false; // halt trading to prevent further DoS
+ }
```
**Fix scope**: Wrap graduation external calls in try/catch; add admin recovery function for failed graduation state.
**Verified**: NO (fix not mechanically re-run)

---

## CH-1 Verification

**Impact Premise**: If AgentFactory governance revokes `BONDING_ROLE` from BondingV5, ALL tokens that reach the graduation threshold become permanently stuck in a buy-DoS state — triggered by an external governance action with zero action required from BondingV5 admin.

**Compiled**: YES (attempts: 3)
**Result**: PASS
**Output**:
```
=== CH-1: BONDING_ROLE Revocation -> Permanent DoS ===
CH-1: CONFIRMED - BONDING_ROLE revocation by external governance triggers permanent DoS
CH-1: BondingV5 has no defense against this external role change
CH-1: [CODE-TRACE] Chain: EP-14 BONDING_ROLE revocation -> H-2 permanent buy() DoS
```

**Evidence Tag**: [CODE-TRACE]

**Verdict**: CONFIRMED

**Final Severity**: Critical (chain upgrade — external root cause eliminates any mitigation assumption about BondingV5 admin control)

**Root cause (confirmed)**:
This chain combines:
- **EP-14**: AgentFactory uses OpenZeppelin `AccessControl`. `DEFAULT_ADMIN_ROLE` can call `revokeRole(BONDING_ROLE, bondingV5Address)`. This is an external governance action outside BondingV5's control.
- **H-2**: Once BONDING_ROLE is revoked, every call to `agentFactory.executeBondingCurveApplicationSalt()` by BondingV5 reverts with an access control error. This triggers the H-2 permanent DoS for every token at graduation threshold.

The test confirms: two sequential graduation attempts both revert with the factory error, state remains unchanged (`trading=true`, `tradingOnUniswap=false`), and BondingV5 has no recovery path.

**Distinguishing factor from H-2**: H-2 requires a transient factory failure (configuration error, factory bug). CH-1 is triggered by a deliberate or accidental governance action that permanently bricks ALL in-flight tokens simultaneously. The blast radius is the entire BondingV5 token universe, not a single token.

### Suggested Fix
Same fix as H-2 (try/catch + admin recovery), PLUS:
```diff
+ // BondingV5: add agentFactory update function with timelock
+ function setAgentFactory(address agentFactory_) external onlyOwner {
+     require(agentFactory_ != address(0), "Zero address");
+     agentFactory = IAgentFactoryV7Minimal(agentFactory_);
+ }
```
This allows BondingV5 to point to a new AgentFactory if the current one revokes BONDING_ROLE.
**Verified**: NO (fix not mechanically re-run)

---

## CH-7 Verification

**Impact Premise**: Any agent token with a transfer tax > 0% automatically triggers the H-2 permanent buy-DoS at graduation — no attacker needed, pure protocol mechanics. The 10% tax causes `BondingV5._openTradingOnUniswap()` to receive less than `tokenBalance` but attempt to transfer the full `tokenBalance`, reverting.

**Compiled**: YES (attempts: 3)
**Result**: PASS
**Output**:
```
=== CH-7: Transfer Tax + Graduation DoS ===
Tax token real balance in pair: 405000000
VIRTUAL in pair: 42000
BondingV5Stub token balance (should be 0): 0
Token in pair (tokenBalance): 405000000
Would receive after 10% tax (90%): 364500000
Shortfall: 40500000
CH-7: [POC-PASS] Graduation reverts due to tax shortfall - Permanent DoS triggered
CH-7: CONFIRMED - Transfer tax causes automatic permanent graduation DoS
CH-7: No attacker needed - pure protocol mechanics with any taxed token
```

**Evidence Tag**: [POC-PASS]

**Verdict**: CONFIRMED

**Final Severity**: Critical

**Root cause (confirmed)**:
`BondingV5._openTradingOnUniswap()` captures `tokenBalance = pairContract.balance()` at line 719, then at line 721 calls `router.graduate(tokenAddress_)` which calls `pair.transferTo(BondingV5, tokenBalance)`. For a token with transfer tax, this transfer delivers only `tokenBalance * (1 - taxRate)` to BondingV5. Subsequently at line 746:
```solidity
IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance); // uses ORIGINAL tokenBalance
```
BondingV5 has `tokenBalance * 90%` but attempts to transfer `tokenBalance` (100%) -> arithmetic underflow/insufficient balance -> revert -> H-2 permanent DoS.

The PoC proved:
1. `BondingV5Stub` starts with 0 tokens (correct initial state)
2. After `graduate()`: receives 364.5M (90% of 405M in pair)
3. Attempting `transfer(token, 405M)` reverts (only has 364.5M)
4. State: `trading=true`, `tradingOnUniswap=false` — unchanged after revert
5. Second attempt: same revert (permanent DoS)

### Suggested Fix
```diff
  // BondingV5._openTradingOnUniswap() line 719
  uint256 assetBalance = pairContract.assetBalance();
- uint256 tokenBalance = pairContract.balance();
+ // Capture balance AFTER graduate() to account for transfer tax
  
  router.graduate(tokenAddress_);
  
+ // Line 746: use actual received balance, not pre-graduate tokenBalance
+ uint256 tokenBalance = IERC20(tokenAddress_).balanceOf(address(this));
  
  IERC20(router.assetToken()).safeTransfer(address(agentFactory), assetBalance);
  ...
  IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance); // now uses actual received amount
```
**Fix scope**: Capture `tokenBalance` AFTER `router.graduate()` to use the actual received balance (accounting for transfer tax), rather than the pre-graduate pair balance.
**Verified**: NO (fix not mechanically re-run)

---

## Summary

| Finding | Impact Premise | Compiled | Result | Evidence Tag | Verdict | Final Severity |
|---------|---------------|----------|--------|--------------|---------|----------------|
| H-1 | EXECUTOR_ROLE holder drains ALL user VIRTUAL from ANY pair | YES | PASS | [POC-PASS] | CONFIRMED | Critical |
| H-2 | Failed graduation -> permanent buy() DoS, no admin recovery | YES | PASS | [CODE-TRACE] | CONFIRMED | Critical |
| CH-1 | External BONDING_ROLE revocation -> H-2 DoS on all tokens | YES | PASS | [CODE-TRACE] | CONFIRMED | Critical |
| CH-7 | Transfer tax -> graduation revert -> H-2 permanent DoS | YES | PASS | [POC-PASS] | CONFIRMED | Critical |

**Test command**: `forge test --match-contract "TestH1|TestH2|TestCH1|TestCH7" -vv`
**Result**: 4 passed, 0 failed
