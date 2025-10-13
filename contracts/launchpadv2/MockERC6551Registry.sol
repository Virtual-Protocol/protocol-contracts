// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libs/IERC6551Registry.sol";

contract MockERC6551Registry is IERC6551Registry {
    // Mapping to store created accounts
    mapping(address => mapping(uint256 => mapping(address => mapping(uint256 => mapping(bytes32 => address)))))
        private _accounts;

    // Counter for generating unique addresses
    uint256 private _accountCounter;

    constructor() {
        // Mock implementation
    }

    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external override returns (address) {
        // Check if account already exists
        address existingAccount = _accounts[implementation][chainId][
            tokenContract
        ][tokenId][salt];
        if (existingAccount != address(0)) {
            return existingAccount;
        }

        // Create a mock account address
        address account = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            implementation,
                            chainId,
                            tokenContract,
                            tokenId,
                            salt,
                            _accountCounter++
                        )
                    )
                )
            )
        );

        // Store the account
        _accounts[implementation][chainId][tokenContract][tokenId][
            salt
        ] = account;

        // Emit event
        emit AccountCreated(
            account,
            implementation,
            chainId,
            tokenContract,
            tokenId,
            uint256(salt)
        );

        return account;
    }

    function account(
        address implementation,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId,
        uint256 salt
    ) external view override returns (address) {
        return
            _accounts[implementation][chainId][tokenContract][tokenId][
                bytes32(salt)
            ];
    }

    // Mock function to get account counter for testing
    function getAccountCounter() external view returns (uint256) {
        return _accountCounter;
    }

    // Mock function to check if account exists
    function accountExists(
        address implementation,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId,
        uint256 salt
    ) external view returns (bool) {
        return
            _accounts[implementation][chainId][tokenContract][tokenId][
                bytes32(salt)
            ] != address(0);
    }
}
