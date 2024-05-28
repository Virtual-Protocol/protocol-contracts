// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMinter {
    function mintInitial(address , uint256 amount) external;

    function mint(uint256 nftId) external;
}
