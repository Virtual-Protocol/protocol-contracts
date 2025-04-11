// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../virtualPersona/IAgentFactoryV3.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract MockAgentFactoryV3 is
    IAgentFactoryV3,
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable
{
    // Mock variables
    address public mockAgentToken;
    uint256 public mockId;
    bytes32 public constant BONDING_ROLE = keccak256("BONDING_ROLE");

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address, // tokenImplementation
        address, // veTokenImplementation
        address, // daoImplementation
        address, // tbaRegistry
        address, // assetToken
        address, // nft
        uint256, // applicationThreshold
        address, // vault
        uint256 // nextId
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(BONDING_ROLE, msg.sender);
    }

    // Mock setter functions
    function setMockAgentToken(address token) external {
        mockAgentToken = token;
    }

    function setMockId(uint256 id) external {
        mockId = id;
    }

    // Interface implementations
    function proposeAgent(
        string memory,
        string memory,
        string memory,
        uint8[] memory,
        bytes32,
        address,
        uint32,
        uint256
    ) public view returns (uint256) {
        return mockId;
    }

    function withdraw(uint256) public pure {
        // Mock implementation - do nothing
    }

    function totalAgents() public pure returns (uint256) {
        return 1; // Mock implementation returns 1
    }

    function initFromBondingCurve(
        string memory,
        string memory,
        uint8[] memory,
        bytes32,
        address,
        uint32,
        uint256,
        uint256,
        address
    ) public view whenNotPaused onlyRole(BONDING_ROLE) returns (uint256) {
        return mockId;
    }

    function executeBondingCurveApplication(
        uint256,
        uint256,
        uint256,
        address
    ) public view onlyRole(BONDING_ROLE) returns (address) {
        return address(mockAgentToken);
    }
}
