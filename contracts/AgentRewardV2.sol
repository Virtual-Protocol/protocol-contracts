// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC5805} from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./virtualPersona/IAgentNft.sol";
import "./virtualPersona/IAgentToken.sol";
import "./virtualPersona/IAgentDAO.sol";
import "./virtualPersona/IAgentVeToken.sol";
import "./libs/RewardSettingsCheckpoints.sol";
import "./contribution/IContributionNft.sol";
import "./contribution/IServiceNft.sol";
import "./libs/TokenSaver.sol";
import "./IAgentReward.sol";

contract AgentRewardV2 is
    IAgentReward,
    Initializable,
    AccessControl,
    TokenSaver
{
    using Math for uint256;
    using SafeERC20 for IERC20;
    using RewardSettingsCheckpoints for RewardSettingsCheckpoints.Trace;

    uint256 private _nextAgentRewardId;

    uint256 public constant DENOMINATOR = 10000;
    bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");
    uint8 public constant LOOP_LIMIT = 100;

    // Referencing contracts
    address public rewardToken;
    address public agentNft;

    // Rewards checkpoints, split into Master reward and Virtual shares
    Reward[] private _rewards;
    mapping(uint256 virtualId => AgentReward[]) private _agentRewards;

    RewardSettingsCheckpoints.Trace private _rewardSettings;

    // Rewards ledger
    uint256 public protocolRewards;

    modifier onlyGov() {
        if (!hasRole(GOV_ROLE, _msgSender())) {
            revert NotGovError();
        }
        _;
    }

    bool internal locked;

    modifier noReentrant() {
        require(!locked, "cannot reenter");
        locked = true;
        _;
        locked = false;
    }

    function initialize(
        address rewardToken_,
        address agentNft_,
        RewardSettingsCheckpoints.RewardSettings memory settings_
    ) external initializer {
        rewardToken = rewardToken_;
        agentNft = agentNft_;
        _rewardSettings.push(0, settings_);
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _nextAgentRewardId = 1;
    }

    function getRewardSettings()
        public
        view
        returns (RewardSettingsCheckpoints.RewardSettings memory)
    {
        return _rewardSettings.latest();
    }

    function getPastRewardSettings(
        uint32 timepoint
    ) public view returns (RewardSettingsCheckpoints.RewardSettings memory) {
        uint32 currentTimepoint = SafeCast.toUint32(block.number);
        if (timepoint >= currentTimepoint) {
            revert ERC5805FutureLookup(timepoint, currentTimepoint);
        }
        return _rewardSettings.upperLookupRecent(timepoint);
    }

    function getReward(uint256 pos) public view returns (Reward memory) {
        return _rewards[pos];
    }

    function getAgentReward(
        uint256 virtualId,
        uint256 pos
    ) public view returns (AgentReward memory) {
        return _agentRewards[virtualId][pos];
    }

    function agentRewardCount(uint256 virtualId) public view returns (uint256) {
        return _agentRewards[virtualId].length;
    }

    function rewardCount() public view returns (uint256) {
        return _rewards.length;
    }

    // ----------------
    // Helper functions
    // ----------------
    function getTotalStaked(
        uint256 virtualId
    ) public view returns (uint256 totalStaked) {
        return
            IERC20(IAgentNft(agentNft).virtualLP(virtualId).veToken)
                .totalSupply();
    }

    function getLPValue(uint256 virtualId) public view returns (uint256) {
        address lp = IAgentNft(agentNft).virtualLP(virtualId).pool;
        return IERC20(rewardToken).balanceOf(lp);
    }

    // ----------------
    // Distribute rewards
    // ----------------

    // Distribute rewards to stakers and validators
    // Reward source such as virtual specific revenue will share with protocol
    function distributeRewards(
        uint256 amount,
        uint256[] memory virtualIds,
        bool shouldShareWithProtocol
    ) public onlyGov {
        require(amount > 0, "Invalid amount");

        IERC20(rewardToken).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );

        RewardSettingsCheckpoints.RewardSettings
            memory settings = getRewardSettings();

        uint256 protocolAmount = shouldShareWithProtocol
            ? _distributeProtocolRewards(amount)
            : 0;

        uint256 balance = amount - protocolAmount;
        uint256 rewardIndex = _rewards.length;
        uint virtualCount = virtualIds.length;
        uint256[] memory lpValues = new uint256[](virtualCount);

        uint256 totalLPValues = 0;
        for (uint i = 0; i < virtualCount; i++) {
            lpValues[i] = getLPValue(virtualIds[i]);
            totalLPValues += lpValues[i];
        }

        if (totalLPValues <= 0) {
            revert("Invalid LP values");
        }

        _rewards.push(Reward(block.number, balance, lpValues, virtualIds));

        emit NewReward(rewardIndex, virtualIds);

        // We expect around 3-5 virtuals here, the loop should not exceed gas limit
        for (uint i = 0; i < virtualCount; i++) {
            uint256 virtualId = virtualIds[i];
            _distributeAgentReward(
                virtualId,
                rewardIndex,
                (lpValues[i] * balance) / totalLPValues,
                settings
            );
        }
    }

    function _distributeAgentReward(
        uint256 virtualId,
        uint256 rewardIndex,
        uint256 amount,
        RewardSettingsCheckpoints.RewardSettings memory settings
    ) private {
        uint256 agentRewardId = _nextAgentRewardId++;

        uint256 totalStaked = getTotalStaked(virtualId);

        uint256 stakerAmount = (amount * settings.stakerShares) / DENOMINATOR;

        uint256 totalProposals = IAgentDAO(
            IAgentNft(agentNft).virtualInfo(virtualId).dao
        ).proposalCount();

        _agentRewards[virtualId].push(
            AgentReward(
                agentRewardId,
                rewardIndex,
                stakerAmount,
                amount - stakerAmount,
                totalProposals,
                totalStaked
            )
        );

        emit NewAgentReward(virtualId, agentRewardId);
    }

    function _distributeProtocolRewards(
        uint256 amount
    ) private returns (uint256) {
        RewardSettingsCheckpoints.RewardSettings
            memory rewardSettings = _rewardSettings.latest();
        uint256 protocolShares = (amount * rewardSettings.protocolShares) /
            DENOMINATOR;
        protocolRewards += protocolShares;
        return protocolShares;
    }

    // ----------------
    // Claim rewards
    // ----------------
    mapping(address account => mapping(uint256 virtualId => Claim claim)) _stakerClaims;
    mapping(address account => mapping(uint256 virtualId => Claim claim)) _validatorClaims;

    function getClaimableStakerRewards(
        address account,
        uint256 virtualId
    ) public view returns (uint256 totalClaimable, uint256 numRewards) {
        Claim memory claim = _stakerClaims[account][virtualId];
        numRewards = Math.min(
            LOOP_LIMIT + claim.rewardCount,
            getAgentRewardCount(virtualId)
        );
        IAgentVeToken veToken = IAgentVeToken(
            IAgentNft(agentNft).virtualLP(virtualId).veToken
        );
        IAgentDAO dao = IAgentDAO(
            IAgentNft(agentNft).virtualInfo(virtualId).dao
        );
        for (uint i = claim.rewardCount; i < numRewards; i++) {
            AgentReward memory agentReward = getAgentReward(virtualId, i);
            Reward memory reward = getReward(agentReward.rewardIndex);
            address delegatee = veToken.getPastDelegates(
                account,
                reward.blockNumber
            );
            uint256 uptime = dao.getPastScore(delegatee, reward.blockNumber);
            uint256 stakedAmount = veToken.getPastBalanceOf(
                account,
                reward.blockNumber
            );
            uint256 stakerReward = (agentReward.stakerAmount * stakedAmount) /
                agentReward.totalStaked;
            stakerReward = (stakerReward * uptime) / agentReward.totalProposals;

            totalClaimable += stakerReward;
        }
    }

    function getClaimableValidatorRewards(
        address account,
        uint256 virtualId
    ) public view returns (uint256 totalClaimable, uint256 numRewards) {
        Claim memory claim = _validatorClaims[account][virtualId];
        numRewards = Math.min(
            LOOP_LIMIT + claim.rewardCount,
            getAgentRewardCount(virtualId)
        );
        IVotes veToken = IVotes(
            IAgentNft(agentNft).virtualLP(virtualId).veToken
        );
        IAgentDAO dao = IAgentDAO(
            IAgentNft(agentNft).virtualInfo(virtualId).dao
        );
        for (uint i = claim.rewardCount; i < numRewards; i++) {
            AgentReward memory agentReward = getAgentReward(virtualId, i);
            Reward memory reward = getReward(agentReward.rewardIndex);
            uint256 uptime = dao.getPastScore(account, reward.blockNumber);
            uint256 votes = veToken.getPastVotes(account, reward.blockNumber);
            uint256 validatorReward = (agentReward.validatorAmount * votes) /
                agentReward.totalStaked;
            validatorReward =
                (validatorReward * uptime) /
                agentReward.totalProposals;

            totalClaimable += validatorReward;
        }
    }

    function getTotalClaimableStakerRewards(
        address account,
        uint256[] memory virtualIds
    ) public view returns (uint256 totalClaimable) {
        for (uint i = 0; i < virtualIds.length; i++) {
            uint256 virtualId = virtualIds[i];
            (uint256 claimable, ) = getClaimableStakerRewards(
                account,
                virtualId
            );
            totalClaimable += claimable;
        }
    }

    function getTotalClaimableValidatorRewards(
        address account,
        uint256[] memory virtualIds
    ) public view returns (uint256 totalClaimable) {
        for (uint i = 0; i < virtualIds.length; i++) {
            uint256 virtualId = virtualIds[i];
            (uint256 claimable, ) = getClaimableValidatorRewards(
                account,
                virtualId
            );
            totalClaimable += claimable;
        }
    }

    function getAgentRewardCount(
        uint256 virtualId
    ) public view returns (uint256) {
        return _agentRewards[virtualId].length;
    }

    function claimStakerRewards(
        uint256 virtualId
    ) public noReentrant {
        address account = _msgSender();
        uint256 totalClaimable;
        uint256 numRewards;
        (totalClaimable, numRewards) = getClaimableStakerRewards(
            account,
            virtualId
        );

        Claim storage claim = _stakerClaims[account][virtualId];
        claim.totalClaimed += totalClaimable;
        claim.rewardCount = numRewards;

        IERC20(rewardToken).safeTransfer(account, totalClaimable);

        emit StakerRewardClaimed(virtualId, account, numRewards, totalClaimable);
    }

    function claimValidatorRewards(
        uint256 virtualId
    ) public noReentrant {
        address account = _msgSender();
        uint256 totalClaimable;
        uint256 numRewards;
        (totalClaimable, numRewards) = getClaimableValidatorRewards(
            account,
            virtualId
        );

        Claim storage claim = _validatorClaims[account][virtualId];
        claim.totalClaimed += totalClaimable;
        claim.rewardCount = numRewards;

        IERC20(rewardToken).safeTransfer(account, totalClaimable);

        emit ValidatorRewardClaimed(virtualId, account, totalClaimable);
    }

    function claimAllStakerRewards(
        uint256[] memory virtualIds
    ) public noReentrant {
        address account = _msgSender();
        uint256 totalClaimable;
        for (uint i = 0; i < virtualIds.length; i++) {
            uint256 virtualId = virtualIds[i];
            uint256 claimable;
            uint256 numRewards;
            (claimable, numRewards) = getClaimableStakerRewards(
                account,
                virtualId
            );
            totalClaimable += claimable;

            Claim storage claim = _stakerClaims[account][virtualId];
            claim.totalClaimed += claimable;
            claim.rewardCount = numRewards;
        }

        IERC20(rewardToken).safeTransfer(account, totalClaimable);
    }

    function claimAllValidatorRewards(
        uint256[] memory virtualIds
    ) public noReentrant {
        address account = _msgSender();
        uint256 totalClaimable;
        for (uint i = 0; i < virtualIds.length; i++) {
            uint256 virtualId = virtualIds[i];
            uint256 claimable;
            uint256 numRewards;
            (claimable, numRewards) = getClaimableValidatorRewards(
                account,
                virtualId
            );
            totalClaimable += claimable;

            Claim storage claim = _validatorClaims[account][virtualId];
            claim.totalClaimed += claimable;
            claim.rewardCount = numRewards;
        }

        IERC20(rewardToken).safeTransfer(account, totalClaimable);
    }

    // ----------------
    // Manage parameters
    // ----------------

    function setRewardSettings(
        uint16 protocolShares_,
        uint16 stakerShares_
    ) public onlyGov {
        _rewardSettings.push(
            SafeCast.toUint32(block.number),
            RewardSettingsCheckpoints.RewardSettings(
                protocolShares_,
                stakerShares_
            )
        );

        emit RewardSettingsUpdated(protocolShares_, stakerShares_);
    }

    function updateRefContracts(
        address rewardToken_,
        address agentNft_
    ) external onlyGov {
        rewardToken = rewardToken_;
        agentNft = agentNft_;

        emit RefContractsUpdated(rewardToken_, agentNft_);
    }
}
