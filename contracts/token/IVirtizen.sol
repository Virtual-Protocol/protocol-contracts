// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVirtizen
 * @notice Interface for Virtizen token, used by governance contracts
 */
interface IVirtizen {
    /**
     * @notice Returns the balance of an account at a specific timestamp
     * @dev This is used by governance contracts to get voting power at proposal snapshot time
     */
    function balanceOfAt(
        address account,
        uint256 timestamp
    ) external view returns (uint256);

    /**
     * @notice Returns the current balance of an account
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @notice Returns the total supply of tokens
     */
    function totalSupply() external view returns (uint256);

    /**
     * @notice Returns the total supply at a specific timestamp
     */
    function totalSupplyAt(uint256 timestamp) external view returns (uint256);

    /**
     * @notice Returns the name of the token
     */
    function name() external view returns (string memory);

    /**
     * @notice Returns the symbol of the token
     */
    function symbol() external view returns (string memory);

    /**
     * @notice Returns the decimals of the token
     */
    function decimals() external pure returns (uint8);
}
