// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import "./IAgentDAO.sol";
import "./GovernorCountingSimpleUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../contribution/IContributionNft.sol";

contract AgentDAO is
    IAgentDAO,
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorCountingSimpleUpgradeable,
    GovernorStorageUpgradeable,
    GovernorVotesUpgradeable,
    GovernorVotesQuorumFractionUpgradeable
{
    using Checkpoints for Checkpoints.Trace208;

    mapping(address => Checkpoints.Trace208) private _scores;
    mapping(uint256 => uint256) private _proposalMaturities;

    address private _contributionNft;

    error ERC5805FutureLookup(uint256 timepoint, uint48 clock);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name,
        IVotes token,
        address contributionNft,
        uint256 threshold,
        uint32 votingPeriod_
    ) external initializer {
        __Governor_init(name);
        __GovernorSettings_init(0, votingPeriod_, threshold);
        __GovernorCountingSimple_init();
        __GovernorVotes_init(token);
        __GovernorVotesQuorumFraction_init(5100);
        __GovernorCountingSimple_init();
        __GovernorStorage_init();

        _contributionNft = contributionNft;
    }

    // The following functions are overrides required by Solidity.

    function votingDelay()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function proposalThreshold()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(GovernorUpgradeable) returns (uint256) {
        address proposer = _msgSender();

        if (!_isValidDescriptionForProposer(proposer, description)) {
            revert GovernorRestrictedProposer(proposer);
        }

        uint256 proposerVotes = getVotes(proposer, clock() - 1);
        uint256 votesThreshold = proposalThreshold();
        if (
            proposerVotes < votesThreshold &&
            proposer != IContributionNft(_contributionNft).getAdmin()
        ) {
            revert GovernorInsufficientProposerVotes(
                proposer,
                proposerVotes,
                votesThreshold
            );
        }

        return _propose(targets, values, calldatas, description, proposer);
    }

    function _propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        address proposer
    )
        internal
        override(GovernorUpgradeable, GovernorStorageUpgradeable)
        returns (uint256)
    {
        return
            super._propose(targets, values, calldatas, description, proposer);
    }

    function proposalCount()
        public
        view
        override(IAgentDAO, GovernorStorageUpgradeable)
        returns (uint256)
    {
        return super.proposalCount();
    }

    function scoreOf(address account) public view returns (uint256) {
        return _scores[account].latest();
    }

    function getPastScore(
        address account,
        uint256 timepoint
    ) external view returns (uint256) {
        uint48 currentTimepoint = clock();
        if (timepoint >= currentTimepoint) {
            revert ERC5805FutureLookup(timepoint, currentTimepoint);
        }
        return _scores[account].upperLookupRecent(SafeCast.toUint48(timepoint));
    }

    function _castVote(
        uint256 proposalId,
        address account,
        uint8 support,
        string memory reason,
        bytes memory params
    ) internal override returns (uint256) {
        bool votedPreviously = hasVoted(proposalId, account);

        uint256 weight = super._castVote(
            proposalId,
            account,
            support,
            reason,
            params
        );

        if (!votedPreviously && hasVoted(proposalId, account)) {
            _scores[account].push(
                SafeCast.toUint48(block.number),
                SafeCast.toUint208(scoreOf(account)) + 1
            );
            if (params.length > 0 && support == 1) {
                _updateMaturity(account, proposalId, weight, params);
            }
        }

        return weight;
    }

    function _updateMaturity(
        address account,
        uint256 proposalId,
        uint256 weight,
        bytes memory params
    ) internal {
        // Check is this a contribution proposal
        address owner = IERC721(_contributionNft).ownerOf(proposalId);
        if (owner == address(0)) {
            return;
        }

        bool isModel = IContributionNft(_contributionNft).isModel(proposalId);
        if (!isModel) {
            return;
        }

        (uint256 maturity, uint8[] memory votes) = abi.decode(
            params,
            (uint256, uint8[])
        );
        _proposalMaturities[proposalId] += (maturity * weight);

        emit ValidatorEloRating(proposalId, account, maturity, votes);
    }

    function getMaturity(uint256 proposalId) public view returns (uint256) {
        (, uint256 forVotes, ) = proposalVotes(proposalId);
        return Math.min(10000, _proposalMaturities[proposalId] / forVotes);
    }

    function quorum(
        uint256 blockNumber
    )
        public
        view
        override(GovernorUpgradeable, GovernorVotesQuorumFractionUpgradeable)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function quorumDenominator() public pure override returns (uint256) {
        return 10000;
    }
}
