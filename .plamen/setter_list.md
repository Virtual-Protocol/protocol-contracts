# Setter / Admin Functions

## BondingV2.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `setTokenParams(uint256, uint256, uint256, uint256, uint256, address)` | onlyOwner | newSupply, newGradThreshold, newMaxTx, newAssetRate, newFee, newFeeTo |
| `setProject60daysLaunchFee(uint256)` | onlyOwner | newProject60daysLaunchFee |
| `setDeployParams(DeployParams memory)` | onlyOwner | params (tbaSalt, tbaImplementation, daoVotingPeriod, daoThreshold) |
| `setLaunchParams(LaunchParams memory)` | onlyOwner | params (startTimeDelay, teamTokenReservedSupply, teamTokenReservedWallet) |

## BondingV3.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `setTokenParams(uint256, uint256, uint256, uint256, uint256, address)` | onlyOwner | Same as V2 |
| `setDeployParams(DeployParams memory)` | onlyOwner | Same as V2 |
| `setLaunchParams(LaunchParams memory)` | onlyOwner | Same as V2 |

## BondingV4.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `setTokenParams(uint256, uint256, uint256, uint256, uint256, address)` | onlyOwner | Same as V2 |
| `setDeployParams(DeployParams memory)` | onlyOwner | Same as V2 |
| `setLaunchParams(LaunchParams memory)` | onlyOwner | Same as V2 |
| `setProjectXLaunchFee(uint256)` | onlyOwner | newProjectXLaunchFee |
| `setAcpSkillLaunchFee(uint256)` | onlyOwner | newAcpSkillLaunchFee |
| `setAcpSkillLauncher(address, bool)` | onlyOwner | launcher, allowed |
| `setXLauncher(address, bool)` | onlyOwner | launcher, allowed |

## BondingV5.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `setBondingConfig(address)` | onlyOwner | bondingConfig_ |

## BondingConfig.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `setDeployParams(DeployParams memory)` | onlyOwner | params_ |
| `setCommonParams(uint256, address)` | onlyOwner | initialSupply_, feeTo_ |
| `setBondingCurveParams(BondingCurveParams memory)` | onlyOwner | params_ (fakeInitialVirtualLiq, targetRealVirtual) |
| `setScheduledLaunchParams(ScheduledLaunchParams memory)` | onlyOwner | params_ (startTimeDelay, normalLaunchFee, acfFee) |
| `setTeamTokenReservedWallet(address)` | onlyOwner | wallet_ |
| `setPrivilegedLauncher(address, bool)` | onlyOwner | launcher_, allowed_ |
| `setReserveSupplyParams(ReserveSupplyParams memory)` | onlyOwner | params_ (maxAirdropBips, maxTotalReservedBips, acfReservedBips) |

## FFactoryV2.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `createPair(address, address, uint256, uint256)` | CREATOR_ROLE | tokenA, tokenB, startTime, startTimeDelay |
| `setTaxParams(address, uint256, uint256, uint256, address)` | ADMIN_ROLE | newVault_, buyTax_, sellTax_, antiSniperBuyTaxStartValue_, antiSniperTaxVault_ |
| `setRouter(address)` | ADMIN_ROLE | router_ |

## FFactoryV3.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `createPair(address, address, uint256, uint256)` | CREATOR_ROLE | Same as V2 |
| `setTaxParams(address, uint256, uint256, uint256, address)` | ADMIN_ROLE | Same as V2 |
| `setRouter(address)` | ADMIN_ROLE | router_ |

## FRouterV2.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `addInitialLiquidity(address, uint256, uint256)` | EXECUTOR_ROLE | token_, amountToken_, amountAsset_ |
| `sell(uint256, address, address)` | EXECUTOR_ROLE | amountIn, tokenAddress, to |
| `buy(uint256, address, address, bool)` | EXECUTOR_ROLE | amountIn, tokenAddress, to, isInitialPurchase |
| `graduate(address)` | EXECUTOR_ROLE | tokenAddress |
| `approval(address, address, address, uint256)` | EXECUTOR_ROLE | pair, asset, spender, amount |
| `setTaxManager(address)` | ADMIN_ROLE | newManager |
| `setAntiSniperTaxManager(address)` | ADMIN_ROLE | newManager |
| `setBondingV2(address)` | ADMIN_ROLE | bondingV2_ |
| `setBondingV4(address)` | ADMIN_ROLE | bondingV4_ |
| `resetTime(address, uint256)` | EXECUTOR_ROLE | tokenAddress, newStartTime |
| `setTaxStartTime(address, uint256)` | EXECUTOR_ROLE | pairAddress, _taxStartTime |
| `drainPrivatePool(address, address)` | EXECUTOR_ROLE | tokenAddress, recipient |
| `drainUniV2Pool(address, address, address, uint256)` | EXECUTOR_ROLE | agentToken, veToken, recipient, deadline |

## FRouterV3.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `addInitialLiquidity(address, uint256, uint256)` | EXECUTOR_ROLE | Same as V2 |
| `sell(uint256, address, address)` | EXECUTOR_ROLE | Same as V2 |
| `buy(uint256, address, address, bool)` | EXECUTOR_ROLE | Same as V2 |
| `graduate(address)` | EXECUTOR_ROLE | Same as V2 |
| `approval(address, address, address, uint256)` | EXECUTOR_ROLE | Same as V2 |
| `setBondingV5(address, address)` | ADMIN_ROLE | bondingV5_, bondingConfig_ |
| `resetTime(address, uint256)` | EXECUTOR_ROLE | Same as V2 |
| `setTaxStartTime(address, uint256)` | EXECUTOR_ROLE | Same as V2 |
| `drainPrivatePool(address, address)` | EXECUTOR_ROLE | Same as V2 |
| `drainUniV2Pool(address, address, address, uint256)` | EXECUTOR_ROLE | Same as V2 |

## multicall3.sol
| Function | Access Control | Parameters |
|----------|---------------|------------|
| `transferOwnership(address)` | onlyOwner | newOwner |
| `grantAdmin(address)` | onlyOwner | admin |
| `revokeAdmin(address)` | onlyOwner | admin |
| `approveToken(address, address, uint256)` | onlyOwnerOrAdmin | token, spender, amount |
| `batchApproveTokens(address[], address[], uint256[])` | onlyOwnerOrAdmin | tokens, spenders, amounts |
| `transferToken(address, address, uint256)` | onlyOwner | token, to, amount |
| `batchTransferTokens(address[], address[], uint256[])` | onlyOwnerOrAdmin | tokens, recipients, amounts |
| `withdrawERC20Token(address, address, uint256)` | onlyOwner | token, to, amount |
| `batchWithdrawERC20Tokens(address[], address[], uint256[])` | onlyOwnerOrAdmin | tokens, recipients, amounts |
| `withdrawETH(address, uint256)` | onlyOwner | to, amount |
| `aggregate(Call[])` | onlyOwnerOrAdmin | calls |
| `tryAggregate(bool, Call[])` | onlyOwnerOrAdmin | requireSuccess, calls |
| `aggregate3(Call3[])` | onlyOwnerOrAdmin | calls |
| `aggregate3Value(Call3Value[])` | onlyOwnerOrAdmin | calls |
| `blockAndAggregate(Call[])` | onlyOwnerOrAdmin | calls |
| `tryBlockAndAggregate(bool, Call[])` | onlyOwnerOrAdmin | calls |

---

## Permissionless State-Modifiers

| Function | Contract | Visibility | State Modified | Events Emitted |
|----------|----------|-----------|----------------|----------------|
| `preLaunch(...)` | BondingV2 | public | tokenInfo, tokenInfos (but reverts "Not implemented") | PreLaunched (unreachable) |
| `preLaunchProject60days(...)` | BondingV2 | public | same as above (but reverts) | PreLaunched (unreachable) |
| `preLaunch(...)` | BondingV3 | public | same (but reverts) | PreLaunched (unreachable) |
| `preLaunch(...)` | BondingV4 | public | same (but reverts) | PreLaunched (unreachable) |
| `preLaunch(...)` | BondingV5 | public | tokenInfo, tokenInfos, tokenLaunchParams, tokenGradThreshold, isFeeDelegation | PreLaunched |
| `preLaunchV2(...)` | BondingV5 | public | same as preLaunch | PreLaunched |
| `cancelLaunch(address)` | BondingV2-V5 | public | tokenInfo (initialPurchase=0, launchExecuted=true) | CancelledLaunch |
| `launch(address)` | BondingV2-V5 | public | tokenInfo (launchExecuted=true, initialPurchase=0) | Launched |
| `buy(uint256, address, uint256, uint256)` | BondingV2-V5 | public payable | tokenInfo.data.lastUpdated, may trigger graduation | None directly (graduation emits Graduated) |
| `sell(uint256, address, uint256, uint256)` | BondingV2-V5 | public | tokenInfo.data.lastUpdated | None |

**Note**: buy() and sell() in BondingV2-V5 are permissionless but delegate to router which requires EXECUTOR_ROLE. The Bonding contract must have EXECUTOR_ROLE on the router.

---

## Setter x Emit Cross-Reference

| Setter Function | Contract | Emits Event? | Event Name | Missing? |
|----------------|----------|-------------|------------|----------|
| setTokenParams | BondingV2 | NO | - | ⚠️ SILENT SETTER |
| setProject60daysLaunchFee | BondingV2 | NO | - | ⚠️ SILENT SETTER |
| setDeployParams | BondingV2 | NO | - | ⚠️ SILENT SETTER |
| setLaunchParams | BondingV2 | NO | - | ⚠️ SILENT SETTER |
| setTokenParams | BondingV3 | NO | - | ⚠️ SILENT SETTER |
| setDeployParams | BondingV3 | NO | - | ⚠️ SILENT SETTER |
| setLaunchParams | BondingV3 | NO | - | ⚠️ SILENT SETTER |
| setTokenParams | BondingV4 | NO | - | ⚠️ SILENT SETTER |
| setDeployParams | BondingV4 | NO | - | ⚠️ SILENT SETTER |
| setLaunchParams | BondingV4 | NO | - | ⚠️ SILENT SETTER |
| setProjectXLaunchFee | BondingV4 | NO | - | ⚠️ SILENT SETTER |
| setAcpSkillLaunchFee | BondingV4 | NO | - | ⚠️ SILENT SETTER |
| setAcpSkillLauncher | BondingV4 | NO | - | ⚠️ SILENT SETTER |
| setXLauncher | BondingV4 | NO | - | ⚠️ SILENT SETTER |
| setBondingConfig | BondingV5 | NO | - | ⚠️ SILENT SETTER |
| setDeployParams | BondingConfig | YES | DeployParamsUpdated | OK |
| setCommonParams | BondingConfig | YES | CommonParamsUpdated | OK |
| setBondingCurveParams | BondingConfig | YES | BondingCurveParamsUpdated | OK |
| setScheduledLaunchParams | BondingConfig | NO | - | ⚠️ SILENT SETTER |
| setTeamTokenReservedWallet | BondingConfig | YES | TeamTokenReservedWalletUpdated | OK |
| setPrivilegedLauncher | BondingConfig | YES | PrivilegedLauncherUpdated | OK |
| setReserveSupplyParams | BondingConfig | YES | ReserveSupplyParamsUpdated | OK |
| setTaxParams | FFactoryV2 | NO | - | ⚠️ SILENT SETTER |
| setRouter | FFactoryV2 | NO | - | ⚠️ SILENT SETTER |
| setTaxParams | FFactoryV3 | NO | - | ⚠️ SILENT SETTER |
| setRouter | FFactoryV3 | NO | - | ⚠️ SILENT SETTER |
| setTaxManager | FRouterV2 | NO | - | ⚠️ SILENT SETTER |
| setAntiSniperTaxManager | FRouterV2 | NO | - | ⚠️ SILENT SETTER |
| setBondingV2 | FRouterV2 | NO | - | ⚠️ SILENT SETTER |
| setBondingV4 | FRouterV2 | NO | - | ⚠️ SILENT SETTER |
| setBondingV5 | FRouterV3 | NO | - | ⚠️ SILENT SETTER |

**Summary**: 23 SILENT SETTERS detected across the codebase. BondingConfig is the best-behaved contract with events on most setters. BondingV2-V4 and FFactory/FRouter contracts emit NO events for admin parameter changes.
