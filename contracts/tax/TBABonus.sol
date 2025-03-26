// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "./ITBABonus.sol";

contract TBABonus is ITBABonus, Initializable, AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    uint256 internal constant DENOM = 10000;

    uint16 public bonusRate;
    IERC20 public assetToken;

    mapping(uint256 agentId => uint256 allowance) private _agentAllowances;
    mapping(uint256 agentId => uint256 paidAmount) private _agentPaidAmounts;

    event BonusRateUpdated(uint16 oldBonusRate, uint16 newBonusRate);
    event AllowanceUpdated(uint256 agentId, uint256 newAllowance);
    event PaidAgent(uint256 agentId, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address defaultAdmin_,
        address assetToken_
    ) external initializer {
        __AccessControl_init();

        _grantRole(ADMIN_ROLE, defaultAdmin_);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);

        assetToken = IERC20(assetToken_);

        bonusRate = 3500;
    }

    function updateBonusRate(uint16 bonusRate_) public onlyRole(ADMIN_ROLE) {
        uint16 oldBonusRate = bonusRate;
        bonusRate = bonusRate_;
        emit BonusRateUpdated(bonusRate_, oldBonusRate);
    }

    function setAllowances(
        uint256[] memory agentIds,
        uint256[] memory allowances
    ) public onlyRole(ADMIN_ROLE) {
        require(agentIds.length == allowances.length, "Invalid input");

        for (uint256 i = 0; i < agentIds.length; i++) {
            uint256 agentId = agentIds[i];
            uint256 allowance = allowances[i];

            require(
                allowance >= _agentPaidAmounts[agentId],
                "Allowance cannot be less than paid amount"
            );

            _agentAllowances[agentId] = allowance;
            emit AllowanceUpdated(agentId, allowance);
        }
    }

    function distributeBonus(
        uint256 agentId,
        address recipient,
        uint256 amount
    ) public {
        require(agentId > 0, "Invalid agent ID");
        require(recipient != address(0), "Invalid recipient");

        if (amount == 0 || !hasRole(EXECUTOR_ROLE, msg.sender)) {
            return;
        }

        uint256 allowance = _agentAllowances[agentId] -
            _agentPaidAmounts[agentId];
        uint256 bonus = (amount * bonusRate) / DENOM;

        if (bonus > allowance) {
            bonus = allowance;
        }

        if (bonus > 0) {
            _agentPaidAmounts[agentId] += bonus;
            assetToken.safeTransfer(recipient, bonus);
            emit PaidAgent(agentId, bonus);
        }
    }
}
