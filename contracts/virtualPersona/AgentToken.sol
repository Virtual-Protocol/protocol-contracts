// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "./IAgentToken.sol";

contract AgentToken is IAgentToken, AccessControlUpgradeable, ERC20Upgradeable {
    constructor() {
        _disableInitializers();
    }

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    function initialize(
        string memory name,
        string memory symbol,
        address minter
    ) external initializer {
        __ERC20_init(name, symbol);
        __AccessControl_init();
        _grantRole(MINTER_ROLE, minter);
    }

    function mint(
        address account,
        uint256 amount
    ) public onlyRole(MINTER_ROLE) {
        _mint(account, amount);
    }
}
