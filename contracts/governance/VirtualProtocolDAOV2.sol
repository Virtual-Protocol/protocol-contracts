// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorStorage.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "./GovernorCountingVP.sol";

contract VirtualProtocolDAOV2 is
    Governor,
    GovernorSettings,
    GovernorStorage,
    GovernorVotes,
    GovernorCountingVP,
    GovernorVotesQuorumFraction
{

    Checkpoints.Trace224 private _totalSupplyCheckpoints;
    address private _admin;

    modifier onlyAdmin() {
        require(_msgSender() == _admin, "Only admin can call this function");
        _;
    }

    constructor(
        IVotes token,
        uint48 initialVotingDelay,
        uint32 initialVotingPeriod,
        uint256 initialProposalThreshold,
        uint256 initialQuorumNumerator,
        address admin
    )
        Governor("VirtualProtocol")
        GovernorSettings(
            initialVotingDelay,
            initialVotingPeriod,
            initialProposalThreshold
        )
        GovernorVotes(token)
        GovernorVotesQuorumFraction(initialQuorumNumerator)
    {
        _totalSupplyCheckpoints.push(0, 0);
        _admin = admin;
    }

    // The following functions are overrides required by Solidity.

    function votingDelay()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override returns (uint256) {
        return super.propose(targets, values, calldatas, description);
    }

    function _propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        address proposer
    ) internal override(Governor, GovernorStorage) returns (uint256) {
        return
            super._propose(targets, values, calldatas, description, proposer);
    }

    function quorum(
        uint256 timestamp
    )
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return
            (token().getPastTotalSupply(timepoint) *
                quorumNumerator(blockNumber)) / quorumDenominator();
    }

    function quorumDenominator() public pure override returns (uint256) {
        return 10000;
    }
}
