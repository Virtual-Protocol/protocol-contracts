// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMinter {
    function mint(uint256 nftId) external;

    event ImpactMultiplierUpdated(uint256 newMultiplier);
    event AgentImpactMultiplierUpdated(
        uint256 indexed virtualId,
        uint256 newMultiplier
    );
    event IPShareUpdated(uint256 newMultiplier);
    event AgentIPShareUpdated(
        uint256 indexed virtualId,
        uint256 newMultiplier
    );
}
