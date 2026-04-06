# Constraint Variables

## BondingV2.sol
| Variable | Type | Value/Range | Setter | Enforced? |
|----------|------|-------------|--------|-----------|
| K | uint256 constant | 3,150,000,000,000 | None (constant) | N/A |
| fee | uint256 | Set in initialize and setTokenParams | setTokenParams (onlyOwner) | ⚠️ UNENFORCED - no max cap |
| assetRate | uint256 | Set in initialize and setTokenParams | setTokenParams (onlyOwner) | Partially - checked > 0 |
| gradThreshold | uint256 | Set in initialize and setTokenParams | setTokenParams (onlyOwner) | ⚠️ UNENFORCED - no min/max |
| maxTx | uint256 | Set in initialize and setTokenParams | setTokenParams (onlyOwner) | ⚠️ UNENFORCED - never checked in code |
| initialSupply | uint256 | Set in initialize and setTokenParams | setTokenParams (onlyOwner) | ⚠️ UNENFORCED - no min/max |
| project60daysLaunchFee | uint256 | 0 initially | setProject60daysLaunchFee (onlyOwner) | ⚠️ UNENFORCED - no max cap |
| startTimeDelay | uint256 | launchParams.startTimeDelay | setLaunchParams (onlyOwner) | ⚠️ UNENFORCED - can be set to 0 |
| teamTokenReservedSupply | uint256 | launchParams member | setLaunchParams (onlyOwner) | ⚠️ UNENFORCED - could exceed initialSupply |

## BondingV3.sol
Same as BondingV2 (minus project60daysLaunchFee).

## BondingV4.sol
Same as BondingV2 plus:
| Variable | Type | Value/Range | Setter | Enforced? |
|----------|------|-------------|--------|-----------|
| K | uint256 constant | 2,850,000,000,000 | None (constant) | N/A |
| projectXLaunchFee | uint256 | 0 initially | setProjectXLaunchFee (onlyOwner) | ⚠️ UNENFORCED |
| acpSkillLaunchFee | uint256 | 0 initially | setAcpSkillLaunchFee (onlyOwner) | ⚠️ UNENFORCED |

## BondingV5.sol
| Variable | Type | Value/Range | Setter | Enforced? |
|----------|------|-------------|--------|-----------|
| tokenGradThreshold[token] | uint256 | Calculated per-token | calculateGradThreshold() | Enforced via BondingConfig formula |

## BondingConfig.sol
| Variable | Type | Value/Range | Setter | Enforced? |
|----------|------|-------------|--------|-----------|
| initialSupply | uint256 | Set in initialize | setCommonParams (onlyOwner) | ⚠️ UNENFORCED - no min/max |
| feeTo | address | Set in initialize | setCommonParams (onlyOwner) | ⚠️ UNENFORCED - can be set to zero address |
| maxAirdropBips | uint16 | reserveSupplyParams member | setReserveSupplyParams (onlyOwner) | Enforced: <= 10000 |
| maxTotalReservedBips | uint16 | reserveSupplyParams member | setReserveSupplyParams (onlyOwner) | Enforced: <= 10000, >= maxAirdropBips + acfReservedBips |
| acfReservedBips | uint16 | reserveSupplyParams member | setReserveSupplyParams (onlyOwner) | Enforced: <= 10000 |
| fakeInitialVirtualLiq | uint256 | bondingCurveParams member | setBondingCurveParams (onlyOwner) | ⚠️ UNENFORCED - can be 0, causing division by zero |
| targetRealVirtual | uint256 | bondingCurveParams member | setBondingCurveParams (onlyOwner) | ⚠️ UNENFORCED - can be 0 |
| startTimeDelay | uint256 | scheduledLaunchParams member | setScheduledLaunchParams (onlyOwner) | ⚠️ UNENFORCED - can be 0 |
| normalLaunchFee | uint256 | scheduledLaunchParams member | setScheduledLaunchParams (onlyOwner) | ⚠️ UNENFORCED |
| acfFee | uint256 | scheduledLaunchParams member | setScheduledLaunchParams (onlyOwner) | ⚠️ UNENFORCED |

## FFactoryV2.sol / FFactoryV3.sol
| Variable | Type | Value/Range | Setter | Enforced? |
|----------|------|-------------|--------|-----------|
| buyTax | uint256 | Percentage (in %) | setTaxParams (ADMIN_ROLE) | ⚠️ UNENFORCED - no max cap (could be > 100) |
| sellTax | uint256 | Percentage (in %) | setTaxParams (ADMIN_ROLE) | ⚠️ UNENFORCED - no max cap |
| antiSniperBuyTaxStartValue | uint256 | Starting tax % | setTaxParams (ADMIN_ROLE) | ⚠️ UNENFORCED - no max cap |
| taxVault | address | Fee recipient | setTaxParams (ADMIN_ROLE) | Enforced: != address(0) |
| antiSniperTaxVault | address | Anti-sniper fee recipient | setTaxParams (ADMIN_ROLE) | ⚠️ UNENFORCED - can be zero |

## FRouterV2.sol / FRouterV3.sol
No constraint variables with setters (taxes read from factory).

## Critical Observations

1. **buyTax + antiSniperTax capped at 99 in router code** (FRouterV2:190, FRouterV3:195) - but buyTax itself has no cap in factory setTaxParams. If buyTax > 99, the antiSniperTax calculation could underflow.
2. **maxTx in BondingV2-V4 is set but never checked** - declared state variable with setter but no enforcement anywhere in buy/sell logic.
3. **fakeInitialVirtualLiq = 0 risk**: If set to 0 via setBondingCurveParams, `calculateGradThreshold()` returns 0 (division result), and `getFakeInitialVirtualLiq()` returns 0 which would be used as the initial liquidity in `addInitialLiquidity()`, causing `price = bondingCurveSupply / 0` (division by zero revert).
4. **teamTokenReservedSupply could exceed initialSupply**: In BondingV2-V4, `bondingCurveSupply = (initialSupply - teamTokenReservedSupply) * decimals` could underflow if teamTokenReservedSupply > initialSupply.
