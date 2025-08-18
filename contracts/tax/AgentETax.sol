// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "../pool/IRouter.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract AgentETax is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;
    struct TaxHistory {
        address tokenAddress;
        uint256 amount;
    }

    struct TaxAmounts {
        uint256 amountCollected;
        uint256 amountSwapped;
    }

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    uint256 internal constant DENOM = 10000;

    address public assetToken;
    address public taxToken;
    IRouter public router;
    address public treasury;
    uint16 public feeRate;
    uint256 public minSwapThreshold;
    uint256 public maxSwapThreshold;

    event SwapThresholdUpdated(
        uint256 oldMinThreshold,
        uint256 newMinThreshold,
        uint256 oldMaxThreshold,
        uint256 newMaxThreshold
    );
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event SwapExecuted(
        address indexed tokenAddress,
        uint256 taxTokenAmount,
        uint256 assetTokenAmount
    );
    event TaxCollected(
        bytes indexed checksum,
        address tokenAddress,
        uint256 amount
    );

    mapping(bytes checksum => TaxHistory history) public taxHistory;
    mapping(address tokenAddress => TaxAmounts amounts) public agentTaxAmounts;

    error ChecksumExists(bytes checksum);

    event SwapParamsUpdated(
        address oldRouter,
        address newRouter,
        address oldAsset,
        address newAsset,
        uint16 oldFeeRate,
        uint16 newFeeRate
    );

    mapping(address tokenAddress => address creator) private _agentCreators;

    event CreatorUpdated(
        address tokenAddress,
        address oldCreator,
        address newCreator
    );

    error CreatorNotSet(address tokenAddress);
    error InvalidCreator(address creator);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address defaultAdmin_,
        address assetToken_,
        address taxToken_,
        address router_,
        address treasury_,
        uint256 minSwapThreshold_,
        uint256 maxSwapThreshold_
    ) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();

        require(
            assetToken_ != taxToken_,
            "Asset token cannot be same as tax token"
        );
        require(defaultAdmin_ != address(0), "Invalid admin");
        require(router_ != address(0), "Invalid router");
        require(treasury_ != address(0), "Invalid treasury");
        require(minSwapThreshold_ <= maxSwapThreshold_, "Invalid thresholds");

        _grantRole(ADMIN_ROLE, defaultAdmin_);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);
        assetToken = assetToken_;
        taxToken = taxToken_;
        router = IRouter(router_);
        treasury = treasury_;
        minSwapThreshold = minSwapThreshold_;
        maxSwapThreshold = maxSwapThreshold_;
        IERC20(taxToken).forceApprove(router_, type(uint256).max);

        feeRate = 3000;

        emit SwapParamsUpdated(
            address(0),
            router_,
            address(0),
            assetToken_,
            0,
            feeRate
        );
        emit SwapThresholdUpdated(0, minSwapThreshold_, 0, maxSwapThreshold_);
    }

    function updateSwapParams(
        address router_,
        address assetToken_,
        uint16 feeRate_
    ) public onlyRole(ADMIN_ROLE) {
        require(router_ != address(0), "Invalid router");
        require(assetToken_ != address(0), "Invalid asset token");
        require(assetToken_ != taxToken, "Asset cannot be tax token");
        require(feeRate_ <= DENOM, "Invalid fee rate");

        address oldRouter = address(router);
        address oldAsset = assetToken;
        uint16 oldFee = feeRate;

        assetToken = assetToken_;
        router = IRouter(router_);
        feeRate = feeRate_;

        IERC20(taxToken).forceApprove(oldRouter, 0);
        IERC20(taxToken).forceApprove(router_, type(uint256).max);

        emit SwapParamsUpdated(
            oldRouter,
            router_,
            oldAsset,
            assetToken_,
            oldFee,
            feeRate_
        );
    }

    function updateSwapThresholds(
        uint256 minSwapThreshold_,
        uint256 maxSwapThreshold_
    ) public onlyRole(ADMIN_ROLE) {
        require(minSwapThreshold_ <= maxSwapThreshold_, "Invalid thresholds");
        require(maxSwapThreshold_ > 0, "Max threshold must be positive");

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
        require(treasury_ != address(0), "Invalid treasury");
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

    function handleAgentTaxes(
        address tokenAddress,
        address creator,
        bytes memory checksum,
        uint256 amount,
        uint256 minOutput
    ) public onlyRole(EXECUTOR_ROLE) {
        require(tokenAddress != address(0), "Invalid token address");
        require(creator != address(0), "Invalid creator");
        require(amount > 0, "Invalid amount");
        require(checksum.length > 0, "Invalid checksum");

        TaxAmounts storage agentAmounts = agentTaxAmounts[tokenAddress];
        if (taxHistory[checksum].tokenAddress != address(0)) {
            revert ChecksumExists(checksum);
        }
        taxHistory[checksum] = TaxHistory(tokenAddress, amount);
        agentAmounts.amountCollected += amount;
        if (_agentCreators[tokenAddress] != creator) {
            _agentCreators[tokenAddress] = creator;
        }
        _swapForAsset(tokenAddress, minOutput, maxSwapThreshold);
    }

    function _swapForAsset(
        address tokenAddress,
        uint256 minOutput,
        uint256 maxOverride
    ) internal nonReentrant returns (bool, uint256) {
        TaxAmounts storage agentAmounts = agentTaxAmounts[tokenAddress];

        if (agentAmounts.amountSwapped >= agentAmounts.amountCollected) {
            return (false, 0);
        }

        uint256 amountToSwap = agentAmounts.amountCollected -
            agentAmounts.amountSwapped;

        uint256 balance = IERC20(taxToken).balanceOf(address(this));

        require(balance >= amountToSwap, "Insufficient balance");

        address creator = _agentCreators[tokenAddress];

        if (address(0) == creator) {
            revert CreatorNotSet(tokenAddress);
        }

        if (amountToSwap < minSwapThreshold) {
            return (false, 0);
        }

        if (amountToSwap > maxOverride) {
            amountToSwap = maxOverride;
        }

        address[] memory path = new address[](2);
        path[0] = taxToken;
        path[1] = assetToken;

        uint256[] memory amountsOut = router.getAmountsOut(amountToSwap, path);
        require(amountsOut.length > 1, "Failed to fetch token price");

        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountToSwap,
            minOutput,
            path,
            address(this),
            block.timestamp + 60
        );

        uint256 assetReceived = amounts[1];
        emit SwapExecuted(tokenAddress, amountToSwap, assetReceived);

        uint256 feeAmount = (assetReceived * feeRate) / DENOM;
        uint256 creatorFee = assetReceived - feeAmount;

        if (creatorFee > 0) {
            IERC20(assetToken).safeTransfer(creator, creatorFee);
        }

        if (feeAmount > 0) {
            IERC20(assetToken).safeTransfer(treasury, feeAmount);
        }

        agentAmounts.amountSwapped += amountToSwap;

        return (true, amounts[1]);
    }

    function updateCreator(
        address tokenAddress,
        address creator
    ) public onlyRole(ADMIN_ROLE) {
        if (address(0) == creator) {
            revert InvalidCreator(creator);
        }
        address oldCreator = _agentCreators[tokenAddress];
        _agentCreators[tokenAddress] = creator;
        emit CreatorUpdated(tokenAddress, oldCreator, creator);
    }

    function dcaSell(
        address[] memory tokenAddresses,
        uint256 slippage,
        uint256 maxOverride
    ) public onlyRole(EXECUTOR_ROLE) {
        require(slippage <= DENOM, "Invalid slippage");
        require(tokenAddresses.length <= 100, "Too many tokens");
        for (uint i = 0; i < tokenAddresses.length; i++) {
            address tokenAddress = tokenAddresses[i];

            TaxAmounts memory agentAmounts = agentTaxAmounts[tokenAddress];
            uint256 amountToSwap = agentAmounts.amountCollected -
                agentAmounts.amountSwapped;

            if (amountToSwap < minSwapThreshold) {
                continue;
            }

            address[] memory path = new address[](2);
            path[0] = taxToken;
            path[1] = assetToken;

            uint256[] memory amountsOut = router.getAmountsOut(
                amountToSwap,
                path
            );

            uint256 minOutput = amountsOut[1] -
                ((amountsOut[1] * slippage) / DENOM);

            _swapForAsset(tokenAddress, minOutput, maxOverride);
        }
    }
}
