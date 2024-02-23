// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/utils/IVotes.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";

interface IAgentDAO {
    function initialize(
        string memory name,
        IVotes token,
        address contributionNft,
        uint256 threshold,
        uint32 votingPeriod_
    ) external;

    function proposalCount() external view returns (uint256);

    function scoreOf(address account) external view returns (uint256);

    function getPastScore(
        address account,
        uint256 timepoint
    ) external view returns (uint256);

    function getMaturity(uint256 proposalId) external view returns (uint256);

    event ValidatorEloRating(uint256 proposalId, address voter, uint256 score, uint8[] votes);
}
