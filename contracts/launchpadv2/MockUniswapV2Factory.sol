// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../pool/IUniswapV2Factory.sol";
import "./MockUniswapV2Pair.sol";

contract MockUniswapV2Factory is IUniswapV2Factory {
    address public override feeTo;
    address public override feeToSetter;

    mapping(address => mapping(address => address)) private _pairs;
    address[] public allPairs;

    constructor() {
        feeToSetter = msg.sender;
    }

    function getPair(
        address tokenA,
        address tokenB
    ) external view override returns (address pair) {
        return _pairs[tokenA][tokenB];
    }

    function allPairsLength() external view override returns (uint) {
        return allPairs.length;
    }

    function createPair(
        address tokenA,
        address tokenB
    ) external override returns (address pair) {
        require(tokenA != tokenB, "Identical addresses");
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        require(token0 != address(0), "Zero address");
        require(_pairs[token0][token1] == address(0), "Pair exists");

        // Deploy a new MockUniswapV2Pair contract
        MockUniswapV2Pair newPair = new MockUniswapV2Pair(
            token0,
            token1,
            address(this)
        );
        pair = address(newPair);

        _pairs[token0][token1] = pair;
        _pairs[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, "Not fee to setter");
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, "Not fee to setter");
        feeToSetter = _feeToSetter;
    }
}
