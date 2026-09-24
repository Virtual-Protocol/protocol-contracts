// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../RVirtualConverter.sol";

/// @notice Test-only V2 used to verify RVirtualConverter's UUPS upgrade path round-trips
///         cleanly. Adds one new event + trigger function on top of V1; never deployed to
///         production - exists purely so a test can upgrade forward, prove the new code is
///         live, then upgrade back and confirm the final bytecode matches the original V1.
contract RVirtualConverterV2Mock is RVirtualConverter {
    event V2UpgradeMarker(string message);

    function triggerV2Marker() external {
        emit V2UpgradeMarker("upgraded");
    }
}
