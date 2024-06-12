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
        uint256 id;
        uint256 rewardIndex;
        uint256 stakerAmount;
        uint256 validatorAmount;
        uint256 totalProposals;
        uint256 totalStaked;
    }

    struct Claim {
        uint256 totalClaimed;
        uint256 rewardCount; // Track number of reward blocks claimed to avoid reclaiming
    }

    event NewReward(uint256 pos, uint256[] virtualIds);

    event NewAgentReward(uint256 indexed virtualId, uint256 id);

    event RewardSettingsUpdated(uint16 protocolShares, uint16 stakerShares);

    event RefContractsUpdated(address rewardToken, address agentNft);

    event StakerRewardClaimed(
        uint256 indexed virtualId,
        address indexed staker,
        uint256 numRewards,
        uint256 amount
    );

    event ValidatorRewardClaimed(
        uint256 indexed virtualId,
        address indexed validator,
        uint256 amount
    );
    
    error ERC5805FutureLookup(uint256 timepoint, uint32 clock);

    error NotGovError();

    error NotOwnerError();
}
