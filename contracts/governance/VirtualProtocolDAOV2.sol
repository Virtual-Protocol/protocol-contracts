// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorStorage.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "./GovernorCountingVP.sol";
import "../token/IVEVirtual.sol";

contract VirtualProtocolDAOV2 is
    Governor,
    GovernorSettings,
    GovernorStorage,
    GovernorCountingVP
{
    using Checkpoints for Checkpoints.Trace224;
    using Checkpoints for Checkpoints.Trace208;

    Checkpoints.Trace224 private _totalSupplyCheckpoints;
    address private _admin;

    IVEVirtual private immutable _token;

    Checkpoints.Trace208 private _quorumNumeratorHistory;

    event QuorumNumeratorUpdated(
        uint256 oldQuorumNumerator,
        uint256 newQuorumNumerator
    );

    event TotalSupplyUpdated(uint256 oldTotalSupply, uint256 newTotalSupply);

    error GovernorInvalidQuorumFraction(
        uint256 quorumNumerator,
        uint256 quorumDenominator
    );

    modifier onlyAdminGov() {
        require(
            _msgSender() == _admin || _msgSender() == _executor(),
            "Only admin or executor can call this function"
        );
        _;
    }

    constructor(
        address token,
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
    {
        require(admin != address(0), "Invalid admin address");
        _totalSupplyCheckpoints.push(0, 0);
        _admin = admin;
        _token = IVEVirtual(token);
        _updateQuorumNumerator(initialQuorumNumerator);
    }

    function quorumNumerator() public view virtual returns (uint256) {
        return _quorumNumeratorHistory.latest();
    }

    function quorumNumerator(
        uint256 timepoint
    ) public view virtual returns (uint256) {
        uint256 length = _quorumNumeratorHistory._checkpoints.length;

        // Optimistic search, check the latest checkpoint
        Checkpoints.Checkpoint208 storage latest = _quorumNumeratorHistory
            ._checkpoints[length - 1];
        uint48 latestKey = latest._key;
        uint208 latestValue = latest._value;
        if (latestKey <= timepoint) {
            return latestValue;
        }

        // Otherwise, do the binary search
        return
            _quorumNumeratorHistory.upperLookupRecent(
                SafeCast.toUint48(timepoint)
            );
    }

    function updateQuorumNumerator(
        uint256 newQuorumNumerator
    ) external virtual onlyAdminGov {
        _updateQuorumNumerator(newQuorumNumerator);
    }

    function _updateQuorumNumerator(
        uint256 newQuorumNumerator
    ) internal virtual {
        uint256 denominator = quorumDenominator();
        if (newQuorumNumerator > denominator) {
            revert GovernorInvalidQuorumFraction(
                newQuorumNumerator,
                denominator
            );
        }

        uint256 oldQuorumNumerator = quorumNumerator();
        _quorumNumeratorHistory.push(
            clock(),
            SafeCast.toUint208(newQuorumNumerator)
        );

        emit QuorumNumeratorUpdated(oldQuorumNumerator, newQuorumNumerator);
    }

    function setAdmin(address admin) public onlyAdminGov {
        if (_msgSender() != _executor() && _msgSender() != _admin) {
            revert("Only admin or executor can call this function");
        }
        _admin = admin;
    }

    function setTotalSupply(uint256 totalSupply, uint256 timestamp) public onlyAdminGov {
        uint256 oldTotalSupply = latestTotalSupply();
        _totalSupplyCheckpoints.push(
            SafeCast.toUint32(timestamp),
            SafeCast.toUint224(totalSupply)
        );
        emit TotalSupplyUpdated(oldTotalSupply, totalSupply);
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
    ) public view override(Governor) returns (uint256) {
        return
            (pastTotalSupply(timestamp) * quorumNumerator(timestamp)) /
            quorumDenominator();
    }

    function quorumDenominator() public pure returns (uint256) {
        return 10000;
    }

    function pastTotalSupply(uint256 timestamp) public view returns (uint256) {
        uint256 length = _totalSupplyCheckpoints.length();

        Checkpoints.Checkpoint224 memory latest = _totalSupplyCheckpoints.at(
            SafeCast.toUint32(length - 1)
        );
        uint48 latestKey = latest._key;
        uint224 latestValue = latest._value;
        if (latestKey <= timestamp) {
            return latestValue;
        }

        return
            _totalSupplyCheckpoints.upperLookupRecent(
                SafeCast.toUint32(timestamp)
            );
    }

    function latestTotalSupply() public view returns (uint256) {
        return _totalSupplyCheckpoints.latest();
    }

    function clock() public view override(Governor) returns (uint48) {
        return Time.timestamp();
    }

    function CLOCK_MODE()
        public
        pure
        override(Governor)
        returns (string memory)
    {
        return "mode=timestamp";
    }

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

    function _getVotes(
        address account,
        uint256 timepoint,
        bytes memory
    ) internal view override(Governor) returns (uint256) {
        return _token.balanceOfAt(account, timepoint);
    }

    function _validateStateBitmap2(uint256 proposalId, bytes32 allowedStates) private view returns (ProposalState) {
        ProposalState currentState = state(proposalId);
        if (_encodeStateBitmap(currentState) & allowedStates == bytes32(0)) {
            revert GovernorUnexpectedProposalState(proposalId, currentState, allowedStates);
        }
        return currentState;
    }

    function _castVote(
        uint256 proposalId,
        address account,
        uint8 support,
        string memory reason,
        bytes memory params
    ) internal override(Governor) returns (uint256) {
        _validateStateBitmap2(proposalId, _encodeStateBitmap(ProposalState.Active));

        uint256 weight = _getVotes(account, block.timestamp, params);
        _countVote(proposalId, account, support, weight, params);

        if (params.length == 0) {
            emit VoteCast(account, proposalId, support, weight, reason);
        } else {
            emit VoteCastWithParams(account, proposalId, support, weight, reason, params);
        }

        return weight;
    }
}
