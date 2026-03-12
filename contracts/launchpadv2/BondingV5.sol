// SPDX-License-Identifier: MIT
// Modified from https://github.com/sourlodine/Pump.fun-Smart-Contract/blob/main/contracts/PumpFun.sol
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./BondingConfig.sol";
import "./IFPairV2.sol";
import "../virtualPersona/IAgentTokenV2.sol";

// Minimal interfaces to reduce contract size (matches FFactoryV2/FRouterV2)
interface IFFactoryV2Minimal {
    function createPair(
        address tokenA,
        address tokenB,
        uint256 startTime,
        uint256 startTimeDelay
    ) external returns (address pair);
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IFRouterV2Minimal {
    function assetToken() external view returns (address);
    function addInitialLiquidity(address token, uint256 amountToken, uint256 amountAsset) external;
    function buy(uint256 amountIn, address tokenAddress, address to, bool isInitialPurchase) external returns (uint256, uint256);
    function sell(uint256 amountIn, address tokenAddress, address to) external returns (uint256, uint256);
    function graduate(address tokenAddress) external;
    function setTaxStartTime(address pairAddress, uint256 taxStartTime) external;
    function hasAntiSniperTax(address pairAddress) external view returns (bool);
}

interface IAgentFactoryV6Minimal {
    function createNewAgentTokenAndApplication(
        string memory name,
        string memory symbol,
        bytes memory tokenSupplyParams,
        uint8[] memory cores,
        bytes32 tbaSalt,
        address tbaImplementation,
        uint32 daoVotingPeriod,
        uint256 daoThreshold,
        uint256 applicationThreshold,
        address creator
    ) external returns (address, uint256);
    function addBlacklistAddress(address token, address addr) external;
    function removeBlacklistAddress(address token, address addr) external;
    function updateApplicationThresholdWithApplicationId(uint256 applicationId, uint256 applicationThreshold) external;
    function executeBondingCurveApplicationSalt(
        uint256 id,
        uint256 totalSupply,
        uint256 lpSupply,
        address vault,
        bytes32 salt
    ) external returns (address);
}

contract BondingV5 is
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable
{
    using SafeERC20 for IERC20;

    IFFactoryV2Minimal public factory;
    IFRouterV2Minimal public router;
    IAgentFactoryV6Minimal public agentFactory;
    BondingConfig public bondingConfig; // Configuration contract for multi-chain launch modes

    mapping(address => BondingConfig.Token) public tokenInfo;
    address[] public tokenInfos;

    // this is for BE to separate with old virtualId from bondingV1, but this field is not used yet
    uint256 public constant VirtualIdBase = 50_000_000_000;

    // Mapping to store configurable launch parameters for each token
    mapping(address => BondingConfig.LaunchParams) public tokenLaunchParams;

    // Mapping to store graduation threshold for each token (calculated per-token based on airdropBips and needAcf)
    mapping(address => uint256) public tokenGradThreshold;

    event PreLaunched(
        address indexed token,
        address indexed pair,
        uint256 virtualId,
        uint256 initialPurchase,
        BondingConfig.LaunchParams launchParams
    );
    event Launched(
        address indexed token,
        address indexed pair,
        uint256 virtualId,
        uint256 initialPurchase,
        uint256 initialPurchasedAmount,
        BondingConfig.LaunchParams launchParams
    );
    event CancelledLaunch(
        address indexed token,
        address indexed pair,
        uint,
        uint256 initialPurchase
    );
    event Graduated(address indexed token, address agentToken);

    error InvalidTokenStatus();
    error InvalidInput();
    error SlippageTooHigh();
    error UnauthorizedLauncher();
    error LaunchModeNotEnabled();
    error InvalidAntiSniperType();
    error InvalidSpecialLaunchParams();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address router_,
        address agentFactory_,
        address bondingConfig_
    ) external initializer {
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();

        factory = IFFactoryV2Minimal(factory_);
        router = IFRouterV2Minimal(router_);
        agentFactory = IAgentFactoryV6Minimal(agentFactory_);
        bondingConfig = BondingConfig(bondingConfig_);
    }

    function preLaunch(
        string memory name_,
        string memory ticker_,
        uint8[] memory cores_,
        string memory desc_,
        string memory img_,
        string[4] memory urls_,
        uint256 purchaseAmount_,
        uint256 startTime_,
        uint8 launchMode_,
        uint16 airdropBips_,
        bool needAcf_,
        uint8 antiSniperTaxType_,
        bool isProject60days_
    ) public nonReentrant returns (address, address, uint, uint256) {
        // Fail-fast: validate reserve bips and calculate bonding curve supply upfront
        // This validates: airdropBips <= maxAirdropBips AND totalReserved < maxTotalReservedBips
        uint256 bondingCurveSupplyBase = bondingConfig.calculateBondingCurveSupply(airdropBips_, needAcf_);

        // Validate anti-sniper tax type
        if (!bondingConfig.isValidAntiSniperType(antiSniperTaxType_)) {
            revert InvalidAntiSniperType();
        }

        if (cores_.length <= 0) {
            revert InvalidInput();
        }

        // Determine if this is an immediate launch or scheduled launch
        // Immediate launch: startTime < now + scheduledLaunchStartTimeDelay
        // Scheduled launch: startTime >= now + scheduledLaunchStartTimeDelay
        BondingConfig.ScheduledLaunchParams memory scheduledParams = bondingConfig.scheduledLaunchParams();
        uint256 scheduledThreshold = block.timestamp + scheduledParams.startTimeDelay;
        bool isScheduledLaunch = startTime_ >= scheduledThreshold;

        // Validate launch mode, authorization, and mode-specific requirements
        _validateLaunchMode(
            launchMode_,
            antiSniperTaxType_,
            airdropBips_,
            needAcf_,
            isProject60days_,
            isScheduledLaunch
        );

        uint256 actualStartTime;
        uint256 actualStartTimeDelay;
        
        if (isScheduledLaunch) {
            // Scheduled launch: use provided startTime
            actualStartTime = startTime_;
            actualStartTimeDelay = scheduledParams.startTimeDelay;
        } else {
            // Immediate launch: start immediately
            actualStartTime = block.timestamp;
            actualStartTimeDelay = 0;
        }

        // Calculate launch fee based on launch type and ACF requirement
        // Fee structure:
        // - Immediate launch, no ACF: 0
        // - Immediate launch, with ACF: acfFee
        // - Scheduled launch, no ACF: normalLaunchFee
        // - Scheduled launch, with ACF: normalLaunchFee + acfFee
        uint256 launchFee = bondingConfig.calculateLaunchFee(isScheduledLaunch, needAcf_);

        if (purchaseAmount_ < launchFee) {
            revert InvalidInput();
        }

        address assetToken = router.assetToken();

        uint256 initialPurchase = (purchaseAmount_ - launchFee);
        if (launchFee > 0) {
            IERC20(assetToken).safeTransferFrom(msg.sender, bondingConfig.feeTo(), launchFee);
        }
        IERC20(assetToken).safeTransferFrom(
            msg.sender,
            address(this),
            initialPurchase
        );

        uint256 configInitialSupply = bondingConfig.initialSupply();
        BondingConfig.DeployParams memory deployParams = bondingConfig.deployParams();
        
        (address token, uint256 applicationId) = agentFactory
            .createNewAgentTokenAndApplication(
                name_, // without "fun " prefix
                ticker_,
                abi.encode(
                    // tokenSupplyParams
                    configInitialSupply,
                    0, // lpSupply, will mint to agentTokenAddress
                    configInitialSupply, // vaultSupply, will mint to vault
                    configInitialSupply,
                    configInitialSupply,
                    0,
                    address(this) // vault, is the bonding contract itself
                ),
                cores_,
                deployParams.tbaSalt,
                deployParams.tbaImplementation,
                deployParams.daoVotingPeriod,
                deployParams.daoThreshold,
                0, // applicationThreshold_
                msg.sender // token creator
            );
        // this is to prevent transfer to blacklist address before graduation
        agentFactory.addBlacklistAddress(
            token,
            IAgentTokenV2(token).liquidityPools()[0]
        );

        // Calculate bonding curve supply in wei (base supply was validated at the beginning)
        uint256 bondingCurveSupply = bondingCurveSupplyBase * (10 ** IAgentTokenV2(token).decimals());
        // Calculate total reserved supply for transfer
        uint256 totalReservedSupply = configInitialSupply - bondingCurveSupplyBase;

        address pair = factory.createPair(
            token,
            assetToken,
            actualStartTime,
            actualStartTimeDelay
        );

        require(_approval(address(router), token, bondingCurveSupply));

        // Get fixed fake initial virtual liquidity
        uint256 liquidity = bondingConfig.getFakeInitialVirtualLiq();
        uint256 price = bondingCurveSupply / liquidity;

        router.addInitialLiquidity(token, bondingCurveSupply, liquidity);
        
        // Transfer reserved tokens (airdrop + ACF if needed) to teamTokenReservedWallet
        if (totalReservedSupply > 0) {
            IERC20(token).safeTransfer(
                bondingConfig.teamTokenReservedWallet(),
                totalReservedSupply * (10 ** IAgentTokenV2(token).decimals())
            );
        }

        // Calculate and store per-token graduation threshold
        uint256 gradThreshold = bondingConfig.calculateGradThreshold(bondingCurveSupply);
        tokenGradThreshold[token] = gradThreshold;

        tokenInfos.push(token);

        // Use storage reference to avoid stack overflow
        BondingConfig.Token storage newToken = tokenInfo[token];
        newToken.creator = msg.sender;
        newToken.token = token;
        newToken.agentToken = address(0);
        newToken.pair = pair;
        newToken.description = desc_;
        newToken.cores = cores_;
        newToken.image = img_;
        newToken.twitter = urls_[0];
        newToken.telegram = urls_[1];
        newToken.youtube = urls_[2];
        newToken.website = urls_[3];
        newToken.trading = true;
        newToken.tradingOnUniswap = false;
        newToken.applicationId = applicationId;
        newToken.initialPurchase = initialPurchase;
        newToken.virtualId = VirtualIdBase + tokenInfos.length;
        newToken.launchExecuted = false;

        // Store V5 configurable launch parameters
        tokenLaunchParams[token] = BondingConfig.LaunchParams({
            launchMode: launchMode_,
            airdropBips: airdropBips_,
            needAcf: needAcf_,
            antiSniperTaxType: antiSniperTaxType_,
            isProject60days: isProject60days_
        });

        // Set Data struct fields
        newToken.data.token = token;
        newToken.data.name = name_;
        newToken.data._name = name_;
        newToken.data.ticker = ticker_;
        newToken.data.supply = bondingCurveSupply;
        newToken.data.price = price;
        newToken.data.marketCap = liquidity;
        newToken.data.liquidity = liquidity * 2;
        newToken.data.volume = 0;
        newToken.data.volume24H = 0;
        newToken.data.prevPrice = price;
        newToken.data.lastUpdated = block.timestamp;

        emit PreLaunched(
            token,
            pair,
            tokenInfo[token].virtualId,
            initialPurchase,
            tokenLaunchParams[token]
        );

        return (token, pair, tokenInfo[token].virtualId, initialPurchase);
    }

    function cancelLaunch(address tokenAddress_) public {
        BondingConfig.Token storage tokenRef = tokenInfo[tokenAddress_];

        // Validate that the token exists and was properly prelaunched
        if (tokenRef.token == address(0) || tokenRef.pair == address(0)) {
            revert InvalidInput();
        }

        if (msg.sender != tokenRef.creator) {
            revert InvalidInput();
        }

        // Validate that the token has not been launched (or cancelled)
        if (tokenRef.launchExecuted) {
            revert InvalidTokenStatus();
        }

        if (tokenRef.initialPurchase > 0) {
            IERC20(router.assetToken()).safeTransfer(
                tokenRef.creator,
                tokenRef.initialPurchase
            );
        }

        tokenRef.initialPurchase = 0; // prevent duplicate transfer initialPurchase back to the creator
        tokenRef.launchExecuted = true; // pretend it has been launched (cancelled) and prevent duplicate launch

        emit CancelledLaunch(
            tokenAddress_,
            tokenRef.pair,
            tokenInfo[tokenAddress_].virtualId,
            tokenRef.initialPurchase
        );
    }

    function launch(
        address tokenAddress_
    ) public nonReentrant returns (address, address, uint, uint256) {
        BondingConfig.Token storage tokenRef = tokenInfo[tokenAddress_];

        // Validate that the token exists and was properly prelaunched
        if (tokenRef.token == address(0) || tokenRef.pair == address(0)) {
            revert InvalidInput();
        }

        if (tokenRef.launchExecuted) {
            revert InvalidTokenStatus();
        }

        // If initialPurchase == 0, the function marks the token as launched
        // while swaps remain blocked (since enabling depends solely on time),
        // resulting in an inconsistent "launched but not tradable" state, also the 550M is go to teamTokenReservedWallet
        // so we need to check the start time of the pair
        IFPairV2 pairContract = IFPairV2(tokenRef.pair);
        if (block.timestamp < pairContract.startTime()) {
            revert InvalidInput();
        }

        // Set tax start time to current block timestamp for proper anti-sniper tax calculation
        router.setTaxStartTime(tokenRef.pair, block.timestamp);

        // Make initial purchase for creator
        // bondingContract will transfer initialPurchase $Virtual to pairAddress
        // pairAddress will transfer amountsOut $agentToken to bondingContract
        // bondingContract then will transfer all the amountsOut $agentToken to teamTokenReservedWallet
        // in the BE, teamTokenReservedWallet will split it out for the initialBuy and 550M
        uint256 amountOut = 0;
        uint256 initialPurchase = tokenRef.initialPurchase;
        if (initialPurchase > 0) {
            IERC20(router.assetToken()).forceApprove(
                address(router),
                initialPurchase
            );
            amountOut = _buy(
                address(this),
                initialPurchase, // will raise error if initialPurchase <= 0
                tokenAddress_,
                0,
                block.timestamp + 300,
                true // isInitialPurchase = true for creator's purchase
            );
            // creator's initialBoughtToken need to go to teamTokenReservedWallet for locking, not to creator
            IERC20(tokenAddress_).safeTransfer(
                bondingConfig.teamTokenReservedWallet(),
                amountOut
            );

            // update initialPurchase and launchExecuted to prevent duplicate purchase
            tokenRef.initialPurchase = 0;
        }

        emit Launched(
            tokenAddress_,
            tokenRef.pair,
            tokenInfo[tokenAddress_].virtualId,
            initialPurchase,
            amountOut,
            tokenLaunchParams[tokenAddress_]
        );
        tokenRef.launchExecuted = true;

        return (
            tokenAddress_,
            tokenRef.pair,
            tokenInfo[tokenAddress_].virtualId,
            initialPurchase
        );
    }

    function sell(
        uint256 amountIn_,
        address tokenAddress_,
        uint256 amountOutMin_,
        uint256 deadline_
    ) public returns (bool) {
        // this alrealy prevented it's a not-exists token
        if (!tokenInfo[tokenAddress_].trading) {
            revert InvalidTokenStatus();
        }

        // this is to prevent sell before launch
        if (!tokenInfo[tokenAddress_].launchExecuted) {
            revert InvalidTokenStatus();
        }

        if (block.timestamp > deadline_) {
            revert InvalidInput();
        }

        (uint256 amount0In, uint256 amount1Out) = router.sell(
            amountIn_,
            tokenAddress_,
            msg.sender
        );

        if (amount1Out < amountOutMin_) {
            revert SlippageTooHigh();
        }

        uint256 duration = block.timestamp -
            tokenInfo[tokenAddress_].data.lastUpdated;

        if (duration > 86400) {
            tokenInfo[tokenAddress_].data.lastUpdated = block.timestamp;
        }

        return true;
    }

    function _buy(
        address buyer_,
        uint256 amountIn_,
        address tokenAddress_,
        uint256 amountOutMin_,
        uint256 deadline_,
        bool isInitialPurchase_
    ) internal returns (uint256) {
        if (block.timestamp > deadline_) {
            revert InvalidInput();
        }
        address pairAddress = factory.getPair(
            tokenAddress_,
            router.assetToken()
        );

        IFPairV2 pairContract = IFPairV2(pairAddress);

        (uint256 reserveA, uint256 reserveB) = pairContract.getReserves();

        (uint256 amount1In, uint256 amount0Out) = router.buy(
            amountIn_,
            tokenAddress_,
            buyer_,
            isInitialPurchase_
        );

        if (amount0Out < amountOutMin_) {
            revert SlippageTooHigh();
        }

        uint256 newReserveA = reserveA - amount0Out;
        uint256 duration = block.timestamp -
            tokenInfo[tokenAddress_].data.lastUpdated;

        if (duration > 86400) {
            tokenInfo[tokenAddress_].data.lastUpdated = block.timestamp;
        }

        // Get per-token gradThreshold (calculated during preLaunch based on airdropBips and needAcf)
        uint256 gradThreshold = tokenGradThreshold[tokenAddress_];

        if (
            newReserveA <= gradThreshold &&
            !router.hasAntiSniperTax(pairAddress) &&
            tokenInfo[tokenAddress_].trading
        ) {
            _openTradingOnUniswap(tokenAddress_);
        }

        return amount0Out;
    }

    function buy(
        uint256 amountIn_,
        address tokenAddress_,
        uint256 amountOutMin_,
        uint256 deadline_
    ) public payable returns (bool) {
        // this alrealy prevented it's a not-exists token
        if (!tokenInfo[tokenAddress_].trading) {
            revert InvalidTokenStatus();
        }

        // this is to prevent sell before launch
        if (!tokenInfo[tokenAddress_].launchExecuted) {
            revert InvalidTokenStatus();
        }

        _buy(msg.sender, amountIn_, tokenAddress_, amountOutMin_, deadline_, false);

        return true;
    }

    function _openTradingOnUniswap(address tokenAddress_) private {
        BondingConfig.Token storage tokenRef = tokenInfo[tokenAddress_];

        if (tokenRef.tradingOnUniswap || !tokenRef.trading) {
            revert InvalidTokenStatus();
        }

        // Transfer asset tokens to bonding contract
        address pairAddress = factory.getPair(
            tokenAddress_,
            router.assetToken()
        );

        IFPairV2 pairContract = IFPairV2(pairAddress);

        uint256 assetBalance = pairContract.assetBalance();
        uint256 tokenBalance = pairContract.balance();

        router.graduate(tokenAddress_);

        // previously initFromBondingCurve has two parts:
        //      1. transfer applicationThreshold_ assetToken from bondingContract to agentFactoryV3Contract
        //      2. create Application
        // now only need to do 1st part and update application.withdrawableAmount to assetBalance
        IERC20(router.assetToken()).safeTransfer(
            address(agentFactory),
            assetBalance
        );
        agentFactory
            .updateApplicationThresholdWithApplicationId(
                tokenRef.applicationId,
                assetBalance
            );

        // remove blacklist address after graduation, cuz executeBondingCurveApplicationSalt we will transfer all left agentTokens to the uniswapV2Pair
        agentFactory.removeBlacklistAddress(
            tokenAddress_,
            IAgentTokenV2(tokenAddress_).liquidityPools()[0]
        );

        // previously executeBondingCurveApplicationSalt will create agentToken and do two parts:
        //      1. (lpSupply = all left $preToken in prePairAddress) $agentToken mint to agentTokenAddress
        //      2. (vaultSupply = 1B - lpSupply) $agentToken mint to prePairAddress
        // now only need to transfer (all left agentTokens) $agentTokens from agentFactoryV6Address to agentTokenAddress
        IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance);
        require(tokenRef.applicationId != 0, "ApplicationId not found");
        address agentToken = agentFactory
            .executeBondingCurveApplicationSalt(
                tokenRef.applicationId,
                tokenRef.data.supply / 1 ether, // totalSupply
                tokenBalance / 1 ether, // lpSupply
                pairAddress, // vault
                keccak256(
                    abi.encodePacked(msg.sender, block.timestamp, tokenAddress_)
                )
            );
        tokenRef.agentToken = agentToken;

        // this is not needed, previously need to do this because of
        //     1. (vaultSupply = 1B - lpSupply) $agentToken will mint to prePairAddress
        //     2. then in unwrapToken, we will transfer burn preToken of each account and transfer same amount of agentToken to them from prePairAddress
        // router.approval(
        //     pairAddress,
        //     agentToken,
        //     address(this),
        //     IERC20(agentToken).balanceOf(pairAddress)
        // );

        emit Graduated(tokenAddress_, agentToken);
        tokenRef.trading = false;
        tokenRef.tradingOnUniswap = true;
    }

    // View functions to check token launch type (affects tax recipient updates and liquidity drain permissions)
    function isProject60days(address token_) external view returns (bool) {
        return tokenLaunchParams[token_].isProject60days;
    }

    function isProjectXLaunch(address token_) external view returns (bool) {
        return tokenLaunchParams[token_].launchMode == bondingConfig.LAUNCH_MODE_X_LAUNCH();
    }

    function isAcpSkillLaunch(address token_) external view returns (bool) {
        return tokenLaunchParams[token_].launchMode == bondingConfig.LAUNCH_MODE_ACP_SKILL();
    }

    // View function for FRouterV2 to get anti-sniper tax type
    // Reverts if token was not created by BondingV5, allowing FRouterV2 to fallback to legacy logic
    function tokenAntiSniperType(address token_) external view returns (uint8) {
        if (tokenInfo[token_].creator == address(0)) {
            revert InvalidTokenStatus();
        }
        return tokenLaunchParams[token_].antiSniperTaxType;
    }

    function _approval(
        address spender_,
        address token_,
        uint256 amount_
    ) internal returns (bool) {
        IERC20(token_).forceApprove(spender_, amount_);

        return true;
    }

    /**
     * @notice Validate launch mode is enabled and caller is authorized
     * @param launchMode_ The launch mode identifier
     */
    function _validateLaunchMode(
        uint8 launchMode_,
        uint8 antiSniperTaxType_,
        uint16 airdropBips_,
        bool needAcf_,
        bool isProject60days_,
        bool isScheduledLaunch_
    ) internal view {
        // Validate launch mode is one of the supported types
        if (launchMode_ != bondingConfig.LAUNCH_MODE_NORMAL() &&
            launchMode_ != bondingConfig.LAUNCH_MODE_X_LAUNCH() &&
            launchMode_ != bondingConfig.LAUNCH_MODE_ACP_SKILL()) {
            revert LaunchModeNotEnabled();
        }

        // Check authorization for special modes
        if (launchMode_ == bondingConfig.LAUNCH_MODE_X_LAUNCH()) {
            if (!bondingConfig.isXLauncher(msg.sender)) {
                revert UnauthorizedLauncher();
            }
        } else if (launchMode_ == bondingConfig.LAUNCH_MODE_ACP_SKILL()) {
            if (!bondingConfig.isAcpSkillLauncher(msg.sender)) {
                revert UnauthorizedLauncher();
            }
        }

        // Special launch modes have strict requirements
        // Only LAUNCH_MODE_NORMAL can freely configure parameters
        if (bondingConfig.isSpecialMode(launchMode_)) {
            // Special modes require:
            // 1. ANTI_SNIPER_NONE
            // 2. Immediate launch (startTime within 24h)
            // 3. airdropBips = 0
            // 4. needAcf = false
            // 5. isProject60days_ = false
            if (antiSniperTaxType_ != bondingConfig.ANTI_SNIPER_NONE() ||
                isScheduledLaunch_ ||
                airdropBips_ != 0 ||
                needAcf_ ||
                isProject60days_) {
                revert InvalidSpecialLaunchParams();
            }
        }
    }

    function setBondingConfig(address bondingConfig_) public onlyOwner {
        bondingConfig = BondingConfig(bondingConfig_);
    }
}

