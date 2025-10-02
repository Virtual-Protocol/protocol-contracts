// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../virtualPersona/IAgentToken.sol";

contract MockAgentToken is ERC20, IAgentToken, Ownable {
    address[] private _liquidityPools;
    bool private initialized;

    // Mock state variables
    uint256 public maxTokensPerWallet = type(uint256).max;
    uint256 public maxTokensPerTransaction = type(uint256).max;
    uint256 public projectBuyTaxBasisPoints = 0;
    uint256 public projectSellTaxBasisPoints = 0;
    uint256 public swapThresholdBasisPoints = 1000;
    address public projectTaxRecipient;
    uint256 public totalBuyTaxBasisPoints = 0;
    uint256 public totalSellTaxBasisPoints = 0;

    mapping(address => bool) private _isLiquidityPool;
    mapping(bytes32 => bool) private _validCallers;
    bytes32[] private _validCallerHashes;

    constructor() ERC20("MockAgentToken", "MAT") Ownable(msg.sender) {
        // Don't mint anything in constructor
    }

    function initialize(
        address[3] memory params, // [tokenAdmin, uniswapRouter, assetToken]
        bytes memory, // name and symbol
        bytes memory supplyParams, // supply configuration
        bytes memory // tax params
    ) external {
        if (!initialized) {
            // Decode supply params to get the intended recipient
            (
                uint256 maxSupply,
                uint256 lpSupply,
                uint256 vaultSupply,
                ,
                ,
                ,
                address vault
            ) = abi.decode(
                    supplyParams,
                    (
                        uint256,
                        uint256,
                        uint256,
                        uint256,
                        uint256,
                        uint256,
                        address
                    )
                );

            // Mint tokens to the vault (which should be BondingV2 contract)
            if (vault != address(0)) {
                _mint(vault, maxSupply);
            } else {
                // Fallback: mint to tx.origin (BondingV2 contract)
                _mint(tx.origin, maxSupply);
            }

            initialized = true;
        }
    }

    function addInitialLiquidity(address) external override {
        // Mock implementation - do nothing
    }

    function isLiquidityPool(
        address queryAddress_
    ) external view override returns (bool) {
        return _isLiquidityPool[queryAddress_];
    }

    function liquidityPools()
        external
        view
        override
        returns (address[] memory)
    {
        return _liquidityPools;
    }

    function addLiquidityPool(
        address newLiquidityPool_
    ) external override onlyOwner {
        require(!_isLiquidityPool[newLiquidityPool_], "Pool already exists");
        _isLiquidityPool[newLiquidityPool_] = true;
        _liquidityPools.push(newLiquidityPool_);
        emit LiquidityPoolAdded(newLiquidityPool_);
    }

    function removeLiquidityPool(
        address removedLiquidityPool_
    ) external override onlyOwner {
        require(_isLiquidityPool[removedLiquidityPool_], "Pool does not exist");
        _isLiquidityPool[removedLiquidityPool_] = false;

        // Remove from array
        for (uint256 i = 0; i < _liquidityPools.length; i++) {
            if (_liquidityPools[i] == removedLiquidityPool_) {
                _liquidityPools[i] = _liquidityPools[
                    _liquidityPools.length - 1
                ];
                _liquidityPools.pop();
                break;
            }
        }
        emit LiquidityPoolRemoved(removedLiquidityPool_);
    }

    function isValidCaller(
        bytes32 queryHash_
    ) external view override returns (bool) {
        return _validCallers[queryHash_];
    }

    function validCallers() external view override returns (bytes32[] memory) {
        return _validCallerHashes;
    }

    function addValidCaller(
        bytes32 newValidCallerHash_
    ) external override onlyOwner {
        require(!_validCallers[newValidCallerHash_], "Caller already exists");
        _validCallers[newValidCallerHash_] = true;
        _validCallerHashes.push(newValidCallerHash_);
        emit ValidCallerAdded(newValidCallerHash_);
    }

    function removeValidCaller(
        bytes32 removedValidCallerHash_
    ) external override onlyOwner {
        require(
            _validCallers[removedValidCallerHash_],
            "Caller does not exist"
        );
        _validCallers[removedValidCallerHash_] = false;

        // Remove from array
        for (uint256 i = 0; i < _validCallerHashes.length; i++) {
            if (_validCallerHashes[i] == removedValidCallerHash_) {
                _validCallerHashes[i] = _validCallerHashes[
                    _validCallerHashes.length - 1
                ];
                _validCallerHashes.pop();
                break;
            }
        }
        emit ValidCallerRemoved(removedValidCallerHash_);
    }

    function setProjectTaxRecipient(
        address projectTaxRecipient_
    ) external override onlyOwner {
        projectTaxRecipient = projectTaxRecipient_;
        emit ProjectTaxRecipientUpdated(projectTaxRecipient_);
    }

    function setSwapThresholdBasisPoints(
        uint16 swapThresholdBasisPoints_
    ) external override onlyOwner {
        uint256 oldThreshold = swapThresholdBasisPoints;
        swapThresholdBasisPoints = swapThresholdBasisPoints_;
        emit AutoSwapThresholdUpdated(oldThreshold, swapThresholdBasisPoints_);
    }

    function setProjectTaxRates(
        uint16 newProjectBuyTaxBasisPoints_,
        uint16 newProjectSellTaxBasisPoints_
    ) external override onlyOwner {
        uint256 oldBuyBasisPoints = projectBuyTaxBasisPoints;
        uint256 oldSellBasisPoints = projectSellTaxBasisPoints;

        projectBuyTaxBasisPoints = newProjectBuyTaxBasisPoints_;
        projectSellTaxBasisPoints = newProjectSellTaxBasisPoints_;

        emit ProjectTaxBasisPointsChanged(
            oldBuyBasisPoints,
            newProjectBuyTaxBasisPoints_,
            oldSellBasisPoints,
            newProjectSellTaxBasisPoints_
        );
    }

    function distributeTaxTokens() external override {
        // Mock implementation - do nothing
    }

    function withdrawETH(uint256 amount_) external override onlyOwner {
        // Mock implementation - do nothing
    }

    function withdrawERC20(
        address token_,
        uint256 amount_
    ) external override onlyOwner {
        // Mock implementation - do nothing
    }

    function burn(uint256 value) external override {
        _burn(msg.sender, value);
    }

    function burnFrom(address account, uint256 value) external override {
        _spendAllowance(account, msg.sender, value);
        _burn(account, value);
    }

    // IErrors interface methods (empty implementations)
    function ERR_INVALID_TOKEN_STATUS() external pure returns (string memory) {
        return "Invalid token status";
    }

    function ERR_INVALID_INPUT() external pure returns (string memory) {
        return "Invalid input";
    }

    function ERR_SLIPPAGE_TOO_HIGH() external pure returns (string memory) {
        return "Slippage too high";
    }

    function ERR_ZERO_ADDRESSES() external pure returns (string memory) {
        return "Zero addresses";
    }

    function ERR_AMOUNT_MUST_BE_GREATER_THAN_ZERO()
        external
        pure
        returns (string memory)
    {
        return "Amount must be greater than zero";
    }
}
