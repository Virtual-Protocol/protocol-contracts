// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgVirtConverter {
    function convertVirtualToAgVirt(
        uint256 amount,
        address agVirtReceiver
    ) external;

    /// @notice The VIRTUAL token this converter accepts as input. Exposed so callers
    ///         (e.g. veVirtual.setAgVirtConverter) can assert their own base token
    ///         matches this converter's before wiring it in (see audit L-09).
    function virtualToken() external view returns (address);

    /// @notice The agVirt token this converter pays out. Exposed so callers (e.g.
    ///         veVirtual.setAgVirtConverter) can snapshot the expected payout token at
    ///         wiring time and verify actual delivery against their OWN stored copy later,
    ///         rather than trusting whatever the converter claims to pay out at conversion
    ///         time - the converter is separately upgradeable, so that claim could change
    ///         without a re-wiring call (see audit H-1 / M-02).
    function agVirtToken() external view returns (address);
}
