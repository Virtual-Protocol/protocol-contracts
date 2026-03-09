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

    // Mapping to store graduation threshold for each token (calculated per-token based on airdropPercent and needAcf)
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
        string memory _name,
        string memory _ticker,
        uint8[] memory cores,
        string memory desc,
        string memory img,
        string[4] memory urls,
        uint256 purchaseAmount,
        uint256 startTime,
        uint8 launchMode_,
        uint8 airdropPercent_,
        bool needAcf_,
        uint8 antiSniperTaxType_,
        bool isProject60days_
    ) public nonReentrant returns (address, address, uint, uint256) {
        // Fail-fast: validate reserve percentages and calculate bonding curve supply upfront
        // This validates: airdropPercent <= maxAirdropPercent AND totalReserved < MAX_TOTAL_RESERVED_PERCENT
        uint256 bondingCurveSupplyBase = bondingConfig.calculateBondingCurveSupply(airdropPercent_, needAcf_);

        // Validate anti-sniper tax type
        if (!bondingConfig.isValidAntiSniperType(antiSniperTaxType_)) {
            revert InvalidAntiSniperType();
        }

        if (cores.length <= 0) {
            revert InvalidInput();
        }

        // Determine if this is an immediate launch or scheduled launch
        // Immediate launch: startTime < now + scheduledLaunchStartTimeDelay
        // Scheduled launch: startTime >= now + scheduledLaunchStartTimeDelay
        BondingConfig.ScheduledLaunchParams memory scheduledParams = bondingConfig.scheduledLaunchParams();
        uint256 scheduledThreshold = block.timestamp + scheduledParams.startTimeDelay;
        bool isScheduledLaunch = startTime >= scheduledThreshold;

        // Validate launch mode, authorization, and mode-specific requirements
        _validateLaunchMode(
            launchMode_,
            antiSniperTaxType_,
            airdropPercent_,
            needAcf_,
            isProject60days_,
            isScheduledLaunch
        );

        uint256 actualStartTime;
        uint256 startTimeDelay;
        
        if (isScheduledLaunch) {
            // Scheduled launch: use provided startTime
            actualStartTime = startTime;
            startTimeDelay = scheduledParams.startTimeDelay;
        } else {
            // Immediate launch: start immediately
            actualStartTime = block.timestamp;
            startTimeDelay = 0;
        }

        // Calculate launch fee based on launch type and ACF requirement
        // Fee structure:
        // - Immediate launch, no ACF: 0
        // - Immediate launch, with ACF: acfFee
        // - Scheduled launch, no ACF: normalLaunchFee
        // - Scheduled launch, with ACF: normalLaunchFee + acfFee
        uint256 launchFee = bondingConfig.calculateLaunchFee(isScheduledLaunch, needAcf_);

        if (purchaseAmount < launchFee) {
            revert InvalidInput();
        }

        address assetToken = router.assetToken();

        uint256 initialPurchase = (purchaseAmount - launchFee);
        if (launchFee > 0) {
            IERC20(assetToken).safeTransferFrom(msg.sender, bondingConfig.feeTo(), launchFee);
        }
        IERC20(assetToken).safeTransferFrom(
            msg.sender,
            address(this),
            initialPurchase
        );

        uint256 _initialSupply = bondingConfig.initialSupply();
        BondingConfig.DeployParams memory _deployParams = bondingConfig.deployParams();
        
        (address token, uint256 applicationId) = agentFactory
            .createNewAgentTokenAndApplication(
                _name, // without "fun " prefix
                _ticker,
                abi.encode(
                    // tokenSupplyParams
                    _initialSupply,
                    0, // lpSupply, will mint to agentTokenAddress
                    _initialSupply, // vaultSupply, will mint to vault
                    _initialSupply,
                    _initialSupply,
                    0,
                    address(this) // vault, is the bonding contract itself
                ),
                cores,
                _deployParams.tbaSalt,
                _deployParams.tbaImplementation,
                _deployParams.daoVotingPeriod,
                _deployParams.daoThreshold,
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
        uint256 totalReservedSupply = _initialSupply - bondingCurveSupplyBase;

        address _pair = factory.createPair(
            token,
            assetToken,
            actualStartTime,
            startTimeDelay
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
        newToken.pair = _pair;
        newToken.description = desc;
        newToken.cores = cores;
        newToken.image = img;
        newToken.twitter = urls[0];
        newToken.telegram = urls[1];
        newToken.youtube = urls[2];
        newToken.website = urls[3];
        newToken.trading = true;
        newToken.tradingOnUniswap = false;
        newToken.applicationId = applicationId;
        newToken.initialPurchase = initialPurchase;
        newToken.virtualId = VirtualIdBase + tokenInfos.length;
        newToken.launchExecuted = false;

        // Store V5 configurable launch parameters
        tokenLaunchParams[token] = BondingConfig.LaunchParams({
            launchMode: launchMode_,
            airdropPercent: airdropPercent_,
            needAcf: needAcf_,
            antiSniperTaxType: antiSniperTaxType_,
            isProject60days: isProject60days_
        });

        // Set Data struct fields
        newToken.data.token = token;
        newToken.data.name = _name;
        newToken.data._name = _name;
        newToken.data.ticker = _ticker;
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
            _pair,
            tokenInfo[token].virtualId,
            initialPurchase,
            tokenLaunchParams[token]
        );

        return (token, _pair, tokenInfo[token].virtualId, initialPurchase);
    }

    function cancelLaunch(address _tokenAddress) public {
        BondingConfig.Token storage _token = tokenInfo[_tokenAddress];

        // Validate that the token exists and was properly prelaunched
        if (_token.token == address(0) || _token.pair == address(0)) {
            revert InvalidInput();
        }

        if (msg.sender != _token.creator) {
            revert InvalidInput();
        }

        // Validate that the token has not been launched (or cancelled)
        if (_token.launchExecuted) {
            revert InvalidTokenStatus();
        }

        if (_token.initialPurchase > 0) {
            IERC20(router.assetToken()).safeTransfer(
                _token.creator,
                _token.initialPurchase
            );
        }

        _token.initialPurchase = 0; // prevent duplicate transfer initialPurchase back to the creator
        _token.launchExecuted = true; // pretend it has been launched (cancelled) and prevent duplicate launch

        emit CancelledLaunch(
            _tokenAddress,
            _token.pair,
            tokenInfo[_tokenAddress].virtualId,
            _token.initialPurchase
        );
    }

    function launch(
        address _tokenAddress
    ) public nonReentrant returns (address, address, uint, uint256) {
        BondingConfig.Token storage _token = tokenInfo[_tokenAddress];

        // Validate that the token exists and was properly prelaunched
        if (_token.token == address(0) || _token.pair == address(0)) {
            revert InvalidInput();
        }

        if (_token.launchExecuted) {
            revert InvalidTokenStatus();
        }

        // If initialPurchase == 0, the function marks the token as launched
        // while swaps remain blocked (since enabling depends solely on time),
        // resulting in an inconsistent "launched but not tradable" state, also the 550M is go to teamTokenReservedWallet
        // so we need to check the start time of the pair
        IFPairV2 pair = IFPairV2(_token.pair);
        if (block.timestamp < pair.startTime()) {
            revert InvalidInput();
        }

        // Set tax start time to current block timestamp for proper anti-sniper tax calculation
        router.setTaxStartTime(_token.pair, block.timestamp);

        // Make initial purchase for creator
        // bondingContract will transfer initialPurchase $Virtual to pairAddress
        // pairAddress will transfer amountsOut $agentToken to bondingContract
        // bondingContract then will transfer all the amountsOut $agentToken to teamTokenReservedWallet
        // in the BE, teamTokenReservedWallet will split it out for the initialBuy and 550M
        uint256 amountOut = 0;
        uint256 initialPurchase = _token.initialPurchase;
        if (initialPurchase > 0) {
            IERC20(router.assetToken()).forceApprove(
                address(router),
                initialPurchase
            );
            amountOut = _buy(
                address(this),
                initialPurchase, // will raise error if initialPurchase <= 0
                _tokenAddress,
                0,
                block.timestamp + 300,
                true // isInitialPurchase = true for creator's purchase
            );
            // creator's initialBoughtToken need to go to teamTokenReservedWallet for locking, not to creator
            IERC20(_tokenAddress).safeTransfer(
                bondingConfig.teamTokenReservedWallet(),
                amountOut
            );

            // update initialPurchase and launchExecuted to prevent duplicate purchase
            _token.initialPurchase = 0;
        }

        emit Launched(
            _tokenAddress,
            _token.pair,
            tokenInfo[_tokenAddress].virtualId,
            initialPurchase,
            amountOut,
            tokenLaunchParams[_tokenAddress]
        );
        _token.launchExecuted = true;

        return (
            _tokenAddress,
            _token.pair,
            tokenInfo[_tokenAddress].virtualId,
            initialPurchase
        );
    }

    function sell(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        uint256 deadline
    ) public returns (bool) {
        // this alrealy prevented it's a not-exists token
        if (!tokenInfo[tokenAddress].trading) {
            revert InvalidTokenStatus();
        }

        // this is to prevent sell before launch
        if (!tokenInfo[tokenAddress].launchExecuted) {
            revert InvalidTokenStatus();
        }

        if (block.timestamp > deadline) {
            revert InvalidInput();
        }

        (uint256 amount0In, uint256 amount1Out) = router.sell(
            amountIn,
            tokenAddress,
            msg.sender
        );

        if (amount1Out < amountOutMin) {
            revert SlippageTooHigh();
        }

        uint256 duration = block.timestamp -
            tokenInfo[tokenAddress].data.lastUpdated;

        if (duration > 86400) {
            tokenInfo[tokenAddress].data.lastUpdated = block.timestamp;
        }

        return true;
    }

    function _buy(
        address buyer,
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        uint256 deadline,
        bool isInitialPurchase
    ) internal returns (uint256) {
        if (block.timestamp > deadline) {
            revert InvalidInput();
        }
        address pairAddress = factory.getPair(
            tokenAddress,
            router.assetToken()
        );

        IFPairV2 pair = IFPairV2(pairAddress);

        (uint256 reserveA, uint256 reserveB) = pair.getReserves();

        (uint256 amount1In, uint256 amount0Out) = router.buy(
            amountIn,
            tokenAddress,
            buyer,
            isInitialPurchase
        );

        if (amount0Out < amountOutMin) {
            revert SlippageTooHigh();
        }

        uint256 newReserveA = reserveA - amount0Out;
        uint256 duration = block.timestamp -
            tokenInfo[tokenAddress].data.lastUpdated;

        if (duration > 86400) {
            tokenInfo[tokenAddress].data.lastUpdated = block.timestamp;
        }

        // Get per-token gradThreshold (calculated during preLaunch based on airdropPercent and needAcf)
        uint256 gradThreshold = tokenGradThreshold[tokenAddress];

        if (
            newReserveA <= gradThreshold &&
            !router.hasAntiSniperTax(pairAddress) &&
            tokenInfo[tokenAddress].trading
        ) {
            _openTradingOnUniswap(tokenAddress);
        }

        return amount0Out;
    }

    function buy(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        uint256 deadline
    ) public payable returns (bool) {
        // this alrealy prevented it's a not-exists token
        if (!tokenInfo[tokenAddress].trading) {
            revert InvalidTokenStatus();
        }

        // this is to prevent sell before launch
        if (!tokenInfo[tokenAddress].launchExecuted) {
            revert InvalidTokenStatus();
        }

        _buy(msg.sender, amountIn, tokenAddress, amountOutMin, deadline, false);

        return true;
    }

    function _openTradingOnUniswap(address tokenAddress) private {
        BondingConfig.Token storage _token = tokenInfo[tokenAddress];

        if (_token.tradingOnUniswap || !_token.trading) {
            revert InvalidTokenStatus();
        }

        // Transfer asset tokens to bonding contract
        address pairAddress = factory.getPair(
            tokenAddress,
            router.assetToken()
        );

        IFPairV2 pair = IFPairV2(pairAddress);

        uint256 assetBalance = pair.assetBalance();
        uint256 tokenBalance = pair.balance();

        router.graduate(tokenAddress);

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
                _token.applicationId,
                assetBalance
            );

        // remove blacklist address after graduation, cuz executeBondingCurveApplicationSalt we will transfer all left agentTokens to the uniswapV2Pair
        agentFactory.removeBlacklistAddress(
            tokenAddress,
            IAgentTokenV2(tokenAddress).liquidityPools()[0]
        );

        // previously executeBondingCurveApplicationSalt will create agentToken and do two parts:
        //      1. (lpSupply = all left $preToken in prePairAddress) $agentToken mint to agentTokenAddress
        //      2. (vaultSupply = 1B - lpSupply) $agentToken mint to prePairAddress
        // now only need to transfer (all left agentTokens) $agentTokens from agentFactoryV6Address to agentTokenAddress
        IERC20(tokenAddress).safeTransfer(tokenAddress, tokenBalance);
        require(_token.applicationId != 0, "ApplicationId not found");
        address agentToken = agentFactory
            .executeBondingCurveApplicationSalt(
                _token.applicationId,
                _token.data.supply / 1 ether, // totalSupply
                tokenBalance / 1 ether, // lpSupply
                pairAddress, // vault
                keccak256(
                    abi.encodePacked(msg.sender, block.timestamp, tokenAddress)
                )
            );
        _token.agentToken = agentToken;

        // this is not needed, previously need to do this because of
        //     1. (vaultSupply = 1B - lpSupply) $agentToken will mint to prePairAddress
        //     2. then in unwrapToken, we will transfer burn preToken of each account and transfer same amount of agentToken to them from prePairAddress
        // router.approval(
        //     pairAddress,
        //     agentToken,
        //     address(this),
        //     IERC20(agentToken).balanceOf(pairAddress)
        // );

        emit Graduated(tokenAddress, agentToken);
        _token.trading = false;
        _token.tradingOnUniswap = true;
    }

    // View functions to check token launch type (affects tax recipient updates and liquidity drain permissions)
    function isProject60days(address token) external view returns (bool) {
        return tokenLaunchParams[token].isProject60days;
    }

    function isProjectXLaunch(address token) external view returns (bool) {
        return tokenLaunchParams[token].launchMode == bondingConfig.LAUNCH_MODE_X_LAUNCH();
    }

    function isAcpSkillLaunch(address token) external view returns (bool) {
        return tokenLaunchParams[token].launchMode == bondingConfig.LAUNCH_MODE_ACP_SKILL();
    }

    // View function for FRouterV2 to get anti-sniper tax type
    // Reverts if token was not created by BondingV5, allowing FRouterV2 to fallback to legacy logic
    function tokenAntiSniperType(address token) external view returns (uint8) {
        if (tokenInfo[token].creator == address(0)) {
            revert InvalidTokenStatus();
        }
        return tokenLaunchParams[token].antiSniperTaxType;
    }

    function _approval(
        address _spender,
        address _token,
        uint256 amount
    ) internal returns (bool) {
        IERC20(_token).forceApprove(_spender, amount);

        return true;
    }

    /**
     * @notice Validate launch mode is enabled and caller is authorized
     * @param launchMode_ The launch mode identifier
     */
    function _validateLaunchMode(
        uint8 launchMode_,
        uint8 antiSniperTaxType_,
        uint8 airdropPercent_,
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
            // 3. airdropPercent = 0
            // 4. needAcf = false
            // 5. isProject60days_ = false
            if (antiSniperTaxType_ != bondingConfig.ANTI_SNIPER_NONE() ||
                isScheduledLaunch_ ||
                airdropPercent_ != 0 ||
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

