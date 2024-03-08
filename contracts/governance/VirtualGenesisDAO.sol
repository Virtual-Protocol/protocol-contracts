// SPDX-License-Identifier: MIT
// This DAO allows early execution of proposal as soon as quorum is reached
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorStorage.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "./GovernorCountingSimple.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract VirtualGenesisDAO is
    Governor,
    GovernorSettings,
    GovernorStorage,
    GovernorVotes,
    GovernorCountingSimple,
    AccessControl
{
    using Checkpoints for Checkpoints.Trace224;

    mapping(uint256 => bool) _earlyExecutions;
    Checkpoints.Trace224 private _quorumCheckpoints;

    uint256 private _quorum;

    event QuorumUpdated(uint224 oldQuorum, uint224 newQuorum);

    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    constructor(
        IVotes token,
        uint48 initialVotingDelay,
        uint32 initialVotingPeriod,
        uint256 initialProposalThreshold
    )
        Governor("VirtualGenesis")
        GovernorSettings(
            initialVotingDelay,
            initialVotingPeriod,
            initialProposalThreshold
        )
        GovernorVotes(token)
    {
        _quorumCheckpoints.push(0, 10000e18);
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
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
        uint256 blockNumber
    ) public view override returns (uint256) {
        uint256 length = _quorumCheckpoints.length();

        // Optimistic search, check the latest checkpoint
        Checkpoints.Checkpoint224 memory latest = _quorumCheckpoints.at(
            SafeCast.toUint32(length - 1)
        );
        uint48 latestKey = latest._key;
        uint224 latestValue = latest._value;
        if (latestKey <= blockNumber) {
            return latestValue;
        }

        // Otherwise, do the binary search
        return
            _quorumCheckpoints.upperLookupRecent(
                SafeCast.toUint32(blockNumber)
            );
    }

    function earlyExecute(uint256 proposalId) public onlyRole(EXECUTOR_ROLE) payable returns (uint256) {
        (
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas,
            bytes32 descriptionHash
        ) = proposalDetails(proposalId);

        require(
            state(proposalId) == ProposalState.Active &&
                _quorumReached(proposalId) &&
                !_earlyExecutions[proposalId],
            "Proposal not ready for early execution"
        );
        // avoid reentrancy
        _earlyExecutions[proposalId] = true;

        _executeOperations(
            proposalId,
            targets,
            values,
            calldatas,
            descriptionHash
        );

        emit ProposalExecuted(proposalId);

        return proposalId;
    }

    // Handle early execution
    function state(
        uint256 proposalId
    ) public view override returns (ProposalState) {
        if (_earlyExecutions[proposalId]) {
            return ProposalState.Executed;
        }
        return super.state(proposalId);
    }

    function updateQuorum(uint224 newQuorum) public onlyGovernance {
        uint224 oldQuorum = _quorumCheckpoints.latest();
        _quorumCheckpoints.push(
            SafeCast.toUint32(clock()),
            SafeCast.toUint208(newQuorum)
        );
        emit QuorumUpdated(oldQuorum, newQuorum);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(Governor, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
