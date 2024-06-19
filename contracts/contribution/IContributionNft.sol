// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/IGovernor.sol";

interface IContributionNft {
    function tokenVirtualId(uint256 tokenId) external view returns (uint256);
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function getChildren(uint256 tokenId) external view returns (uint256[] memory);
    function getParentId(uint256 tokenId) external view returns (uint256);
    function getCore(uint256 tokenId) external view returns (uint8);
    function isModel(uint256 tokenId) external view returns (bool);
    function getAdmin() external view returns (address);
    function getDatasetId(uint256 tokenId) external view returns (uint256);
    function getAgentDAO(uint256 virtualId) external view returns (IGovernor);
    function getEloCalculator() external view returns (address);
}
