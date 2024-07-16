// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract AgentInference is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using Math for uint256;
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public minFees;
    mapping(address => uint256) public fees;

    IERC20 public token;

    event MinFeesUpdated(uint256 minFees);
    event FeesUpdated(address indexed provider, uint256 fees);
    event Prompt(
        address indexed sender,
        bytes32 promptHash,
        address provider,
        uint256 cost
    );

    function initialize(
        address defaultAdmin_,
        address token_,
        uint256 minFees_
    ) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();

        _grantRole(ADMIN_ROLE, defaultAdmin_);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);

        token = IERC20(token_);
        minFees = minFees_;
    }

    function setFees(
        address provider,
        uint256 amount
    ) public onlyRole(ADMIN_ROLE) {
        fees[provider] = amount;
        emit FeesUpdated(provider, amount);
    }

    function setMinFees(uint256 amount) public onlyRole(ADMIN_ROLE) {
        minFees = amount;
        emit MinFeesUpdated(amount);
    }

    function prompt(bytes32 promptHash, address provider) public nonReentrant {
        address sender = _msgSender();
        require(
            token.balanceOf(sender) >= fees[provider],
            "Insufficient balance"
        );
        uint256 cost = fees[provider].max(minFees);
        token.safeTransferFrom(sender, provider, cost);
        emit Prompt(sender, promptHash, provider, cost);
    }
}
