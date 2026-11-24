// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../IAgVirtConverter.sol";

/// @notice TEST-ONLY mock for the audit I-04 regression test. Delivers the correct agVirt
///         amount from its own pre-funded balance (so the M-02 delivery check passes and the
///         call does not revert), but never calls transferFrom on the approved VIRTUAL -
///         simulating a converter that pays out correctly through some path that doesn't
///         consume veVirtual's allowance. This is the only way, once the M-02 balance-delta
///         check is in place, to reach a *successful* conversion that still leaves the
///         allowance standing - a plain no-op or fund-stealing converter now reverts the
///         whole transaction instead (see MaliciousConverterMock / NoOpConverterMock).
contract NonConsumingConverterMock is IAgVirtConverter {
    address public virtualToken;
    address public agVirtToken;

    constructor(address virtualToken_, address agVirtToken_) {
        virtualToken = virtualToken_;
        agVirtToken = agVirtToken_;
    }

    function convertVirtualToAgVirt(
        uint256 amount,
        address agVirtReceiver
    ) external override {
        // Deliver from this contract's own balance - never touches the VIRTUAL allowance.
        IERC20(agVirtToken).transfer(agVirtReceiver, amount);
    }
}
