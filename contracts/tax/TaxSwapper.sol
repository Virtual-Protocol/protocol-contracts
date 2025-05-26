// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../pool/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TaxSwapper is Ownable {
    address public immutable assetToken;
    address public taxRecipient;

    IUniswapV2Router02 internal immutable uniswapRouter;

    uint256 public maxSwapAmount;
    mapping(address => uint256) public maxAmountByToken;

    event SwapTax(address indexed token, uint256 amount);

    constructor(
        address assetToken_,
        address taxRecipient_,
        address router_,
        address initialOwner_,
        uint256 maxSwapAmount_
    ) Ownable(initialOwner_) {
        assetToken = assetToken_;
        taxRecipient = taxRecipient_;
        uniswapRouter = IUniswapV2Router02(router_);
        maxSwapAmount = maxSwapAmount_;
    }

    function setMaxSwapAmount(uint256 maxSwapAmount_) external onlyOwner {
        maxSwapAmount = maxSwapAmount_;
    }

    function setMaxAmountByToken(
        address token,
        uint256 maxAmount
    ) external onlyOwner {
        maxAmountByToken[token] = maxAmount;
    }

    function setTaxRecipient(address taxRecipient_) external onlyOwner {
        taxRecipient = taxRecipient_;
    }

    function swapTax(address token) external {
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
}
