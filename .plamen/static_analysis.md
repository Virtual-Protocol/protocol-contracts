# Static Analysis Report

SLITHER UNAVAILABLE - grep-based fallback

## TASK 8: Slither Detector Results (grep fallback)

### Reentrancy (`.call{value}` after state changes)

**multicall3.sol:255** — `aggregate3Value()` calls `calli.target.call{value: val}(calli.callData)` inside a loop after accumulating ETH. This is the standard Multicall3 pattern; however, no state is updated after the call, so reentrancy impact is limited to the batch itself.

**multicall3.sol:520** — `withdrawEth(address to, uint256 amount)`:
```
require(address(this).balance >= amount, "Multicall3: insufficient balance");
(bool success, ) = to.call{value: amount}("");
```
Pattern: balance check, then external call. No state variable updated before call. Low reentrancy risk but no return value check enforced (success is checked below via require).

**FPairV2.sol / FRouterV2.sol / FRouterV3.sol** — No `.call{value}` patterns found in core launchpad contracts. Token transfers use `IERC20.transfer()` / `safeTransfer()` patterns.

**VERDICT**: No clear reentrancy-eth vulnerabilities in in-scope bonding/router/factory contracts. multicall3 is a standard external utility.

---

### Divide-before-multiply

Potential patterns found (multiply then divide is actually fine; the risk is dividing first, losing precision, then multiplying):

**BondingV2.sol:325-326** (and same pattern in V3/V4):
```solidity
uint256 liquidity = (((((K * 10000) / assetRate) * 10000 ether) /
    bondingCurveSupply) * 1 ether) / 10000;
```
This chains division and multiplication. The inner `(K * 10000) / assetRate` divides before subsequent multiplications — potential precision loss if `K * 10000 < assetRate`. Needs further audit review.

**FRouterV3.sol:318**:
```solidity
return startTax * (duration - timeElapsed) / duration;
```
Multiplication before division — correct pattern.

**FRouterV2.sol:151** / **FRouterV3.sol:158**:
```solidity
uint256 txFee = (fee * amountOut) / 100;
```
Multiplication before division — correct pattern.

**VERDICT**: BondingV2/V3/V4 liquidity calculation uses chained div-mul that may cause precision loss. Flag for deeper review.

---

### Costly-loop (storage `.length` in loop condition)

**MockUniswapV2Router02.sol** (lines 130, 145, 159, 174, 189, 203, 242, 254):
```solidity
for (uint i = 1; i < path.length; i++)  // path is memory array — OK
```
`path` is a `memory` parameter, not storage. No costly-loop issue.

**multicall3.sol:419, 457, 505**:
```solidity
for (uint256 i = 0; i < tokens.length; i++)  // tokens is memory param — OK
```
`tokens` is a function parameter (memory). No costly-loop issue.

**MockAgentToken.sol:106, 147**:
```solidity
for (uint256 i = 0; i < _liquidityPools.length; i++)  // storage array
for (uint256 i = 0; i < _validCallerHashes.length; i++)  // storage array
```
Storage array length accessed in loop condition — costly-loop pattern. Mock contract, low severity.

**VERDICT**: No costly-loop in production launchpadv2 contracts. Storage loops only in mock.

---

### Calls-in-loop (external calls inside loops)

**multicall3.sol:255** — External call inside loop in `aggregate3Value()`. This is the core purpose of Multicall3 — intentional design.

No external calls inside loops found in BondingV2-V5, FRouterV2/V3, FFactoryV2/V3, or FPairV2.

**VERDICT**: No unintentional calls-in-loop in production contracts.

---

### Dead Code / Unused State

**BondingV2.sol:264** — `_preLaunch()` contains `revert("Not implemented")`. This function is called by the test suite but is intentionally stubbed out in V2, causing 21 test failures.

**FPairV2 Pool.lastUpdated field** — The `lastUpdated` field in the Pool struct is set (`pool.lastUpdated = block.timestamp`) but never read elsewhere. Potential dead storage field.

---

### Unused Struct Fields

**FPairV2.sol Pool struct**:
```solidity
struct Pool {
    uint256 reserve0;
    uint256 reserve1;
    uint256 k;
    uint256 lastUpdated;  // written but never read — potentially dead
}
```

**BondingV2/V3/V4 Token struct** — Profile struct appears defined (line 35) but usage patterns vary. Potential for unused fields across version upgrades.

**BondingConfig.sol ScheduledLaunchParams struct** — Contains `startTime` and `startTimeDelay` fields; confirm all are consumed downstream.

---

## Aderyn Static Analysis
[MCP farofino not available — skipped]

## Pattern Analysis
[MCP farofino not available — skipped]
