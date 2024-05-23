// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract AgentToken is ERC20Upgradeable {
    address public minter;

    modifier onlyMinter() {
        require(_msgSender() == minter, "Caller is not the minter");
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name,
        string memory symbol,
        address _minter
    ) external initializer {
        __ERC20_init(name, symbol);
        minter = _minter;
    }

    function mint(address account, uint256 value) public onlyMinter {
        super._mint(account, value);
    }
}
