// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IFlowGrowToken (GWT)
/// @notice Mint/burn surface for the GWT compensation token. Minted 1:1
///         versus the USDT fee paid on every buy/sell. Burned when a user
///         redeems extra income limit via `buyIncomeLimitWithGWT`.
interface IFlowGrowToken is IERC20 {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}
