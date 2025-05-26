// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../pool/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract TaxSwapper is AccessControl {
    address public immutable assetToken;
    address public taxRecipient;

    address public immutable taxManager;

    IUniswapV2Router02 internal immutable uniswapRouter;

    uint256 public maxSwapAmount;
    mapping(address => uint256) public maxAmountByToken;

    event SwapTax(address indexed token, uint256 amount);

    bytes32 public constant OPS_ROLE = keccak256("OPS_ROLE");

    constructor(
        address assetToken_,
        address taxRecipient_,
        address router_,
        address initialOwner_,
        uint256 maxSwapAmount_
    ) {
        assetToken = assetToken_;
        taxRecipient = taxRecipient_;
        uniswapRouter = IUniswapV2Router02(router_);
        maxSwapAmount = maxSwapAmount_;
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner_);
        _grantRole(OPS_ROLE, initialOwner_);
    }

    function setMaxSwapAmount(
        uint256 maxSwapAmount_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxSwapAmount = maxSwapAmount_;
    }

    function setMaxAmountByToken(
        address token,
        uint256 maxAmount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxAmountByToken[token] = maxAmount;
    }

    function setTaxRecipient(
        address taxRecipient_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        taxRecipient = taxRecipient_;
    }

    function swapTax(address token) external onlyRole(OPS_ROLE) {
        uint256 maxAmount = maxAmountByToken[token];
        if (maxAmount == 0) {
            maxAmount = maxSwapAmount;
        }

        uint256 swapBalance = IERC20(token).balanceOf(address(this));
        if (swapBalance > maxAmount) {
            swapBalance = maxAmount;
        }

        if (swapBalance == 0) {
            return;
        }

        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = assetToken;

        IERC20(token).approve(address(uniswapRouter), swapBalance);

        uniswapRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapBalance,
            0,
            path,
            taxRecipient,
            block.timestamp + 600
        );

        emit SwapTax(token, swapBalance);
    }

    function withdraw(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).transfer(
            taxRecipient,
            IERC20(token).balanceOf(address(this))
        );
    }
}
