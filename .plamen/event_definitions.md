# Event Definitions (grep fallback - SLITHER UNAVAILABLE)

Source: grep on contracts/launchpadv2/*.sol

## FPairV2.sol
- `event Mint(uint256 reserve0, uint256 reserve1)` (line 48)
- `event Swap(uint256 amount0In, uint256 amount0Out, uint256 amount1In, uint256 amount1Out)` (line 50)
- `event TimeReset(uint256 oldStartTime, uint256 newStartTime)` (line 57)
- `event TaxStartTimeSet(uint256 taxStartTime)` (line 58)
- `event Sync(uint256 reserve0, uint256 reserve1)` (line 59)

## MockUniswapV2Pair.sol
- `event TimeReset(uint256 oldStartTime, uint256 newStartTime)` (line 39)

## BondingV2.sol
- `event PreLaunched(...)` (line 101)
- `event Launched(...)` (line 107)
- `event CancelledLaunch(...)` (line 114)
- `event Deployed(address indexed token, uint256 amount0, uint256 amount1)` (line 120)
- `event Graduated(address indexed token, address agentToken)` (line 121)

## BondingV3.sol
- `event PreLaunched(...)` (line 97)
- `event Launched(...)` (line 103)
- `event CancelledLaunch(...)` (line 110)
- `event Deployed(address indexed token, uint256 amount0, uint256 amount1)` (line 116)
- `event Graduated(address indexed token, address agentToken)` (line 117)

## BondingConfig.sol
- `event DeployParamsUpdated(DeployParams params)` (line 115)
- `event TeamTokenReservedWalletUpdated(address wallet)` (line 116)
- `event CommonParamsUpdated(uint256 initialSupply, address feeTo)` (line 117)
- `event BondingCurveParamsUpdated(BondingCurveParams params)` (line 118)
- `event ReserveSupplyParamsUpdated(ReserveSupplyParams params)` (line 119)
- `event PrivilegedLauncherUpdated(address indexed launcher, bool allowed)` (line 120)

## MockAgentVeToken.sol
- `event Transfer(address indexed from, address indexed to, uint256 value)` (line 33)
- `event Approval(address indexed owner, address indexed spender, uint256 value)` (line 34)

## BondingV4.sol
- `event PreLaunched(...)` (line 116)
- `event Launched(...)` (line 122)
- `event CancelledLaunch(...)` (line 129)
- `event Deployed(address indexed token, uint256 amount0, uint256 amount1)` (line 135)
- `event Graduated(address indexed token, address agentToken)` (line 136)

## BondingV5.sol
- `event PreLaunched(...)` (line 114)
- `event Launched(...)` (line 121)
- `event CancelledLaunch(...)` (line 129)
- `event Graduated(address indexed token, address agentToken)` (line 135)
- NOTE: BondingV5 drops `Deployed` event compared to V4

## FRouterV2.sol
- `event PrivatePoolDrained(...)` (line 44)
- `event UniV2PoolDrained(...)` (line 51)

## FRouterV3.sol
- `event PrivatePoolDrained(...)` (line 54)
- `event UniV2PoolDrained(...)` (line 61)

## FFactoryV2.sol
- `event PairCreated(...)` (line 30)

## FFactoryV3.sol
- `event PairCreated(...)` (line 38)

## multicall3.sol
- `event OwnershipTransferred(...)` (line 29)
- `event AdminGranted(address indexed admin)` (line 33)
- `event AdminRevoked(address indexed admin)` (line 34)
- `event TokenApproved(...)` (line 35)
- `event TokenTransferred(...)` (line 40)
