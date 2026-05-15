// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/proxy/Clones.sol";

/// @notice Test/utility helper that exposes EIP-1167 minimal-proxy
///         cloning to test code (and any future scripted launches that
///         need to bypass the LaunchpadFactory pipeline). NOT meant for
///         production use — register your template through the factory.
contract Cloner {
    event Cloned(address indexed implementation, address instance, bytes32 salt);

    function clone(address implementation) external returns (address instance) {
        instance = Clones.clone(implementation);
        emit Cloned(implementation, instance, bytes32(0));
    }

    function cloneDeterministic(address implementation, bytes32 salt)
        external
        returns (address instance)
    {
        instance = Clones.cloneDeterministic(implementation, salt);
        emit Cloned(implementation, instance, salt);
    }

    function predict(address implementation, bytes32 salt)
        external
        view
        returns (address)
    {
        return
            Clones.predictDeterministicAddress(implementation, salt, address(this));
    }
}
