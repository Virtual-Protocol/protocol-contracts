// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../virtualPersona/IAgentDAO.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";

contract MockAgentDAO is IAgentDAO {
    string public daoName;
    IVotes public token;
    address public agentNft;
    uint256 public threshold;
    uint256 public votingPeriod;

    uint256 private _proposalCount;
    mapping(address => uint256) private _scoreOf;
    uint256 private _totalScore;

    // Mock proposal data
    struct Proposal {
        address proposer;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bool canceled;
    }

    mapping(uint256 => Proposal) public proposals;

    // Events are inherited from IGovernor interface

    constructor() {
        // Mock implementation
    }

    function initialize(
        string memory _name,
        IVotes _token,
        address _agentNft,
        uint256 _threshold,
        uint32 _votingPeriod_
    ) external override {
        daoName = _name;
        token = _token;
        agentNft = _agentNft;
        threshold = _threshold;
        votingPeriod = uint256(_votingPeriod_);
    }

    function proposalCount() external view override returns (uint256) {
        return _proposalCount;
    }

    function scoreOf(address account) external view override returns (uint256) {
        return _scoreOf[account];
    }

    function totalScore() external view override returns (uint256) {
        return _totalScore;
    }

    function getPastScore(
        address account,
        uint256 timepoint
    ) external view override returns (uint256) {
        // Mock implementation - return current score
        return _scoreOf[account];
    }

    function getMaturity(
        uint256 proposalId
    ) external view override returns (uint256) {
        require(proposalId < _proposalCount, "Proposal does not exist");
        return proposals[proposalId].endBlock;
    }

    // Mock functions for testing
    function setScore(address account, uint256 score) external {
        _totalScore = _totalScore - _scoreOf[account] + score;
        _scoreOf[account] = score;
    }
}
