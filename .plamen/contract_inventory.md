# Contract Inventory

## Line Counts & Scope

| # | Contract | Lines | Scope | Purpose |
|---|----------|-------|-------|---------|
| 1 | BondingV2.sol | 678 | IN_SCOPE | Bonding curve v2 - token preLaunch/launch/buy/sell/graduation (pump.fun fork). Has `revert("Not implemented")` in preLaunch. |
| 2 | BondingV3.sol | 613 | IN_SCOPE | Bonding curve v3 - same as V2 with different K constant and VirtualIdBase. Has `revert("Not implemented")` in preLaunch. |
| 3 | BondingV4.sol | 685 | IN_SCOPE | Bonding curve v4 - adds X_LAUNCH and ACP_SKILL launch modes with authorized launchers. Has `revert("Not implemented")` in preLaunch. |
| 4 | BondingV5.sol | 860 | IN_SCOPE | Bonding curve v5 - latest version. Configurable launch params via BondingConfig, per-token gradThreshold, anti-sniper types, scheduled/immediate launch, fee delegation. Active preLaunch (no revert). |
| 5 | BondingConfig.sol | 364 | IN_SCOPE | Configuration contract for BondingV5. Stores deploy params, bonding curve params, reserve supply params, scheduled launch params, privileged launchers. |
| 6 | FPairV2.sol | 207 | IN_SCOPE | AMM pair contract - holds reserves (virtual + real), handles swap/mint/transferTo/transferAsset/syncAfterDrain. Router-only access. |
| 7 | IFPairV2.sol | 43 | IN_SCOPE | Interface for FPairV2. |
| 8 | FFactoryV2.sol | 127 | IN_SCOPE | Pair factory for BondingV2/V3/V4. Creates FPairV2 instances. Role-based access (ADMIN_ROLE, CREATOR_ROLE). Stores tax params. |
| 9 | FFactoryV3.sol | 135 | IN_SCOPE | Pair factory for BondingV5. Identical to FFactoryV2 but deployed separately for version separation. |
| 10 | FRouterV2.sol | 491 | IN_SCOPE | Router for BondingV2/V3/V4. Handles buy/sell/graduate/drain operations with anti-sniper tax. EXECUTOR_ROLE gated. |
| 11 | FRouterV3.sol | 477 | IN_SCOPE | Router for BondingV5. Same as FRouterV2 but uses FFactoryV3, BondingV5, and deposits tax via IAgentTaxForRouter. |
| 12 | multicall3.sol | 529 | IN_SCOPE | Multicall utility - batch calls, token approvals/transfers, ETH withdrawals. Owner/admin gated. |
| 13 | MockUniswapV2Factory.sol | 67 | REFERENCE_ONLY | Mock Uniswap V2 factory for testing. |
| 14 | MockUniswapV2Pair.sol | 410 | REFERENCE_ONLY | Mock Uniswap V2 pair for testing. |
| 15 | MockUniswapV2Router02.sol | 315 | REFERENCE_ONLY | Mock Uniswap V2 router for testing. |
| 16 | MockAgentDAO.sol | 84 | REFERENCE_ONLY | Mock Agent DAO for testing. |
| 17 | MockAgentToken.sol | 240 | REFERENCE_ONLY | Mock Agent Token (ERC20) for testing. |
| 18 | MockAgentVeToken.sol | 265 | REFERENCE_ONLY | Mock Agent VeToken for testing. |
| 19 | MockERC20Decimals.sol | 28 | REFERENCE_ONLY | Mock ERC20 with configurable decimals. |
| 20 | MockERC6551Registry.sol | 100 | REFERENCE_ONLY | Mock ERC6551 Registry for testing. |

**Total in-scope lines**: 4,609 (12 contracts)
**Total reference-only lines**: 2,109 (8 contracts)
**Grand total**: 6,718 lines

## Inheritance Chain Analysis

### In-Scope Contracts

| Contract | Inherits From | Parent Type |
|----------|--------------|-------------|
| BondingV2 | Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable | OpenZeppelin upgradeable |
| BondingV3 | Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable | OpenZeppelin upgradeable |
| BondingV4 | Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable | OpenZeppelin upgradeable |
| BondingV5 | Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable | OpenZeppelin upgradeable |
| BondingConfig | Initializable, OwnableUpgradeable | OpenZeppelin upgradeable |
| FPairV2 | IFPairV2, ReentrancyGuard | Interface + OpenZeppelin non-upgradeable |
| FFactoryV2 | Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable | OpenZeppelin upgradeable |
| FFactoryV3 | Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable | OpenZeppelin upgradeable |
| FRouterV2 | Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable | OpenZeppelin upgradeable |
| FRouterV3 | Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable | OpenZeppelin upgradeable |
| Multicall3 | (none) | Standalone |
| IFPairV2 | (none) | Interface |

### Dependency Tree

```
OpenZeppelin (out-of-scope parents):
  Initializable
    -> BondingV2, BondingV3, BondingV4, BondingV5, BondingConfig, FFactoryV2, FFactoryV3, FRouterV2, FRouterV3
  OwnableUpgradeable
    -> BondingV2, BondingV3, BondingV4, BondingV5, BondingConfig
  AccessControlUpgradeable
    -> FFactoryV2, FFactoryV3, FRouterV2, FRouterV3
  ReentrancyGuardUpgradeable
    -> BondingV2, BondingV3, BondingV4, BondingV5, FFactoryV2, FFactoryV3, FRouterV2, FRouterV3
  ReentrancyGuard
    -> FPairV2
```

### PARENT_CONDITIONAL_OVERRIDE Analysis

All inherited parents are standard OpenZeppelin contracts. No custom virtual function overrides detected in any parent contract. The `initializer` modifier from `Initializable` is used correctly by all upgradeable contracts. No PARENT_CONDITIONAL_OVERRIDE flags needed.

**Key observation**: BondingV2-V5 do NOT inherit from each other -- they are parallel implementations with copy-pasted code. This means bugs in one version may or may not exist in others, requiring individual analysis of each.

### Relationship Between Versions

```
BondingV2 (K=3.15T, VirtualIdBase=20B) -- uses FFactoryV2/FRouterV2
BondingV3 (K=3.15T, VirtualIdBase=30B) -- uses FFactoryV2/FRouterV2
BondingV4 (K=2.85T, VirtualIdBase=40B) -- uses FFactoryV2/FRouterV2, adds launch modes
BondingV5 (VirtualIdBase=50B) -- uses FFactoryV3/FRouterV3/BondingConfig, configurable params
```

## Fork Ancestry

All Bonding contracts are modified from: `https://github.com/sourlodine/Pump.fun-Smart-Contract/blob/main/contracts/PumpFun.sol`

**[ELEVATE:FORK_ANCESTRY:Pump.fun]**
