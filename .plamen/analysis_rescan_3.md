# Third-Pass Re-Scan Analysis (Breadth Re-Scan Agent #3)

**Scope:** Full codebase — all contracts in `contracts/launchpadv2/`
**Focus:** Least-obvious vulnerabilities; cross-cutting integer arithmetic, cross-version state, initialization races, EIP-170, unchecked blocks, degenerate pair paths, and graduation cross-contract confusion.

---

## [RS3-1] FRouterV3._calculateAntiSniperTax() — no null check for bondingV5; bricks all regular buys before setBondingV5() is called

**Severity:** High

**File:** `contracts/launchpadv2/FRouterV3.sol` lines 283–318

**Description:**

`FRouterV3._calculateAntiSniperTax()` calls `bondingV5.tokenAntiSniperType(tokenAddress)` at line 293 with no null-address guard:

```solidity
function _calculateAntiSniperTax(address pairAddress) private view returns (uint256) {
    // ...
    uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);  // line 293 — no null check!
    uint256 duration = bondingConfig.getAntiSniperDuration(antiSniperType);
```

`bondingV5` is set via `setBondingV5()` (admin-only). Before that call is executed, `bondingV5 == address(0)`. In Solidity 0.8.x, an external call to `address(0)` via an interface succeeds at the EVM level (CALL opcode returns success, 0 bytes), but the ABI decoder then attempts to decode a `uint8` from 0 bytes of return data and **reverts** with an ABI decode error. The result: every non-initial-purchase `buy()` call through FRouterV3 reverts until `setBondingV5()` is executed.

`BondingV5.tokenAntiSniperType()` also reverts with `InvalidTokenStatus` when called for tokens whose `creator == address(0)` (i.e., any non-BondingV5 token, or before registration). This means if the `bondingV5` reference in FRouterV3 becomes stale after a BondingV5 upgrade (without updating `FRouterV3.bondingV5`), all buys fail again.

**Contrast with FRouterV2:** `FRouterV2._calculateAntiSniperTax()` wraps the equivalent `bondingV4.isProjectXLaunch()` call in both a null check and a `try-catch`:
```solidity
// FRouterV2.sol lines 331–339
if (address(bondingV4) != address(0)) {
    try bondingV4.isProjectXLaunch(tokenAddress) returns (bool _isXLaunch) {
        isXLaunch = _isXLaunch;
    } catch { isXLaunch = false; }
}
```
FRouterV3 has **neither** the null guard nor the try-catch.

**Impact:** During the window between FRouterV3 deployment and `setBondingV5()` execution, all regular (non-initial-purchase) buys revert. After any BondingV5 upgrade that doesn't update the reference, the same window reopens. Since `_calculateAntiSniperTax` is also called from `hasAntiSniperTax()` which is called in `BondingV5._buy()` at the graduation check (line 666), the revert propagates and blocks graduation too.

**References:**
- `FRouterV3.sol:283–295` (`_calculateAntiSniperTax`)
- `FRouterV3.sol:192` (buy calls `_calculateAntiSniperTax` without null guard)
- `FRouterV3.sol:340` (`hasAntiSniperTax` wraps `_calculateAntiSniperTax` without null guard)
- `BondingV5.sol:666` (`router.hasAntiSniperTax(pairAddress)` called in `_buy()`)
- `FRouterV2.sol:331–339` (contrast — has null check and try-catch)

---

## [RS3-2] FFactoryV2/V3.setTaxParams() — no upper-bound on buyTax_ or sellTax_; admin can trigger uint256 underflow bricking all trades

**Severity:** High

**File:** `contracts/launchpadv2/FFactoryV2.sol` lines 108–122, `contracts/launchpadv2/FFactoryV3.sol` lines 116–130

**Description:**

`FFactoryV2.setTaxParams()` and `FFactoryV3.setTaxParams()` accept `buyTax_` and `sellTax_` as `uint256` with no upper-bound validation:

```solidity
function setTaxParams(
    address newVault_,
    uint256 buyTax_,       // No require(buyTax_ < 100) or similar
    uint256 sellTax_,      // No require(sellTax_ < 100) or similar
    uint256 antiSniperBuyTaxStartValue_,
    address antiSniperTaxVault_
) public onlyRole(ADMIN_ROLE) {
    require(newVault_ != address(0), "Zero addresses are not allowed.");
    taxVault = newVault_;
    buyTax = buyTax_;
    // ...
```

**Buy path — underflow in cap logic:** In `FRouterV2.buy()` and `FRouterV3.buy()`, if `normalTax >= 100`:

```solidity
// FRouterV3.sol:195
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax;  // UNDERFLOW: e.g., 99 - 100 reverts in Solidity 0.8.x
}
```

If `normalTax = 100`, the condition `100 + 0 > 99` is true and `99 - 100` causes a checked-arithmetic underflow panic, reverting the transaction. All subsequent buys on that router revert until `setTaxParams()` is called again. This affects **all tokens** on the router simultaneously — a protocol-wide DoS.

**Sell path — underflow in amount calculation:** In `FRouterV2.sell()` and `FRouterV3.sell()`, if `sellTax > 100`:

```solidity
// FRouterV3.sol:158–160
uint fee = factory.sellTax();
uint256 txFee = (fee * amountOut) / 100;  // if sellTax=200: txFee = 2*amountOut
uint256 amount = amountOut - txFee;       // UNDERFLOW -> revert
```

Setting `sellTax = 200` makes `txFee > amountOut`, causing a checked underflow and reverting all sells.

**Impact:** An admin (not owner) with `ADMIN_ROLE` on FFactoryV2 or FFactoryV3 can permanently halt all buys or sells for every token on the corresponding router by setting `buyTax >= 100` or `sellTax > 100`. This is an admin-key risk but with no technical backstop.

**References:**
- `FFactoryV2.sol:108–122` (`setTaxParams`, no buyTax upper bound)
- `FFactoryV3.sol:116–130` (`setTaxParams`, no buyTax upper bound)
- `FRouterV2.sol:190–191` (cap underflow: `99 - normalTax`)
- `FRouterV3.sol:195–196` (cap underflow: `99 - normalTax`)
- `FRouterV2.sol:150–153` (sell underflow: `amount = amountOut - txFee`)
- `FRouterV3.sol:158–160` (sell underflow: `amount = amountOut - txFee`)

---

## [RS3-3] Graduation DAO address is non-deterministic and frontrunner-controlled — msg.sender of graduating buyer determines DAO CREATE2 salt

**Severity:** Medium

**File:** `contracts/launchpadv2/BondingV5.sol` lines 748–756

**Description:**

In `BondingV5._openTradingOnUniswap()`, the salt passed to `executeBondingCurveApplicationSalt()` is:

```solidity
// BondingV5.sol:752–756
address agentToken = agentFactory.executeBondingCurveApplicationSalt(
    tokenRef.applicationId,
    tokenRef.data.supply / 1 ether,
    tokenBalance / 1 ether,
    pairAddress,
    keccak256(
        abi.encodePacked(msg.sender, block.timestamp, tokenAddress_)
    )
);
```

`msg.sender` here is the buyer whose purchase crossed the graduation threshold — an arbitrary third party, not the token creator. In `AgentFactoryV7._createNewDAO()`, this salt is used directly for `Clones.cloneDeterministic(daoImplementation, salt)`:

```solidity
// AgentFactoryV7.sol:316
instance = Clones.cloneDeterministic(daoImplementation, salt);
```

**Consequences:**

1. **Frontrunner controls DAO address:** A mempool observer who sees a transaction about to trigger graduation can front-run it with their own buy. Their `msg.sender` + current `block.timestamp` becomes the DAO creation salt, allowing them to pre-compute the DAO address and potentially influence where the governance contract is deployed (e.g., to a predictable address useful for griefing or integration exploits).

2. **Token creator has zero control over DAO address:** The creator cannot determine the DAO address for their own token; it depends entirely on who happens to trigger graduation at what block.

3. **Graduation DoS via DAO address collision:** If a contract already exists at the `Clones.cloneDeterministic` target address (from a prior deployment or CREATE2 collision), `cloneDeterministic` reverts. Since `block.timestamp` changes each second and `msg.sender` is different each call, there is no single bad salt — but this highlights the fragility of the unpredictable salt. A malicious actor who can influence `block.timestamp` on PoA networks or monitor the mempool can cause targeted graduation failure.

**Impact:** Governance structure manipulation; unpredictable DAO addresses make off-chain tooling and integration harder; opens a narrow frontrunning-based governance attack vector.

**References:**
- `BondingV5.sol:748–756` (`executeBondingCurveApplicationSalt` salt construction)
- `AgentFactoryV7.sol:309–329` (`_createNewDAO` using `Clones.cloneDeterministic(daoImplementation, salt)`)

---

## [RS3-4] AgentFactoryV7._createNewDAO — _existingAgents duplication check is dead code for DAOs

**Severity:** Low / Informational

**File:** `contracts/virtualPersona/AgentFactoryV7.sol` lines 315–319, 340–343

**Description:**

`_createNewAgentToken()` sets `_existingAgents[instance] = true` after creation (line 343). However, `_createNewDAO()` only **reads** `_existingAgents[instance]` (line 318) and never sets it to `true`:

```solidity
// AgentFactoryV7.sol:315–319 — _createNewDAO
function _createNewDAO(...) internal returns (address instance) {
    instance = Clones.cloneDeterministic(daoImplementation, salt);
    // here just to share _existingAgents mapping with agentToken and daoImplementation duplication checking
    if (_existingAgents[instance]) {   // This is ALWAYS false for DAOs
        revert AgentAlreadyExists();   // Dead code path
    }
    IAgentDAO(instance).initialize(...);
```

Since `_existingAgents` is only ever written for agent tokens (not DAOs), the check `if (_existingAgents[daoInstance])` is always `false`, and the `AgentAlreadyExists` revert is unreachable for DAO addresses. The intended duplication guard for DAOs is non-functional.

In practice, if `Clones.cloneDeterministic` targets an address that already has code (from any source), the EVM-level CREATE2 will revert before the `_existingAgents` check runs. But for addresses that don't have code, two different graduation events could potentially produce DAOs at the same address if given the same salt — and the `_existingAgents` guard would not catch it because DAOs are never registered there.

**Impact:** Logic error — the comment "to share _existingAgents mapping" is incorrect. DAO address deduplication is not enforced at the application level; only EVM-level CREATE2 constraints apply. Combined with RS3-3, this means that if graduation is triggered twice with the same salt (theoretically impossible with `block.timestamp` changing, but relevant in forked/test environments), the second would revert at the EVM level rather than the intended application-level guard.

**References:**
- `AgentFactoryV7.sol:315–319` (`_createNewDAO`, reads but never writes `_existingAgents`)
- `AgentFactoryV7.sol:338–343` (`_createNewAgentToken`, writes `_existingAgents[instance] = true`)

---

## [RS3-5] FRouterV3 upgrade coupling — stale bondingV5 reference after BondingV5 re-deployment silently bricks all trading

**Severity:** Medium

**File:** `contracts/launchpadv2/FRouterV3.sol` lines 257–261, 283–295

**Description:**

`FRouterV3.bondingV5` is set via `setBondingV5()` at deployment time. If `BondingV5` is upgraded to a new proxy implementation address (or a new contract is deployed), `FRouterV3.bondingV5` continues pointing to the old address. For any token that exists in the new BondingV5 but not the old one, `BondingV5.tokenAntiSniperType()` on the stale reference returns `InvalidTokenStatus` revert.

The call chain is:
```
BondingV5.buy() -> _buy() -> router.hasAntiSniperTax(pairAddress)
    -> FRouterV3._calculateAntiSniperTax()
        -> bondingV5.tokenAntiSniperType(tokenAddress)  // stale reference -> REVERT
```

This reverts inside `_buy()`, which means **no buy can succeed** for any token created on the new BondingV5. Similarly, `FRouterV3.drainPrivatePool()` and `drainUniV2Pool()` also call `bondingV5.isProject60days()` — these would silently return `false` for the old bondingV5 (since tokens are unknown to it), blocking all drain operations.

There is **no event emitted** or timelock on `setBondingV5()`, making the upgrade-then-update sequence non-atomic and invisible to on-chain monitors unless the admin immediately follows the upgrade with `setBondingV5()` in the same transaction (not possible since they are separate contract calls without a multicall wrapper).

**Impact:** Trading halt and drain operations silently break during any BondingV5 upgrade window. The gap between BondingV5 re-deployment and `FRouterV3.setBondingV5()` call leaves all new token buys reverting.

**Contrast with FRouterV2:** `FRouterV2._calculateAntiSniperTax()` wraps the bondingV4 call in `try-catch`, so a stale or missing reference degrades gracefully (defaults to non-X_LAUNCH behavior) rather than bricking all buys.

**References:**
- `FRouterV3.sol:257–261` (`setBondingV5`, no timelock/event-only minimal guard)
- `FRouterV3.sol:283–295` (`_calculateAntiSniperTax` — no graceful fallback for stale bondingV5)
- `FRouterV3.sol:371` (`drainPrivatePool` — has null check but not staleness check)
- `FRouterV2.sol:331–339` (contrast — try-catch wraps bondingV4 calls)

---

## Summary

| ID | Severity | Contract | Description |
|----|----------|----------|-------------|
| RS3-1 | High | FRouterV3.sol:293 | No null check for bondingV5 in _calculateAntiSniperTax; address(0) or stale ref bricks all buys |
| RS3-2 | High | FFactoryV2.sol:108–122, FFactoryV3.sol:116–130 | setTaxParams buyTax/sellTax unbounded; >=100 triggers uint256 underflow bricking all trades |
| RS3-3 | Medium | BondingV5.sol:752–756 | Graduation DAO salt includes msg.sender of graduating buyer — frontrunner controls DAO address |
| RS3-4 | Low | AgentFactoryV7.sol:318 | _createNewDAO _existingAgents check is dead code — DAOs never written to mapping |
| RS3-5 | Medium | FRouterV3.sol:283–295 | Stale bondingV5 reference after BondingV5 upgrade bricks all buys; no graceful fallback unlike FRouterV2 |
