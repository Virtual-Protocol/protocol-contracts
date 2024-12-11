// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBondingTax {
    function swapForAsset() external returns (bool, uint256);
}
