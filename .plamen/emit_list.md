# Emit Statements

## BondingConfig.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 157 | setDeployParams() | `emit DeployParamsUpdated(params_)` |
| 171 | setCommonParams() | `emit CommonParamsUpdated(initialSupply_, feeTo_)` |
| 182 | setBondingCurveParams() | `emit BondingCurveParamsUpdated(params_)` |
| 252 | setTeamTokenReservedWallet() | `emit TeamTokenReservedWalletUpdated(wallet_)` |
| 263 | setPrivilegedLauncher() | `emit PrivilegedLauncherUpdated(launcher_, allowed_)` |
| 287 | setReserveSupplyParams() | `emit ReserveSupplyParamsUpdated(params_)` |

## BondingV2.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 377 | _preLaunch() | `emit PreLaunched(token, _pair, virtualId, initialPurchase)` |
| 414 | cancelLaunch() | `emit CancelledLaunch(tokenAddress, pair, virtualId, initialPurchase)` |
| 478 | launch() | `emit Launched(tokenAddress, pair, virtualId, initialPurchase, amountOut)` |
| 674 | _openTradingOnUniswap() | `emit Graduated(tokenAddress, agentToken)` |

## BondingV3.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 312 | preLaunch() | `emit PreLaunched(token, _pair, virtualId, initialPurchase)` |
| 349 | cancelLaunch() | `emit CancelledLaunch(tokenAddress, pair, virtualId, initialPurchase)` |
| 413 | launch() | `emit Launched(tokenAddress, pair, virtualId, initialPurchase, amountOut)` |
| 609 | _openTradingOnUniswap() | `emit Graduated(tokenAddress, agentToken)` |

## BondingV4.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 384 | preLaunch() | `emit PreLaunched(token, _pair, virtualId, initialPurchase)` |
| 421 | cancelLaunch() | `emit CancelledLaunch(tokenAddress, pair, virtualId, initialPurchase)` |
| 485 | launch() | `emit Launched(tokenAddress, pair, virtualId, initialPurchase, amountOut)` |
| 681 | _openTradingOnUniswap() | `emit Graduated(tokenAddress, agentToken)` |

## BondingV5.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 451 | _preLaunch() | `emit PreLaunched(token, pair, virtualId, initialPurchase, launchParams)` |
| 491 | cancelLaunch() | `emit CancelledLaunch(tokenAddress, pair, virtualId, initialPurchase)` |
| 563 | launch() | `emit Launched(tokenAddress, pair, virtualId, initialPurchase, amountOut, launchParams)` |
| 769 | _openTradingOnUniswap() | `emit Graduated(tokenAddress_, agentToken)` |

## FPairV2.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 81 | mint() | `emit Mint(reserve0, reserve1)` |
| 104 | swap() | `emit Swap(amount0In, amount0Out, amount1In, amount1Out)` |
| 157 | syncAfterDrain() | `emit Sync(_pool.reserve0, _pool.reserve1)` |
| 195 | resetTime() | `emit TimeReset(oldStartTime, newStartTime)` |
| 205 | setTaxStartTime() | `emit TaxStartTimeSet(_taxStartTime)` |

## FFactoryV2.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 83 | _createPair() | `emit PairCreated(tokenA, tokenB, address(pair_), pairs.length)` |

## FFactoryV3.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 91 | _createPair() | `emit PairCreated(tokenA, tokenB, address(pair_), pairs.length)` |

## FRouterV2.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 416 | drainPrivatePool() | `emit PrivatePoolDrained(tokenAddress, recipient, assetAmount, tokenAmount)` |
| 489 | drainUniV2Pool() | `emit UniV2PoolDrained(agentToken, veToken, recipient, veTokenAmount)` |

## FRouterV3.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 402 | drainPrivatePool() | `emit PrivatePoolDrained(tokenAddress, recipient, assetAmount, tokenAmount)` |
| 475 | drainUniV2Pool() | `emit UniV2PoolDrained(agentToken, veToken, recipient, veTokenAmount)` |

## multicall3.sol
| Line | Function Context | Event |
|------|-----------------|-------|
| 61 | constructor() | `emit OwnershipTransferred(address(0), msg.sender)` |
| 355 | transferOwnership() | `emit OwnershipTransferred(owner, newOwner)` |
| 365 | grantAdmin() | `emit AdminGranted(admin)` |
| 373 | revokeAdmin() | `emit AdminRevoked(admin)` |
| 401 | approveToken() | `emit TokenApproved(token, spender, amount)` |
| 439 | transferToken() | `emit TokenTransferred(token, to, amount)` |
| 487 | withdrawERC20Token() | `emit TokenTransferred(token, to, amount)` |

## Missing Events (Notable)

- **buy() / sell()** in BondingV2-V5: NO buy/sell events emitted. Users trading have no event trail from the Bonding contract. (Router's FPairV2 emits Swap events, but not the Bonding layer.)
- **All BondingV2-V4 setters**: No events emitted for parameter changes.
- **FRouterV2/V3 buy/sell**: No events emitted (rely on FPairV2 Swap event).
- **FRouterV2/V3 graduate**: No event emitted (relies on Bonding's Graduated event).

**Total emit statements**: 40 (in-scope, non-mock)
