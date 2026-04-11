// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../pool/IUniswapV2Router02.sol";

interface IAgentTaxForToken {
    function depositTax(address tokenAddress, uint256 amount) external;
}

/**
 * @title TaxAccountingAdapter
 * @notice Upgradeable (transparent proxy, same pattern as BondingV5). Pulls agent tokens from the AgentToken contract,
 *         swaps to `pairToken` via Uniswap V2 with `to = address(this)`, then deposits into AgentTax via `depositTax`.
 * @dev Upgrades are performed via ProxyAdmin, not inside this implementation (no UUPS). Owner may rescue stuck assets
 *      via {emergencyWithdrawERC20} / {emergencyWithdrawNative}.
 */
contract TaxAccountingAdapter is
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable
{
    using SafeERC20 for IERC20;

    event TaxSwapDeposited(
        address indexed agentToken,
        address indexed taxRecipient,
        uint256 received
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        __ReentrancyGuard_init();
        __Ownable_init(initialOwner);
    }

    receive() external payable {}

    /**
     * @param agentToken Agent ERC20 (same as `path[0]`). Tokens are pulled from `agentToken` (the contract holding tax).
     * @param pairToken Quote token (e.g. VIRTUAL).
     * @param taxRecipient AgentTax — `depositTax` pulls `pairToken` from this adapter.
     * @param router Uniswap V2 compatible router.
     * @param swapAmount Requested pull amount from `agentToken`; actual swap input is only the balance increase on this adapter from that pull (fee-on-transfer safe; ignores pre-existing balance here).
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

        IERC20 a = IERC20(agentToken);
        uint256 adapterBalBefore = a.balanceOf(address(this));
        a.safeTransferFrom(agentToken, address(this), swapAmount);

        // Use the balance *increase* from this pull, not `swapAmount`: fee-on-transfer / burn on inbound
        // can make received < swapAmount; router must not pull more than actually sits here. Also ignores
        // any ERC20 already on this contract before this call (non-FOT: increase == swapAmount if prior bal was 0).
        uint256 swapIn = a.balanceOf(address(this)) - adapterBalBefore;
        require(swapIn > 0, "TaxAccountingAdapter: zero in");

        a.forceApprove(router, swapIn);

        address[] memory path = new address[](2);
        path[0] = agentToken;
        path[1] = pairToken;

        uint256 pairBalBefore = IERC20(pairToken).balanceOf(address(this));

        IUniswapV2Router02(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapIn,
            0,
            path,
            address(this),
            deadline
        );

        uint256 received = IERC20(pairToken).balanceOf(address(this)) - pairBalBefore;
        if (received > 0) {
            IERC20(pairToken).forceApprove(taxRecipient, received);
            IAgentTaxForToken(taxRecipient).depositTax(agentToken, received);
            emit TaxSwapDeposited(agentToken, taxRecipient, received);
        }

        a.forceApprove(router, 0);
    }

    /// @notice Rescue ERC20 stuck on this adapter. `amount == type(uint256).max` withdraws full balance.
    function emergencyWithdrawERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "TaxAccountingAdapter: zero to");
        IERC20 t = IERC20(token);
        uint256 pull = amount == type(uint256).max ? t.balanceOf(address(this)) : amount;
        require(pull > 0, "TaxAccountingAdapter: zero amount");
        t.safeTransfer(to, pull);
    }

    /// @notice Rescue native ETH. `amount == type(uint256).max` sends full balance.
    function emergencyWithdrawNative(
        address payable to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "TaxAccountingAdapter: zero to");
        uint256 bal = address(this).balance;
        uint256 sendAmt = amount == type(uint256).max ? bal : amount;
        require(sendAmt > 0 && sendAmt <= bal, "TaxAccountingAdapter: native amount");
        (bool ok, ) = to.call{value: sendAmt}("");
        require(ok, "TaxAccountingAdapter: native transfer");
    }
}
