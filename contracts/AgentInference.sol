// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./virtualPersona/IAgentNft.sol";

contract AgentInference is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using Math for uint256;
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    mapping(uint256 agentId => uint256) public inferenceCount; // Inference count per agent

    IERC20 public token;
    IAgentNft public agentNft;

    event Prompt(
        address indexed sender,
        bytes32 promptHash,
        uint256 agentId,
        uint256 cost,
        uint8[] coreIds
    );

    function initialize(
        address defaultAdmin_,
        address token_,
        address agentNft_
    ) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();

        _grantRole(ADMIN_ROLE, defaultAdmin_);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);

        token = IERC20(token_);
        agentNft = IAgentNft(agentNft_);
    }

    function prompt(
        bytes32 promptHash,
        uint256[] memory agentIds,
        uint256[] memory amounts,
        uint8[][] memory coreIds
    ) public nonReentrant {
        address sender = _msgSender();
        uint256 total = 0;

        require(
            agentIds.length == amounts.length &&
                agentIds.length == coreIds.length,
            "Invalid input"
        );

        uint256 len = amounts.length;
        for (uint256 i = 0; i != len; ++i) {
            total += amounts[i];
        }

        require(token.balanceOf(sender) >= total, "Insufficient balance");

        for (uint256 i = 0; i != len; ++i) {
            uint256 agentId = agentIds[i];
            address agentTba = agentNft.virtualInfo(agentId).tba;
            token.safeTransferFrom(sender, agentTba, amounts[i]);

            inferenceCount[agentId]++;
            emit Prompt(sender, promptHash, agentId, amounts[i], coreIds[i]);
        }
    }

    function promptMulti(
        bytes32[] memory promptHashes,
        uint256[] memory agentIds,
        uint256[] memory amounts,
        uint8[][] memory coreIds
    ) public nonReentrant {
        address sender = _msgSender();
        uint256 total = 0;
        uint256 len = agentIds.length;

        require(
            len == amounts.length &&
                len == coreIds.length &&
                len == promptHashes.length,
            "Invalid input"
        );

        for (uint256 i = 0; i != len; ++i) {
            total += amounts[i];
        }

        require(token.balanceOf(sender) >= total, "Insufficient balance");

        uint256 prevAgentId = 0;
        address agentTba = address(0);
        for (uint256 i = 0; i != len; ++i) {
            uint256 agentId = agentIds[i];
            if (prevAgentId != agentId) {
                agentTba = agentNft.virtualInfo(agentId).tba;
            }
            token.safeTransferFrom(sender, agentTba, amounts[i]);

            inferenceCount[agentId]++;
            emit Prompt(
                sender,
                promptHashes[i],
                agentId,
                amounts[i],
                coreIds[i]
            );
        }
    }
}
