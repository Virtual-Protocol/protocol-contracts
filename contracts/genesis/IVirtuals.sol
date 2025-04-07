// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IVirtualsFactory {

    function assetRate() external view returns (uint256);

    function launch(
        string memory _name,
        string memory _ticker,
        uint8[] memory cores,
        string memory desc,
        string memory img,
        string[4] memory urls,
        uint256 purchaseAmount
    ) external returns (address, address, uint);    
}