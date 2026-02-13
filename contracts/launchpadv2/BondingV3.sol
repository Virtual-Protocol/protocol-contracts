// SPDX-License-Identifier: MIT
// Modified from https://github.com/sourlodine/Pump.fun-Smart-Contract/blob/main/contracts/PumpFun.sol
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./FFactoryV2.sol";
import "./IFPairV2.sol";
import "./FRouterV2.sol";
import "../virtualPersona/IAgentFactoryV6.sol";
import "../virtualPersona/IAgentTokenV2.sol";

contract BondingV3 is
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable
{
    using SafeERC20 for IERC20;

    address private _feeTo;

    FFactoryV2 public factory;
    FRouterV2 public router;
    uint256 public initialSupply;
    uint256 public fee;
    uint256 public constant K = 3_150_000_000_000;
    uint256 public assetRate;
    uint256 public gradThreshold;
    uint256 public maxTx;
    address public agentFactory;
    struct Profile {
        address user;
        address[] tokens;
    }

    struct Token {
        address creator;
        address token;
        address pair;
        address agentToken;
        Data data;
        string description;
        uint8[] cores;
        string image;
        string twitter;
        string telegram;
        string youtube;
        string website;
        bool trading;
        bool tradingOnUniswap;
        uint256 applicationId;
        uint256 initialPurchase;
        uint256 virtualId;
        bool launchExecuted;
    }

    struct Data {
        address token;
        string name;
        string _name;
        string ticker;
        uint256 supply;
        uint256 price;
        uint256 marketCap;
        uint256 liquidity;
        uint256 volume;
        uint256 volume24H;
        uint256 prevPrice;
        uint256 lastUpdated;
    }

    struct DeployParams {
        bytes32 tbaSalt;
        address tbaImplementation;
        uint32 daoVotingPeriod;
        uint256 daoThreshold;
    }

    DeployParams private _deployParams;

    mapping(address => Token) public tokenInfo;
    address[] public tokenInfos;

    struct LaunchParams {
        uint256 startTimeDelay;
        uint256 teamTokenReservedSupply;
        address teamTokenReservedWallet;
    }
    LaunchParams public launchParams;
    // this is for BE to separate with old virtualId from bondingV1, but this field is not used yet
    uint256 public constant VirtualIdBase = 30_000_000_000;

    event PreLaunched(
        address indexed token,
        address indexed pair,
        uint,
        uint256 initialPurchase
    );
    event Launched(
        address indexed token,
        address indexed pair,
        uint,
        uint256 initialPurchase,
        uint256 initialPurchasedAmount
    );
    event CancelledLaunch(
        address indexed token,
        address indexed pair,
        uint,
        uint256 initialPurchase
    );
    event Deployed(address indexed token, uint256 amount0, uint256 amount1);
    event Graduated(address indexed token, address agentToken);

    error InvalidTokenStatus();
    error InvalidInput();
    error SlippageTooHigh();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address router_,
        address feeTo_,
        uint256 fee_,
        uint256 initialSupply_,
        uint256 assetRate_,
        uint256 maxTx_,
        address agentFactory_,
        uint256 gradThreshold_,
        uint256 startTimeDelay_
    ) external initializer {
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();

        factory = FFactoryV2(factory_);
        router = FRouterV2(router_);

        _feeTo = feeTo_;
        fee = (fee_ * 1 ether) / 1000;

        initialSupply = initialSupply_;
        assetRate = assetRate_;
        maxTx = maxTx_;

        agentFactory = agentFactory_;
        gradThreshold = gradThreshold_;
        launchParams.startTimeDelay = startTimeDelay_;
    }

    function _approval(
        address _spender,
        address _token,
        uint256 amount
    ) internal returns (bool) {
        IERC20(_token).forceApprove(_spender, amount);

        return true;
    }

    function setTokenParams(
        uint256 newSupply,
        uint256 newGradThreshold,
        uint256 newMaxTx,
        uint256 newAssetRate,
        uint256 newFee,
        address newFeeTo
    ) public onlyOwner {
        if (newAssetRate <= 0) {
            revert InvalidInput();
        }
        initialSupply = newSupply;
        gradThreshold = newGradThreshold;
        maxTx = newMaxTx;
        assetRate = newAssetRate;
        fee = newFee;
        _feeTo = newFeeTo;
    }

    function setDeployParams(DeployParams memory params) public onlyOwner {
        _deployParams = params;
    }

    function setLaunchParams(LaunchParams memory params) public onlyOwner {
        launchParams = params;
    }

    function preLaunch(
        string memory _name,
        string memory _ticker,
        uint8[] memory cores,
        string memory desc,
        string memory img,
        string[4] memory urls,
        uint256 purchaseAmount,
        uint256 startTime
    ) public nonReentrant returns (address, address, uint, uint256) {
        if (purchaseAmount < fee || cores.length <= 0) {
            revert InvalidInput();
        }
        // startTime must be at least startTimeDelay in the future
        if (startTime < block.timestamp + launchParams.startTimeDelay) {
            revert InvalidInput();
        }

        address assetToken = router.assetToken();

        uint256 initialPurchase = (purchaseAmount - fee);
        IERC20(assetToken).safeTransferFrom(msg.sender, _feeTo, fee);
        IERC20(assetToken).safeTransferFrom(
            msg.sender,
            address(this),
            initialPurchase
        );

        (address token, uint256 applicationId) = IAgentFactoryV6(agentFactory)
            .createNewAgentTokenAndApplication(
                _name, // without "fun " prefix
                _ticker,
                abi.encode( // tokenSupplyParams
                        initialSupply,
                        0, // lpSupply, will mint to agentTokenAddress
                        initialSupply, // vaultSupply, will mint to vault
                        initialSupply,
                        initialSupply,
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
        IAgentFactoryV6(agentFactory).addBlacklistAddress(
            token,
            IAgentTokenV2(token).liquidityPools()[0]
        );

        uint256 bondingCurveSupply = (initialSupply -
            launchParams.teamTokenReservedSupply) *
            (10 ** IAgentTokenV2(token).decimals()); // (1B - 20M) * 10^18 = 980M * 10^18

        address _pair = factory.createPair(
            token,
            assetToken,
            startTime,
            launchParams.startTimeDelay
        );

        require(_approval(address(router), token, bondingCurveSupply)); // 980M in wei

        uint256 liquidity = (((((K * 10000) / assetRate) * 10000 ether) /
            bondingCurveSupply) * 1 ether) / 10000;
        uint256 price = bondingCurveSupply / liquidity;

        router.addInitialLiquidity(token, bondingCurveSupply, liquidity); // 980M
        // reset agentTokens will be transferred to the teamTokenReservedWallet
        IERC20(token).safeTransfer(
            launchParams.teamTokenReservedWallet,
            launchParams.teamTokenReservedSupply *
                (10 ** IAgentTokenV2(token).decimals()) // teamTokens in wei
        ); // 550M * 10^18

        tokenInfos.push(token);

        // Use storage reference to avoid stack overflow
        Token storage newToken = tokenInfo[token];
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
            initialPurchase
        );

        return (token, _pair, tokenInfo[token].virtualId, initialPurchase);
    }

    function cancelLaunch(address _tokenAddress) public {
        Token storage _token = tokenInfo[_tokenAddress];

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
        Token storage _token = tokenInfo[_tokenAddress];

        // Validate that the token exists and was properly prelaunched
        if (_token.token == address(0) || _token.pair == address(0)) {
            revert InvalidInput();
        }

        if (_token.launchExecuted) {
            revert InvalidTokenStatus();
        }

        // If initialPurchase == 0, the function marks the token as launched
        // while swaps remain blocked (since enabling depends solely on time),
        // resulting in an inconsistent “launched but not tradable” state, also the 550M is go to teamTokenReservedWallet
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
                launchParams.teamTokenReservedWallet,
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
            amountOut
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

        if (amount1Out == 0 || amount1Out < amountOutMin) {
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

        if (amount0Out == 0 || amount0Out < amountOutMin) {
            revert SlippageTooHigh();
        }

        uint256 newReserveA = reserveA - amount0Out;
        uint256 duration = block.timestamp -
            tokenInfo[tokenAddress].data.lastUpdated;

        if (duration > 86400) {
            tokenInfo[tokenAddress].data.lastUpdated = block.timestamp;
        }

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
        Token storage _token = tokenInfo[tokenAddress];

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
        IAgentFactoryV6(agentFactory)
            .updateApplicationThresholdWithApplicationId(
                _token.applicationId,
                assetBalance
            );

        // remove blacklist address after graduation, cuz executeBondingCurveApplicationSalt we will transfer all left agentTokens to the uniswapV2Pair
        IAgentFactoryV6(agentFactory).removeBlacklistAddress(
            tokenAddress,
            IAgentTokenV2(tokenAddress).liquidityPools()[0]
        );

        // previously executeBondingCurveApplicationSalt will create agentToken and do two parts:
        //      1. (lpSupply = all left $preToken in prePairAddress) $agentToken mint to agentTokenAddress
        //      2. (vaultSupply = 1B - lpSupply) $agentToken mint to prePairAddress
        // now only need to transfer (all left agentTokens) $agentTokens from agentFactoryV6Address to agentTokenAddress
        IERC20(tokenAddress).safeTransfer(tokenAddress, tokenBalance);
        require(_token.applicationId != 0, "ApplicationId not found");
        address agentToken = IAgentFactoryV6(agentFactory)
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
}
