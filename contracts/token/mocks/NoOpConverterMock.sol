// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../IRVirtualConverter.sol";

/// @notice TEST-ONLY mock for verify_H-10.js. Implements IRVirtualConverter but does NOT call
///         transferFrom at all - simulates the specific scenario Chain Agent 2 analyzed where
///         the converter call succeeds (no-op) without pulling the approved VIRTUAL, leaving
///         veVirtual's raw `approve()` allowance (L345) standing after the call returns.
///         Distinct from MaliciousConverterMock (H-4), which DOES pull funds via transferFrom
///         and therefore leaves zero residual allowance.
contract NoOpConverterMock is IRVirtualConverter {
    address public virtualToken;

    constructor(address virtualToken_) {
        virtualToken = virtualToken_;
    }

    function convertVirtualToRVirtual(
        uint256 /* amount */,
        address /* rVirtualReceiver */
    ) external override {
        // Intentionally does nothing - no transferFrom, no revert.
    }
}
