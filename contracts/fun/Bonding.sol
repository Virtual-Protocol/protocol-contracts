// SPDX-License-Identifier: MIT
// Modified from https://github.com/sourlodine/Pump.fun-Smart-Contract/blob/main/contracts/PumpFun.sol
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./FFactory.sol";
import "./FPair.sol";
import "./FRouter.sol";
import "../virtualPersona/AgentToken.sol";

contract Bonding is ReentrancyGuard, Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    receive() external payable {}

    address private _feeTo;

    FFactory public factory;
    FRouter public router;
    uint256 public initialSupply;
    uint256 public fee;
    uint256 public marketCapLimit;
    uint256 public constant K = 3_000_000_000_000;
    uint256 public assetRate;
    uint256 public gradThreshold;
    uint256 public maxTx;

    struct Profile {
        address user;
        Token[] tokens;
    }

    struct Token {
        address creator;
        address token;
        address pair;
        Data data;
        string description;
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

    mapping(address => Profile) public profile;
    Profile[] public profiles;

    mapping(address => Token) public tokenInfo;
    Token[] public tokenInfos;

    event Launched(address indexed token, address indexed pair, uint);
    event Deployed(address indexed token, uint256 amount0, uint256 amount1);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address router_,
        address feeTo_,
        uint256 fee_,
        address uniswapRouter_,
        uint256 mcap_,
        uint256 initialSupply_,
        uint256 assetRate_,
        uint256 maxTx_
    ) external initializer {
        __Ownable_init(msg.sender);

        require(factory_ != address(0), "Zero addresses are not allowed.");
        require(router_ != address(0), "Zero addresses are not allowed.");
        require(feeTo_ != address(0), "Zero addresses are not allowed.");

        factory = Factory(factory_);
        router = Router(router_);

        feeTo = feeTo_;
        fee = (fee_ * 1 ether) / 1000;

        initialSupply = initialSupply_;
        assetRate = assetRate_;
        maxTx = maxTx_;
    }

    function createUserProfile(address _user) private returns (bool) {
        require(_user != address(0), "Zero addresses are not allowed.");

        Token[] memory _tokens;

        Profile memory _profile = Profile({user: _user, tokens: _tokens});

        profile[_user] = _profile;

        profiles.push(_profile);

        return true;
    }

    function checkIfProfileExists(address _user) private view returns (bool) {
        require(_user != address(0), "Zero addresses are not allowed.");

        bool exists = false;

        for (uint i = 0; i < profiles.length; i++) {
            if (profiles[i].user == _user) {
                return true;
            }
        }

        return exists;
    }

    function _approval(
        address _spender,
        address _token,
        uint256 amount
    ) private returns (bool) {
        require(_spender != address(0), "Zero addresses are not allowed.");
        require(_token != address(0), "Zero addresses are not allowed.");

        ERC20 token_ = ERC20(_token);

        token_.approve(_user, amount);

        return true;
    }

    function setInitialSupply(uint256 newSupply) public onlyOwner {
        initialSupply = newSupply;
    }

    function setLaunchFee(uint256 newFee) public onlyOwner {
        fee = newFee;
    }

    function setFeeTo(address newFeeTo) public onlyOwner {
        require(newFeeTo != address(0), "Zero addresses are not allowed.");

        feeTo = newFeeTo;
    }

    function setMaxTx(uint256 maxTx_) public onlyOwner {
        maxTx = maxTx_;
    }

    function setAssetRate(address newRate) public onlyOwner {
        require(newRate > 0, "Rate cannot be 0");

        assetRate = newRate;
    }

    function getUserTokens(
        address account
    ) public view returns (Token[] memory) {
        require(checkIfProfileExists(account), "User Profile dose not exist.");

        Profile memory _profile = profile[account];

        return _profile.tokens;
    }

    function getTokens() public view returns (Token[] memory) {
        return tokens;
    }

    function launch(
        string memory _name,
        string memory _ticker,
        string memory desc,
        string memory img,
        string[4] memory urls,
        uint256 purchaseAmount
    ) public nonReentrant returns (address, address, uint) {
        require(
            purchaseAmount > fee,
            "Purchase amount must be greater than fee"
        );
        address assetToken = router.assetToken();
        require(
            IERC20(assetToken).balanceOf(msg.sender) >= purchaseAmount,
            "Insufficient amount for fee."
        );
        IERC20(assetToken).safeTransferFrom(msg.sender, _feeTo, fee);
        IERC20(assetToken).safeTransferFrom(msg.sender, address(this), (purchaseAmount - fee));

        FERC20 token = new FERC20(_name, _ticker, initialSupply, maxTx);
        supply = token.totalSupply();

        address _pair = factory.createPair(address(token), assetToken);

        bool approved = _approval(address(router), address(token), supply);
        require(approved);

        uint256 liquidity = supply - gradThreshold;
        uint256 k = K / assetRate;
        router.addInitialLiquidity(address(token), liquidity, k/liquidity);
        token.transfer(_pair, gradThreshold);
        uint256 price = token.priceALast();
        Data memory _data = Data({
            token: address(token),
            name: _name,
            ticker: _ticker,
            supply: supply,
            price: price,
            marketCap: price * supply,
            liquidity: liquidity,
            volume: 0,
            volume24H: 0,
            prevPrice: price,
            lastUpdated: block.timestamp
        });
        Token memory tmpToken = Token({
            creator: msg.sender,
            token: address(token),
            pair: _pair,
            data: _data,
            description: desc,
            image: img,
            twitter: urls[0],
            telegram: urls[1],
            youtube: urls[2],
            website: urls[3],
            trading: true, // Can only be traded once creator made initial purchase
            tradingOnUniswap: false
        });
        tokenInfo[address(token)] = tmpToken;
        tokenInfos.push(tmpToken);

        bool exists = checkIfProfileExists(msg.sender);

        if (exists) {
            Profile storage _profile = profile[msg.sender];

            _profile.tokens.push(address(_token));
        } else {
            bool created = createUserProfile(msg.sender);

            if (created) {
                Profile storage _profile = profile[msg.sender];

                _profile.tokens.push(address(_token));
            }
        }

        uint n = tokens.length;

        emit Launched(address(_token), _pair, n);

        return (address(_token), _pair, n);
    }

    function sell(
        uint256 amountIn,
        address tokenAddress
    ) public returns (bool) {
        address pairAddress = factory.getPair(tokenAddress, router.WETH());

        Pair pair = Pair(pairAddress);

        (uint256 reserveA, uint256 reserveB) = pair
            .getReserves();

        (uint256 amount0In, uint256 amount1Out) = router.sell(
            amountIn,
            tokenAddress,
            msg.sender
        );

        uint256 newReserveA = reserveA + amount0In;
        uint256 newReserveB = reserveB - amount1Out;
        uint256 duration = block.timestamp - token[tokenAddress].data.lastUpdated;

        uint256 liquidity = newReserveB;
        uint256 mCap = (token[tokenAddress].data.supply * newReserveB) / newReserveA;
        uint256 price = newReserveA / newReserveB;
        uint256 volume = duration > 86400
            ? amount1Out
            : token[tokenAddress].data.volume24H + amount1Out;
        uint256 prevPrice = duration > 86400
            ? token[tokenAddress].data.price
            : token[tokenAddress].data.prevPrice;

        token[tokenAddress].data.price = price;
        token[tokenAddress].data.marketCap = mCap;
        token[tokenAddress].data.liquidity = liquidity;
        token[tokenAddress].data.volume = token[tokenAddress].data.volume + amount1Out;
        token[tokenAddress].data.volume24H = volume;
        token[tokenAddress].data.prevPrice = prevPrice;

        if (duration > 86400) {
            token[tokenAddress].data.lastUpdated = block.timestamp;
        }

        for (uint i = 0; i < tokens.length; i++) {
            if (tokens[i].token == tokenAddress) {
                tokens[i].data.price = price;
                tokens[i].data.marketCap = mCap;
                tokens[i].data.liquidity = liquidity;
                tokens[i].data.volume = token[tokenAddress].data.volume + amount1Out;
                tokens[i].data.volume24H = volume;
                tokens[i].data.prevPrice = prevPrice;

                if (duration > 86400) {
                    tokens[i].data.lastUpdated = block.timestamp;
                }
                break;
            }
        }

        return true;
    }

    function buy(
        uint256 amountIn
        address tokenAddress
    ) public payable returns (bool) {
        require(tokenAddress != address(0), "Zero addresses are not allowed.");
        require(to != address(0), "Zero addresses are not allowed.");

        address pairAddress = factory.getPair(tokenAddress, router.assetToken());

        Pair pair = Pair(pairAddress);

        (uint256 reserveA, uint256 reserveB) = pair
            .getReserves();

        (uint256 amount1In, uint256 amount0Out) = router.buy(amountIn, tokenAddress);

        uint256 newReserveA = reserveA - amount0Out;
        uint256 newReserveB = reserveB + amount1In;
        uint256 _newReserveB = _reserveB + amount1In;
        uint256 duration = block.timestamp - token[tk].data.lastUpdated;

        uint256 _liquidity = _newReserveB * 2;
        uint256 liquidity = newReserveB * 2;
        uint256 mCap = (token[tk].data.supply * _newReserveB) / newReserveA;
        uint256 price = newReserveA / _newReserveB;
        uint256 volume = duration > 86400
            ? amount1In
            : token[tk].data.volume24H + amount1In;
        uint256 _price = duration > 86400
            ? token[tk].data.price
            : token[tk].data.prevPrice;

        token[tk].data.price = price;
        token[tk].data.marketCap = mCap;
        token[tk].data.liquidity = liquidity;
        token[tk].data._liquidity = _liquidity;
        token[tk].data.volume = token[tk].data.volume + amount1In;
        token[tk].data.volume24H = volume;
        token[tk].data.prevPrice = _price;

        if (duration > 86400) {
            token[tk].data.lastUpdated = block.timestamp;
        }

        for (uint i = 0; i < tokens.length; i++) {
            if (tokens[i].token == tk) {
                tokens[i].data.price = price;
                tokens[i].data.marketCap = mCap;
                tokens[i].data.liquidity = liquidity;
                tokens[i].data._liquidity = _liquidity;
                tokens[i].data.volume = token[tk].data.volume + amount1In;
                tokens[i].data.volume24H = volume;
                tokens[i].data.prevPrice = _price;

                if (duration > 86400) {
                    tokens[i].data.lastUpdated = block.timestamp;
                }
            }
        }

        return true;
    }

    function deploy(address tk) public onlyOwner nonReentrant {
        require(tk != address(0), "Zero addresses are not allowed.");

        address weth = router.WETH();

        address pair = factory.getPair(tk, weth);

        ERC20 token_ = ERC20(tk);

        token_.excludeFromMaxTx(pair);

        Token storage _token = token[tk];

        (uint256 amount0, uint256 amount1) = router.removeLiquidityETH(
            tk,
            100,
            address(this)
        );

        Data memory _data = Data({
            token: tk,
            name: token[tk].data.name,
            ticker: token[tk].data.ticker,
            supply: token[tk].data.supply,
            price: 0,
            marketCap: 0,
            liquidity: 0,
            _liquidity: 0,
            volume: 0,
            volume24H: 0,
            prevPrice: 0,
            lastUpdated: block.timestamp
        });

        _token.data = _data;

        for (uint i = 0; i < tokens.length; i++) {
            if (tokens[i].token == tk) {
                tokens[i].data = _data;
            }
        }

        openTradingOnUniswap(tk);

        _token.trading = false;
        _token.tradingOnUniswap = true;

        emit Deployed(tk, amount0, amount1);
    }

    function openTradingOnUniswap(address tk) private {
        require(tk != address(0), "Zero addresses are not allowed.");

        ERC20 token_ = ERC20(tk);

        Token storage _token = token[tk];

        require(
            _token.trading && !_token.tradingOnUniswap,
            "trading is already open"
        );

        bool approved = _approval(
            address(uniswapV2Router),
            tk,
            token_.balanceOf(address(this))
        );
        require(approved, "Not approved.");

        address uniswapV2Pair = IUniswapV2Factory(uniswapV2Router.factory())
            .createPair(tk, uniswapV2Router.WETH());

        uniswapV2Router.addLiquidityETH{value: address(this).balance}(
            tk,
            token_.balanceOf(address(this)),
            0,
            0,
            address(this),
            block.timestamp
        );

        ERC20(uniswapV2Pair).approve(address(uniswapV2Router), type(uint).max);
    }
}
