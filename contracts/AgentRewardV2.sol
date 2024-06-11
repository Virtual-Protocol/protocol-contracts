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

    uint48 private _nextAgentRewardId;

    uint256 public constant DENOMINATOR = 10000;
    bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");

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

    function getReward(uint48 pos) public view returns (Reward memory) {
        return _rewards[pos];
    }

    function getAgentReward(
        uint256 virtualId,
        uint48 pos
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

        uint48 rewardIndex = SafeCast.toUint48(_rewards.length);

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
        uint48 rewardIndex,
        uint256 amount,
        RewardSettingsCheckpoints.RewardSettings memory settings
    ) private {
        uint48 agentRewardId = _nextAgentRewardId++;

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
}
