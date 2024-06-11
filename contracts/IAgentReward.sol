// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentReward {
    struct Reward {
        uint256 blockNumber;
        uint256 amount;
        uint256[] lpValues;
        uint256[] virtualIds;
    }

    // Agent specific reward, the amount will be shared between stakers and validators
    struct AgentReward {
        uint48 id;
        uint48 rewardIndex;
        uint256 stakerAmount;
        uint256 validatorAmount;
        uint256 totalProposals;
        uint256 totalStaked;
    }

    struct Claim {
        uint256 totalClaimed;
        uint32 rewardCount; // Track number of reward blocks claimed to avoid reclaiming
    }

    event NewReward(
        uint48 pos,
        uint256[] virtualIds
    );

    event NewAgentReward(uint256 indexed virtualId, uint48 id);

    /*struct ServiceReward {
        uint256 impact;
        uint256 amount;
        uint256 parentAmount;
        uint256 totalClaimed;
        uint256 totalClaimedParent;
    }

    

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
*/
    error ERC5805FutureLookup(uint256 timepoint, uint32 clock);

    error NotGovError();

    error NotOwnerError();
}
