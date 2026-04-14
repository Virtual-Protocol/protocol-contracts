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
 * @notice Upgradeable (transparent proxy, same pattern as BondingV5). Pulls agent tokens from `msg.sender`
 *         (`safeTransferFrom` — caller must approve this contract), swaps to `pairToken` via Uniswap V2 with
 *         `to = address(this)`, then deposits into AgentTax via `depositTax`. Actual swap input uses the balance
 *         increase from the pull (fee-on-transfer safe). AgentTokenV4 calls with `msg.sender` = the agent token;
 *         AgentFactoryV7 sweep calls with `msg.sender` = factory after `distributeTaxTokens`.
 * @dev Upgrades are performed via ProxyAdmin, not inside this implementation (no UUPS). Owner may rescue stuck assets
 *      via {emergencyWithdrawERC20} / {emergencyWithdrawNative}.
 *
 *      `taxRecipient` (AgentTaxV2 or successor) is stored on this adapter only — not passed per-call — so AgentTokenV4 does not
 *      embed the tax sink address in calldata (avoids spoofing) and migrating to a new tax contract is an adapter-only change.
 */
contract TaxAccountingAdapter is
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable
{
    using SafeERC20 for IERC20;

    /// @notice AgentTaxV2 (or compatible `depositTax`) — sole destination for swapped quote token.
    address public taxRecipient;

    event TaxRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);

    event TaxSwapDeposited(
        address indexed agentToken,
        address indexed taxRecipient,
        uint256 received
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address initialOwner,
        address taxRecipient_
    ) external initializer {
        __ReentrancyGuard_init();
        __Ownable_init(initialOwner);
        require(taxRecipient_ != address(0), "TaxAccountingAdapter: zero taxRecipient");
        taxRecipient = taxRecipient_;
    }

    /// @notice Point tax accrual at a new AgentTax contract (e.g. migration AgentTaxV2 → v3) without upgrading every agent token.
    function setTaxRecipient(address taxRecipient_) external onlyOwner {
        require(taxRecipient_ != address(0), "TaxAccountingAdapter: zero taxRecipient");
        address previous = taxRecipient;
        taxRecipient = taxRecipient_;
        emit TaxRecipientUpdated(previous, taxRecipient_);
    }

    receive() external payable {}

    /**
     * @param agentToken_ Agent ERC20 (same as `path[0]`). Tokens are pulled from `msg.sender` (must equal allowance giver).
     * @param pairToken_ Quote token (e.g. VIRTUAL).
     * @param router_ Uniswap V2 compatible router (from the agent token; not stored here so one adapter serves all clones).
     * @param swapAmount_ Requested pull amount from `agentToken_`; actual swap input is only the balance increase on this adapter from that pull (fee-on-transfer safe).
     * @param deadline_ Router deadline.
     */
    function swapTaxAndDeposit(
        address agentToken_,
        address pairToken_,
        address router_,
        uint256 swapAmount_,
        uint256 deadline_
    ) external nonReentrant returns (uint256 received) {
        require(taxRecipient != address(0), "TaxAccountingAdapter: taxRecipient unset");
        require(swapAmount_ > 0, "TaxAccountingAdapter: zero swap");
        require(deadline_ >= block.timestamp, "TaxAccountingAdapter: expired");
        require(router_ != address(0), "TaxAccountingAdapter: zero router");

        uint256 agentTokenBalanceBefore = IERC20(agentToken_).balanceOf(address(this));
        IERC20(agentToken_).safeTransferFrom(msg.sender, address(this), swapAmount_);

        // Use the balance *increase* from this pull, not `swapAmount_`: fee-on-transfer / burn on inbound
        // can make received < swapAmount_; router must not pull more than actually sits here. Also ignores
        // any ERC20 already on this contract before this call (non-FOT: increase == swapAmount_ if prior bal was 0).
        uint256 swapIn = IERC20(agentToken_).balanceOf(address(this)) - agentTokenBalanceBefore;
        require(swapIn > 0, "TaxAccountingAdapter: zero in");

        IERC20(agentToken_).forceApprove(router_, swapIn);

        address[] memory path = new address[](2);
        path[0] = agentToken_;
        path[1] = pairToken_;

        uint256 pairTokenBalanceBefore = IERC20(pairToken_).balanceOf(address(this));

        IUniswapV2Router02(router_).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapIn,
            0,
            path,
            address(this),
            deadline_
        );

        received = IERC20(pairToken_).balanceOf(address(this)) - pairTokenBalanceBefore;
        if (received > 0) {
            IERC20(pairToken_).forceApprove(taxRecipient, received);
            IAgentTaxForToken(taxRecipient).depositTax(agentToken_, received);
            IERC20(pairToken_).forceApprove(taxRecipient, 0);
            emit TaxSwapDeposited(agentToken_, taxRecipient, received);
        }

        IERC20(agentToken_).forceApprove(router_, 0);
    }

    /// @notice Rescue ERC20 stuck on this adapter.
    function emergencyWithdrawERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "TaxAccountingAdapter: zero to");
        IERC20 t = IERC20(token);
        uint256 bal = t.balanceOf(address(this));
        require(amount <= bal, "TaxAccountingAdapter: amount exceeds balance");
        t.safeTransfer(to, amount);
    }

    /// @notice Rescue native ETH stuck on this adapter.
    function emergencyWithdrawNative(
        address payable to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "TaxAccountingAdapter: zero to");
        uint256 bal = address(this).balance;
        require(amount <= bal, "TaxAccountingAdapter: amount exceeds balance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "TaxAccountingAdapter: native transfer");
    }
}
