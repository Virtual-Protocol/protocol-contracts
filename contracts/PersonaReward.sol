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
import "./virtualPersona/IPersonaNft.sol";
import "./virtualPersona/IPersonaToken.sol";
import "./libs/RewardSettingsCheckpoints.sol";
import "./contribution/IContributionNft.sol";
import "./contribution/IServiceNft.sol";
import "./libs/TokenSaver.sol";
import "./IPersonaReward.sol";

contract PersonaReward is
    IPersonaReward,
    Initializable,
    AccessControl,
    TokenSaver
{
    using Math for uint256;
    using SafeERC20 for IERC20;
    using RewardSettingsCheckpoints for RewardSettingsCheckpoints.Trace;

    uint48 private _nextRewardId;

    uint256 public constant DENOMINATOR = 10000;

    address public rewardToken;
    address public personaNft;
    address public contributionNft;
    address public serviceNft;

    MainReward[] private _mainRewards;
    uint256 public protocolRewards;
    uint256 public stakeThreshold; // Each VIRTUAL will require minimum amount of staked tokens to be considered for rewards
    uint16 public parentShares;

    RewardSettingsCheckpoints.Trace private _rewardSettings;

    mapping(address account => mapping(uint256 virtualId => Claim claim))
        private _claimedStakerRewards;
    mapping(address account => mapping(uint256 virtualId => Claim claim))
        private _claimedValidatorRewards;
    mapping(uint256 virtualId => Reward[]) private _rewards;
    mapping(address validator => mapping(uint48 rewardId => uint256 score))
        private _validatorScores;
    mapping(uint256 serviceId => ModelReward) private _modelRewards;
    mapping(uint256 datasetId => Claim) private _datasetClaims;

    bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");

    modifier onlyGov() {
        if (!hasRole(GOV_ROLE, _msgSender())) {
            revert NotGovError();
        }
        _;
    }

    function initialize(
        address rewardToken_,
        address personaNft_,
        address contributionNft_,
        address serviceNft_,
        RewardSettingsCheckpoints.RewardSettings memory settings_,
        uint256 stakeThreshold_,
        uint16 parentShares_
    ) external initializer {
        rewardToken = rewardToken_;
        personaNft = personaNft_;
        contributionNft = contributionNft_;
        serviceNft = serviceNft_;
        _rewardSettings.push(0, settings_);
        stakeThreshold = stakeThreshold_;
        parentShares = parentShares_;
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

    function _calcProtocolRewards(
        uint256 amount
    ) private view returns (uint256) {
        RewardSettingsCheckpoints.RewardSettings
            memory rewardSettings = _rewardSettings.latest();
        uint256 protocolShares = (amount * rewardSettings.protocolShares) /
            DENOMINATOR;
        return protocolShares;
    }

    // Validator score is calculated based on weighted uptime and votes
    function _calcValidatorScore(
        address validator,
        uint256 virtualId,
        uint256 totalStaked,
        uint256 totalUptime
    ) private view returns (uint256) {
        RewardSettingsCheckpoints.RewardSettings
            memory settings = getRewardSettings();
        // Uptime portion
        uint256 normalizedUptimeScore = totalUptime > 0
            ? (DENOMINATOR *
                IValidatorRegistry(personaNft).validatorScore(
                    virtualId,
                    validator
                )) / totalUptime
            : 0;
        uint256 uptimeShares = (uint256(settings.uptimeWeight) *
            normalizedUptimeScore) / DENOMINATOR;

        // Stake portion
        uint256 normalizedVoteScore = totalStaked > 0
            ? (DENOMINATOR *
                IPersonaNft(personaNft).getVotes(virtualId, validator)) /
                totalStaked
            : 0;

        uint256 stakeShares = (uint256(settings.stakeWeight) *
            normalizedVoteScore) / DENOMINATOR;

        return uptimeShares + stakeShares;
    }

    function _distributePersonaRewards(
        uint256 amount
    ) private returns (uint256 personaCount) {
        IPersonaNft nft = IPersonaNft(personaNft);
        uint256 grandTotalStaked = 0; // Total staked amount for all personas
        personaCount = nft.totalSupply();
        uint32 mainPos = SafeCast.toUint32(_mainRewards.length);

        // Get staking amount for all personas
        for (uint256 virtualId = 1; virtualId <= personaCount; virtualId++) {
            // Get staked amount
            uint256 totalStaked = nft.totalStaked(virtualId);
            if (totalStaked < stakeThreshold) {
                continue;
            }

            // Calculate validator score
            uint48 rewardId = _nextRewardId++;
            uint256 validatorCount = nft.validatorCount(virtualId);
            uint256 totalVScore = 0;
            for (uint256 j = 0; j < validatorCount; j++) {
                address validator = nft.validatorAt(virtualId, j);

                // Calculate validator score
                uint256 validatorScore = _calcValidatorScore(
                    validator,
                    virtualId,
                    totalStaked,
                    nft.totalUptimeScore(virtualId)
                );
                totalVScore += validatorScore;
                _validatorScores[validator][rewardId] = validatorScore;
            }

            _rewards[virtualId].push(
                Reward({
                    id: rewardId,
                    mainIndex: mainPos,
                    totalStaked: totalStaked,
                    totalVScore: totalVScore,
                    totalDatasets: 0,
                    validatorAmount: 0,
                    modelAmount: 0,
                    datasetAmount: 0
                })
            );
            grandTotalStaked += totalStaked;
        }

        _mainRewards.push(
            MainReward(
                SafeCast.toUint32(block.number),
                amount,
                personaCount,
                grandTotalStaked
            )
        );
        emit NewMainReward(mainPos, amount, grandTotalStaked);
    }

    function _populateRewardAmounts(
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

        uint256 amount = (mainReward.amount * reward.totalStaked) /
            mainReward.totalStaked;

        uint256 contributorAmount = (((amount * reward.totalStaked) /
            mainReward.totalStaked) * uint256(settings.contributorShares)) /
            DENOMINATOR;
        reward.validatorAmount = amount - contributorAmount;

        _distributeContributorRewards(virtualId, contributorAmount, settings);
    }

    function _distributeImpactRewards(
        uint256 virtualId,
        uint256 amount,
        uint256 totalMaturity
    ) private {
        uint256[] memory services = IPersonaNft(personaNft).getAllServices(
            virtualId
        );
        uint256 serviceId;
        uint256 impact;
        uint256 impactAmount;
        uint256 parentAmount;
        for (uint256 i = 0; i < services.length; i++) {
            serviceId = services[i];
            impact = IServiceNft(serviceNft).getImpact(serviceId);
            if (impact > 0) {
                impactAmount = (amount * impact) / totalMaturity;
                parentAmount = IContributionNft(contributionNft).getParentId(
                    serviceId
                ) == 0
                    ? 0
                    : (impactAmount * uint256(parentShares)) / DENOMINATOR;
                _modelRewards[serviceId].amount += impactAmount - parentAmount;
                _modelRewards[serviceId].parentAmount += parentAmount;
            }
        }
    }

    function _distributeModelUtilizationRewards(
        uint256 amount,
        uint256[] memory services,
        uint8 totalCores,
        uint8 totalCurrent
    ) private {
        for (uint i = 0; i < totalCores; i++) {
            if (services[i] > 0) {
                _modelRewards[services[i]].amount += (amount / totalCurrent);
            }
        }
    }

    function _distributeContributorRewards(
        uint256 virtualId,
        uint256 amount,
        RewardSettingsCheckpoints.RewardSettings memory settings
    ) private {
        uint256 impactAmount = (amount * uint256(settings.impactShares)) /
            DENOMINATOR;

        uint8[] memory coreTypes = IPersonaNft(personaNft)
            .virtualInfo(virtualId)
            .coreTypes;
        uint256[] memory currentServices = new uint256[](coreTypes.length);
        uint256 totalMaturity = 0;
        uint8 totalModels = 0;
        IServiceNft serviceNftContract = IServiceNft(serviceNft);
        Reward storage reward = _rewards[virtualId][
            _rewards[virtualId].length - 1
        ];
        for (uint i = 0; i < coreTypes.length; i++) {
            currentServices[i] = serviceNftContract.getCoreService(
                virtualId,
                coreTypes[i]
            );
            if (currentServices[i] > 0) {
                totalMaturity += serviceNftContract.getMaturity(
                    currentServices[i]
                );
                totalModels++;
            }
            reward.totalDatasets += serviceNftContract.totalCoreDatasets(
                virtualId,
                coreTypes[i]
            );
        }
        if (totalMaturity > 0) {
            _distributeImpactRewards(virtualId, impactAmount, totalMaturity);
        }
        uint256 utilAmount = amount - impactAmount;

        reward.datasetAmount =
            (utilAmount * uint256(settings.datasetShares)) /
            DENOMINATOR;
        if (totalModels > 0) {
            _distributeModelUtilizationRewards(
                (utilAmount - reward.datasetAmount),
                currentServices,
                uint8(coreTypes.length),
                totalModels
            );
        }
    }

    function distributeRewards(uint256 amount) public onlyGov returns (uint32) {
        require(amount > 0, "Invalid amount");

        IERC20(rewardToken).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );

        uint256 protocolShares = _calcProtocolRewards(amount);
        protocolRewards += protocolShares;

        uint256 personaShares = amount - protocolShares;
        uint256 personaCount = _distributePersonaRewards(personaShares);
        uint32 mainRewardIndex = SafeCast.toUint32(_mainRewards.length - 1);
        RewardSettingsCheckpoints.RewardSettings
            memory settings = getRewardSettings();
        for (uint256 virtualId = 1; virtualId <= personaCount; virtualId++) {
            _populateRewardAmounts(virtualId, mainRewardIndex, settings);
        }

        return SafeCast.toUint32(_mainRewards.length - 1);
    }

    function _calcDelegateeRevenue(
        Reward memory reward,
        address delegatee
    ) private view returns (uint256) {
        uint256 delegateeRevenue = reward.totalVScore > 0
            ? (reward.validatorAmount *
                _validatorScores[delegatee][reward.id]) / reward.totalVScore
            : 0;
        return delegateeRevenue;
    }

    function _getClaimableStakerRewardAt(
        uint256 pos,
        uint256 virtualId,
        address account,
        address stakingAddress
    ) private view returns (uint256) {
        Reward memory reward = getReward(virtualId, SafeCast.toUint32(pos));
        MainReward memory mainReward = getMainReward(reward.mainIndex);
        IPersonaToken token = IPersonaToken(stakingAddress);

        address delegatee = token.getPastDelegates(
            account,
            mainReward.blockNumber
        );

        if (delegatee == address(0)) {
            return 0;
        }

        RewardSettingsCheckpoints.RewardSettings
            memory settings = getPastRewardSettings(mainReward.blockNumber);

        uint256 delegateeRevenue = _calcDelegateeRevenue(reward, delegatee);
        uint256 tokens = token.getPastBalanceOf(
            account,
            mainReward.blockNumber
        );
        uint256 votes = IERC5805(stakingAddress).getPastVotes(
            delegatee,
            mainReward.blockNumber
        );

        return
            (((delegateeRevenue * tokens) / votes) *
                uint256(settings.stakerShares)) / DENOMINATOR;
    }

    function getClaimableStakerRewardAt(
        uint256 pos,
        uint256 virtualId,
        address account
    ) public view returns (uint256) {
        address stakingAddress = IPersonaNft(personaNft)
            .virtualInfo(virtualId)
            .token;

        return
            _getClaimableStakerRewardAt(
                pos,
                virtualId,
                account,
                stakingAddress
            );
    }

    function getClaimableStakerRewards(
        address staker,
        uint256 virtualId
    ) public view returns (uint256) {
        uint256 count = rewardCount(virtualId);
        if (count == 0) {
            return 0;
        }

        address stakingAddress = IPersonaNft(personaNft)
            .virtualInfo(virtualId)
            .token;

        Claim memory claim = claimedStakerRewards(staker, virtualId);
        uint256 total = 0;
        for (uint256 i = claim.rewardCount; i < count; i++) {
            total += _getClaimableStakerRewardAt(
                i,
                virtualId,
                staker,
                stakingAddress
            );
        }

        return total;
    }

    function claimStakerRewards(uint256 virtualId) public {
        address account = _msgSender();
        uint256 amount = getClaimableStakerRewards(account, virtualId);
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

    function getClaimableValidatorRewardsAt(
        uint256 pos,
        uint256 virtualId,
        address validator
    ) public view returns (uint256) {
        Reward memory reward = getReward(virtualId, SafeCast.toUint32(pos));
        MainReward memory mainReward = getMainReward(reward.mainIndex);
        RewardSettingsCheckpoints.RewardSettings
            memory rewardSettings = getPastRewardSettings(
                mainReward.blockNumber
            );

        uint256 delegateeRevenue = _calcDelegateeRevenue(reward, validator);
        return
            (delegateeRevenue *
                (DENOMINATOR - uint256(rewardSettings.stakerShares))) /
            DENOMINATOR;
    }

    function getClaimableValidatorRewards(
        address validator,
        uint256 virtualId
    ) public view returns (uint256) {
        uint256 count = rewardCount(virtualId);
        if (count == 0) {
            return 0;
        }

        Claim memory claim = _claimedValidatorRewards[validator][virtualId];
        uint256 total = 0;
        for (uint256 i = claim.rewardCount; i < count; i++) {
            total += getClaimableValidatorRewardsAt(i, virtualId, validator);
        }

        return total;
    }

    function claimValidatorRewards(uint256 virtualId) public {
        address account = _msgSender();

        uint256 amount = getClaimableValidatorRewards(account, virtualId);
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

    function claimedStakerRewards(
        address staker,
        uint256 virtualId
    ) public view returns (Claim memory) {
        return _claimedStakerRewards[staker][virtualId];
    }

    function claimedValidatorRewards(
        address staker,
        uint256 virtualId
    ) public view returns (Claim memory) {
        return _claimedValidatorRewards[staker][virtualId];
    }

    function withdrawProtocolRewards() external onlyGov {
        require(protocolRewards > 0, "No protocol rewards");
        IERC20(rewardToken).safeTransfer(_msgSender(), protocolRewards);
        protocolRewards = 0;
    }

    function getModelReward(
        uint256 virtualId
    ) public view returns (ModelReward memory) {
        return _modelRewards[virtualId];
    }

    function getChildrenRewards(uint256 nftId) public view returns (uint256) {
        uint256 childrenAmount = 0;
        uint256[] memory children = IContributionNft(contributionNft)
            .getChildren(nftId);

        ModelReward memory childReward;
        for (uint256 i = 0; i < children.length; i++) {
            childReward = getModelReward(children[i]);
            childrenAmount += (childReward.parentAmount -
                childReward.totalClaimedParent);
        }
        return childrenAmount;
    }

    function getClaimableModelRewards(
        uint256 nftId
    ) public view returns (uint256 total) {
        ModelReward memory modelReward = getModelReward(nftId);
        total = modelReward.amount - modelReward.totalClaimed;
        uint256 childrenAmount = getChildrenRewards(nftId);
        total += childrenAmount;
    }

    function claimModelRewards(uint256 nftId) public {
        address account = _msgSender();
        require(
            IERC721(contributionNft).ownerOf(nftId) == account,
            "Only NFT owner can claim rewards"
        );

        require(
            IContributionNft(contributionNft).isModel(nftId),
            "Not a model NFT"
        );

        ModelReward storage modelReward = _modelRewards[nftId];
        uint256 total = (modelReward.amount - modelReward.totalClaimed);

        modelReward.totalClaimed += total;

        // Claim children rewards
        uint256[] memory children = IContributionNft(contributionNft)
            .getChildren(nftId);

        uint256 totalChildrenAmount;
        uint256 childAmount;
        for (uint256 i = 0; i < children.length; i++) {
            ModelReward storage childReward = _modelRewards[children[i]];

            childAmount = (childReward.parentAmount -
                childReward.totalClaimedParent);

            if (childAmount > 0) {
                childReward.totalClaimedParent += childAmount;
                modelReward.parentAmount += childAmount;
                total += childAmount;
                totalChildrenAmount += childAmount;
            }
        }

        if (total == 0) {
            return;
        }

        IERC20(rewardToken).safeTransfer(account, total);
        emit ModelRewardsClaimed(nftId, account, total, totalChildrenAmount);
    }

    function _getClaimableDatasetRewards(
        uint256 datasetId,
        uint256 virtualId
    ) private view returns (uint256 total) {
        if (IContributionNft(contributionNft).isModel(datasetId)) {
            return 0;
        }
        Claim memory claim = _datasetClaims[datasetId];
        uint256 mintedAt = IServiceNft(serviceNft).getMintedAt(datasetId);
        uint256 totalRewardCount = _rewards[virtualId].length;

        for (uint256 i = (totalRewardCount - 1); i > claim.rewardCount; i--) {
            Reward memory reward = _rewards[virtualId][i];
            if (claim.rewardCount == 0) {
                // This is the first time claiming, we need to ensure the nft is not claiming rewards before the minting blockNumber
                MainReward memory mainReward = _mainRewards[reward.mainIndex];
                if (mintedAt > mainReward.blockNumber) {
                    break;
                }
            }
            if (reward.datasetAmount > 0) {
                total += reward.datasetAmount / reward.totalDatasets;
            }
        }
    }

    function getClaimableDatasetRewards(
        uint256 datasetId
    ) public view returns (uint256 total) {
        uint256 virtualId = IContributionNft(contributionNft).tokenVirtualId(
            datasetId
        );
        return _getClaimableDatasetRewards(datasetId, virtualId);
    }

    function claimDatasetRewards(uint256 datasetId) public {
        address account = _msgSender();
        require(
            IERC721(contributionNft).ownerOf(datasetId) == account,
            "Only NFT owner can claim rewards"
        );

        uint256 virtualId = IContributionNft(contributionNft).tokenVirtualId(
            datasetId
        );
        uint256 totalRewardCount = _rewards[virtualId].length;

        if (totalRewardCount == 0) {
            return;
        }

        uint256 total = _getClaimableDatasetRewards(datasetId, virtualId);
        if (total == 0) {
            return;
        }

        Claim storage claim = _datasetClaims[datasetId];
        claim.rewardCount = SafeCast.toUint32(totalRewardCount);
        claim.totalClaimed += total;

        emit DatasetRewardsClaimed(datasetId, account, total);
        IERC20(rewardToken).safeTransfer(account, total);
    }

    function getTotalClaimableRewards(
        address account,
        uint256[] memory virtualIds,
        uint256[] memory datasetNftIds,
        uint256[] memory modelNftIds
    ) public view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < virtualIds.length; i++) {
            total +=
                getClaimableStakerRewards(account, virtualIds[i]) +
                getClaimableValidatorRewards(account, virtualIds[i]);
        }
        for (uint256 i = 0; i < datasetNftIds.length; i++) {
            total += getClaimableDatasetRewards(datasetNftIds[i]);
        }
        for (uint256 i = 0; i < modelNftIds.length; i++) {
            total += getClaimableModelRewards(modelNftIds[i]);
        }
        return total;
    }

    function claimAllRewards(
        uint256[] memory virtualIds,
        uint256[] memory datasetNftIds,
        uint256[] memory modelNftIds
    ) public {
        for (uint256 i = 0; i < virtualIds.length; i++) {
            claimStakerRewards(virtualIds[i]);
            claimValidatorRewards(virtualIds[i]);
        }

        for (uint256 i = 0; i < datasetNftIds.length; i++) {
            claimDatasetRewards(datasetNftIds[i]);
        }

        for (uint256 i = 0; i < modelNftIds.length; i++) {
            claimModelRewards(modelNftIds[i]);
        }
    }

    function setStakeThreshold(uint256 threshold) external onlyGov {
        stakeThreshold = threshold;
        emit StakeThresholdUpdated(threshold);
    }

    function setParentShares(uint16 shares) external onlyGov {
        parentShares = shares;
        emit ParentSharesUpdated(shares);
    }

    function setRewardSettings(
        uint16 uptimeWeight_,
        uint16 stakeWeight_,
        uint16 protocolShares_,
        uint16 contributorShares_,
        uint16 stakerShares_,
        uint16 datasetShares_,
        uint16 impactShares_
    ) public onlyGov {
        _rewardSettings.push(
            SafeCast.toUint32(block.number),
            RewardSettingsCheckpoints.RewardSettings(
                uptimeWeight_,
                stakeWeight_,
                protocolShares_,
                contributorShares_,
                stakerShares_,
                datasetShares_,
                impactShares_
            )
        );
        emit RewardSettingsUpdated(
            uptimeWeight_,
            stakeWeight_,
            protocolShares_,
            contributorShares_,
            stakerShares_,
            datasetShares_,
            impactShares_
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
