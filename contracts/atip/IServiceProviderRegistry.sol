// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IServiceProviderRegistry {
    struct ServiceProvider {
        string name;
        string description;
        address providerAddress;
        bool isActive;
        uint256 totalApprovedJobs;
        uint256 totalRejectedJobs;
    }

    event NewApplication(
        address indexed provider,
        string name,
        string description
    );
    event ProviderActivated(address indexed provider, string name);
    event ProviderDeactivated(address indexed provider);
    event ReputationUpdated(
        address indexed source,
        address indexed providerAddress,
        uint256 totalApprovedJobs,
        uint256 totalRejectedJobs
    );

    function applyAsProvider(
        string memory name,
        string memory description
    ) external;

    function approveProvider(address providerAddress) external;

    function deactivateProvider(address providerAddress) external;

    function isActiveProvider(
        address providerAddress
    ) external view returns (bool);

    function jobCompleted(address providerAddress, bool success) external;

    function getProvider(
        address providerAddress
    ) external view returns (ServiceProvider memory);
}
