// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentToken {
    function initialize(
        string memory name,
        string memory symbol,
        address theFounder,
        address theAssetToken,
        address theVirtualNft,
        uint256 theMatureAt
    ) external;

    function stake(
        uint256 amount,
        address receiver,
        address delegatee
    ) external;

    function withdraw(uint256 amount) external;

    function getPastDelegates(
        address account,
        uint256 timepoint
    ) external view returns (address);

    function getPastBalanceOf(
        address account,
        uint256 timepoint
    ) external view returns (uint256);
}
