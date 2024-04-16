// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./AgentReward.sol";

contract RewardTreasury is Ownable {
    using SafeERC20 for IERC20;

    struct RewardBucket {
        uint256 amount;
        bool disbursed;
    }

    mapping(uint32 => RewardBucket) public buckets;
    IERC20 public rewardToken;
    AgentReward public rewardManager;

    event RewardCreated(
        uint256 total,
        uint8 count,
        uint32 interval,
        uint32 startTS
    );

    event TokenSaved(
        address indexed by,
        address indexed receiver,
        address indexed token,
        uint256 amount
    );

    event RewardManagerUpdated(address newManager);

    event RewardDisbursed(uint32 indexed ts, uint256 amount);

    event RewardAmountUpdated(uint32 indexed ts, uint256 amount);

    constructor(
        address owner,
        address token,
        address rewardManager_
    ) Ownable(owner) {
        rewardToken = IERC20(token);
        rewardToken.approve(rewardManager_, type(uint256).max);
        rewardManager = AgentReward(rewardManager_);
    }

    function createReward(
        uint256 total,
        uint8 count,
        uint32 interval,
        uint32 startTS
    ) external onlyOwner {
        require(total > 0, "Total must be greater than zero");
        require(count > 0, "Number of buckets must be greater than zero");
        require(interval > 0, "Interval must be greater than zero");
        require(
            startTS > block.timestamp,
            "Start timestamp must be in the future"
        );

        uint256 singleReward = total / count;
        for (uint8 i = 0; i < count; i++) {
            uint32 ts = startTS + i * interval;

            RewardBucket storage bucket = buckets[ts];
            bucket.amount += singleReward;
        }

        emit RewardCreated(total, count, interval, startTS);
    }

    function saveToken(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).safeTransfer(owner(), _amount);
        emit TokenSaved(_msgSender(), owner(), _token, _amount);
    }

    function withdraw(uint256 _amount) external onlyOwner {
        payable(owner()).transfer(_amount);
    }

    function distribute(uint32 ts) external {
        RewardBucket storage bucket = buckets[ts];
        require(!bucket.disbursed, "Bucket already disbursed");
        require(bucket.amount > 0, "Bucket is empty");
        require(block.timestamp >= ts, "Disbursement time not reached");
        require(
            rewardToken.balanceOf(address(this)) >= bucket.amount,
            "Insufficient balance"
        );

        bucket.disbursed = true;
        rewardManager.distributeRewards(bucket.amount);

        emit RewardDisbursed(ts, bucket.amount);
    }

    function setRewardManager(address rewardManager_) external onlyOwner {
        rewardManager = AgentReward(rewardManager_);
        emit RewardManagerUpdated(rewardManager_);
    }

    function adjustAmount(uint32 ts, uint256 amount) external onlyOwner {
        RewardBucket storage bucket = buckets[ts];
        require(!bucket.disbursed, "Bucket already disbursed");

        bucket.amount = amount;
        emit RewardAmountUpdated(ts, amount);
    }
}
