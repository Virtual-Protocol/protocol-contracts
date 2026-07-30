// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRVirtualConverter {
    function convertVirtualToRVirtual(
        uint256 amount,
        address rVirtualReceiver
    ) external;

    /// @notice The VIRTUAL token this converter accepts as input. Exposed so callers
    ///         (e.g. veVirtual.setRVirtualConverter) can assert their own base token
    ///         matches this converter's before wiring it in (see audit L-09).
    function virtualToken() external view returns (address);
}
