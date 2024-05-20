// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMinter {
    function mintInitial(address token) external;

    function mint(uint256 nftId) external;
}
