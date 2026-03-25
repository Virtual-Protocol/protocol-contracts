// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "../pool/IRouter.sol";

/**
 * @dev Minimal interface for BondingV5 to check token launch types
 */
interface IBondingV5ForTaxV2 {
    function isProject60days(address token) external view returns (bool);
    function isProjectXLaunch(address token) external view returns (bool);
    function isAcpSkillLaunch(address token) external view returns (bool);
}

/**
 * @title AgentTaxV2
 * @notice Simplified tax contract for V3 tokens with on-chain attribution
 * @dev This contract handles tax collection and distribution for tokens launched via BondingV5
 *      - Uses tokenAddress-based attribution (not agentId)
 *      - No dependency on AgentNft or tax-listener
 *      - Cleaner design with only essential functionality
 */
contract AgentTaxV2 is Initializable, AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    struct TaxRecipient {
        address tba;
        address creator;
    }

    struct TaxAmounts {
        uint256 amountCollected;
        uint256 amountSwapped;
    }

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant REGISTER_ROLE = keccak256("REGISTER_ROLE");
    bytes32 public constant SWAP_ROLE = keccak256("SWAP_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    uint256 internal constant DENOM = 10000;

    address public assetToken;
    address public taxToken;
    IRouter public router; // the swap router
    address public treasury;
    uint16 public feeRate;
    uint256 public minSwapThreshold;
    uint256 public maxSwapThreshold;

    mapping(address tokenAddress => TaxRecipient) public tokenRecipients;
    mapping(address tokenAddress => TaxAmounts) public tokenTaxAmounts;

    IBondingV5ForTaxV2 public bondingV5;

    event TokenRegistered(address indexed tokenAddress, address indexed creator, address tba);
    event TaxDeposited(address indexed tokenAddress, uint256 amount);
    event SwapExecuted(address indexed tokenAddress, uint256 taxTokenAmount, uint256 assetTokenAmount);
    event SwapFailed(address indexed tokenAddress, uint256 taxTokenAmount);
    event CreatorUpdated(address indexed tokenAddress, address oldCreator, address newCreator);
    event SwapParamsUpdated(
        address oldRouter,
        address newRouter,
        address oldAsset,
        address newAsset,
        uint16 oldFeeRate,
        uint16 newFeeRate
    );
    event SwapThresholdUpdated(
        uint256 oldMinThreshold,
        uint256 newMinThreshold,
        uint256 oldMaxThreshold,
        uint256 newMaxThreshold
    );
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param defaultAdmin_ The default admin address
     * @param assetToken_ The asset token address (e.g., USDC)
     * @param taxToken_ The tax token address (e.g., VIRTUAL)
     * @param router_ The Uniswap router address
     * @param treasury_ The treasury address for protocol fees
     * @param minSwapThreshold_ Minimum amount to trigger swap
     * @param maxSwapThreshold_ Maximum amount per swap
     * @param feeRate_ Protocol fee rate (out of 10000)
     */
    function initialize(
        address defaultAdmin_,
        address assetToken_,
        address taxToken_,
        address router_,
        address treasury_,
        uint256 minSwapThreshold_,
        uint256 maxSwapThreshold_,
        uint16 feeRate_
    ) external initializer {
        __AccessControl_init();

        require(assetToken_ != taxToken_, "Asset token cannot be same as tax token");
        require(feeRate_ <= DENOM, "Fee rate too high");

        _grantRole(ADMIN_ROLE, defaultAdmin_);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);

        assetToken = assetToken_;
        taxToken = taxToken_;
        router = IRouter(router_);
        treasury = treasury_;
        minSwapThreshold = minSwapThreshold_;
        maxSwapThreshold = maxSwapThreshold_;
        feeRate = feeRate_;

        IERC20(taxToken).forceApprove(router_, type(uint256).max);

        emit SwapParamsUpdated(address(0), router_, address(0), assetToken_, 0, feeRate_);
        emit SwapThresholdUpdated(0, minSwapThreshold_, 0, maxSwapThreshold_);
    }

    // ============ Core Functions ============

    /**
     * @notice Register a token with its tax recipient (creator and TBA)
     * @dev Called by BondingV5 during launch() to associate token with creator
     * @param tokenAddress The address of the agent token
     * @param tba The Token Bound Address for the agent
     * @param creator The creator address that will receive tax rewards
     */
    function registerToken(
        address tokenAddress,
        address tba,
        address creator
    ) external onlyRole(REGISTER_ROLE) {
        require(tokenAddress != address(0), "Invalid token address");
        require(creator != address(0), "Invalid creator");

        tokenRecipients[tokenAddress] = TaxRecipient({
            tba: tba,
            creator: creator
        });

        emit TokenRegistered(tokenAddress, creator, tba);
    }

    /**
     * @notice Deposit tax for a specific token
     * @dev Called by FRouterV3 and AgentTokenV3 during trades
     *      Caller must have approved this contract to spend taxToken
     * @param tokenAddress The address of the agent token
     * @param amount The amount of tax being deposited
     */
    function depositTax(address tokenAddress, uint256 amount) external {
        TaxRecipient memory recipient = tokenRecipients[tokenAddress];
        require(recipient.creator != address(0), "Token not registered");
        require(amount > 0, "Amount must be greater than 0");

        IERC20(taxToken).safeTransferFrom(msg.sender, address(this), amount);

        TaxAmounts storage amounts = tokenTaxAmounts[tokenAddress];
        amounts.amountCollected += amount;

        emit TaxDeposited(tokenAddress, amount);
    }

    /**
     * @notice Backend-triggered swap for a specific token's accumulated tax
     * @dev Only backend can trigger swaps to ensure proper price verification.
     *      Backend should verify conversion rate externally before calling.
     * @param tokenAddress The address of the agent token to swap taxes for
     * @param minOutput Minimum output amount (calculated by backend with proper price check)
     */
    function swapForTokenAddress(
        address tokenAddress,
        uint256 minOutput
    ) external onlyRole(SWAP_ROLE) {
        TaxRecipient memory recipient = tokenRecipients[tokenAddress];
        require(recipient.creator != address(0), "Token not registered");

        TaxAmounts storage amounts = tokenTaxAmounts[tokenAddress];
        _swapAndDistribute(tokenAddress, recipient, amounts, minOutput);
    }

    /**
     * @notice Batch swap for multiple tokens
     * @param tokenAddresses Array of token addresses to swap
     * @param minOutputs Array of minimum output amounts (same length as tokenAddresses)
     */
    function batchSwapForTokenAddress(
        address[] memory tokenAddresses,
        uint256[] memory minOutputs
    ) external onlyRole(SWAP_ROLE) {
        require(tokenAddresses.length == minOutputs.length, "Length mismatch");

        // Trade-off: keep per-token swap/distribution instead of aggregating all pending tax
        // into one large swap. This path is currently low-frequency, so we prioritize
        // correctness/isolation over gas optimization:
        // - Per-token minOutput/slippage checks remain explicit.
        // - Per-token accounting and recipient attribution stay simple/auditable.
        // - A single token issue does not block others in the batch.
        // If execution frequency increases materially, revisit aggregate-swap design.
        for (uint i = 0; i < tokenAddresses.length; i++) {
            address tokenAddress = tokenAddresses[i];
            TaxRecipient memory recipient = tokenRecipients[tokenAddress];
            
            if (recipient.creator == address(0)) {
                continue;
            }

            TaxAmounts storage amounts = tokenTaxAmounts[tokenAddress];
            _swapAndDistribute(tokenAddress, recipient, amounts, minOutputs[i]);
        }
    }

/**
     * @notice Update tax recipient for special launch agents (Project60days, X_LAUNCH, or ACP_SKILL)
     * @dev Called by backend for tokens that need creator updates:
     * 
     *      Project60days tokens:
     *        - After graduation: set creator = vaultAddress (60-day lock)
     *        - After COMMIT: set creator = walletAddress (creator receives tax)
     * 
     *      X_LAUNCH / ACP_SKILL tokens:
     *        - Before launch: set creator = taxRecipient (partner address)
     * 
     * @param tokenAddress The address of the agent token
     * @param tba The Token Bound Address (usually same as dbVirtuals.walletAddress)
     * @param creator The creator address that will receive tax rewards
     */
    function updateCreatorForSpecialLaunchAgents(
        address tokenAddress,
        address tba,
        address creator
    ) external onlyRole(EXECUTOR_ROLE) {
        require(address(bondingV5) != address(0), "BondingV5 not set");
        require(tokenAddress != address(0), "Invalid token address");
        require(tba != address(0), "Invalid TBA");
        require(creator != address(0), "Invalid creator");

        bool isSpecialLaunch = bondingV5.isProject60days(tokenAddress) ||
            bondingV5.isProjectXLaunch(tokenAddress) ||
            bondingV5.isAcpSkillLaunch(tokenAddress);

        require(isSpecialLaunch, "Token is not a special launch type");

        TaxRecipient storage recipient = tokenRecipients[tokenAddress];
        require(recipient.creator != address(0), "Token not registered");

        address oldCreator = recipient.creator;
        recipient.tba = tba;
        recipient.creator = creator;

        emit CreatorUpdated(tokenAddress, oldCreator, creator);
    }

    // ============ Internal Functions ============

    /**
     * @notice Internal function to swap accumulated tax and distribute
     */
    function _swapAndDistribute(
        address tokenAddress,
        TaxRecipient memory recipient,
        TaxAmounts storage amounts,
        uint256 minOutput
    ) internal {
        uint256 amountToSwap = amounts.amountCollected - amounts.amountSwapped;

        if (amountToSwap < minSwapThreshold) {
            return;
        }

        if (amountToSwap > maxSwapThreshold) {
            amountToSwap = maxSwapThreshold;
        }

        uint256 balance = IERC20(taxToken).balanceOf(address(this));
        if (balance < amountToSwap) {
            return;
        }

        address[] memory path = new address[](2);
        path[0] = taxToken;
        path[1] = assetToken;

        uint256[] memory amountsOut = router.getAmountsOut(amountToSwap, path);
        require(amountsOut.length > 1, "Failed to fetch token price");

        try
            router.swapExactTokensForTokens(
                amountToSwap,
                minOutput,
                path,
                address(this),
                block.timestamp + 300
            )
        returns (uint256[] memory swapAmounts) {
            uint256 assetReceived = swapAmounts[1];
            emit SwapExecuted(tokenAddress, amountToSwap, assetReceived);

            uint256 protocolFee = (assetReceived * feeRate) / DENOM;
            uint256 creatorFee = assetReceived - protocolFee;

            if (creatorFee > 0) {
                IERC20(assetToken).safeTransfer(recipient.creator, creatorFee);
            }

            if (protocolFee > 0) {
                IERC20(assetToken).safeTransfer(treasury, protocolFee);
            }

            amounts.amountSwapped += amountToSwap;
        } catch {
            emit SwapFailed(tokenAddress, amountToSwap);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get the tax recipient for a token
     */
    function getTokenRecipient(
        address tokenAddress
    ) external view returns (address tba, address creator) {
        TaxRecipient memory recipient = tokenRecipients[tokenAddress];
        return (recipient.tba, recipient.creator);
    }

    /**
     * @notice Get tax amounts for a token
     */
    function getTokenTaxAmounts(
        address tokenAddress
    ) external view returns (uint256 amountCollected, uint256 amountSwapped) {
        TaxAmounts memory amounts = tokenTaxAmounts[tokenAddress];
        return (amounts.amountCollected, amounts.amountSwapped);
    }

    // ============ Creator Functions ============

    /**
     * @notice Update the creator for a registered token
     * @dev Only current creator or admin can update
     */
    function updateCreator(
        address tokenAddress,
        address newCreator
    ) external {
        TaxRecipient storage recipient = tokenRecipients[tokenAddress];
        require(recipient.creator != address(0), "Token not registered");
        require(newCreator != address(0), "Invalid new creator");

        address sender = _msgSender();
        require(
            sender == recipient.creator || hasRole(ADMIN_ROLE, sender),
            "Only creator or admin can update"
        );

        address oldCreator = recipient.creator;
        recipient.creator = newCreator;

        emit CreatorUpdated(tokenAddress, oldCreator, newCreator);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set BondingV5 contract address
     * @param bondingV5_ The address of the BondingV5 contract
     */
    function setBondingV5(address bondingV5_) external onlyRole(ADMIN_ROLE) {
        require(bondingV5_ != address(0), "Invalid BondingV5 address");
        bondingV5 = IBondingV5ForTaxV2(bondingV5_);
    }

    /**
     * @notice Update swap parameters
     */
    function updateSwapParams(
        address router_,
        address assetToken_,
        uint16 feeRate_
    ) external onlyRole(ADMIN_ROLE) {
        require(feeRate_ <= DENOM, "Fee rate too high");

        address oldRouter = address(router);
        address oldAsset = assetToken;
        uint16 oldFee = feeRate;

        IERC20(taxToken).forceApprove(oldRouter, 0);
        IERC20(taxToken).forceApprove(router_, type(uint256).max);

        router = IRouter(router_);
        assetToken = assetToken_;
        feeRate = feeRate_;

        emit SwapParamsUpdated(oldRouter, router_, oldAsset, assetToken_, oldFee, feeRate_);
    }

    /**
     * @notice Update swap thresholds
     */
    function updateSwapThresholds(
        uint256 minSwapThreshold_,
        uint256 maxSwapThreshold_
    ) external onlyRole(ADMIN_ROLE) {
        uint256 oldMin = minSwapThreshold;
        uint256 oldMax = maxSwapThreshold;

        minSwapThreshold = minSwapThreshold_;
        maxSwapThreshold = maxSwapThreshold_;

        emit SwapThresholdUpdated(oldMin, minSwapThreshold_, oldMax, maxSwapThreshold_);
    }

    /**
     * @notice Update treasury address
     */
    function updateTreasury(address treasury_) external onlyRole(ADMIN_ROLE) {
        require(treasury_ != address(0), "Invalid treasury");
        address oldTreasury = treasury;
        treasury = treasury_;
        emit TreasuryUpdated(oldTreasury, treasury_);
    }

    /**
     * @notice Emergency withdraw tokens
     */
    function withdraw(address token) external onlyRole(ADMIN_ROLE) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(treasury, balance);
        }
    }
}
