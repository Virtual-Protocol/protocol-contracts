// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IFlowProtocol
interface IFlowProtocol {
    function activate(address referrer) external;
    function buy(uint256 usdtAmount) external;
    function sell(uint256 flowAmount) external;
    function extendTree(uint256 months) external;
    function buyIncomeLimitWithGWT(uint256 gwtAmount) external;
    function claimGWT() external;

    // Views
    function poolUSDT() external view returns (uint256);
    function priceFLOW() external view returns (uint256);
    function incomeLimit(address user) external view returns (uint256);
    function lifetimeIncomeLimit(address user) external view returns (uint256);
    function isActivated(address user) external view returns (bool);
    function pendingGWT(address user) external view returns (uint256);
}
