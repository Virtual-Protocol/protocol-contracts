// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "./IAgentToken.sol";
import "./IAgentFactory.sol";

contract AgentToken is IAgentToken, ERC20Upgradeable {
    address public minter;

    IAgentFactory private _factory; // Single source of truth

    modifier onlyMinter() {
        require(_msgSender() == _factory.minter(), "Caller is not the minter");
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name,
        string memory symbol
    ) external initializer {
        __ERC20_init(name, symbol);
        _factory = IAgentFactory(msg.sender);
    }

    function mint(address account, uint256 value) public onlyMinter {
        super._mint(account, value);
    }
}
