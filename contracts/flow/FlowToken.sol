// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ----------------------------------------------------------------------------
// AgentFlow $FLOW Token (closed-system, dPNM-modelled)
//
// Properties:
//   * 18-decimals ERC20 with permit (gasless approvals).
//   * No premint, no fixed cap. Supply expands only when FlowProtocol
//     calls `mint` against fresh USDT, and contracts when the protocol
//     calls `burn` on a sell.
//   * Mint and burn are gated by `MINTER_ROLE` — held exclusively by
//     FlowProtocol. The deployer keeps `DEFAULT_ADMIN_ROLE` so it can
//     rotate the protocol address (e.g. to a multisig-owned upgrade).
//
// Backing model: 100% of `pool_USDT` held by FlowProtocol stands behind
// `totalSupply`. The token contract is intentionally dumb so the backing
// invariant cannot be broken from this side.
//
// Implements `IFlowToken` structurally (mint/burn) — not via interface
// inheritance — to avoid `override(ERC20, IERC20)` boilerplate. External
// callers cast to `IFlowToken`; the cast succeeds because the function
// selectors match exactly.
// ----------------------------------------------------------------------------

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract Flow is ERC20, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    error ZeroAdmin();

    constructor(address admin)
        ERC20("AgentFlow", "FLOW")
        ERC20Permit("AgentFlow")
    {
        if (admin == address(0)) revert ZeroAdmin();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Mints `amount` $FLOW to `to`. Restricted to MINTER_ROLE.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Burns `amount` $FLOW from `from`. Restricted to MINTER_ROLE.
    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }
}
