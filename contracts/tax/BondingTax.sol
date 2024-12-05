// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./IBondingTax.sol";

interface IRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract BondingTax is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    IBondingTax
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address assetToken;
    address taxToken;
    IRouter router;
    address treasury;
    uint256 swapThreshold;

    event SwapParamsUpdated(
        address oldRouter,
        address newRouter,
        address oldAsset,
        address newAsset,
        uint256 oldSwapThreshold,
        uint256 newSwapThreshold
    );
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event SwapExecuted(uint256 taxTokenAmount, uint256 assetTokenAmount);

    function initialize(
        address defaultAdmin_,
        address assetToken_,
        address taxToken_,
        address router_,
        address treasury_,
        uint256 swapThreshold_
    ) external initializer {
        _grantRole(ADMIN_ROLE, defaultAdmin_);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);
        assetToken = assetToken_;
        taxToken = taxToken_;
        router = IRouter(router_);
        treasury = treasury_;
        swapThreshold = swapThreshold_;
        IERC20(taxToken).approve(router_, type(uint256).max);
    }

    function updateSwapParams(
        address router_,
        address assetToken_,
        uint256 swapThreshold_
    ) public onlyRole(ADMIN_ROLE) {
        address oldRouter = address(router);
        address oldAsset = assetToken;
        uint256 oldThreshold = swapThreshold;

        assetToken = assetToken_;
        router = IRouter(router_);
        swapThreshold = swapThreshold_;

        IERC20(taxToken).approve(router_, type(uint256).max);
        IERC20(taxToken).approve(oldRouter, 0);

        emit SwapParamsUpdated(
            oldRouter,
            router_,
            oldAsset,
            assetToken_,
            oldThreshold,
            swapThreshold_
        );
    }

    function updateTreasury(address treasury_) public onlyRole(ADMIN_ROLE) {
        address oldTreasury = treasury;
        treasury = treasury_;

        emit TreasuryUpdated(oldTreasury, treasury_);
    }

    function claim(address token) external onlyRole(ADMIN_ROLE) {
        IERC20(token).safeTransfer(
            treasury,
            IERC20(token).balanceOf(address(this))
        );
    }

    function swapForAsset() public returns (bool, uint256) {
        uint256 amount = IERC20(taxToken).balanceOf(address(this));

        require(amount > 0, "Nothing to be swapped");

        address[] memory path;
        path[0] = taxToken;
        path[1] = assetToken;

        uint256[] memory amounts = router.swapExactTokensForTokens(
            amount,
            0,
            path,
            treasury,
            block.timestamp + 300
        );

        emit SwapExecuted(amount, amounts[1]);

        return (true, amounts[1]);
    }
}
