// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFPair {
    function getReserves() external view returns (uint256, uint256);

    function assetBalance() external view returns (uint256);

    function balance() external view returns (uint256);

    function mint(uint256 reserve0, uint256 reserve1) external returns (bool);

    function transferAsset(address recipient, uint256 amount) external;

    function transferTo(address recipient, uint256 amount) external;

    function swap(
        uint256 amount0In,
        uint256 amount0Out,
        uint256 amount1In,
        uint256 amount1Out
    ) external returns (bool);

    function kLast() external view returns (uint256);

    function approval(
        address _user,
        address _token,
        uint256 amount
    ) external returns (bool);
}
