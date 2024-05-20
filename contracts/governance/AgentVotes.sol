// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155V} from "./ERC1155V.sol";
import "../virtualPersona/IAgentNft.sol";

// Voting token for agents
// AgentLP token holders can stake their tokens here in exchange for voting token that they can delegate for voting power
contract AgentVotes is ERC1155V, AccessControl, Initializable {
    using SafeERC20 for IERC20;
    bool public isAdminUnlock = false;
    mapping(address => mapping(uint256 => uint256)) lockedAmounts;
    IAgentNft _agentNft;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    error Locked();

    bool internal entranceLocked;

    modifier noReentrant() {
        require(!entranceLocked, "cannot reenter");
        entranceLocked = true;
        _;
        entranceLocked = false;
    }

    constructor() {
        _disableInitializers();
    }

    function uri(uint256) public pure override returns (string memory) {}

    function initialize(address agentNft, address admin) external initializer {
        _agentNft = IAgentNft(agentNft);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setAdminUnlock(bool unlock) public {
        isAdminUnlock = unlock;
    }

    // Stakers have to stake their tokens and delegate to a validator
    function stake(
        uint256 id, // Agent Id is equivalent to token Id
        uint256 amount,
        address receiver,
        address delegatee,
        bool locked,
        bytes calldata data
    ) public {
        address sender = _msgSender();
        require(amount > 0, "Cannot stake 0");

        if (locked) {
            lockedAmounts[receiver][id] += amount;
        }

        // Get token from NFT
        IERC20(_lpToken(id)).safeTransferFrom(sender, address(this), amount);

        _mint(receiver, id, amount, data);
        _delegate(receiver, delegatee, id);
    }

    function withdraw(uint256 id, uint256 amount) public noReentrant {
        address sender = _msgSender();
        uint256 balance = balanceOf[sender][id];
        require(balance >= amount, "Insufficient balance");

        uint256 withdrawable = isAdminUnlock
            ? balance
            : balance - lockedAmounts[sender][id];
        if (withdrawable < amount) {
            revert Locked();
        }

        _burn(sender, id, amount);

        IERC20(_lpToken(id)).safeTransfer(sender, amount);
    }

    // Get LP token address from Agent NFT
    function _lpToken(uint256 id) internal view returns (address) {
        address lpToken = _agentNft.virtualInfo(id).pool;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(AccessControl, ERC1155V) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function clock() external view returns (uint48) {
        return uint48(block.number);
    }

    function CLOCK_MODE() external view returns (string memory) {
        return "mode=blocknumber&from=default";
    }
}
