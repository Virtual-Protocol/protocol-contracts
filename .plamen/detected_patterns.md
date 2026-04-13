# Detected Patterns

## Pattern Detection Results

| Pattern | Flag | Match Count | Detected? | Example Locations |
|---------|------|-------------|-----------|-------------------|
| interval/epoch/period/duration/delay/startTime/deadline | TEMPORAL | 177 | YES | BondingConfig.sol:36 (startTimeDelay), FPairV2.sol:25 (startTime), BondingV2.sol:499 (deadline), BondingConfig.sol:29 (duration) |
| oracle/latestRoundData/TWAP/chainlink | ORACLE | 0 | NO | - |
| random/keccak256*block/prevrandao/VRF | RANDOMNESS_WEAK_SOURCE | 0 | NO | - |
| keccak256*%/uint*%*length/modulo | RANDOMNESS_DETERMINISTIC_SELECTION | 0 | NO | - |
| flashLoan/flash/callback*amount | FLASH_LOAN | 0 | NO | - |
| IUniswapV2Router/swap*token/addLiquidity/removeLiquidity/getReserves | FLASH_LOAN_EXTERNAL | 39 | YES | FRouterV2.sol (getAmountsOut, addInitialLiquidity), FRouterV3.sol (buy/sell), IFPairV2.sol (getReserves) |
| ERC4626/vault/deposit*shares | ERC4626 | 27 | PARTIAL | vault references in factory (taxVault, antiSniperTaxVault), NOT actual ERC4626 |
| delegation/staking*receipt/liquid*staking | STAKING_RECEIPT | 0 | NO | - |
| balanceOf*this/address*balance | BALANCE_DEPENDENT | 21 | YES | FPairV2.sol:177 (balance()), FPairV2.sol:181 (assetBalance()), multicall3.sol:465,481 |
| bridge/L1/L2/tunnel/messenger/crossChain | CROSS_CHAIN | 0 | NO | - |
| onlyBot/onlyOperator/onlyKeeper/BOT_ROLE/EXECUTOR_ROLE | SEMI_TRUSTED_ROLE | 26 | YES | FRouterV2.sol:36 (EXECUTOR_ROLE), FRouterV3.sol:45, used in buy/sell/graduate/drain |
| reinitializer/V2/V3/_deprecated/migrat/upgrade/legacy | MIGRATION | 221 | YES | V2/V3/V4/V5 versioning across all contracts, FRouterV2.sol:40 (taxManager deprecated) |
| shares/allocation/distribute/pro.rata/proportional/vest | SHARE_ALLOCATION | 1 | MINIMAL | Not meaningful in context |
| rate/rebase/supply/mint*burn/emission/inflation/peg | MONETARY_PARAMETER | 34 | YES | BondingConfig.sol (initialSupply, fakeInitialVirtualLiq, targetRealVirtual), BondingV2.sol (assetRate, K, gradThreshold) |
| 1e6/1e8/decimals()/10** | MIXED_DECIMALS | 10 | YES | BondingV2.sol:314 (10**decimals()), BondingV5.sol:361, all Bonding contracts use dynamic decimals |
| IERC6909/ERC6909/IERC1155/ERC1155 | MULTI_TOKEN_STANDARD | 0 | NO | - |
| ecrecover/ECDSA/SignatureChecker/permit | HAS_SIGNATURES | 3 | MINIMAL | Only in MockUniswapV2Pair.sol (PERMIT_TYPEHASH, DOMAIN_SEPARATOR) - mock only |
| proxy/upgradeable/diamond/delegatecall/sstore/sload/assembly | STORAGE_LAYOUT | 29 | YES | All Bonding*/FFactory*/FRouter* use Initializable+Upgradeable. multicall3.sol:202,258 (inline assembly) |
| lzReceive/ccipReceive/receiveWormholeMessages | CROSS_CHAIN_MSG | 0 | NO | - |
| _safeMint/safeTransfer/onERC721Received | OUTCOME_CALLBACK | 42 | YES | SafeERC20.safeTransfer used extensively in all contracts |
| depositFor/stakeFor/delegateTo/mintFor | MULTI_STEP_OPS | 0 | NO | - |
| IUniswapV2Router/IUniswapV2Pair (named external) | NAMED_EXTERNAL_PROTOCOL | 1 | YES | FRouterV2.sol:15 (IUniswapV2Pair import), FRouterV3.sol:15 |
| .call{value}/.call()/.delegatecall() | OUTCOME_CALLBACK_LOW_LEVEL | 5 | YES | multicall3.sol:105,128,199,255 (arbitrary .call), multicall3.sol:520 (ETH transfer) |
| deadline/claimPeriod/expir | OUTCOME_DELAY | 52 | YES | BondingV2-V5 sell/buy deadline params, FRouterV2/V3 drainUniV2Pool deadline |
| assembly {} | INLINE_ASSEMBLY | 2 in-scope | YES | multicall3.sol:202, multicall3.sol:258 |

## Signal Elevation Tags

| Tag | Location | Details |
|-----|----------|---------|
| [ELEVATE:FORK_ANCESTRY:Pump.fun] | BondingV2-V5 | All bonding contracts derived from sourlodine/Pump.fun-Smart-Contract |
| [ELEVATE:STORAGE_LAYOUT] | BondingV2-V5, FFactoryV2/V3, FRouterV2/V3, BondingConfig | All use Initializable + upgradeable proxy pattern |
| [ELEVATE:INLINE_ASSEMBLY] | multicall3.sol:202,258 | Assembly blocks in aggregate3 and aggregate3Value |
| [ELEVATE:SINGLE_ENTRY] | BondingV2-V5 tokenInfo mapping | Single mapping entry per token address, no nonce/epoch - state can be overwritten if same token reused |
| [ELEVATE:BRANCH_ASYMMETRY] | FRouterV2/V3 buy() vs sell() | Buy has anti-sniper tax + normal tax logic (complex), sell only has normal tax (simple) |

## Key Observations

1. **BondingV2/V3/V4 preLaunch is dead code**: All three have `revert("Not implemented")` as first statement. Only BondingV5._preLaunch is active.
2. **BondingV2/V3/V4 launch/buy/sell are still live**: These functions do NOT revert and process tokens created before the version upgrade.
3. **EXECUTOR_ROLE is semi-trusted**: Controls buy/sell/graduate/drain on routers - this is the bonding contract itself, not an EOA. But setBondingV2/V4/V5 functions allow changing which contract has this role.
4. **No flash loan protection beyond reentrancy guards**: No flash-loan-specific checks exist. The constant-product AMM with virtual liquidity could be manipulated.
5. **Virtual liquidity in FPairV2**: `mint()` sets reserves but only transfers tokenA (not tokenB/asset). The asset reserve is virtual (fake). `assetBalance()` uses `balanceOf` which tracks real deposits only. This discrepancy between virtual reserves and real balances is critical for the bonding curve math.
