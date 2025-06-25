// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVEVirtual {
    function balanceOfAt(
        address account,
        uint256 timestamp
    ) external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function balanceOfLock(
        address account,
        uint256 index
    ) external view returns (uint256);
}
