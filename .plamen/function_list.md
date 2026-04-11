# Function List (grep fallback - SLITHER UNAVAILABLE)

Source: grep on contracts/launchpadv2/*.sol

## MockUniswapV2Factory.sol
- getPair(address tokenA, address tokenB) external view
- allPairsLength() external view returns (uint)
- createPair(address tokenA, address tokenB) external
- setFeeTo(address _feeTo) external
- setFeeToSetter(address _feeToSetter) external

## FPairV2.sol
- mint(uint256 reserve0, uint256 reserve1) external
- swap(uint256 amount0In, uint256 amount0Out, uint256 amount1In, uint256 amount1Out) external
- approval(address _user, address _token, uint256 amount) external
- transferAsset(address recipient, uint256 amount) external
- transferTo(address recipient, uint256 amount) public onlyRouter
- syncAfterDrain(uint256 assetAmount, uint256 tokenAmount) external
- resetTime(uint256 newStartTime) external
- setTaxStartTime(uint256 _taxStartTime) external
- getReserves() external view
- assetBalance() external view
- balance() external view
- kLast() external view
- tokenA() external view

## BondingV2.sol
- (constructor, initialize, buy, sell, launch, cancelLaunch, preLaunch, graduate)
- Full list via grep in source file

## BondingV3.sol
- Similar to BondingV2 with additional V3 features

## BondingV4.sol
- Similar to BondingV3 with V4 additions

## BondingV5.sol
- Extended bonding curve with privileged launcher, initial purchase, graduateWithParams

## FFactoryV2.sol
- createPair(address tokenA, address tokenB, ...)
- getPair(address, address)

## FFactoryV3.sol
- createPair extended with additional params

## FRouterV2.sol
- buy(address pair, uint256 amountIn, ...)
- sell(address pair, uint256 amountIn, ...)
- drainPrivatePool(...)
- drainUniV2Pool(...)

## FRouterV3.sol
- Same interface as FRouterV2 with additional tax logic

## BondingConfig.sol
- setDeployParams(...)
- setBondingCurveParams(...)
- setReserveSupplyParams(...)
- setCommonParams(...)
- setPrivilegedLauncher(address, bool)
- bondingCurveSupply() view
- gradThreshold() view

## multicall3.sol
- aggregate(Call[] calldata calls)
- tryAggregate(bool requireSuccess, Call[] calldata calls)
- aggregate3(Call3[] calldata calls)
- aggregate3Value(Call3Value[] calldata calls)
- blockAndAggregate(Call[] calldata calls)
- tryBlockAndAggregate(bool requireSuccess, Call[] calldata calls)
- getBlockHash(uint256 blockNumber)
- getBlockNumber() / getChainId() / getCurrentBlockCoinbase() etc.
- withdrawEth(address to, uint256 amount)
- approveToken(address token, address spender, uint256 amount)
- transferToken(address token, address to, uint256 amount)
