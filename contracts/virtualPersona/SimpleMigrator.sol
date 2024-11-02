// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

import "./AgentNftV2.sol";
import "./AgentVeToken.sol";
import "./IAgentDAO.sol";
import "./IAgentToken.sol";

contract SimpleMigrator is Ownable, Pausable {
    AgentNftV2 public nft;
    address public daoImplementation;
    address public veTokenImplementation;

    mapping(uint256 => bool) public migratedAgents;

    bool internal locked;

    event AgentMigrated(uint256 virtualId, address dao, address veToken);

    modifier noReentrant() {
        require(!locked, "cannot reenter");
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address agentNft,
        address veToken,
        address dao
    ) Ownable(_msgSender()) {
        nft = AgentNftV2(agentNft);
        veTokenImplementation = veToken;
        daoImplementation = dao;
    }

    function migrateAgent(uint256 id) external noReentrant onlyOwner {
        require(!migratedAgents[id], "Agent already migrated");

        IAgentNft.VirtualInfo memory virtualInfo = nft.virtualInfo(id);
        address founder = virtualInfo.founder;

        IAgentNft.VirtualLP memory lpInfo = nft.virtualLP(id);

        // Deploy AgentVeToken
        AgentVeToken oriVeToken = AgentVeToken(lpInfo.veToken);
        address veToken = _createNewAgentVeToken(
            oriVeToken.name(),
            oriVeToken.symbol(),
            oriVeToken.assetToken(),
            founder,
            oriVeToken.canStake(),
            oriVeToken.matureAt()
        );

        // Deploy DAO
        IGovernor oldDAO = IGovernor(virtualInfo.dao);
        address payable dao = payable(
            _createNewDAO(
                oldDAO.name(),
                IVotes(veToken),
                uint32(oldDAO.votingPeriod()),
                oldDAO.proposalThreshold()
            )
        );
        // Update AgentNft
        nft.migrateVirtual(id, dao, virtualInfo.token, lpInfo.pool, veToken);

        migratedAgents[id] = true;

        emit AgentMigrated(id, dao, veToken);
    }

    function _createNewDAO(
        string memory name,
        IVotes token,
        uint32 daoVotingPeriod,
        uint256 daoThreshold
    ) internal returns (address instance) {
        instance = Clones.clone(daoImplementation);
        IAgentDAO(instance).initialize(
            name,
            token,
            address(nft),
            daoThreshold,
            daoVotingPeriod
        );

        return instance;
    }

    function _createNewAgentVeToken(
        string memory name,
        string memory symbol,
        address stakingAsset,
        address founder,
        bool canStake,
        uint256 matureAt
    ) internal returns (address instance) {
        instance = Clones.clone(veTokenImplementation);
        IAgentVeToken(instance).initialize(
            name,
            symbol,
            founder,
            stakingAsset,
            matureAt,
            address(nft),
            canStake
        );

        return instance;
    }

    function pause() external onlyOwner {
        super._pause();
    }

    function unpause() external onlyOwner {
        super._unpause();
    }

    function reset(uint256 id) external onlyOwner {
        migratedAgents[id] = false;
    }
}
