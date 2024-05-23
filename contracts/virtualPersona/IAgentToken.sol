// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentToken {
    function initialize(
        string memory name,
        string memory symbol,
        address _minter
    ) external;

    function mint(address account, uint256 value) external;
}
