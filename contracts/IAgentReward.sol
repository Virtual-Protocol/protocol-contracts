// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentReward {
    struct MainReward {
        uint32 blockNumber;
        uint256 amount;
        uint256 agentCount;
        uint256 totalStaked;
    }

    // Virtual specific reward, the amount will be shared between validator pool and contributor pool
    // Validator pool will be shared by validators and stakers
    // Contributor pool will be shared by contribution NFT holders
    struct Reward {
        uint48 id;
        uint32 mainIndex;
        uint256 totalStaked;
        uint256 validatorAmount;
        uint256 contributorAmount;
        uint256 coreAmount; // Rewards per core
    }

    struct Claim {
        uint256 totalClaimed;
        uint32 rewardCount; // Track number of reward blocks claimed to avoid reclaiming
    }

    struct ServiceReward {
        uint256 impact;
        uint256 amount;
        uint256 parentAmount;
        uint256 totalClaimed;
        uint256 totalClaimedParent;
    }

    event NewMainReward(
        uint32 indexed pos,
        uint256 amount,
        uint256 agentCount,
        uint256 totalStaked
    );

    event RewardSettingsUpdated(
        uint16 protocolShares,
        uint16 contributorShares,
        uint16 stakerShares,
        uint16 parentShares,
        uint256 stakeThreshold
    );

    event RefContractsUpdated(
        address rewardToken,
        address agentNft,
        address contributionNft,
        address serviceNft
    );

    event StakeThresholdUpdated(uint256 threshold);

    event ParentSharesUpdated(uint256 shares);

    event StakerRewardClaimed(
        uint256 virtualId,
        uint256 amount,
        address staker
    );

    event ValidatorRewardClaimed(
        uint256 virtualId,
        uint256 amount,
        address validator
    );

    event ServiceRewardsClaimed(
        uint256 nftId,
        address account,
        uint256 total,
        uint256 childrenAmount
    );

    event NewAgentReward(
        uint32 mainIndex,
        uint256 virtualId,
        uint256 validatorAmount,
        uint256 contributorAmount,
        uint256 coreAmount
    );

    event DatasetRewardsClaimed(uint256 nftId, address account, uint256 total);

    error ERC5805FutureLookup(uint256 timepoint, uint32 clock);

    error NotGovError();

    error NotOwnerError();
}
