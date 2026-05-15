// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IFlowToken
/// @notice Mint/burn surface for the closed-system $FLOW token. Only the
///         FlowProtocol (granted MINTER_ROLE) is allowed to mint or burn.
interface IFlowToken is IERC20 {
    /// @notice Mints `amount` $FLOW to `to`. Restricted to MINTER_ROLE.
    function mint(address to, uint256 amount) external;

    /// @notice Burns `amount` $FLOW from `from`. Restricted to MINTER_ROLE.
    function burn(address from, uint256 amount) external;
}
