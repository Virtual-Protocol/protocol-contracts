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

contract AgentRewardV2 {
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

    // modifier onlyGov() {
    //     if (!hasRole(GOV_ROLE, _msgSender())) {
    //         revert NotGovError();
    //     }
    //     _;
    // }

    bool internal locked;

    modifier noReentrant() {
        require(!locked, "cannot reenter");
        locked = true;
        _;
        locked = false;
    }

    // function initialize(
    //     address rewardToken_,
    //     address agentNft_,
    //     address contributionNft_,
    //     address serviceNft_,
    //     RewardSettingsCheckpoints.RewardSettings memory settings_
    // ) external initializer {
    //     rewardToken = rewardToken_;
    //     agentNft = agentNft_;
    //     contributionNft = contributionNft_;
    //     serviceNft = serviceNft_;
    //     _rewardSettings.push(0, settings_);
    //     _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
    //     _nextRewardId = 1;
    // }
}
