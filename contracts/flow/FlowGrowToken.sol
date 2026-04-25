// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ----------------------------------------------------------------------------
// FlowGrowToken (GWT)
//
// Compensation token. Minted 1:1 versus the USDT fee paid on every $FLOW
// buy/sell (so high-volume users accumulate GWT proportional to their
// fee contribution). Burned when redeemed via
// `FlowProtocol.buyIncomeLimitWithGWT` for extra income limit
// (1 GWT = 1.25 USDT income limit, capped at 10% of lifetime limit).
//
// MINTER_ROLE held by FlowProtocol exclusively.
// ----------------------------------------------------------------------------

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract FlowGrowToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    error ZeroAdmin();

    constructor(address admin) ERC20("Flow Grow", "GWT") {
        if (admin == address(0)) revert ZeroAdmin();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }
}
