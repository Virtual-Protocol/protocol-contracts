// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
interface ITimeLockDeposits {
    function deposit(uint256 _amount, uint256 _duration, address _receiver) external;
}