// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../pool/IUniswapV2Router02.sol";

interface IAgentTaxForToken {
    function depositTax(address tokenAddress, uint256 amount) external;
}

/**
 * @title TaxAccountingAdapter
 * @notice Pulls agent tokens from the AgentToken contract, swaps to `pairToken` via Uniswap V2
 *         with `to = address(this)` so the pool's INVALID_TO check is satisfied (recipient is not token0/token1).
 *         Deposits the *actual* `pairToken` received into AgentTax via `depositTax(agentToken, received)`.
 */
contract TaxAccountingAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    event TaxSwapDeposited(
        address indexed agentToken,
        address indexed taxRecipient,
        uint256 received
    );

    /**
     * @param agentToken Agent ERC20 (same as `path[0]`). Tokens are pulled from `agentToken` address (the contract's own balance).
     * @param pairToken Quote token (e.g. VIRTUAL).
     * @param taxRecipient AgentTax (or compatible) — `depositTax` pulls `pairToken` from this adapter.
     * @param router Uniswap V2 compatible router.
     * @param swapAmount Amount of agent token to pull and pass to the router (fee-on-transfer: actual balance used after pull).
     * @param deadline Router deadline.
     */
    function swapTaxAndDeposit(
        address agentToken,
        address pairToken,
        address taxRecipient,
        address router,
        uint256 swapAmount,
        uint256 deadline
    ) external nonReentrant {
        require(swapAmount > 0, "TaxAccountingAdapter: zero swap");
        require(deadline >= block.timestamp, "TaxAccountingAdapter: expired");
        require(
            taxRecipient != address(0) && router != address(0),
            "TaxAccountingAdapter: zero address"
        );

        IERC20(agentToken).safeTransferFrom(agentToken, address(this), swapAmount);

        uint256 swapIn = IERC20(agentToken).balanceOf(address(this));
        require(swapIn > 0, "TaxAccountingAdapter: zero in");

        IERC20(agentToken).forceApprove(router, swapIn);

        address[] memory path = new address[](2);
        path[0] = agentToken;
        path[1] = pairToken;

        uint256 balBefore = IERC20(pairToken).balanceOf(address(this));

        IUniswapV2Router02(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapIn,
            0,
            path,
            address(this),
            deadline
        );

        uint256 received = IERC20(pairToken).balanceOf(address(this)) - balBefore;
        if (received > 0) {
            IERC20(pairToken).forceApprove(taxRecipient, received);
            IAgentTaxForToken(taxRecipient).depositTax(agentToken, received);
            emit TaxSwapDeposited(agentToken, taxRecipient, received);
        }
    }
}
