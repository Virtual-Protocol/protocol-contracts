// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IERC20Config.sol";
import "./IErrors.sol";

interface IAgentToken is
    IERC20,
    IERC20Config,
    IERC20Metadata,
    IErrors
{
    event AutoSwapThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    event ExternalCallError(uint256 identifier);

    event InitialLiquidityAdded(
        uint256 tokenA,
        uint256 tokenB,
        uint256 lpToken
    );

    event LimitsUpdated(
        uint256 oldMaxTokensPerTransaction,
        uint256 newMaxTokensPerTransaction,
        uint256 oldMaxTokensPerWallet,
        uint256 newMaxTokensPerWallet
    );

    event LiquidityPoolCreated(address addedPool);

    event LiquidityPoolAdded(address addedPool);

    event LiquidityPoolRemoved(address removedPool);

    event ProjectTaxBasisPointsChanged(
        uint256 oldBuyBasisPoints,
        uint256 newBuyBasisPoints,
        uint256 oldSellBasisPoints,
        uint256 newSellBasisPoints
    );

    event RevenueAutoSwap();

    event ProjectTaxRecipientUpdated(address treasury);

    event ValidCallerAdded(bytes32 addedValidCaller);

    event ValidCallerRemoved(bytes32 removedValidCaller);

    /**
     * @dev function {addInitialLiquidity}
     *
     * Add initial liquidity to the uniswap pair
     *
     * @param lpOwner The recipient of LP tokens
     */
    function addInitialLiquidity(address lpOwner) external;

    /**
     * @dev function {isLiquidityPool}
     *
     * Return if an address is a liquidity pool
     *
     * @param queryAddress_ The address being queried
     * @return bool The address is / isn't a liquidity pool
     */
    function isLiquidityPool(
        address queryAddress_
    ) external view returns (bool);

    /**
     * @dev function {liquidityPools}
     *
     * Returns a list of all liquidity pools
     *
     * @return liquidityPools_ a list of all liquidity pools
     */
    function liquidityPools()
        external
        view
        returns (address[] memory liquidityPools_);

    /**
     * @dev function {addLiquidityPool} onlyOwner
     *
     * Allows the manager to add a liquidity pool to the pool enumerable set
     *
     * @param newLiquidityPool_ The address of the new liquidity pool
     */
    function addLiquidityPool(address newLiquidityPool_) external;

    /**
     * @dev function {removeLiquidityPool} onlyOwner
     *
     * Allows the manager to remove a liquidity pool
     *
     * @param removedLiquidityPool_ The address of the old removed liquidity pool
     */
    function removeLiquidityPool(address removedLiquidityPool_) external;

    /**
     * @dev function {isValidCaller}
     *
     * Return if an address is a valid caller
     *
     * @param queryHash_ The code hash being queried
     * @return bool The address is / isn't a valid caller
     */
    function isValidCaller(bytes32 queryHash_) external view returns (bool);

    /**
     * @dev function {validCallers}
     *
     * Returns a list of all valid caller code hashes
     *
     * @return validCallerHashes_ a list of all valid caller code hashes
     */
    function validCallers()
        external
        view
        returns (bytes32[] memory validCallerHashes_);

    /**
     * @dev function {addValidCaller} onlyOwner
     *
     * Allows the owner to add the hash of a valid caller
     *
     * @param newValidCallerHash_ The hash of the new valid caller
     */
    function addValidCaller(bytes32 newValidCallerHash_) external;

    /**
     * @dev function {removeValidCaller} onlyOwner
     *
     * Allows the owner to remove a valid caller
     *
     * @param removedValidCallerHash_ The hash of the old removed valid caller
     */
    function removeValidCaller(bytes32 removedValidCallerHash_) external;

    /**
     * @dev function {setProjectTaxRecipient} onlyOwner
     *
     * Allows the manager to set the project tax recipient address
     *
     * @param projectTaxRecipient_ New recipient address
     */
    function setProjectTaxRecipient(address projectTaxRecipient_) external;

    /**
     * @dev function {setSwapThresholdBasisPoints} onlyOwner
     *
     * Allows the manager to set the autoswap threshold
     *
     * @param swapThresholdBasisPoints_ New swap threshold in basis points
     */
    function setSwapThresholdBasisPoints(
        uint16 swapThresholdBasisPoints_
    ) external;

    /**
     * @dev function {setProjectTaxRates} onlyOwner
     *
     * Change the tax rates, subject to only ever decreasing
     *
     * @param newProjectBuyTaxBasisPoints_ The new buy tax rate
     * @param newProjectSellTaxBasisPoints_ The new sell tax rate
     */
    function setProjectTaxRates(
        uint16 newProjectBuyTaxBasisPoints_,
        uint16 newProjectSellTaxBasisPoints_
    ) external;

    /**
     * @dev totalBuyTaxBasisPoints
     *
     * Provide easy to view tax total:
     */
    function totalBuyTaxBasisPoints() external view returns (uint256);

    /**
     * @dev totalSellTaxBasisPoints
     *
     * Provide easy to view tax total:
     */
    function totalSellTaxBasisPoints() external view returns (uint256);

    /**
     * @dev distributeTaxTokens
     *
     * Allows the distribution of tax tokens to the designated recipient(s)
     *
     * As part of standard processing the tax token balance being above the threshold
     * will trigger an autoswap to ETH and distribution of this ETH to the designated
     * recipients. This is automatic and there is no need for user involvement.
     *
     * As part of this swap there are a number of calculations performed, particularly
     * if the tax balance is above MAX_SWAP_THRESHOLD_MULTIPLE.
     *
     * Testing indicates that these calculations are safe. But given the data / code
     * interactions it remains possible that some edge case set of scenarios may cause
     * an issue with these calculations.
     *
     * This method is therefore provided as a 'fallback' option to safely distribute
     * accumulated taxes from the contract, with a direct transfer of the ERC20 tokens
     * themselves.
     */
    function distributeTaxTokens() external;

    /**
     * @dev function {withdrawETH} onlyOwner
     *
     * A withdraw function to allow ETH to be withdrawn by the manager
     *
     * This contract should never hold ETH. The only envisaged scenario where
     * it might hold ETH is a failed autoswap where the uniswap swap has completed,
     * the recipient of ETH reverts, the contract then wraps to WETH and the
     * wrap to WETH fails.
     *
     * This feels unlikely. But, for safety, we include this method.
     *
     * @param amount_ The amount to withdraw
     */
    function withdrawETH(uint256 amount_) external;

    /**
     * @dev function {withdrawERC20} onlyOwner
     *
     * A withdraw function to allow ERC20s (except address(this)) to be withdrawn.
     *
     * This contract should never hold ERC20s other than tax tokens. The only envisaged
     * scenario where it might hold an ERC20 is a failed autoswap where the uniswap swap
     * has completed, the recipient of ETH reverts, the contract then wraps to WETH, the
     * wrap to WETH succeeds, BUT then the transfer of WETH fails.
     *
     * This feels even less likely than the scenario where ETH is held on the contract.
     * But, for safety, we include this method.
     *
     * @param token_ The ERC20 contract
     * @param amount_ The amount to withdraw
     */
    function withdrawERC20(address token_, uint256 amount_) external;

    /**
     * @dev Destroys a `value` amount of tokens from the caller.
     *
     * See {ERC20-_burn}.
     */
    function burn(uint256 value) external;

    /**
     * @dev Destroys a `value` amount of tokens from `account`, deducting from
     * the caller's allowance.
     *
     * See {ERC20-_burn} and {ERC20-allowance}.
     *
     * Requirements:
     *
     * - the caller must have allowance for ``accounts``'s tokens of at least
     * `value`.
     */
    function burnFrom(address account, uint256 value) external;

    /**
     * @dev {initializer}
     *
     * @param integrationAddresses_ The project owner, uniswap router, LP currency
     * @param baseParams_ configuration of this ERC20.
     * param supplyParams_ Supply configuration of this ERC20.
     * param taxParams_  Tax configuration of this ERC20
     * param taxParams_  Launch pool configuration of this ERC20
     * param lpSupply_  Initial supply to be minted for LP
     */
    function initialize(
        address[3] memory integrationAddresses_,
        bytes memory baseParams_,
        bytes memory supplyParams_,
        bytes memory taxParams_
    ) external;
}
