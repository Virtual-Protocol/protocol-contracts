// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Pair is ReentrancyGuard {

    address public router;
    address public tokenA;
    address public tokenB;

    struct Pool {
        uint256 reserve0;
        uint256 reserve1;
        uint256 k;
        uint256 lastUpdated;
    }

    Pool private _pool;

    constructor(address router_, address token0, address token1) {
        require(router_ != address(0), "Zero addresses are not allowed.");
        require(token0 != address(0), "Zero addresses are not allowed.");
        require(token1 != address(0), "Zero addresses are not allowed.");

        router = router_;
        tokenA = token0;
        tokenB = token1;
    }

    modifier onlyRouter(){
        require(router == _msgSender(), "Only router can call this function");
        _;
    }

    event Mint(uint256 reserve0, uint256 reserve1);

    event Swap(uint256 amount0In, uint256 amount0Out, uint256 amount1In, uint256 amount1Out);

    function mint(uint256 reserve0, uint256 reserve1) public onlyRouter {
        require(pool.lastUpdated == 0, "Already minted")

        pool = Pool({
            reserve0: reserve0,
            reserve1: reserve1,
            k: reserve0 * reserve1,
            lastUpdated: block.timestamp
        });

        emit Mint(reserve0, reserve1);

        return true;
    }

    function swap(uint256 amount0In, uint256 amount0Out, uint256 amount1In, uint256 amount1Out) public onlyRouter returns (bool) {
        uint256 _reserve0 = (pool.reserve0 + amount0In) - amount0Out;
        uint256 _reserve1 = (pool.reserve1 + amount1In) - amount1Out;
        uint256 reserve1_ = (pool._reserve1 + amount1In) - amount1Out;

        pool = Pool({
            reserve0: _reserve0,
            reserve1: _reserve1,
            _reserve1: reserve1_,
            k: pool.k,
            lastUpdated: block.timestamp
        });

        emit Swap(amount0In, amount0Out, amount1In, amount1Out);

        return true;
    }


    function approval(address _user, address _token, uint256 amount) public onlyRouter returns (bool) {
        require(_user != address(0), "Zero addresses are not allowed.");
        require(_token != address(0), "Zero addresses are not allowed.");

        IERC20 token = IERC20(_token);

        token.approve(_user, amount);

        return true;
    }

    function transferAsset(address recipient, uint256 amount) public onlyRouter returns (bool) {
        require(recipient != address(0), "Zero addresses are not allowed.");

        return IERC20(assetToken).safeTransfer(recipient, amount);
    }

    function getReserves() public view returns (uint256, uint256) {
        return (pool.reserve0, pool.reserve1);
    }

    function kLast() public view returns (uint256) {
        return pool.k;
    }

    function priceALast() public view returns (uint256) {
        return pool.reserve1 / pool.reserve0;
    }

    function priceBLast() public view returns (uint256) {
        return pool.reserve0 / pool.reserve1;
    }

    function balance() public view returns (uint256) {
        return IERC20(tokenB).balanceOf(address(this));
    }
}