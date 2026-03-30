// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev ERC20 mock with configurable decimals (e.g. 6 for USDC-style test tokens).
contract MockERC20Decimals is ERC20 {
    uint8 private immutable _decimalsOverride;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address initialAccount,
        uint256 initialBalance
    ) ERC20(name_, symbol_) {
        _decimalsOverride = decimals_;
        _mint(initialAccount, initialBalance);
    }

    function decimals() public view override returns (uint8) {
        return _decimalsOverride;
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
