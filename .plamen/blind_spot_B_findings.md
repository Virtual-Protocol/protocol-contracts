# Blind Spot B Findings — Guards, Visibility, Inheritance

**Agent**: Blind Spot Scanner B
**Checks performed**: CHECK 3 (Admin Griefability), CHECK 4 (Permissionless Visibility), CHECK 5 (Inherited Capability), CHECK 5b (Override Safety)

---

## CHECK 3: Admin Function Griefability

**Targets enumerated (8)**:

| # | Admin Function | Contract | Preconditions | User-Manipulable? | Analyzed? | Existing Finding? |
|---|---------------|----------|---------------|-------------------|-----------|-------------------|
| 1 | `graduate(address)` | FRouterV2, FRouterV3 | `pair.assetBalance()`, `pair.balance()` | YES — via donations | DONE | EP-5, TF-1 (donation attack) |
| 2 | `launch(address)` | BondingV5 (NORMAL mode) | `!launchExecuted`, `block.timestamp >= pair.startTime()` | YES — anyone can front-run | DONE | No finding — front-running is benign (proceeds go to teamTokenReservedWallet) |
| 3 | `launch(address)` | BondingV5 (X/ACP/60d mode) | `isPrivilegedLauncher(msg.sender)` | NO — privileged only | DONE | AC-9 |
| 4 | `createPair(address,address,...)` | FFactoryV2, FFactoryV3 | `CREATOR_ROLE` | NO — role-gated | DONE | N/A |
| 5 | `setTaxStartTime(pairAddress,...)` | FRouterV2, FRouterV3 | `EXECUTOR_ROLE` | NO — role-gated | DONE | AC-5, TE-4 |
| 6 | `resetTime(address,uint256)` | FRouterV2, FRouterV3 | `EXECUTOR_ROLE`, `block.timestamp < startTime` | NO — role-gated | DONE | N/A |
| 7 | `drainPrivatePool(...)` | FRouterV2, FRouterV3 | `EXECUTOR_ROLE`, `isProject60days(token)` | NO — role-gated; isProject60days is set at preLaunch immutably | DONE | N/A |
| 8 | `drainUniV2Pool(...)` | FRouterV2, FRouterV3 | `EXECUTOR_ROLE`, `isProject60days(token)` | NO — role-gated | DONE | EP-7 |

**Coverage**: 8 enumerated, 8 analyzed. **No new admin griefability blind spots** beyond existing findings.

---

## CHECK 4: Permissionless Function Visibility Audit

**Targets enumerated (18 non-view public/external functions without access control)**:

| # | Function | Contract | Emits Events? | Modifies State? | Should Be Internal? | Analyzed? | Finding? |
|---|----------|----------|---------------|-----------------|---------------------|-----------|---------|
| 1 | `preLaunch(...)` | BondingV5 | YES | YES | NO — by design (permissionless token launch) | DONE | N/A |
| 2 | `preLaunchV2(...)` | BondingV5 | YES | YES | NO — by design | DONE | N/A |
| 3 | `cancelLaunch(address)` | BondingV2 | YES | YES (ERC-20 transfer, state zero) | NO | DONE | **BLIND-B1** |
| 4 | `cancelLaunch(address)` | BondingV3 | YES | YES (ERC-20 transfer, state zero) | NO | DONE | **BLIND-B1** |
| 5 | `cancelLaunch(address)` | BondingV4 | YES | YES (ERC-20 transfer, state zero) | NO | DONE | **BLIND-B1** |
| 6 | `cancelLaunch(address)` | BondingV5 | YES | YES (ERC-20 transfer, state zero) | NO | DONE | RS2-3 (V5 only) — V2/V3/V4 NOT covered |
| 7 | `launch(address)` | BondingV2 | YES | YES | NO | DONE | N/A (nonReentrant present) |
| 8 | `launch(address)` | BondingV3 | YES | YES | NO | DONE | N/A (nonReentrant present) |
| 9 | `launch(address)` | BondingV4 | YES | YES | NO | DONE | N/A (nonReentrant present) |
| 10 | `launch(address)` | BondingV5 | YES | YES | NO | DONE | N/A (nonReentrant present) |
| 11 | `buy(...)` | BondingV5 | NO | YES | NO | DONE | N/A |
| 12 | `sell(...)` | BondingV5 | NO | YES | NO | DONE | N/A |
| 13 | `getAmountsOut(...)` | FRouterV2, FRouterV3 | NO | NO (view) | N/A | DONE | N/A |
| 14 | `hasAntiSniperTax(address)` | FRouterV2, FRouterV3 | NO | NO (view — but reverts for non-V5 tokens in V3) | NO | DONE | MG-1/RS2-1 cover the revert |
| 15 | `getPair(...)` | FFactoryV2, FFactoryV3 | NO | NO (view) | N/A | DONE | N/A |
| 16 | `allPairsLength()` | FFactoryV2, FFactoryV3 | NO | NO (view) | N/A | DONE | N/A |
| 17 | `setBondingConfig(address)` | BondingV5 | NO | YES (config pointer swap) | NO | DONE | AC-6, EVT-7 |
| 18 | `getReserves()` | FPairV2 | NO | NO (view) | N/A | DONE | N/A |

**KEY FINDING from CHECK 4**: `cancelLaunch()` in BondingV2, BondingV3, BondingV4 lacks `nonReentrant`. It performs ERC-20 `safeTransfer` BEFORE zeroing `initialPurchase`. RS2-3 only covers BondingV5. **→ BLIND-B1**

**Coverage**: 18 enumerated, 18 analyzed.

---

## CHECK 5: Inherited Capability Completeness

**Targets enumerated (9 contracts)**:

| # | Contract | Inherited Bases | _disableInitializers()? | Emergency Pause? | renounceOwnership exposed? | Finding? |
|---|----------|----------------|------------------------|-----------------|---------------------------|---------|
| 1 | BondingV2 | Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable | YES (line 129) | NO | YES — OwnableUpgradeable exposes it | **BLIND-B2** |
| 2 | BondingV3 | Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable | YES | NO | YES | **BLIND-B2** |
| 3 | BondingV4 | Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable | YES | NO | YES | **BLIND-B2** |
| 4 | BondingV5 | Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable | YES (line 147) | NO | YES — `setBondingConfig()` bricked if owner renounces | **BLIND-B2** |
| 5 | BondingConfig | Initializable, OwnableUpgradeable | YES (line 128) | NO | YES — ALL admin setters bricked | **BLIND-B2** |
| 6 | FRouterV2 | Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable | YES (line 63) | NO | YES (DEFAULT_ADMIN_ROLE can grant any role; renounce doesn't affect AccessControl directly) | N/A — AC-10 covers admin role |
| 7 | FRouterV3 | Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable | YES (line 70) | NO | N/A — AccessControl, not Ownable | N/A |
| 8 | FFactoryV2 | Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable | YES (line 39) | NO | N/A — AccessControl | N/A |
| 9 | FFactoryV3 | Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable | YES (line 48) | NO | N/A — AccessControl | N/A |

**KEY FINDING from CHECK 5**: `OwnableUpgradeable.renounceOwnership()` is publicly callable on BondingV5 and BondingConfig. If the deployer accidentally (or maliciously) calls it, ALL onlyOwner functions are permanently locked — including `setBondingConfig()`, all BondingConfig parameter setters (`setDeployParams`, `setBondingCurveParams`, `setTeamTokenReservedWallet`, `setPrivilegedLauncher`, `setScheduledLaunchParams`, `setCommonParams`). No two-step ownership transfer is used. **→ BLIND-B2**

**_disableInitializers() verified**: SLS-5 is confirmed correct — all 9 constructors call it.

**Coverage**: 9 enumerated, 9 analyzed.

---

## CHECK 5b: Override Safety

**Analysis**: BondingV2, V3, V4, and V5 are PARALLEL independent deployments — they do NOT form an inheritance chain. Each is a standalone contract that re-implements the same pattern (Initializable + OwnableUpgradeable + ReentrancyGuardUpgradeable). There is no `is BondingV2` or `is BondingV3` relationship.

**FPairV2** has no `virtual` functions and no derived contracts.

**OpenZeppelin base virtual functions inherited**:
- `OwnableUpgradeable`: `renounceOwnership()` (virtual), `transferOwnership()` (virtual) — neither is overridden in BondingV5 or BondingConfig to add a two-step guard.
- `ReentrancyGuardUpgradeable`: No virtual functions exposed.
- `AccessControlUpgradeable`: `supportsInterface()` (virtual) — not overridden.

**No modifier dropping detected** between versions (no inheritance to drop from).

**KEY FINDING from CHECK 5b**: `OwnableUpgradeable.renounceOwnership()` is inherited but NOT overridden to revert (unlike many hardened deployments). This overlaps with BLIND-B2 above.

**No additional override safety issues beyond BLIND-B2.**

**Coverage**: 4 Bonding versions checked, FPairV2 checked, 3 OZ bases analyzed.

---

## Findings

---

## Finding [BLIND-B1]: cancelLaunch() CEI Violation Extends to BondingV2/V3/V4 — Missing nonReentrant

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no role) | ✗8(checked)
**Rules Applied**: [R4:✓, R5:✗(same contract, single entity per token), R6:✗(no role), R8:✗(single-step state), R10:✓, R11:✗(no external tokens beyond assetToken), R12:✗(no dangerous precondition created), R13:✗(not design-related), R14:✗(no aggregate variables), R15:✓, R16:✗(no oracle)]
**Depth Evidence**: [BOUNDARY:initialPurchase > 0 → ERC-20 safeTransfer fires before state zeroed], [TRACE:cancelLaunch() → safeTransfer(creator, initialPurchase) → [reentrancy callback] → cancelLaunch() again → safeTransfer fires again (initialPurchase still non-zero) → initialPurchase = 0 → launchExecuted = true]
**Severity**: Medium
**Location**: BondingV2.sol:387-420, BondingV3.sol:322-355, BondingV4.sol:394-427
**Description**: `cancelLaunch()` in BondingV2, BondingV3, and BondingV4 lacks the `nonReentrant` modifier and violates Checks-Effects-Interactions (CEI). The function calls `IERC20(router.assetToken()).safeTransfer(_token.creator, _token.initialPurchase)` BEFORE setting `_token.initialPurchase = 0` and `_token.launchExecuted = true`. If the assetToken has a hook (e.g., ERC-777, fee-on-transfer with callbacks, or a rebasing token with notify callbacks), the creator can re-enter `cancelLaunch()` and claim the `initialPurchase` a second time before the state update. RS2-3 covers the same pattern in BondingV5 but BondingV2/V3/V4 are independently deployed contracts sharing the same flaw.

```solidity
// BondingV3.sol:339-346 (identical pattern in V2 L404-411, V4 L411-418)
if (_token.initialPurchase > 0) {
    IERC20(router.assetToken()).safeTransfer(  // ← external call BEFORE state update
        _token.creator,
        _token.initialPurchase
    );
}
_token.initialPurchase = 0; // ← state update AFTER external call (CEI violated)
_token.launchExecuted = true;
```

**Impact**: If the assetToken used by BondingV2/V3/V4 supports transfer hooks or callbacks (e.g., ERC-777 `tokensReceived`, or a token with an `onTransfer` hook), a malicious creator can drain double their `initialPurchase` from the Bonding contract's balance. The Bonding contract holds all pre-launch deposits from all creators, so a successful double-claim extracts funds belonging to other creators or the protocol treasury.

### Postcondition Analysis
**Postconditions Created**: Double-drained initialPurchase reduces Bonding contract's assetToken balance
**Postcondition Types**: [STATE, BALANCE]
**Who Benefits**: The creator of a token in pre-launch state

---

## Finding [BLIND-B2]: OwnableUpgradeable.renounceOwnership() Unguarded on BondingV5 and BondingConfig — Permanent Admin Lock

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no role — it's owner not admin-role) | ✓8
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no semi-trusted role), R8:✓, R10:✓, R11:✗(no external tokens), R12:✓, R13:✓, R14:✗(no aggregate variables), R15:✗(no flash-loan-accessible state), R16:✗(no oracle)]
**Depth Evidence**: [BOUNDARY:owner calls renounceOwnership() → owner = address(0)], [TRACE:renounceOwnership() → owner = address(0) → ALL onlyOwner calls revert permanently → setBondingConfig/setTeamTokenReservedWallet/setPrivilegedLauncher/setDeployParams/setBondingCurveParams/setScheduledLaunchParams/setCommonParams all permanently locked]
**Severity**: Medium
**Location**: BondingV5.sol:857 (setBondingConfig onlyOwner), BondingConfig.sol:155-264 (all setters onlyOwner); inherited via OwnableUpgradeable
**Description**: Both `BondingV5` and `BondingConfig` inherit OpenZeppelin's `OwnableUpgradeable`, which exposes `renounceOwnership()` as a public function callable by the current owner. Neither contract overrides `renounceOwnership()` to revert. If the deployer/owner accidentally or maliciously calls `renounceOwnership()`, the owner is permanently set to `address(0)` with no recovery path.

This eliminates all administrative control over:
- **BondingV5**: `setBondingConfig()` — cannot swap the configuration contract
- **BondingConfig**: `setDeployParams()`, `setBondingCurveParams()`, `setReserveSupplyParams()`, `setCommonParams()`, `setTeamTokenReservedWallet()`, `setPrivilegedLauncher()`, `setScheduledLaunchParams()` — all permanently frozen

Neither contract implements two-step ownership transfer (unlike the `multicall3.sol` which does implement its own two-step pattern at line 350).

```solidity
// BondingConfig.sol: all critical setters use onlyOwner
function setTeamTokenReservedWallet(address wallet_) external onlyOwner { ... }
function setPrivilegedLauncher(address launcher_, bool allowed_) external onlyOwner { ... }
function setBondingCurveParams(BondingCurveParams memory params_) external onlyOwner { ... }
// OwnableUpgradeable exposes this with no override:
// function renounceOwnership() public virtual onlyOwner { _transferOwnership(address(0)); }
```

**Impact**: Permanent loss of protocol governance. No more authorized launchers can be added/removed, no graduation parameters can be updated, team token wallet cannot be changed, and no emergency configuration changes are possible. All future token launches use frozen parameters with no admin override.

### Postcondition Analysis
**Postconditions Created**: owner = address(0), all onlyOwner functions permanently locked
**Postcondition Types**: [STATE, ACCESS]
**Who Benefits**: No one (griefing/accidental); attacker who wants frozen/unresponsive protocol for other exploit chains

---

## Finding [BLIND-B3]: FRouterV3._calculateAntiSniperTax() Calls bondingV5.tokenAntiSniperType() Without bondingV5 Null-Check — DoS if bondingV5 Unset

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(no semi-trusted role in the direct call path) | ✗8(single-step)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous state created), R13:✗(not design), R14:✗(no aggregate vars), R15:✗(no flash loan), R16:✗(no oracle)]
**Depth Evidence**: [BOUNDARY:bondingV5 = address(0) → bondingV5.tokenAntiSniperType(token) → call to address(0) → EVM returns empty bytes → Solidity ABI decode returns uint8(0) → duration = bondingConfig.getAntiSniperDuration(0) = 0 → returns 0 tax], [TRACE:buy() called on FRouterV3 with bondingV5 unset → _calculateAntiSniperTax() → bondingV5.tokenAntiSniperType(token) → BUT bondingConfig.getAntiSniperDuration() also called → if bondingConfig also unset → NullPointerEquivalent revert]
**Severity**: Medium
**Location**: FRouterV3.sol:283-319 (`_calculateAntiSniperTax`), FRouterV3.sol:257-262 (`setBondingV5`)
**Description**: `FRouterV3._calculateAntiSniperTax()` is called during every `buy()` and `sell()` for non-initial-purchase transactions. It calls `bondingV5.tokenAntiSniperType(tokenAddress)` at line 293 and `bondingConfig.getAntiSniperDuration(antiSniperType)` at line 295 with NO null-check on either `bondingV5` or `bondingConfig` storage slots. These are set via `setBondingV5()` which is a separate post-initialize admin call.

If `setBondingV5()` has not been called yet (both addresses are `address(0)` from initialization), then:
1. A call to `bondingV5.tokenAntiSniperType(token)` at `address(0)` — in Solidity ^0.8.20, calling a function on `address(0)` when the variable is typed as an interface does NOT automatically revert at the call site. The call returns empty returndata, and if the return value `uint8` has no returndata, the ABI decoder will silently return `0`.
2. However, `bondingConfig.getAntiSniperDuration(0)` called on `address(0)` will ALSO return 0, giving `duration = 0 → return 0` (no tax).

More critically: if an admin calls `setBondingV5(bondingV5_, bondingConfig_)` with an INCORRECT bondingConfig address, the `getAntiSniperDuration()` may revert for all trades on that router permanently. Additionally, no event is emitted by `setBondingV5()` — already noted in EVT-11.

The deeper issue: `_calculateAntiSniperTax()` is in the hot path of every `buy()` transaction via FRouterV3. If `bondingV5` is set but `bondingConfig` is not (partial misconfiguration), ALL buys and sells via FRouterV3 will revert, creating a complete trading DoS.

```solidity
// FRouterV3.sol:291-295 — no null-check guards
uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress); // address(0) call = silent mismatch
uint256 duration = bondingConfig.getAntiSniperDuration(antiSniperType); // address(0) call = revert or 0
```

**Impact**: If `bondingV5` and `bondingConfig` are unset or misconfigured at deployment time, ALL trades through FRouterV3 silently apply zero anti-sniper tax (potentially defeating anti-sniper protection for ALL tokens) or revert entirely (trading DoS for all tokens on the router). This affects every token registered through BondingV5 + FRouterV3 stack simultaneously.

### Precondition Analysis (if PARTIAL or REFUTED)
N/A — CONFIRMED

### Postcondition Analysis
**Postconditions Created**: Anti-sniper tax bypassed OR complete trading DoS
**Postcondition Types**: [STATE, ACCESS]
**Who Benefits**: Snipers (if silent zero tax), no one (if DoS)

---

## Finding [BLIND-B4]: FPairV2.priceALast() / priceBLast() Divide by Zero After Pool Drain

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3 | ✗4(N/A — view function, no cross-entity) | ✗5(N/A)
**Rules Applied**: [R4:✗(evidence clear — deterministic divide by zero), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous state created), R13:✗(not design), R14:✗(no aggregate vars), R15:✗(no flash loan), R16:✗(no oracle)]
**Depth Evidence**: [BOUNDARY:reserve0 = 0 after drainPrivatePool → priceBLast() = reserve0 / reserve1 = 0/reserve1 = 0 (safe); priceALast() = reserve1 / reserve0 = reserve1 / 0 → REVERT], [TRACE:drainPrivatePool() → syncAfterDrain() → reserve0 = 0 → priceALast() called externally → division by zero revert]
**Severity**: Low
**Location**: FPairV2.sol:168-173
**Description**: `FPairV2` exposes two price view functions that perform integer division without zero-guard:

```solidity
function priceALast() public view returns (uint256) {
    return _pool.reserve1 / _pool.reserve0;  // ← revert if reserve0 == 0
}

function priceBLast() public view returns (uint256) {
    return _pool.reserve0 / _pool.reserve1;  // ← revert if reserve1 == 0
}
```

These functions are not in the `IFPairV2` interface and are not called by any other in-scope contract, but they are `public` and callable by integrators, monitoring tools, or off-chain indexers. After `drainPrivatePool()` is called (which sets reserves to 0 via `syncAfterDrain()`), calling `priceALast()` reverts with a division-by-zero panic. This makes the pair contract uninspectable after graduation/drain and could cause monitoring scripts or third-party integrations to malfunction.

**Impact**: Third-party indexers, dashboards, or monitoring tools calling `priceALast()` after pool drain will receive hard reverts instead of graceful zero/empty returns. Low severity as no in-scope protocol logic depends on these functions.

---

## Finding [BLIND-B5]: BondingV5.launch() for NORMAL Mode Has No Access Control — Permissionless Front-Running Sends Initial Purchase to Configurable Wallet

**Verdict**: PARTIAL
**Step Execution**: ✓1,2,3,4,5 | ✗6(no role involved) | ✓8
**Rules Applied**: [R4:✓, R5:✗(single entity per token), R6:✗(no role), R8:✓, R10:✓, R11:✗(no external tokens beyond assetToken), R12:✗(no dangerous state created), R13:✓, R14:✗(no aggregate vars), R15:✗, R16:✗]
**Depth Evidence**: [BOUNDARY:launch() called by ANY address for NORMAL mode → initial purchase executes → tokens sent to bondingConfig.teamTokenReservedWallet() (read fresh)], [TRACE:launch(token) → _buy(address(this), initialPurchase, ...) → tokens bought → safeTransfer to bondingConfig.teamTokenReservedWallet() (line 554-556) → launchExecuted = true]
**Severity**: Low
**Location**: BondingV5.sol:499-578 (`launch`)
**Description**: For NORMAL mode tokens (non-X_LAUNCH, non-ACP_SKILL, non-Project60days), `launch()` has no caller restriction — any address can call it. The function executes the creator's initial purchase using funds pre-deposited by the creator at `preLaunch()`, and sends the purchased agent tokens to `bondingConfig.teamTokenReservedWallet()` (a fresh read from the config contract, not the creator). 

The front-running scenario: a competitor (or MEV bot) front-runs the backend's `launch()` call. Result: the initial purchase executes correctly, tokens go to the intended wallet, and `launchExecuted` is set to true. The creator gets their token launched but has no control over timing. This is partially by design (the backend is supposed to orchestrate launch timing), but:

1. A front-runner can trigger `launch()` BEFORE the backend has had a chance to call it, potentially bypassing the backend's pre-launch setup (e.g., updating taxRecipient in AgentTax).
2. If `teamTokenReservedWallet` changes between `preLaunch()` and `launch()` (MG-4 covers this), the front-runner causes tokens to go to the NEW wallet rather than the intended one.

### Precondition Analysis (PARTIAL)
**Missing Precondition**: For MG-4 chain: `teamTokenReservedWallet` must have changed between preLaunch and launch
**Precondition Type**: STATE / TIMING
**Why This Blocks**: Without a wallet change, front-running is harmless — tokens go to the correct wallet, trading opens correctly

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|-----------|----------|---------------------|---------|----------|-------------------|--------------------|
| BLIND-B1 | BondingV2.sol:387-420, BondingV3.sol:322-355, BondingV4.sol:394-427 | cancelLaunch() transfers ERC-20 before zeroing initialPurchase with no nonReentrant guard in V2/V3/V4 | CONFIRMED | Medium | EXTERNAL_CALL (assetToken hook) | DOUBLE_WITHDRAWAL |
| BLIND-B2 | BondingV5.sol:857, BondingConfig.sol:155-264 | OwnableUpgradeable.renounceOwnership() unguarded; permanent loss of all onlyOwner admin control | CONFIRMED | Medium | OWNER_ACTION | PERMANENT_ADMIN_LOCK |
| BLIND-B3 | FRouterV3.sol:283-319 | bondingV5 and bondingConfig null/misconfiguration causes silent anti-sniper bypass or complete trading DoS on all FRouterV3 pairs | CONFIRMED | Medium | MISCONFIGURATION | BYPASS or DOS |
| BLIND-B4 | FPairV2.sol:168-173 | priceALast()/priceBLast() divide by zero when reserves are zero after drain | CONFIRMED | Low | NATURAL_OPERATION (drain) | VIEW_REVERT |
| BLIND-B5 | BondingV5.sol:499-578 | NORMAL mode launch() has no caller restriction; anyone can front-run to trigger initial purchase before backend orchestration | PARTIAL | Low | TIMING | ORDERING_DISRUPTION |
