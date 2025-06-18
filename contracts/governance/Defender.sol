// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "../token/IVEVirtual.sol";

contract Defender is AccessControlUpgradeable, ReentrancyGuardUpgradeable {
    using Checkpoints for Checkpoints.Trace224;

    bytes32 public constant OPS_ROLE = keccak256("OPS_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    Checkpoints.Trace224 private _quorumCheckpoints;

    error DisabledDeposit();

    enum ProposalState {
        Pending,
        Active,
        Finalizing,
        Defeated,
        Succeeded
    }

    enum VoteType {
        NotVoted,
        Against,
        For
    }
    struct Proposal {
        uint256 totalVEVirtual;
        uint256 finalizedAt;
        uint256 createdAt;
        ProposalState state;
    }

    struct ProposalVote {
        uint256 againstVotes;
        uint256 forVotes;
        uint256 initialForVotes;
        uint256 initialAgainstVotes;
        mapping(address voter => bool) hasVoted;
        mapping(address voter => bool) forVoters;
        mapping(address voter => bool) voteFinalized;
        mapping(address voter => uint256) votes;
        address[] voters;
        uint256 finalizedCount;
    }

    mapping(uint256 proposalId => ProposalVote) private _proposalVotes;

    mapping(uint256 proposalId => Proposal) public proposals;

    event ProposalCreated(
        uint256 indexed genesisId,
        uint256 version,
        uint256 proposalId
    );

    event QuorumUpdated(uint224 oldQuorum, uint224 newQuorum);

    mapping(address voter => uint8 defendedCount) public defendedCount;

    uint8 public maxDefendCount;

    uint256 public constant DENOM = 10000;

    error ExceededMaxDefendCount(
        uint8 currentDefendCount,
        uint8 maxDefendCount
    );

    modifier onlyActiveProposal(uint256 proposalId) {
        require(
            proposals[proposalId].state == ProposalState.Active,
            "Proposal not active"
        );
        _;
    }

    IVEVirtual public veVirtual;

    event CastVote(
        uint256 indexed proposalId,
        address indexed voter,
        VoteType support
    );
    event Finalized(
        uint256 indexed proposalId,
        uint256 totalVEVirtual,
        uint256 againstVotes,
        uint256 forVotes,
        ProposalState state
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin_,
        uint8 maxDefendCount_,
        address veVirtual_
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, admin_);
        require(admin_ != address(0), "Invalid admin address");
        require(veVirtual_ != address(0), "Invalid veVirtual address");
        maxDefendCount = maxDefendCount_;
        veVirtual = IVEVirtual(veVirtual_);
        _quorumCheckpoints.push(0, 3000);
    }

    receive() external payable virtual {
        revert DisabledDeposit();
    }

    function setMaxDefendCount(
        uint8 maxDefendCount_
    ) external onlyRole(ADMIN_ROLE) {
        maxDefendCount = maxDefendCount_;
    }

    function updateQuorum(uint224 newQuorum) public onlyRole(ADMIN_ROLE) {
        uint224 oldQuorum = _quorumCheckpoints.latest();
        _quorumCheckpoints.push(
            SafeCast.toUint32(block.timestamp),
            SafeCast.toUint208(newQuorum)
        );
        emit QuorumUpdated(oldQuorum, newQuorum);
    }

    function propose(
        uint256 genesisId,
        uint256 version
    ) external onlyRole(OPS_ROLE) returns (uint256) {
        uint256 proposalId = hashProposal(genesisId, version);

        proposals[proposalId] = Proposal({
            totalVEVirtual: 0,
            finalizedAt: 0,
            createdAt: block.timestamp,
            state: ProposalState.Active
        });

        emit ProposalCreated(genesisId, version, proposalId);

        return proposalId;
    }

    function hasVoted(
        uint256 proposalId,
        address account
    ) public view returns (bool) {
        return _proposalVotes[proposalId].hasVoted[account];
    }

    function voteByAccount(
        uint256 proposalId,
        address account
    ) public view returns (VoteType, uint256) {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];

        if (!proposalVote.hasVoted[account]) {
            return (VoteType.NotVoted, 0);
        }

        if (proposalVote.forVoters[account]) {
            return (VoteType.For, proposalVote.votes[account]);
        }

        return (VoteType.Against, proposalVote.votes[account]);
    }

    function proposalVotes(
        uint256 proposalId
    )
        public
        view
        returns (
            uint256 againstVotes,
            uint256 forVotes,
            uint256 initialAgainstVotes,
            uint256 initialForVotes,
            uint256 totalVEVirtual,
            uint256 voterCount
        )
    {
        Proposal memory proposal = proposals[proposalId];
        ProposalVote storage proposalVote = _proposalVotes[proposalId];

        return (
            proposalVote.againstVotes,
            proposalVote.forVotes,
            proposalVote.initialAgainstVotes,
            proposalVote.initialForVotes,
            proposal.totalVEVirtual,
            proposalVote.voters.length
        );
    }

    function castVote(
        uint256 proposalId,
        VoteType support
    ) external onlyActiveProposal(proposalId) nonReentrant {
        address account = msg.sender;

        require(
            support == VoteType.For || support == VoteType.Against,
            "Invalid vote"
        );

        if (defendedCount[account] >= maxDefendCount) {
            revert ExceededMaxDefendCount(
                defendedCount[account],
                maxDefendCount
            );
        }

        defendedCount[account]++;

        require(!hasVoted(proposalId, account), "Already voted");

        ProposalVote storage proposalVote = _proposalVotes[proposalId];
        proposalVote.hasVoted[account] = true;
        proposalVote.voters.push(account);

        if (support == VoteType.For) {
            proposalVote.forVoters[account] = true;
            proposalVote.initialForVotes++;
        } else {
            proposalVote.initialAgainstVotes++;
        }

        emit CastVote(proposalId, account, support);
    }

    function finalize(
        uint256 proposalId,
        uint256 totalVEVirtual,
        uint256 finalizedAt
    ) external onlyRole(OPS_ROLE) onlyActiveProposal(proposalId) {
        Proposal storage proposal = proposals[proposalId];
        require(
            finalizedAt <= block.timestamp && finalizedAt > proposal.createdAt,
            "Invalid finalizedAt"
        );
        require(totalVEVirtual > 0, "Invalid totalVEVirtual");

        proposal.finalizedAt = finalizedAt;
        proposal.totalVEVirtual = totalVEVirtual;
        proposal.state = ProposalState.Finalizing;
    }

    function countVotes(
        uint256 proposalId,
        uint256[] calldata voterIndexes
    ) external {
        Proposal memory proposal = proposals[proposalId];
        ProposalVote storage proposalVote = _proposalVotes[proposalId];
        require(
            proposal.state == ProposalState.Finalizing,
            "Proposal not finalizing"
        );
        for (uint256 i = 0; i < voterIndexes.length; i++) {
            address voter = proposalVote.voters[voterIndexes[i]];
            if (
                proposalVote.hasVoted[voter] &&
                !proposalVote.voteFinalized[voter]
            ) {
                proposalVote.votes[voter] = veVirtual.balanceOfAt(
                    voter,
                    proposal.finalizedAt
                );

                proposalVote.voteFinalized[voter] = true;

                if (proposalVote.forVoters[voter]) {
                    proposalVote.forVotes += proposalVote.votes[voter];
                } else {
                    proposalVote.againstVotes += proposalVote.votes[voter];
                }

                proposalVote.finalizedCount++;
                if (defendedCount[voter] > 0) {
                    defendedCount[voter]--;
                }
            }
        }

        if (proposalVote.finalizedCount == proposalVote.voters.length) {
            _concludeProposalState(proposalId);
        }
    }

    function _concludeProposalState(uint256 proposalId) internal {
        Proposal storage proposal = proposals[proposalId];
        ProposalVote storage proposalVote = _proposalVotes[proposalId];
        proposal.state = (_quorumReached(
            proposal.totalVEVirtual,
            proposalVote.againstVotes,
            proposalVote.forVotes
        ) && (proposalVote.forVotes > proposalVote.againstVotes))
            ? ProposalState.Succeeded
            : ProposalState.Defeated;

        emit Finalized(
            proposalId,
            proposal.totalVEVirtual,
            proposalVote.againstVotes,
            proposalVote.forVotes,
            proposal.state
        );
    }

    function _quorumReached(
        uint256 totalVEVirtual,
        uint256 againstVotes,
        uint256 forVotes
    ) internal view returns (bool) {
        uint256 totalVotes = againstVotes + forVotes;
        uint256 quorumVotes = (totalVEVirtual * quorum(block.timestamp)) /
            DENOM;
        return totalVotes >= quorumVotes;
    }

    function proposalVoterCount(
        uint256 proposalId
    ) public view returns (uint256) {
        return _proposalVotes[proposalId].voters.length;
    }

    function hashProposal(
        uint256 genesisId,
        uint256 version
    ) public pure virtual returns (uint256) {
        return uint256(keccak256(abi.encode(genesisId, version)));
    }

    function quorum(uint256 timestamp) public view returns (uint256) {
        uint256 length = _quorumCheckpoints.length();

        Checkpoints.Checkpoint224 memory latest = _quorumCheckpoints.at(
            SafeCast.toUint32(length - 1)
        );
        uint48 latestKey = latest._key;
        uint224 latestValue = latest._value;
        if (latestKey <= timestamp) {
            return latestValue;
        }

        return
            _quorumCheckpoints.upperLookupRecent(SafeCast.toUint32(timestamp));
    }
}
