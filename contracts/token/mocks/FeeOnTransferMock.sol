// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST-ONLY mock modeling a fee-on-transfer / tax token, used to simulate the
///         real rVirtual (GodToken)'s configurable transfer tax for security PoC purposes
///         (see verify_H-2.js). NOT used in production - lives under contracts/token/mocks
///         solely to be reachable by Hardhat's compiler for the test.
///
///         Deducts `feeBps` (out of 10_000) from every transfer/transferFrom, sending the
///         fee portion to a burn/dead sink so the recipient always receives strictly less
///         than the nominal transferred amount whenever feeBps > 0.
contract FeeOnTransferMock is ERC20 {
    uint256 public immutable feeBps; // e.g. 1000 = 10%
    address public immutable feeSink;

    constructor(
        string memory name_,
        string memory symbol_,
        address initialAccount,
        uint256 initialBalance,
        uint256 feeBps_,
        address feeSink_
    ) ERC20(name_, symbol_) {
        require(feeBps_ <= 10_000, "fee too high");
        feeBps = feeBps_;
        feeSink = feeSink_;
        _mint(initialAccount, initialBalance);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Mint (from == address(0)) and burn (to == address(0)) pass through untaxed -
        // only regular transfers between two live accounts are taxed, matching typical
        // fee-on-transfer token behavior.
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * feeBps) / 10_000;
        uint256 net = value - fee;

        super._update(from, to, net);
        if (fee > 0) {
            super._update(from, feeSink, fee);
        }
    }
}
