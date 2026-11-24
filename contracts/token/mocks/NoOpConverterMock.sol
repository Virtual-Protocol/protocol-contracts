// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../IAgVirtConverter.sol";

/// @notice TEST-ONLY mock for verify_H-10.js. Implements IAgVirtConverter but does NOT call
///         transferFrom at all - simulates the specific scenario Chain Agent 2 analyzed where
///         the converter call succeeds (no-op) without pulling the approved VIRTUAL, leaving
///         veVirtual's raw `approve()` allowance (L345) standing after the call returns.
///         Distinct from MaliciousConverterMock (H-4), which DOES pull funds via transferFrom
///         and therefore leaves zero residual allowance.
contract NoOpConverterMock is IAgVirtConverter {
    address public virtualToken;
    address public agVirtToken;

    constructor(address virtualToken_, address agVirtToken_) {
        virtualToken = virtualToken_;
        agVirtToken = agVirtToken_;
    }

    function convertVirtualToAgVirt(
        uint256 /* amount */,
        address /* agVirtReceiver */
    ) external override {
        // Intentionally does nothing - no transferFrom, no revert.
    }
}
