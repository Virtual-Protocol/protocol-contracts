// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IUniswapV2Router02.sol";

interface IUniswapV2Router03 is IUniswapV2Router02 {
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB);
}
