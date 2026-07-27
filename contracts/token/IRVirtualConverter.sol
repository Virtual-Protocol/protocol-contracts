// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRVirtualConverter {
    function convertVirtualToRVirtual(
        uint256 amount,
        address rVirtualReceiver
    ) external;
}
