// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "./IServiceProviderRegistry.sol";

contract ServiceProviderRegistry is
    IServiceProviderRegistry,
    Initializable,
    AccessControlUpgradeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant REPUTATION_MANAGER_ROLE =
        keccak256("REPUTATION_MANAGER_ROLE");

    struct PendingProvider {
        string name;
        string description;
    }

    mapping(address => PendingProvider) public pendingProviders;

    mapping(address => ServiceProvider) public providers;

    ServiceProvider[] public allProviders;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __AccessControl_init();

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(REPUTATION_MANAGER_ROLE, msg.sender);
    }

    modifier onlyActiveProvider() {
        require(providers[msg.sender].isActive, "Provider is not active");
        _;
    }

    function applyAsProvider(
        string memory name,
        string memory description
    ) external {
        require(!providers[msg.sender].isActive, "Provider already registered");
        require(!_isPendingProvider(msg.sender), "Application already pending");

        pendingProviders[msg.sender] = PendingProvider({
            name: name,
            description: description
        });

        emit NewApplication(msg.sender, name, description);
    }

    function _isPendingProvider(
        address providerAddress
    ) internal view returns (bool) {
        return bytes(pendingProviders[providerAddress].name).length > 0;
    }

    function approveProvider(
        address providerAddress
    ) external override onlyRole(ADMIN_ROLE) {
        require(_isPendingProvider(providerAddress), "No pending registration");
        require(
            !providers[providerAddress].isActive,
            "Provider already registered"
        );

        PendingProvider memory pending = pendingProviders[providerAddress];

        providers[providerAddress] = ServiceProvider({
            name: pending.name,
            providerAddress: providerAddress,
            isActive: true,
            description: pending.description,
            totalApprovedJobs: 0,
            totalRejectedJobs: 0
        });

        delete pendingProviders[providerAddress];

        allProviders.push(providers[providerAddress]);

        emit ProviderActivated(providerAddress, pending.name);
    }

    function deactivateProvider(
        address providerAddress
    ) external override onlyRole(ADMIN_ROLE) {
        require(providers[providerAddress].isActive, "Provider is not active");
        providers[providerAddress].isActive = false;
        emit ProviderDeactivated(providerAddress);
        // remove from allProviders array
        for (uint256 i = 0; i < allProviders.length; i++) {
            if (allProviders[i].providerAddress == providerAddress) {
                allProviders[i] = allProviders[allProviders.length - 1];
                allProviders.pop();
                break;
            }
        }
    }

    function jobCompleted(
        address providerAddress,
        bool success
    ) external override onlyRole(REPUTATION_MANAGER_ROLE) {
        ServiceProvider storage provider = providers[providerAddress];
        require(provider.isActive, "Provider is not active");
        if (success) {
            provider.totalApprovedJobs++;
        } else {
            provider.totalRejectedJobs++;
        }

        emit ReputationUpdated(
            msg.sender,
            providerAddress,
            provider.totalApprovedJobs,
            provider.totalRejectedJobs
        );
    }

    function isActiveProvider(
        address providerAddress
    ) external view override returns (bool) {
        return providers[providerAddress].isActive;
    }

    function getProvider(
        address providerAddress
    ) external view override returns (ServiceProvider memory) {
        return providers[providerAddress];
    }
}
