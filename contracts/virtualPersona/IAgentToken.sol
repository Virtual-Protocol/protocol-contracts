// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentToken {
    function initialize(
        string memory name,
        string memory symbol,
        address minter
    ) external;


    function mint(address receiver, uint256 amount) external;
}
