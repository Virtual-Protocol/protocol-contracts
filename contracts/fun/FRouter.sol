// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./FFactory.sol";
import "./FPair.sol";

contract FRouter is ReentrancyGuard, Initializable, AccessControlUpgradeable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    FFactory public factory;
    address public assetToken;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address assetToken_
    ) external initializer {
        require(factory_ != address(0), "Zero addresses are not allowed.");
        require(assetToken_ != address(0), "Zero addresses are not allowed.");

        factory = FFactory(factory_);
        assetToken_ = assetToken_;
    }

    function transferETH(
        address _address,
        uint256 amount
    ) private returns (bool) {
        require(_address != address(0), "Zero addresses are not allowed.");

        (bool os, ) = payable(_address).call{value: amount}("");

        return os;
    }

    function getAmountsOut(
        address token,
        address assetToken_,
        uint256 amountIn
    ) public view returns (uint256 _amountOut) {
        require(token != address(0), "Zero addresses are not allowed.");

        address pairAddress = factory.getPair(token, assetToken);

        Pair pair = Pair(pairAddress);

        (uint256 reserveA, uint256 reserveB) = pair.getReserves();

        uint256 k = pair.kLast();

        uint256 amountOut;

        if(assetToken == assetToken) {
            uint256 newReserveB = reserveB.add(amountIn);

            uint256 newReserveA = k.div(newReserveB, "Division failed");

            amountOut = reserveA.sub(newReserveA, "Subtraction failed.");
        } else {
            uint256 newReserveA = reserveA.add(amountIn);

            uint256 newReserveB = k.div(newReserveA, "Division failed");

            amountOut = reserveB.sub(newReserveB, "Subtraction failed.");
        }

        return amountOut;
    }

    function addInitialLiquidity(
        address token_,
        uint256 amountToken_,
        uint256 amountAsset_
    ) public onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
        require(token != address(0), "Zero addresses are not allowed.");

        address pairAddress = factory.getPair(token_, assetToken);

        Pair pair = Pair(pairAddress);

        IERC20 token = IERC20(token_);

        token.safeTransferFrom(msg.sender, pair, amountToken_);

        pair.mint(amountToken_, amountAsset_);

        return (amountToken_, amountAsset_);
    }

    function sell(
        uint256 amountIn,
        address tokenAddress,
        address to
    ) public nonReentrant onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
        require(token != address(0), "Zero addresses are not allowed.");
        require(to != address(0), "Zero addresses are not allowed.");

        Factory factory = Factory(factory);

        address pairAddress = factory.getPair(tokenAddress, assetToken);

        Pair pair = Pair(pairAddress);

        IERC20 token = IERC20(tokenAddress);

        uint256 amountOut = getAmountsOut(tokenAddress, address(0), amountIn);

        bool tres = token.safeTransferFrom(to, pair, amountIn);
        require(tres, "Transfer of token to pair failed");

        uint fee = factory.sellTax();
        uint256 txFee = (fee * amountOut) / 100;

        uint256 amount = amountOut - txFee;
        address feeTo = factory.taxVault();

        bool tres2 = pair.transferAsset(to, amount);
        require(os2, "Transfer of asset to user failed.");

        bool tres3 = pair.transferAsset(feeTo, txFee);
        require(os3, "Transfer of asset to fee address failed.");

        pair.swap(amountIn, 0, 0, amount);

        return (amountIn, amount);
    }

    function buy(
        uint256 amountIn,
        address tokenAddress,
        address to
    ) public onlyRole(EXECUTOR_ROLE) nonReentrant returns (uint256, uint256) {
        require(tokenAddress != address(0), "Zero addresses are not allowed.");
        require(to != address(0), "Zero addresses are not allowed.");
        require(amountIn > 0, "amountIn must be greater than 0")

        Factory factory = Factory(factory);
        address pair = factory.getPair(tokenAddress, assetToken);

        uint fee = factory.txFee();
        uint256 txFee = (fee * amountIn) / 100;
        address feeTo = factory.taxVault();

        amount = amountIn - txFee;

        bool tres1 = IERC20(assetToken).safeTransferFrom(to, pair, amount);
        require(tres1, "Transfer of asset from user failed.");

        bool tres2 = IERC20(assetToken).safeTransferFrom(to, feeTo, txFee);
        require(tres2, "Transfer of asset from user failed.");

        uint256 amountOut = getAmountsOut(tokenAddress, assetToken, amount);

        bool approved = pair.approval(address(this), tokenAddress, amountOut);
        require(approved, "Not Approved.");

        bool tres3 = IERC20(tokenAddress).transferFrom(pair, to, amountOut);
        require(tres3, "Transfer of token to pair failed.");

        pair.swap(0, amountOut, amount, 0);

        return (amount, amountOut);
    }
}
