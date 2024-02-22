// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IValidatorRegistry.sol";

interface IAgentNft is IValidatorRegistry {
    struct VirtualInfo {
        address dao; // Persona DAO can update the persona metadata
        address token;
        address founder;
        address tba; // Token Bound Address
        uint8[] coreTypes;
    }

    event CoresUpdated(uint256 virtualId, uint8[] coreTypes);

    function mint(
        address to,
        string memory newTokenURI,
        address payable theDAO,
        address founder,
        uint8[] memory coreTypes
    ) external returns (uint256);

    function stakingTokenToVirtualId(
        address daoToken
    ) external view returns (uint256);

    function setTBA(uint256 virtualId, address tba) external;

    function virtualInfo(
        uint256 virtualId
    ) external view returns (VirtualInfo memory);

    function totalSupply() external view returns (uint256);

    function totalStaked(uint256 virtualId) external view returns (uint256);

    function getVotes(
        uint256 virtualId,
        address validator
    ) external view returns (uint256);

    function getContributionNft() external view returns (address);

    function getServiceNft() external view returns (address);

    function getAllServices(
        uint256 virtualId
    ) external view returns (uint256[] memory);
}
