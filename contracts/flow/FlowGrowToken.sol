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

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @notice Clonable companion token (Grow / GWT) for the dPNM template.
///         `name`/`symbol` are initialize-time so each launchpad instance
///         can have a uniquely-named GWT clone.
contract FlowGrowToken is
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    error ZeroAdmin();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        string memory name_,
        string memory symbol_
    ) external initializer {
        if (admin == address(0)) revert ZeroAdmin();
        __ERC20_init(name_, symbol_);
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }
}
