// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITBABonus {
    function distributeBonus(
        uint256 agentId,
        address recipient,
        uint256 amount
    ) external;
}
