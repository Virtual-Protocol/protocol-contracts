// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IExecutionInterface {
    function execute(address to, uint256 value, bytes memory data, uint8 operation) external returns (bool success);
}