# Analysis: Storage Layout Safety + Event Correctness

**Agent**: B5  
**Scope**: contracts/launchpadv2/ (all 9 core contracts + BondingConfig)  
**Date**: 2026-04-02  

---

## Part 1: STORAGE LAYOUT SAFETY

### Step 1: Storage Surface Inventory

#### FRouterV2 Storage Layout (after OZ upgradeable base slots)

OZ base contracts (Initializable + AccessControlUpgradeable + ReentrancyGuardUpgradeable) occupy their own internal slots. After those, user-declared storage begins:

| Slot (relative) | Variable | Type | Notes |
|---|---|---|---|
| N+0 | `factory` | FFactoryV2 (address) | |
| N+1 | `assetToken` | address | |
| N+2 | `taxManager` | address | **DEPRECATED** - slot must be preserved |
| N+3 | `antiSniperTaxManager` | address | **DEPRECATED** - slot must be preserved |
| N+4 | `bondingV2` | IBondingV2ForRouter (address) | |
| (event defs between - no storage) | | | |
| N+5 | `bondingV4` | IBondingV4ForRouter (address) | Declared after event block |

#### FRouterV3 Storage Layout

| Slot (relative) | Variable | Type | Notes |
|---|---|---|---|
| N+0 | `factory` | FFactoryV3 (address) | |
| N+1 | `assetToken` | address | |
| N+2 | `bondingV5` | IBondingV5ForRouter (address) | |
| N+3 | `bondingConfig` | IBondingConfigForRouter (address) | |

#### BondingV2 Storage Layout

| Slot (relative) | Variable | Type |
|---|---|---|
| N+0 | `_feeTo` | address (private) |
| N+1 | `factory` | FFactoryV2 |
| N+2 | `router` | FRouterV2 |
| N+3 | `initialSupply` | uint256 |
| N+4 | `fee` | uint256 |
| (K is constant - no slot) | | |
| N+5 | `assetRate` | uint256 |
| N+6 | `gradThreshold` | uint256 |
| N+7 | `maxTx` | uint256 |
| N+8 | `agentFactory` | address |
| N+9 | `_deployParams` | DeployParams struct (2 slots: bytes32+address packed, uint32+padding, uint256) |
| N+11 | `tokenInfo` | mapping(address => Token) |
| N+12 | `tokenInfos` | address[] |
| N+13 | `launchParams` | LaunchParams struct (3 slots) |
| N+16 | (VirtualIdBase is constant) | |
| N+16 | `isProject60days` | mapping(address => bool) |
| N+17 | `project60daysLaunchFee` | uint256 |

#### BondingV3 Storage Layout

| Slot (relative) | Variable | Type |
|---|---|---|
| N+0 to N+15 | **Identical to BondingV2 through launchParams** | Same |
| (No isProject60days, no project60daysLaunchFee) | | |

#### BondingV4 Storage Layout

| Slot (relative) | Variable | Type |
|---|---|---|
| N+0 to N+15 | **Identical to BondingV2 through launchParams** | Same |
| N+16 | `isProjectXLaunch` | mapping(address => bool) |
| N+17 | `projectXLaunchFee` | uint256 |
| N+18 | `isAcpSkillLaunch` | mapping(address => bool) |
| N+19 | `acpSkillLaunchFee` | uint256 |
| N+20 | `isAcpSkillLauncher` | mapping(address => bool) |
| N+21 | `isXLauncher` | mapping(address => bool) |

#### BondingV5 Storage Layout

| Slot (relative) | Variable | Type |
|---|---|---|
| N+0 | `factory` | IFFactoryV2Minimal |
| N+1 | `router` | IFRouterV3Minimal |
| N+2 | `agentFactory` | IAgentFactoryV7Minimal |
| N+3 | `bondingConfig` | BondingConfig |
| N+4 | `tokenInfo` | mapping(address => BondingConfig.Token) |
| N+5 | `tokenInfos` | address[] |
| N+6 | `tokenLaunchParams` | mapping(address => BondingConfig.LaunchParams) |
| N+7 | `tokenGradThreshold` | mapping(address => uint256) |
| N+8 | `isFeeDelegation` | mapping(address => bool) |

#### BondingConfig Storage Layout

| Slot (relative) | Variable | Type |
|---|---|---|
| N+0 | `reserveSupplyParams` | ReserveSupplyParams struct (packed: 3x uint16 = 1 slot) |
| N+1 | `scheduledLaunchParams` | ScheduledLaunchParams struct (3x uint256 = 3 slots) |
| N+4 | `teamTokenReservedWallet` | address |
| N+5 | `isPrivilegedLauncher` | mapping(address => bool) |
| N+6 | `bondingCurveParams` | BondingCurveParams struct (2 slots) |
| N+8 | `deployParams` | DeployParams struct (~3 slots) |
| N+11 | `initialSupply` | uint256 |
| N+12 | `feeTo` | address |

#### FFactoryV2 / FFactoryV3 Storage Layout (identical)

| Slot (relative) | Variable | Type |
|---|---|---|
| N+0 | `_pair` | mapping(address => mapping(address => address)) |
| N+1 | `pairs` | address[] |
| N+2 | `router` | address |
| N+3 | `taxVault` | address |
| N+4 | `buyTax` | uint256 |
| N+5 | `sellTax` | uint256 |
| N+6 | `antiSniperBuyTaxStartValue` | uint256 |
| N+7 | `antiSniperTaxVault` | address |

---

### Findings

#### [SLS-1] MISSING `__gap` STORAGE RESERVATIONS IN ALL UPGRADEABLE CONTRACTS | MEDIUM

**Contracts**: BondingV2, BondingV3, BondingV4, BondingV5, FRouterV2, FRouterV3, FFactoryV2, FFactoryV3, BondingConfig  
**Location**: All 9 core upgradeable contracts

None of the 9 core upgradeable contracts declare a `uint256[N] private __gap` storage array. The OpenZeppelin upgradeable pattern recommends `__gap` to reserve storage slots so that future versions of a base contract (or the contract itself) can add new state variables without shifting the storage layout of derived contracts or subsequent upgrade implementations.

**Impact**: If any of these contracts are upgraded and new state variables are appended, the upgrade is safe **only if variables are strictly appended at the end**. However, without `__gap`, there is no formal reservation mechanism, and inserting variables in base contract upgrades (e.g., if OZ AccessControlUpgradeable adds internal state in a new version) could cause silent slot collisions.

**Risk**: Medium. The contracts are currently functional, but this is a systemic upgrade hygiene issue. Any future upgrade must be carefully slot-verified.

---

#### [SLS-2] FRouterV2 DEPRECATED FIELDS CORRECTLY PRESERVE SLOT ORDER | INFORMATIONAL (CONFIRMED SAFE)

**File**: `contracts/launchpadv2/FRouterV2.sol`, lines 40-42, 59

The deprecated `taxManager` (slot N+2) and `antiSniperTaxManager` (slot N+3) are declared in their original positions and preserved as `address` types. The subsequent fields `bondingV2` (slot N+4) and `bondingV4` (slot N+5) are correctly appended after the deprecated slots.

Note: `bondingV4` is declared after event definitions (lines 44-57), but event definitions do not consume storage slots, so `bondingV4` occupies slot N+5 as expected.

**Setters** `setTaxManager()` and `setAntiSniperTaxManager()` still exist and can write to these deprecated slots (lines 252-259). These are guarded by ADMIN_ROLE but serve no functional purpose since the router's buy/sell functions no longer use these values (commented out at lines 160-164 and 220-225). The setters are dead code but harmless.

**Status**: Slot preservation is correct. No collision.

---

#### [SLS-3] BondingV2, V3, V4 ARE INDEPENDENT DEPLOYMENTS WITH COMPATIBLE BASE LAYOUTS | INFORMATIONAL

**Files**: BondingV2.sol, BondingV3.sol, BondingV4.sol

All three contracts share identical storage layout from slots N+0 through N+15 (through `launchParams`). This means:

- BondingV2 extends the shared base with: `isProject60days` (N+16), `project60daysLaunchFee` (N+17)
- BondingV3 has NO additional variables beyond the shared base (ends at N+15)
- BondingV4 extends with: `isProjectXLaunch` (N+16), `projectXLaunchFee` (N+17), `isAcpSkillLaunch` (N+18), `acpSkillLaunchFee` (N+19), `isAcpSkillLauncher` (N+20), `isXLauncher` (N+21)

If in production BondingV3 was upgraded to BondingV4 behind the same proxy, the layout is compatible (V4 appends after V3's last slot). Similarly V2->V4 is compatible as V4 appends starting at slot N+16 which in V2 holds `isProject60days` - but in that case the mapping at slot N+16 would be reinterpreted (both are `mapping(address => bool)` so the slot base is the same, but they map different concepts). This is only a concern if V2 was actually upgraded to V4 in production on the same proxy.

**Status**: Safe as parallel deployments. If used as upgrades of each other, V2->V4 has a semantic conflict at slot N+16 (isProject60days vs isProjectXLaunch) though both are `mapping(address => bool)` so no data corruption, just semantic confusion.

---

#### [SLS-4] BondingV5 IS A CLEAN NEW LAYOUT - NOT UPGRADE-COMPATIBLE WITH V2/V3/V4 | INFORMATIONAL

**File**: BondingV5.sol

BondingV5 has a completely different storage layout starting from slot N+0. It does not start with `_feeTo`, `factory (FFactoryV2)`, etc. Instead it starts with `factory (IFFactoryV2Minimal)`, `router (IFRouterV3Minimal)`, `agentFactory`, `bondingConfig`.

**Impact**: BondingV5 CANNOT be deployed as an upgrade behind a V2/V3/V4 proxy without complete storage corruption. The task description states these are "parallel deployments, not upgrades of each other" - this is consistent with the code. BondingV5 is individually upgradeable behind its own proxy.

**Status**: Confirmed safe as new deployment. Would be CRITICAL if ever used as V4 upgrade.

---

#### [SLS-5] BondingConfig `_disableInitializers()` IN CONSTRUCTOR IS CORRECT | INFORMATIONAL (CONFIRMED SAFE)

**File**: `contracts/launchpadv2/BondingConfig.sol`, lines 127-129

```solidity
constructor() {
    _disableInitializers();
}
```

This correctly prevents the implementation contract from being initialized directly. The `initialize()` function uses the `initializer` modifier. Combined with `_disableInitializers()` in the constructor, reinitialization is blocked on both the implementation and the proxy (after first initialization).

All other upgradeable contracts (BondingV2-V5, FRouterV2, FRouterV3, FFactoryV2, FFactoryV3) also have `_disableInitializers()` in their constructors. This is correct.

**Status**: Safe.

---

#### [SLS-6] NO INLINE ASSEMBLY WITH sstore/sload IN CORE CONTRACTS | INFORMATIONAL

**Scope**: All 9 core contracts

Inline assembly exists only in `multicall3.sol` (lines 202, 258) and `MockUniswapV2Pair.sol` (line 58). The multicall3 assembly uses only `calldataload`, `mload`, `mstore`, and `revert` - no `sstore` or `sload`. No storage manipulation via assembly in any core contract.

**Status**: No assembly storage safety concerns.

---

#### [SLS-7] NO MEMORY vs STORAGE CONFUSION DETECTED | INFORMATIONAL

All struct operations in the core contracts use explicit `storage` references when modifying persistent state. Specifically:

- BondingV2-V5 `_preLaunch()`: `Token storage newToken = tokenInfo[token]` - correct storage reference
- BondingV2-V5 `cancelLaunch()`: `Token storage _token = tokenInfo[_tokenAddress]` - correct
- BondingV2-V5 `launch()`: `Token storage _token = tokenInfo[_tokenAddress]` - correct
- BondingV2-V5 `_openTradingOnUniswap()`: `Token storage _token = tokenInfo[tokenAddress]` - correct
- BondingConfig: Struct assignments use direct `=` to storage variables (e.g., `scheduledLaunchParams = params_`) which correctly copies from memory parameter to storage

Function parameters using `memory` for struct inputs (e.g., `DeployParams memory params_`) are correct since these are read-only inputs being copied to storage.

**Status**: No lost writes detected.

---

## Part 2: EVENT CORRECTNESS

### Step 1: Emit Inventory Cross-Check

40 emit statements confirmed across the codebase. 23 silent setters confirmed.

### Findings

#### [EVT-1] cancelLaunch() IN BondingV2 AND BondingV4 EMITS `initialPurchase: 0` (POST-ZEROING VALUE) | MEDIUM

**Files**: 
- `BondingV2.sol` lines 411-419
- `BondingV3.sol` lines 346-354
- `BondingV4.sol` lines 418-426

**Code pattern** (identical in V2, V3, V4):
```solidity
_token.initialPurchase = 0;  // Zero the storage value FIRST
_token.launchExecuted = true;

emit CancelledLaunch(
    _tokenAddress,
    _token.pair,
    tokenInfo[_tokenAddress].virtualId,
    _token.initialPurchase   // <-- Reads 0 from storage, NOT the original value
);
```

The event reads `_token.initialPurchase` AFTER it has been set to 0, so the emitted `initialPurchase` parameter is always 0.

**Contrast with BondingV5** (lines 486-496): V5 correctly captures the value BEFORE zeroing:
```solidity
uint256 initialPurchase = tokenRef.initialPurchase; // record real initialPurchase for event
tokenRef.initialPurchase = 0;
// ...
emit CancelledLaunch(tokenAddress_, tokenRef.pair, ..., initialPurchase); // Uses saved value
```

**Impact**: Off-chain indexers tracking CancelledLaunch events in BondingV2/V3/V4 see `initialPurchase=0` for every cancellation, making it impossible to determine how much was refunded. Note: BondingV2-V4 have `revert("Not implemented")` in their preLaunch functions, so no new tokens can be created through them. However, any tokens created before the revert was added are affected.

**Severity**: MEDIUM (data loss for off-chain monitoring; no on-chain fund impact since the transfer itself uses the correct pre-zero value).

---

#### [EVT-2] launch() EVENT CORRECTLY EMITS PRE-ZERO initialPurchase IN ALL VERSIONS | INFORMATIONAL (CONFIRMED SAFE)

**Files**: BondingV2.sol line 478, BondingV3.sol line 413, BondingV4.sol line 485, BondingV5.sol line 563

In all versions, `launch()` captures `initialPurchase` in a local variable BEFORE zeroing:
```solidity
uint256 initialPurchase = _token.initialPurchase;  // Save first
// ... _buy() ... _token.initialPurchase = 0;
emit Launched(..., initialPurchase, amountOut);     // Uses saved value
```

**Status**: Correct in all versions.

---

#### [EVT-3] GRADUATION EVENT EMITS PRE-GRADUATION assetBalance CORRECTLY | INFORMATIONAL (CONFIRMED SAFE)

**Files**: All Bonding versions, `_openTradingOnUniswap()`

The graduation flow:
1. `assetBalance = pair.assetBalance()` - captured before transfer
2. `tokenBalance = pair.balance()` - captured before transfer  
3. `router.graduate(tokenAddress)` - transfers assets OUT of pair
4. `IERC20(router.assetToken()).safeTransfer(agentFactory, assetBalance)` - uses captured value
5. `emit Graduated(tokenAddress_, agentToken)` - only emits token and agentToken addresses

The `Graduated` event does NOT emit balances at all (only token address and agentToken address), so there is no value accuracy concern. However, this means off-chain systems cannot determine graduation amounts from the event alone; they must parse internal transactions or pair balance changes.

**Status**: Correct but minimal. Consider adding assetBalance and tokenBalance to the event for better observability (enhancement, not a bug).

---

#### [EVT-4] buy/sell FUNCTIONS IN BondingV2-V5 EMIT NO EVENTS | LOW

**Files**: All Bonding versions, `buy()` and `sell()` functions

The permissionless `buy()` and `sell()` functions in all Bonding contracts emit no events. The FPairV2 `swap()` function emits a `Swap` event, but this is at the pair level and does not include the user address, the bonding contract context, or pre/post-tax amounts.

**Impact**: Off-chain indexers must reconstruct buy/sell activity from FPairV2 Swap events plus ERC20 Transfer events. This is workable but fragile, especially for:
- Distinguishing buy vs sell (must check direction)
- Attributing trades to users (must trace Transfer events)
- Calculating tax amounts (must compute difference between input and pair-received amount)

**Severity**: LOW. Standard for many DeFi protocols, but limits monitoring capability.

---

#### [EVT-5] BondingConfig.setScheduledLaunchParams() IS A SILENT SETTER | MEDIUM

**File**: `contracts/launchpadv2/BondingConfig.sol`, line 240-244

```solidity
function setScheduledLaunchParams(
    ScheduledLaunchParams memory params_
) external onlyOwner {
    scheduledLaunchParams = params_;
    // NO EVENT
}
```

This setter modifies `startTimeDelay`, `normalLaunchFee`, and `acfFee` with NO event emitted. These parameters directly affect:
- Whether a launch is classified as "scheduled" vs "immediate" (controls fee structure)
- The launch fee amount for all future launches

Notably, other BondingConfig setters DO emit events (setDeployParams, setCommonParams, setBondingCurveParams, setReserveSupplyParams, setTeamTokenReservedWallet, setPrivilegedLauncher). This appears to be an oversight.

**Severity**: MEDIUM. Fee changes and timing threshold changes are security-relevant and should be observable.

---

#### [EVT-6] ALL BondingV2-V4 ADMIN SETTERS ARE SILENT (14 SETTERS) | MEDIUM

**Files**: BondingV2.sol, BondingV3.sol, BondingV4.sol

The following 14 admin setters emit NO events:

| # | Contract | Function | Security-Critical Parameters Changed |
|---|----------|----------|-------------------------------------|
| 1 | BondingV2 | `setTokenParams()` | initialSupply, gradThreshold, maxTx, assetRate, fee, feeTo |
| 2 | BondingV2 | `setProject60daysLaunchFee()` | project60daysLaunchFee |
| 3 | BondingV2 | `setDeployParams()` | tbaSalt, tbaImplementation, daoVotingPeriod, daoThreshold |
| 4 | BondingV2 | `setLaunchParams()` | startTimeDelay, teamTokenReservedSupply, teamTokenReservedWallet |
| 5 | BondingV3 | `setTokenParams()` | Same as V2 |
| 6 | BondingV3 | `setDeployParams()` | Same as V2 |
| 7 | BondingV3 | `setLaunchParams()` | Same as V2 |
| 8 | BondingV4 | `setTokenParams()` | Same as V2 |
| 9 | BondingV4 | `setDeployParams()` | Same as V2 |
| 10 | BondingV4 | `setLaunchParams()` | Same as V2 |
| 11 | BondingV4 | `setProjectXLaunchFee()` | projectXLaunchFee |
| 12 | BondingV4 | `setAcpSkillLaunchFee()` | acpSkillLaunchFee |
| 13 | BondingV4 | `setAcpSkillLauncher()` | isAcpSkillLauncher mapping |
| 14 | BondingV4 | `setXLauncher()` | isXLauncher mapping |

**Most critical silent changes**:
- `setTokenParams()`: Can change `gradThreshold` (when tokens graduate), `fee` (launch fee), `feeTo` (fee recipient), `maxTx` (max transaction size), and `assetRate` (affects bonding curve shape). A malicious or compromised owner could redirect all fees to a new address with no on-chain trace.
- `setLaunchParams()`: Can change `teamTokenReservedWallet` silently, redirecting reserved tokens.

**Mitigating factor**: BondingV2-V4 have `revert("Not implemented")` in preLaunch, so no new tokens can be created. However, existing tokens from these contracts are still actively tradable and graduatable, so parameter changes (gradThreshold, fee) still affect them.

**Severity**: MEDIUM. The contracts are partially deprecated but still active for existing tokens.

---

#### [EVT-7] BondingV5.setBondingConfig() IS A SILENT SETTER | MEDIUM

**File**: `contracts/launchpadv2/BondingV5.sol`, lines 857-859

```solidity
function setBondingConfig(address bondingConfig_) public onlyOwner {
    bondingConfig = BondingConfig(bondingConfig_);
}
```

Changing the BondingConfig address redirects ALL configuration lookups (fee amounts, supply params, graduation thresholds, privileged launchers, deploy params). This is a high-impact change with no event emitted.

**Severity**: MEDIUM. This single setter can alter the entire economic model of BondingV5 by pointing to a different config contract.

---

#### [EVT-8] FFactoryV2 AND FFactoryV3 setTaxParams() ARE SILENT SETTERS | HIGH

**Files**: 
- `contracts/launchpadv2/FFactoryV2.sol`, lines 108-122
- `contracts/launchpadv2/FFactoryV3.sol`, lines 116-130

```solidity
function setTaxParams(
    address newVault_,
    uint256 buyTax_,
    uint256 sellTax_,
    uint256 antiSniperBuyTaxStartValue_,
    address antiSniperTaxVault_
) public onlyRole(ADMIN_ROLE) {
    taxVault = newVault_;
    buyTax = buyTax_;
    sellTax = sellTax_;
    antiSniperBuyTaxStartValue = antiSniperBuyTaxStartValue_;
    antiSniperTaxVault = antiSniperTaxVault_;
    // NO EVENT
}
```

This function can:
1. Redirect ALL buy/sell tax revenue to a new address (`taxVault`)
2. Change buy/sell tax rates (e.g., from 1% to 99%)
3. Change anti-sniper tax start value and vault

These are the most economically impactful parameters in the system and they can be changed silently by any ADMIN_ROLE holder.

**Severity**: HIGH. Tax parameter changes directly affect every trade. An admin could silently set `buyTax = 99` and `sellTax = 99`, extracting nearly all value from trades. Off-chain monitoring systems would have no event to trigger alerts.

---

#### [EVT-9] FFactoryV2 AND FFactoryV3 setRouter() ARE SILENT SETTERS | HIGH

**Files**:
- `contracts/launchpadv2/FFactoryV2.sol`, lines 124-126
- `contracts/launchpadv2/FFactoryV3.sol`, lines 132-134

```solidity
function setRouter(address router_) public onlyRole(ADMIN_ROLE) {
    router = router_;
    // NO EVENT
}
```

The router address is used by FPairV2 for the `onlyRouter` modifier, but the factory's `router` variable is not directly used for pair access control (pairs get router in constructor). However, new pairs created after a router change would use the new router. This could silently redirect all pair operations through a malicious router.

**Severity**: HIGH for new pairs created after the change. No event means no alert for monitoring.

---

#### [EVT-10] FRouterV2 setBondingV2(), setBondingV4(), setTaxManager(), setAntiSniperTaxManager() ARE SILENT | LOW-MEDIUM

**File**: `contracts/launchpadv2/FRouterV2.sol`, lines 252-278

Four ADMIN_ROLE setters with no events:
- `setTaxManager()` (deprecated but still writable)
- `setAntiSniperTaxManager()` (deprecated but still writable)
- `setBondingV2()` - changes which bonding contract is used for `isProject60days` checks (affects drain permissions)
- `setBondingV4()` - changes which bonding contract is used for `isProjectXLaunch` checks (affects anti-sniper timing)

**Severity**: LOW-MEDIUM. `setBondingV2` and `setBondingV4` are security-relevant since they control drain permission checks and anti-sniper behavior.

---

#### [EVT-11] FRouterV3 setBondingV5() IS A SILENT SETTER | MEDIUM

**File**: `contracts/launchpadv2/FRouterV3.sol`, lines 257-262

```solidity
function setBondingV5(address bondingV5_, address bondingConfig_) public onlyRole(ADMIN_ROLE) {
    bondingV5 = IBondingV5ForRouter(bondingV5_);
    bondingConfig = IBondingConfigForRouter(bondingConfig_);
    // NO EVENT
}
```

This changes both the BondingV5 reference (used for `isProject60days` drain checks and `tokenAntiSniperType` lookups) and the BondingConfig reference (used for anti-sniper duration calculations). A silent change here could:
- Bypass drain restrictions (pointing to a contract that returns `true` for `isProject60days`)
- Disable or extend anti-sniper protection

**Severity**: MEDIUM.

---

### Complete Silent Setter Summary

| # | Contract | Setter | Emits Event? | Security Impact |
|---|----------|--------|-------------|----------------|
| 1 | BondingV2 | setTokenParams | NO | HIGH - fee, feeTo, gradThreshold |
| 2 | BondingV2 | setProject60daysLaunchFee | NO | LOW |
| 3 | BondingV2 | setDeployParams | NO | LOW |
| 4 | BondingV2 | setLaunchParams | NO | MEDIUM - teamTokenReservedWallet |
| 5 | BondingV3 | setTokenParams | NO | HIGH - same as V2 |
| 6 | BondingV3 | setDeployParams | NO | LOW |
| 7 | BondingV3 | setLaunchParams | NO | MEDIUM - same as V2 |
| 8 | BondingV4 | setTokenParams | NO | HIGH - same as V2 |
| 9 | BondingV4 | setDeployParams | NO | LOW |
| 10 | BondingV4 | setLaunchParams | NO | MEDIUM - same as V2 |
| 11 | BondingV4 | setProjectXLaunchFee | NO | LOW |
| 12 | BondingV4 | setAcpSkillLaunchFee | NO | LOW |
| 13 | BondingV4 | setAcpSkillLauncher | NO | MEDIUM - authorization |
| 14 | BondingV4 | setXLauncher | NO | MEDIUM - authorization |
| 15 | BondingV5 | setBondingConfig | NO | HIGH - entire config redirect |
| 16 | BondingConfig | setScheduledLaunchParams | NO | MEDIUM - fee/timing |
| 17 | FFactoryV2 | setTaxParams | NO | HIGH - tax rates & vaults |
| 18 | FFactoryV2 | setRouter | NO | HIGH - new pair routing |
| 19 | FFactoryV3 | setTaxParams | NO | HIGH - tax rates & vaults |
| 20 | FFactoryV3 | setRouter | NO | HIGH - new pair routing |
| 21 | FRouterV2 | setTaxManager | NO | LOW (deprecated) |
| 22 | FRouterV2 | setAntiSniperTaxManager | NO | LOW (deprecated) |
| 23 | FRouterV2 | setBondingV2 | NO | MEDIUM - drain permission |
| 24 | FRouterV2 | setBondingV4 | NO | LOW-MEDIUM - anti-sniper |
| 25 | FRouterV3 | setBondingV5 | NO | MEDIUM - drain + anti-sniper |

Note: The recon identified 23 silent setters. The detailed count above yields 25 because FRouterV2 has 4 silent setters (setBondingV2, setBondingV4, setTaxManager, setAntiSniperTaxManager) that may have been counted differently in the initial recon.

---

## Summary of Findings

### Storage Layout Safety

| ID | Severity | Title |
|----|----------|-------|
| [SLS-1] | MEDIUM | Missing `__gap` storage reservations in all 9 upgradeable contracts |
| [SLS-2] | INFORMATIONAL | FRouterV2 deprecated fields correctly preserve slot order |
| [SLS-3] | INFORMATIONAL | BondingV2/V3/V4 compatible base layouts (as parallel deployments) |
| [SLS-4] | INFORMATIONAL | BondingV5 incompatible with V2-V4 (confirmed separate deployment) |
| [SLS-5] | INFORMATIONAL | All constructors correctly use `_disableInitializers()` |
| [SLS-6] | INFORMATIONAL | No assembly sstore/sload in core contracts |
| [SLS-7] | INFORMATIONAL | No memory vs storage confusion detected |

### Event Correctness

| ID | Severity | Title |
|----|----------|-------|
| [EVT-1] | MEDIUM | cancelLaunch() in BondingV2/V3/V4 emits initialPurchase=0 (post-zeroing) |
| [EVT-2] | INFORMATIONAL | launch() correctly emits pre-zero initialPurchase in all versions |
| [EVT-3] | INFORMATIONAL | Graduated event correct but minimal (no balance data) |
| [EVT-4] | LOW | buy/sell in BondingV2-V5 emit no events |
| [EVT-5] | MEDIUM | BondingConfig.setScheduledLaunchParams() is silent |
| [EVT-6] | MEDIUM | 14 BondingV2-V4 admin setters are silent |
| [EVT-7] | MEDIUM | BondingV5.setBondingConfig() is silent |
| [EVT-8] | HIGH | FFactoryV2/V3.setTaxParams() are silent (tax rates + vault redirect) |
| [EVT-9] | HIGH | FFactoryV2/V3.setRouter() are silent (routing redirect) |
| [EVT-10] | LOW-MEDIUM | FRouterV2 4 admin setters are silent |
| [EVT-11] | MEDIUM | FRouterV3.setBondingV5() is silent |

**Critical path**: [EVT-8] and [EVT-9] are the highest-impact findings. An ADMIN_ROLE holder on FFactoryV2 or FFactoryV3 can silently change tax rates to 99% or redirect tax revenue with no on-chain event trail for monitoring systems to detect.
