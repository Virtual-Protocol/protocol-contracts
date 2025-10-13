// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../pool/IUniswapV2Router02.sol";
import "../pool/IUniswapV2Factory.sol";

contract MockUniswapV2Router02 {
    address private immutable _factory;
    address private immutable _WETH;

    constructor(address factory_, address WETH_) {
        _factory = factory_;
        _WETH = WETH_;
    }

    function factory() external view returns (address) {
        return _factory;
    }

    function WETH() external view returns (address) {
        return _WETH;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        // Mock implementation - return the desired amounts
        amountA = amountADesired;
        amountB = amountBDesired;
        liquidity = amountADesired + amountBDesired; // Simple mock
    }

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    )
        external
        payable
        returns (uint amountToken, uint amountETH, uint liquidity)
    {
        // Mock implementation
        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = amountTokenDesired + msg.value;
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB) {
        // Mock implementation
        amountA = liquidity / 2;
        amountB = liquidity / 2;
    }

    function removeLiquidityETH(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountToken, uint amountETH) {
        // Mock implementation
        amountToken = liquidity / 2;
        amountETH = liquidity / 2;
    }

    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint amountA, uint amountB) {
        // Mock implementation
        amountA = liquidity / 2;
        amountB = liquidity / 2;
    }

    function removeLiquidityETHWithPermit(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint amountToken, uint amountETH) {
        // Mock implementation
        amountToken = liquidity / 2;
        amountETH = liquidity / 2;
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        // Mock implementation
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        for (uint i = 1; i < path.length; i++) {
            amounts[i] = amountIn; // Simple 1:1 swap
        }
    }

    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        // Mock implementation
        amounts = new uint[](path.length);
        amounts[path.length - 1] = amountOut;
        for (uint i = 0; i < path.length - 1; i++) {
            amounts[i] = amountOut; // Simple 1:1 swap
        }
    }

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts) {
        // Mock implementation
        amounts = new uint[](path.length);
        amounts[0] = msg.value;
        for (uint i = 1; i < path.length; i++) {
            amounts[i] = msg.value; // Simple 1:1 swap
        }
    }

    function swapTokensForExactETH(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        // Mock implementation
        amounts = new uint[](path.length);
        amounts[path.length - 1] = amountOut;
        for (uint i = 0; i < path.length - 1; i++) {
            amounts[i] = amountOut; // Simple 1:1 swap
        }
    }

    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        // Mock implementation
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        for (uint i = 1; i < path.length; i++) {
            amounts[i] = amountIn; // Simple 1:1 swap
        }
    }

    function swapETHForExactTokens(
        uint amountOut,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts) {
        // Mock implementation
        amounts = new uint[](path.length);
        amounts[path.length - 1] = amountOut;
        for (uint i = 0; i < path.length - 1; i++) {
            amounts[i] = amountOut; // Simple 1:1 swap
        }
    }

    function quote(
        uint amountA,
        uint reserveA,
        uint reserveB
    ) external pure returns (uint amountB) {
        // Mock implementation - simple 1:1 quote
        return amountA;
    }

    function getAmountOut(
        uint amountIn,
        uint reserveIn,
        uint reserveOut
    ) external pure returns (uint amountOut) {
        // Mock implementation - simple 1:1 calculation
        return amountIn;
    }

    function getAmountIn(
        uint amountOut,
        uint reserveIn,
        uint reserveOut
    ) external pure returns (uint amountIn) {
        // Mock implementation - simple 1:1 calculation
        return amountOut;
    }

    function getAmountsOut(
        uint amountIn,
        address[] calldata path
    ) external view returns (uint[] memory amounts) {
        // Mock implementation
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        for (uint i = 1; i < path.length; i++) {
            amounts[i] = amountIn; // Simple 1:1 swap
        }
    }

    function getAmountsIn(
        uint amountOut,
        address[] calldata path
    ) external view returns (uint[] memory amounts) {
        // Mock implementation
        amounts = new uint[](path.length);
        amounts[path.length - 1] = amountOut;
        for (uint i = 0; i < path.length - 1; i++) {
            amounts[i] = amountOut; // Simple 1:1 swap
        }
    }

    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountETH) {
        // Mock implementation
        return liquidity / 2;
    }

    function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint amountETH) {
        // Mock implementation
        return liquidity / 2;
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external {
        // Mock implementation - do nothing
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable {
        // Mock implementation - do nothing
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external {
        // Mock implementation - do nothing
    }
}
