# State Variables (grep fallback - SLITHER UNAVAILABLE)

Source: grep on contracts/launchpadv2/*.sol

## MockUniswapV2Factory.sol
- `address public override feeTo`
- `address public override feeToSetter`
- `address[] public allPairs`
- `mapping(address => mapping(address => address)) public override getPair`

## FPairV2.sol
- `address public router`
- `address public tokenA` (via pool struct)
- `uint256 public startTime`
- `uint256 public startTimeDelay`
- `uint256 public taxStartTime`
- Pool struct: `{ uint256 reserve0, uint256 reserve1, uint256 k, uint256 lastUpdated }`

## MockUniswapV2Pair.sol
- `address public override token0`
- `address public override token1`
- `uint112 private reserve0`
- `uint112 private reserve1`
- `uint32 private blockTimestampLast`
- `uint256 public override price0CumulativeLast`
- `uint256 public override price1CumulativeLast`
- `uint256 public override kLast`
- `uint256 public override totalSupply`
- `string public constant name = "Mock Uniswap V2"`
- `string public constant symbol = "UNI-V2"`
- `uint8 public constant decimals = 18`
- `bytes32 public override DOMAIN_SEPARATOR`
- `bytes32 public constant PERMIT_TYPEHASH`
- `address public override factory`
- `uint256 public startTime`
- `uint256 public startTimeDelay`

## BondingV2.sol / BondingV3.sol / BondingV4.sol
- mapping(address => Token) public tokens (token state per token address)
- `address public feeTo`
- `uint256 public fee`
- `uint256 public initialSupply`
- `address public factory` / `address public router`
- `address public agentFactory` / `address public agentFactoryV6`
- `uint256 public gradThreshold` / bonding curve params
- Token struct includes: `initialPurchase`, `launchExecuted`, `creator`, etc.

## BondingV5.sol
- Extends BondingV4 state with:
  - `mapping(address => bool) public privilegedLaunchers`
  - Additional struct fields for V5-specific launch params

## BondingConfig.sol
- `DeployParams public deployParams`
- `BondingCurveParams public bondingCurveParams`
- `ReserveSupplyParams public reserveSupplyParams`
- `uint256 public initialSupply`
- `address public feeTo`
- `mapping(address => bool) public privilegedLaunchers`

## FFactoryV2.sol / FFactoryV3.sol
- `mapping(address => mapping(address => address)) public getPair`
- `address[] public allPairs`
- `address public router`

## FRouterV2.sol / FRouterV3.sol
- `address public factory`
- `uint256 public fee` (percentage)

## multicall3.sol
- `address public owner`
- `mapping(address => bool) public admins`
- `address[] public approvedTokens`
