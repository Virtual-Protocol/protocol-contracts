// SPDX-License-Identifier: MIT
// Modified from https://github.com/sourlodine/Pump.fun-Smart-Contract/blob/main/contracts/PumpFun.sol
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./FFactory.sol";
import "./IFPair.sol";
import "./FRouter.sol";
import "./FERC20.sol";
import "../virtualPersona/IAgentFactoryV3.sol";

contract Bonding is
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable
{
    using SafeERC20 for IERC20;

    address private _feeTo;

    FFactory public factory;
    FRouter public router;
    uint256 public initialSupply;
    uint256 public fee;
    uint256 public constant K = 3_000_000_000_000;
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

    mapping(address => Profile) public profile;
    address[] public profiles;

    mapping(address => Token) public tokenInfo;
    address[] public tokenInfos;

    event Launched(address indexed token, address indexed pair, uint);
    event Deployed(address indexed token, uint256 amount0, uint256 amount1);
    event Graduated(address indexed token, address agentToken);

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
        uint256 gradThreshold_
    ) external initializer {
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();

        factory = FFactory(factory_);
        router = FRouter(router_);

        _feeTo = feeTo_;
        fee = (fee_ * 1 ether) / 1000;

        initialSupply = initialSupply_;
        assetRate = assetRate_;
        maxTx = maxTx_;

        agentFactory = agentFactory_;
        gradThreshold = gradThreshold_;
    }

    function _createUserProfile(address _user) internal returns (bool) {
        address[] memory _tokens;

        Profile memory _profile = Profile({user: _user, tokens: _tokens});

        profile[_user] = _profile;

        profiles.push(_user);

        return true;
    }

    function _checkIfProfileExists(address _user) internal view returns (bool) {
        return profile[_user].user == _user;
    }

    function _approval(
        address _spender,
        address _token,
        uint256 amount
    ) internal returns (bool) {
        IERC20(_token).forceApprove(_spender, amount);

        return true;
    }

    function setInitialSupply(uint256 newSupply) public onlyOwner {
        initialSupply = newSupply;
    }

    function setGradThreshold(uint256 newThreshold) public onlyOwner {
        gradThreshold = newThreshold;
    }

    function setFee(uint256 newFee, address newFeeTo) public onlyOwner {
        fee = newFee;
        _feeTo = newFeeTo;
    }

    function setMaxTx(uint256 maxTx_) public onlyOwner {
        maxTx = maxTx_;
    }

    function setAssetRate(uint256 newRate) public onlyOwner {
        require(newRate > 0, "Rate err");

        assetRate = newRate;
    }

    function setDeployParams(DeployParams memory params) public onlyOwner {
        _deployParams = params;
    }

    function getUserTokens(
        address account
    ) public view returns (address[] memory) {
        require(_checkIfProfileExists(account), "User Profile dose not exist.");

        Profile memory _profile = profile[account];

        return _profile.tokens;
    }

    function launch(
        string memory _name,
        string memory _ticker,
        uint8[] memory cores,
        string memory desc,
        string memory img,
        string[4] memory urls,
        uint256 purchaseAmount
    ) public nonReentrant returns (address, address, uint) {
        require(
            purchaseAmount > fee,
            "Purchase amount must be greater than fee"
        );

        require(cores.length > 0, "Cores must be provided");

        address assetToken = router.assetToken();
        require(
            IERC20(assetToken).balanceOf(msg.sender) >= purchaseAmount,
            "Insufficient amount"
        );
        uint256 initialPurchase = (purchaseAmount - fee);
        IERC20(assetToken).safeTransferFrom(msg.sender, _feeTo, fee);
        IERC20(assetToken).safeTransferFrom(
            msg.sender,
            address(this),
            initialPurchase
        );

        FERC20 token = new FERC20{
            salt: keccak256(abi.encodePacked(msg.sender, block.timestamp))
        }(string.concat("fun ", _name), _ticker, initialSupply, maxTx);
        uint256 supply = token.totalSupply();

        address _pair = factory.createPair(address(token), assetToken);

        bool approved = _approval(address(router), address(token), supply);
        require(approved);

        uint256 k = ((K * 10000) / assetRate);
        uint256 liquidity = (((k * 10000 ether) / supply) * 1 ether) / 10000;

        router.addInitialLiquidity(address(token), supply, liquidity);

        Data memory _data = Data({
            token: address(token),
            name: string.concat("fun ", _name),
            _name: _name,
            ticker: _ticker,
            supply: supply,
            price: supply / liquidity,
            marketCap: liquidity,
            liquidity: liquidity * 2,
            volume: 0,
            volume24H: 0,
            prevPrice: supply / liquidity,
            lastUpdated: block.timestamp
        });
        Token memory tmpToken = Token({
            creator: msg.sender,
            token: address(token),
            agentToken: address(0),
            pair: _pair,
            data: _data,
            description: desc,
            cores: cores,
            image: img,
            twitter: urls[0],
            telegram: urls[1],
            youtube: urls[2],
            website: urls[3],
            trading: true, // Can only be traded once creator made initial purchase
            tradingOnUniswap: false
        });
        tokenInfo[address(token)] = tmpToken;
        tokenInfos.push(address(token));

        bool exists = _checkIfProfileExists(msg.sender);

        if (exists) {
            Profile storage _profile = profile[msg.sender];

            _profile.tokens.push(address(token));
        } else {
            bool created = _createUserProfile(msg.sender);

            if (created) {
                Profile storage _profile = profile[msg.sender];

                _profile.tokens.push(address(token));
            }
        }

        uint n = tokenInfos.length;

        emit Launched(address(token), _pair, n);

        // Make initial purchase
        IERC20(assetToken).forceApprove(address(router), initialPurchase);
        _buy(
            address(this),
            initialPurchase,
            address(token),
            0,
            block.timestamp + 300
        );
        token.transfer(msg.sender, token.balanceOf(address(this)));

        return (address(token), _pair, n);
    }

    function sell(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        uint256 deadline
    ) public returns (bool) {
        require(tokenInfo[tokenAddress].trading, "Token not trading");
        require(block.timestamp <= deadline, "Deadline exceeded");

        address pairAddress = factory.getPair(
            tokenAddress,
            router.assetToken()
        );

        IFPair pair = IFPair(pairAddress);

        (uint256 reserveA, uint256 reserveB) = pair.getReserves();

        (uint256 amount0In, uint256 amount1Out) = router.sell(
            amountIn,
            tokenAddress,
            msg.sender
        );
        require(amount1Out >= amountOutMin, "Slippage too high");

        uint256 newReserveA = reserveA + amount0In;
        uint256 newReserveB = reserveB - amount1Out;
        uint256 duration = block.timestamp -
            tokenInfo[tokenAddress].data.lastUpdated;

        uint256 liquidity = newReserveB * 2;
        uint256 mCap = (tokenInfo[tokenAddress].data.supply * newReserveB) /
            newReserveA;
        uint256 price = newReserveA / newReserveB;
        uint256 volume = duration > 86400
            ? amount1Out
            : tokenInfo[tokenAddress].data.volume24H + amount1Out;
        uint256 prevPrice = duration > 86400
            ? tokenInfo[tokenAddress].data.price
            : tokenInfo[tokenAddress].data.prevPrice;

        tokenInfo[tokenAddress].data.price = price;
        tokenInfo[tokenAddress].data.marketCap = mCap;
        tokenInfo[tokenAddress].data.liquidity = liquidity;
        tokenInfo[tokenAddress].data.volume =
            tokenInfo[tokenAddress].data.volume +
            amount1Out;
        tokenInfo[tokenAddress].data.volume24H = volume;
        tokenInfo[tokenAddress].data.prevPrice = prevPrice;

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
        uint256 deadline
    ) internal {
        require(block.timestamp <= deadline, "Deadline exceeded");
        address pairAddress = factory.getPair(
            tokenAddress,
            router.assetToken()
        );

        IFPair pair = IFPair(pairAddress);

        (uint256 reserveA, uint256 reserveB) = pair.getReserves();

        (uint256 amount1In, uint256 amount0Out) = router.buy(
            amountIn,
            tokenAddress,
            buyer
        );

        require(amount0Out >= amountOutMin, "Slippage too high");

        uint256 newReserveA = reserveA - amount0Out;
        uint256 newReserveB = reserveB + amount1In;
        uint256 duration = block.timestamp -
            tokenInfo[tokenAddress].data.lastUpdated;

        uint256 liquidity = newReserveB * 2;
        uint256 mCap = (tokenInfo[tokenAddress].data.supply * newReserveB) /
            newReserveA;
        uint256 price = newReserveA / newReserveB;
        uint256 volume = duration > 86400
            ? amount1In
            : tokenInfo[tokenAddress].data.volume24H + amount1In;
        uint256 _price = duration > 86400
            ? tokenInfo[tokenAddress].data.price
            : tokenInfo[tokenAddress].data.prevPrice;

        tokenInfo[tokenAddress].data.price = price;
        tokenInfo[tokenAddress].data.marketCap = mCap;
        tokenInfo[tokenAddress].data.liquidity = liquidity;
        tokenInfo[tokenAddress].data.volume =
            tokenInfo[tokenAddress].data.volume +
            amount1In;
        tokenInfo[tokenAddress].data.volume24H = volume;
        tokenInfo[tokenAddress].data.prevPrice = _price;

        if (duration > 86400) {
            tokenInfo[tokenAddress].data.lastUpdated = block.timestamp;
        }

        if (newReserveA <= gradThreshold && tokenInfo[tokenAddress].trading) {
            _openTradingOnUniswap(tokenAddress);
        }
    }

    function buy(
        uint256 amountIn,
        address tokenAddress,
        uint256 amountOutMin,
        uint256 deadline
    ) public payable returns (bool) {
        require(tokenInfo[tokenAddress].trading, "Token not trading");

        _buy(msg.sender, amountIn, tokenAddress, amountOutMin, deadline);

        return true;
    }

    function _openTradingOnUniswap(address tokenAddress) private {
        FERC20 token_ = FERC20(tokenAddress);

        Token storage _token = tokenInfo[tokenAddress];

        require(
            _token.trading && !_token.tradingOnUniswap,
            "trading is already open"
        );

        _token.trading = false;
        _token.tradingOnUniswap = true;

        // Transfer asset tokens to bonding contract
        address pairAddress = factory.getPair(
            tokenAddress,
            router.assetToken()
        );

        IFPair pair = IFPair(pairAddress);

        uint256 assetBalance = pair.assetBalance();
        uint256 tokenBalance = pair.balance();

        router.graduate(tokenAddress);

        IERC20(router.assetToken()).forceApprove(agentFactory, assetBalance);
        uint256 id = IAgentFactoryV3(agentFactory).initFromBondingCurve(
            string.concat(_token.data._name, " by Virtuals"),
            _token.data.ticker,
            _token.cores,
            _deployParams.tbaSalt,
            _deployParams.tbaImplementation,
            _deployParams.daoVotingPeriod,
            _deployParams.daoThreshold,
            assetBalance,
            _token.creator
        );

        address agentToken = IAgentFactoryV3(agentFactory)
            .executeBondingCurveApplicationSalt(
                id,
                _token.data.supply / (10 ** token_.decimals()),
                tokenBalance / (10 ** token_.decimals()),
                pairAddress,
                keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress))
            );
        _token.agentToken = agentToken;

        router.approval(
            pairAddress,
            agentToken,
            address(this),
            IERC20(agentToken).balanceOf(pairAddress)
        );

        token_.burnFrom(pairAddress, tokenBalance);

        emit Graduated(tokenAddress, agentToken);
    }

    function unwrapToken(
        address srcTokenAddress,
        address[] memory accounts
    ) public {
        Token memory info = tokenInfo[srcTokenAddress];
        require(info.tradingOnUniswap, "Token is not graduated yet");

        FERC20 token = FERC20(srcTokenAddress);
        IERC20 agentToken = IERC20(info.agentToken);
        address pairAddress = factory.getPair(
            srcTokenAddress,
            router.assetToken()
        );
        for (uint i = 0; i < accounts.length; i++) {
            address acc = accounts[i];
            uint256 balance = token.balanceOf(acc);
            if (balance > 0) {
                token.burnFrom(acc, balance);
                agentToken.transferFrom(pairAddress, acc, balance);
            }
        }
    }
}
