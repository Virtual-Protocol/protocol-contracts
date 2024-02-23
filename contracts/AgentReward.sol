// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC5805} from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./virtualPersona/IAgentNft.sol";
import "./virtualPersona/IAgentToken.sol";
import "./libs/RewardSettingsCheckpoints.sol";
import "./contribution/IContributionNft.sol";
import "./contribution/IServiceNft.sol";
import "./libs/TokenSaver.sol";
import "./IAgentReward.sol";

contract AgentReward is IAgentReward, Initializable, AccessControl, TokenSaver {
    using Math for uint256;
    using SafeERC20 for IERC20;
    using RewardSettingsCheckpoints for RewardSettingsCheckpoints.Trace;

    uint48 private _nextRewardId;

    uint256 public constant DENOMINATOR = 10000;
    bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");

    // Referencing contracts
    address public rewardToken;
    address public agentNft;
    address public contributionNft;
    address public serviceNft;

    // Rewards checkpoints, split into Master reward and Virtual shares
    MainReward[] private _mainRewards;
    mapping(uint256 virtualId => Reward[]) private _rewards;

    RewardSettingsCheckpoints.Trace private _rewardSettings;

    // Rewards ledger
    uint256 public protocolRewards;
    uint256 public validatorPoolRewards; // Accumulate the penalties from missed proposal voting
    mapping(address account => mapping(uint256 virtualId => Claim claim))
        private _claimedStakerRewards;
    mapping(address account => mapping(uint256 virtualId => Claim claim))
        private _claimedValidatorRewards;
    mapping(uint256 serviceId => ServiceReward) private _serviceRewards;
    mapping(uint48 rewardId => mapping(uint8 coreType => uint256 impacts)) _rewardImpacts;

    mapping(address validator => mapping(uint48 rewardId => uint256 amount))
        private _validatorRewards;

    modifier onlyGov() {
        if (!hasRole(GOV_ROLE, _msgSender())) {
            revert NotGovError();
        }
        _;
    }

    function initialize(
        address rewardToken_,
        address agentNft_,
        address contributionNft_,
        address serviceNft_,
        RewardSettingsCheckpoints.RewardSettings memory settings_
    ) external initializer {
        rewardToken = rewardToken_;
        agentNft = agentNft_;
        contributionNft = contributionNft_;
        serviceNft = serviceNft_;
        _rewardSettings.push(0, settings_);
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _nextRewardId = 1;
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

    function getMainReward(uint32 pos) public view returns (MainReward memory) {
        return _mainRewards[pos];
    }

    function getReward(
        uint256 virtualId,
        uint32 pos
    ) public view returns (Reward memory) {
        return _rewards[virtualId][pos];
    }

    function rewardCount(uint256 virtualId) public view returns (uint256) {
        return _rewards[virtualId].length;
    }

    // ----------------
    // Distribute rewards
    // ----------------

    // DONE
    function distributeRewards(uint256 amount) public onlyGov returns (uint32) {
        require(amount > 0, "Invalid amount");

        IERC20(rewardToken).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );

        RewardSettingsCheckpoints.RewardSettings
            memory settings = getRewardSettings();

        uint256 protocolShares = _distributeProtocolRewards(amount);

        uint256 agentShares = amount - protocolShares;
        uint256 agentCount = _prepareAgentsRewards(agentShares, settings);

        uint32 mainRewardIndex = SafeCast.toUint32(_mainRewards.length - 1);

        for (uint256 virtualId = 1; virtualId <= agentCount; virtualId++) {
            _distributeAgentRewards(virtualId, mainRewardIndex, settings);
        }

        return SafeCast.toUint32(_mainRewards.length - 1);
    }

    // DONE
    function _distributeProtocolRewards(
        uint256 amount
    ) private view returns (uint256) {
        RewardSettingsCheckpoints.RewardSettings
            memory rewardSettings = _rewardSettings.latest();
        uint256 protocolShares = (amount * rewardSettings.protocolShares) /
            DENOMINATOR;
        protocolRewards += protocolShares;
        return protocolShares;
    }

    // DONE
    // Prepare agent reward placeholders and calculate total staked tokens for all eligible agents
    function _prepareAgentsRewards(
        uint256 amount,
        RewardSettingsCheckpoints.RewardSettings memory settings
    ) private returns (uint256 agentCount) {
        IAgentNft nft = IAgentNft(agentNft);
        uint256 grandTotalStaked = 0; // Total staked amount for all personas
        uint256 totalAgents = nft.totalSupply();
        uint32 mainPos = SafeCast.toUint32(_mainRewards.length);

        // Get staking amount for all agents
        for (uint256 virtualId = 1; virtualId <= totalAgents; virtualId++) {
            // Get staked amount
            uint256 totalStaked = nft.totalStaked(virtualId);
            if (totalStaked < settings.stakeThreshold) {
                continue;
            }

            agentCount++;
            grandTotalStaked += totalStaked;
            uint48 rewardId = _nextRewardId++;

            _rewards[virtualId].push(
                Reward({
                    id: rewardId,
                    mainIndex: mainPos,
                    totalStaked: totalStaked,
                    validatorAmount: 0,
                    contributorAmount: 0,
                    coreAmount: 0
                })
            );
        }

        _mainRewards.push(
            MainReward(
                SafeCast.toUint32(block.number),
                amount,
                agentCount,
                grandTotalStaked
            )
        );
        emit NewMainReward(mainPos, amount, agentCount, grandTotalStaked);
    }

    // DONE
    // Calculate agent rewards based on staked weightage and distribute to all stakers, validators and contributors
    function _distributeAgentRewards(
        uint256 virtualId,
        uint256 mainRewardIndex,
        RewardSettingsCheckpoints.RewardSettings memory settings
    ) private {
        if (_rewards[virtualId].length == 0) {
            return;
        }

        MainReward memory mainReward = _mainRewards[mainRewardIndex];

        Reward storage reward = _rewards[virtualId][
            _rewards[virtualId].length - 1
        ];
        if (reward.mainIndex != mainRewardIndex) {
            return;
        }

        // Calculate VIRTUAL reward based on staked weightage
        uint256 amount = (mainReward.amount * reward.totalStaked) /
            mainReward.totalStaked;

        reward.contributorAmount =
            (amount * uint256(settings.contributorShares)) /
            DENOMINATOR;
        reward.validatorAmount = amount - reward.contributorAmount;

        _distributeValidatorRewards(
            reward.validatorAmount,
            virtualId,
            reward.id,
            mainReward.totalStaked,
            settings
        );
        _distributeContributorRewards(
            reward.contributorAmount,
            virtualId,
            settings
        );
    }

    // DONE
    // Calculate validator rewards based on votes weightage and participation rate
    function _distributeValidatorRewards(
        uint256 amount,
        uint256 virtualId,
        uint256 rewardId,
        uint256 totalStaked,
        RewardSettingsCheckpoints.RewardSettings memory settings
    ) private {
        IAgentNft nft = IAgentNft(agentNft);
        // Calculate weighted validator shares
        uint256 validatorCount = nft.validatorCount(virtualId);
        uint256 totalProposals = nft.totalProposals(virtualId);
        for (uint256 i = 0; i < validatorCount; i++) {
            address validator = nft.validatorAt(virtualId, i);

            // Get validator revenue by votes weightage
            address stakingAddress = nft.virtualInfo(virtualId).token;
            uint256 votes = IERC5805(stakingAddress).getPastVotes(
                validator,
                block.number
            );
            uint256 validatorRewards = (amount * votes) / totalStaked;

            // Calc validator reward based on participation rate
            uint256 participationReward = (validatorRewards *
                nft.validatorScore(virtualId, validator)) / totalProposals;
            _validatorRewards[validator][rewardId] = participationReward;

            validatorPoolRewards += validatorRewards - participationReward;
        }
    }

    // DONE
    function _distributeContributorRewards(
        uint256 amount,
        uint256 virtualId,
        RewardSettingsCheckpoints.RewardSettings memory settings
    ) private {
        IAgentNft nft = IAgentNft(agentNft);
        uint8[] memory coreTypes = nft.virtualInfo(virtualId).coreTypes;
        IServiceNft serviceNftContract = IServiceNft(serviceNft);
        IContributionNft contributionNftContract = IContributionNft(
            contributionNft
        );

        Reward storage reward = _rewards[virtualId][
            _rewards[virtualId].length - 1
        ];
        reward.coreAmount = amount / coreTypes.length;
        uint256[] memory coreImpacts = new uint256[](coreTypes.length);
        uint256[] memory services = nft.getAllServices(virtualId);

        // Populate service impacts
        uint256 serviceId;
        uint256 impact;
        for (uint i = 0; i < services.length; i++) {
            serviceId = services[i];
            impact = serviceNftContract.getImpact(serviceId);
            if (impact == 0) {
                continue;
            }

            ServiceReward storage serviceReward = _serviceRewards[serviceId];
            if(serviceReward.impact == 0){
                serviceReward.impact = impact;
            }
            _rewardImpacts[reward.id][
                serviceNftContract.getCore(serviceId)
            ] += impact;
        }

        // Distribute service rewards
        uint256 impactAmount = 0;
        uint256 parentAmount = 0;
        uint256 parentShares = uint256(settings.parentShares);
        for (uint i = 0; i < services.length; i++) {
            serviceId = services[i];
            ServiceReward storage serviceReward = _serviceRewards[serviceId];
            if (serviceReward.impact == 0) {
                continue;
            }
            impactAmount =
                (reward.coreAmount * serviceReward.impact) /
                _rewardImpacts[reward.id][
                    serviceNftContract.getCore(serviceId)
                ];
            parentAmount = contributionNftContract.getParentId(serviceId) == 0
                ? 0
                : ((impactAmount * parentShares) / DENOMINATOR);

            serviceReward.amount += impactAmount - parentAmount;
            serviceReward.parentAmount += parentAmount;
        }
    }

    // ----------------
    // Functions to query rewards
    // ----------------

    // Done
    function _getClaimableStakerRewardsAt(
        uint256 pos,
        uint256 virtualId,
        address account,
        address stakingAddress
    ) private view returns (uint256) {
        Reward memory reward = getReward(virtualId, SafeCast.toUint32(pos));
        MainReward memory mainReward = getMainReward(reward.mainIndex);
        IAgentToken token = IAgentToken(stakingAddress);

        address delegatee = token.getPastDelegates(
            account,
            mainReward.blockNumber
        );

        if (delegatee == address(0)) {
            return 0;
        }

        RewardSettingsCheckpoints.RewardSettings
            memory settings = getPastRewardSettings(mainReward.blockNumber);

        uint256 validatorGroupRewards = _validatorRewards[delegatee][reward.id];

        uint256 tokens = token.getPastBalanceOf(
            account,
            mainReward.blockNumber
        );
        uint256 votes = IERC5805(stakingAddress).getPastVotes(
            delegatee,
            mainReward.blockNumber
        );

        return
            (((validatorGroupRewards * tokens) / votes) *
                uint256(settings.stakerShares)) / DENOMINATOR;
    }

    // DONE
    function _getClaimableStakerRewards(
        address staker,
        uint256 virtualId
    ) internal view returns (uint256) {
        uint256 count = rewardCount(virtualId);
        if (count == 0) {
            return 0;
        }

        address stakingAddress = IAgentNft(agentNft)
            .virtualInfo(virtualId)
            .token;

        Claim memory claim = claimedStakerRewards(staker, virtualId);
        uint256 total = 0;
        for (uint256 i = claim.rewardCount; i < count; i++) {
            total += _getClaimableStakerRewardsAt(
                i,
                virtualId,
                staker,
                stakingAddress
            );
        }

        return total;
    }

    // DONE
    function _getClaimableValidatorRewardsAt(
        uint256 pos,
        uint256 virtualId,
        address validator
    ) internal view returns (uint256) {
        Reward memory reward = getReward(virtualId, SafeCast.toUint32(pos));
        MainReward memory mainReward = getMainReward(reward.mainIndex);
        RewardSettingsCheckpoints.RewardSettings
            memory rewardSettings = getPastRewardSettings(
                mainReward.blockNumber
            );

        uint256 validatorGroupRewards = _validatorRewards[validator][reward.id];

        return
            (validatorGroupRewards *
                (DENOMINATOR - uint256(rewardSettings.stakerShares))) /
            DENOMINATOR;
    }

    // DONE
    function _getClaimableValidatorRewards(
        address validator,
        uint256 virtualId
    ) internal view returns (uint256) {
        uint256 count = rewardCount(virtualId);
        if (count == 0) {
            return 0;
        }

        Claim memory claim = _claimedValidatorRewards[validator][virtualId];
        uint256 total = 0;
        for (uint256 i = claim.rewardCount; i < count; i++) {
            total += _getClaimableValidatorRewardsAt(i, virtualId, validator);
        }

        return total;
    }

    // DONE
    function getChildrenRewards(uint256 nftId) public view returns (uint256) {
        uint256 childrenAmount = 0;
        uint256[] memory children = IContributionNft(contributionNft)
            .getChildren(nftId);

        ServiceReward memory childReward;
        for (uint256 i = 0; i < children.length; i++) {
            childReward = getServiceReward(children[i]);
            childrenAmount += (childReward.parentAmount -
                childReward.totalClaimedParent);
        }
        return childrenAmount;
    }

    // DONE
    function _getClaimableServiceRewards(
        uint256 nftId
    ) public view returns (uint256 total) {
        ServiceReward memory serviceReward = getServiceReward(nftId);
        total = serviceReward.amount - serviceReward.totalClaimed;
        uint256 childrenAmount = getChildrenRewards(nftId);
        total += childrenAmount;
    }

    // ----------------
    // Functions to claim rewards
    // ----------------
    // DONE
    function _claimStakerRewards(address account, uint256 virtualId) internal {
        uint256 amount = _getClaimableStakerRewards(account, virtualId);
        if (amount == 0) {
            return;
        }

        uint256 count = rewardCount(virtualId);

        Claim storage claim = _claimedStakerRewards[account][virtualId];
        IERC20(rewardToken).safeTransfer(account, amount);
        emit StakerRewardClaimed(virtualId, amount, account);

        claim.rewardCount = SafeCast.toUint32(count);
        claim.totalClaimed += amount;
    }

    // DONE
    function _claimValidatorRewards(uint256 virtualId) internal {
        address account = _msgSender();

        uint256 amount = _getClaimableValidatorRewards(account, virtualId);
        if (amount == 0) {
            return;
        }

        uint256 count = rewardCount(virtualId);

        Claim storage claim = _claimedValidatorRewards[account][virtualId];
        IERC20(rewardToken).safeTransfer(account, amount);
        emit ValidatorRewardClaimed(virtualId, amount, account);

        claim.rewardCount = SafeCast.toUint32(count);
        claim.totalClaimed += amount;
    }

    // DONE
    function withdrawProtocolRewards() external onlyGov {
        require(protocolRewards > 0, "No protocol rewards");
        IERC20(rewardToken).safeTransfer(_msgSender(), protocolRewards);
        protocolRewards = 0;
    }

    // DONE
    function withdrawValidatorPoolRewards() external onlyGov {
        require(validatorPoolRewards > 0, "No validator pool rewards");
        IERC20(rewardToken).safeTransfer(_msgSender(), validatorPoolRewards);
        validatorPoolRewards = 0;
    }

    // DONE
    function getServiceReward(
        uint256 virtualId
    ) public view returns (ServiceReward memory) {
        return _serviceRewards[virtualId];
    }

    function _claimServiceRewards(uint256 nftId) public {
        address account = _msgSender();
        require(
            IERC721(contributionNft).ownerOf(nftId) == account,
            "Not NFT owner"
        );

        ServiceReward storage serviceReward = _serviceRewards[nftId];
        uint256 total = (serviceReward.amount - serviceReward.totalClaimed);
 
        serviceReward.totalClaimed += total;

        // Claim children rewards
        uint256[] memory children = IContributionNft(contributionNft)
            .getChildren(nftId);

        uint256 totalChildrenAmount;
        uint256 childAmount;
        for (uint256 i = 0; i < children.length; i++) {
            ServiceReward storage childReward = _serviceRewards[children[i]];

            childAmount = (childReward.parentAmount -
                childReward.totalClaimedParent);

            if (childAmount > 0) {
                childReward.totalClaimedParent += childAmount;
                total += childAmount;
                totalChildrenAmount += childAmount;
            }
        }

        if (total == 0) {
            return;
        }

        IERC20(rewardToken).safeTransfer(account, total);
        emit ServiceRewardsClaimed(nftId, account, total, totalChildrenAmount);
    }

    function getTotalClaimableRewards(
        address account,
        uint256[] memory virtualIds,
        uint256[] memory contributionNftIds
    ) public view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < virtualIds.length; i++) {
            total +=
                _getClaimableStakerRewards(account, virtualIds[i]) +
                _getClaimableValidatorRewards(account, virtualIds[i]);
        }
        for (uint256 i = 0; i < contributionNftIds.length; i++) {
            total += _getClaimableServiceRewards(contributionNftIds[i]);
        }
        return total;
    }

    function claimAllRewards(
        uint256[] memory virtualIds,
        uint256[] memory contributionNftIds
    ) public {
        address account = _msgSender();
        for (uint256 i = 0; i < virtualIds.length; i++) {
            _claimStakerRewards(account, virtualIds[i]);
            _claimValidatorRewards(virtualIds[i]);
        }

        for (uint256 i = 0; i < contributionNftIds.length; i++) {
            _claimServiceRewards(contributionNftIds[i]);
        }
    }

    // ----------------
    // Manage parameters
    // ----------------

    function setRewardSettings(
        uint16 protocolShares_,
        uint16 contributorShares_,
        uint16 stakerShares_,
        uint16 parentShares_,
        uint256 stakeThreshold_
    ) public onlyGov {
        _rewardSettings.push(
            SafeCast.toUint32(block.number),
            RewardSettingsCheckpoints.RewardSettings(
                protocolShares_,
                contributorShares_,
                stakerShares_,
                parentShares_,
                stakeThreshold_
            )
        );
        emit RewardSettingsUpdated(
            protocolShares_,
            contributorShares_,
            stakerShares_,
            parentShares_,
            stakeThreshold_
        );
    }

    function updateRefContracts(
        address rewardToken_,
        address personaNft_,
        address contributionNft_,
        address serviceNft_
    ) external onlyGov {
        rewardToken = rewardToken_;
        personaNft = personaNft_;
        contributionNft = contributionNft_;
        serviceNft = serviceNft_;

        emit RefContractsUpdated(
            rewardToken_,
            personaNft_,
            contributionNft_,
            serviceNft_
        );
    }
}
