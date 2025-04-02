// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./IBondingTax.sol";
import "../pool/IRouter.sol";

contract BondingTax is
    Initializable,
    AccessControlUpgradeable,
    IBondingTax
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public assetToken;
    address public taxToken;
    IRouter public router;
    address public bondingRouter;
    address public treasury;
    uint256 public minSwapThreshold;
    uint256 public maxSwapThreshold;
    uint16 private _slippage;

    event SwapParamsUpdated(
        address oldRouter,
        address newRouter,
        address oldBondingRouter,
        address newBondingRouter,
        address oldAsset,
        address newAsset
    );
    event SwapThresholdUpdated(
        uint256 oldMinThreshold,
        uint256 newMinThreshold,
        uint256 oldMaxThreshold,
        uint256 newMaxThreshold
    );
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event SwapExecuted(uint256 taxTokenAmount, uint256 assetTokenAmount);
    event SwapFailed(uint256 taxTokenAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyBondingRouter() {
        require(_msgSender() == address(bondingRouter), "Only bonding router");
        _;
    }

    function initialize(
        address defaultAdmin_,
        address assetToken_,
        address taxToken_,
        address router_,
        address bondingRouter_,
        address treasury_,
        uint256 minSwapThreshold_,
        uint256 maxSwapThreshold_
    ) external initializer {
        __AccessControl_init();

        _grantRole(ADMIN_ROLE, defaultAdmin_);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);
        assetToken = assetToken_;
        taxToken = taxToken_;
        router = IRouter(router_);
        bondingRouter = bondingRouter_;
        treasury = treasury_;
        minSwapThreshold = minSwapThreshold_;
        maxSwapThreshold = maxSwapThreshold_;
        IERC20(taxToken).forceApprove(router_, type(uint256).max);

        _slippage = 100; // default to 1%
    }

    function updateSwapParams(
        address router_,
        address bondingRouter_,
        address assetToken_,
        uint16 slippage_
    ) public onlyRole(ADMIN_ROLE) {
        address oldRouter = address(router);
        address oldBondingRouter = bondingRouter;
        address oldAsset = assetToken;

        assetToken = assetToken_;
        router = IRouter(router_);
        bondingRouter = bondingRouter_;
        _slippage = slippage_;

        IERC20(taxToken).forceApprove(router_, type(uint256).max);
        IERC20(taxToken).forceApprove(oldRouter, 0);

        emit SwapParamsUpdated(
            oldRouter,
            router_,
            oldBondingRouter,
            bondingRouter_,
            oldAsset,
            assetToken_
        );
    }

    function updateSwapThresholds(
        uint256 minSwapThreshold_,
        uint256 maxSwapThreshold_
    ) public onlyRole(ADMIN_ROLE) {
        uint256 oldMin = minSwapThreshold;
        uint256 oldMax = maxSwapThreshold;

        minSwapThreshold = minSwapThreshold_;
        maxSwapThreshold = maxSwapThreshold_;

        emit SwapThresholdUpdated(
            oldMin,
            minSwapThreshold_,
            oldMax,
            maxSwapThreshold_
        );
    }

    function updateTreasury(address treasury_) public onlyRole(ADMIN_ROLE) {
        address oldTreasury = treasury;
        treasury = treasury_;

        emit TreasuryUpdated(oldTreasury, treasury_);
    }

    function withdraw(address token) external onlyRole(ADMIN_ROLE) {
        IERC20(token).safeTransfer(
            treasury,
            IERC20(token).balanceOf(address(this))
        );
    }

    function swapForAsset() public onlyBondingRouter returns (bool, uint256) {
        uint256 amount = IERC20(taxToken).balanceOf(address(this));

        if (amount < minSwapThreshold || amount == 0) {
            return (false, 0);
        }

        if (amount > maxSwapThreshold) {
            amount = maxSwapThreshold;
        }

        address[] memory path = new address[](2);
        path[0] = taxToken;
        path[1] = assetToken;

        uint256[] memory amountsOut = router.getAmountsOut(amount, path);
        require(amountsOut.length > 1, "Failed to fetch token price");

        uint256 expectedOutput = amountsOut[1];
        uint256 minOutput = (expectedOutput * (10000 - _slippage)) / 10000;

        try
            router.swapExactTokensForTokens(
                amount,
                minOutput,
                path,
                treasury,
                block.timestamp + 300
            )
        returns (uint256[] memory amounts) {
            emit SwapExecuted(amount, amounts[1]);
            return (true, amounts[1]);
        } catch {
            emit SwapFailed(amount);
            return (false, 0);
        }
    }
}
