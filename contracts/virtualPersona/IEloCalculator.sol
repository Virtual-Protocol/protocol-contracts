// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEloCalculator {
    function battleElo(
        uint256 currentRating,
        uint8[] memory battles
    ) external view returns (uint256);
}
