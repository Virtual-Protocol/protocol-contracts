# External Interfaces

## In-scope (contracts/launchpadv2/)
- `IFPairV2.sol` — pair interface with getReserves, swap, mint, approval, transferTo, transferAsset, syncAfterDrain, resetTime, setTaxStartTime, tokenA

## Project-level interfaces used by launchpadv2 contracts
- `contracts/pool/IUniswapV2Factory.sol` — standard Uni V2 factory interface
- `contracts/pool/IUniswapV2Pair.sol` — standard Uni V2 pair interface
- `contracts/pool/IUniswapV2Router01.sol` / `IUniswapV2Router02.sol` / `IUniswapV2Router03.sol`
- `contracts/pool/IRouter.sol`
- `contracts/virtualPersona/IAgentFactory.sol` — agent factory (graduation)
- `contracts/virtualPersona/IAgentFactoryV6.sol` — V6 agent factory
- `contracts/virtualPersona/IAgentToken.sol` / `IAgentTokenV2.sol` / `IAgentTokenV3.sol`
- `contracts/virtualPersona/IAgentDAO.sol`
- `contracts/virtualPersona/IAgentVeToken.sol` / `IAgentVeTokenV2.sol`
- `contracts/virtualPersona/IAgentNft.sol`
- `contracts/virtualPersona/IEloCalculator.sol`
- `contracts/virtualPersona/IExecutionInterface.sol`
- `contracts/contribution/IContributionNft.sol`
- `contracts/contribution/IServiceNft.sol`
- `contracts/token/IMinter.sol`
- `contracts/token/IVEVirtual.sol`
- `contracts/tax/IBondingTax.sol`
- `contracts/tax/ITBABonus.sol`
- `contracts/IAgentReward.sol` / `IAgentRewardV3.sol`
- `contracts/libs/IERC6551Registry.sol`
