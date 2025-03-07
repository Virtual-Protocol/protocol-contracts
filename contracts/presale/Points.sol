// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract Points is 
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable 
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // Mapping to store points for each address
    mapping(address => int256) public points;

    event PointsUpdated(address indexed user, int256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    // Update points for an address (can be positive or negative)
    function addPoints(
        address user,
        int256 amount
    ) external onlyRole(OPERATOR_ROLE) {
        require(user != address(0), "Zero address not allowed");
        require(points[user] + amount >= 0, "Points cannot be negative");

        points[user] += amount;
        emit PointsUpdated(user, amount);
    }

    // Batch update points
    function batchAddPoints(
        address[] calldata users,
        int256[] calldata amounts
    ) external onlyRole(OPERATOR_ROLE) {
        require(users.length == amounts.length, "Array lengths must match");
        
        for (uint i = 0; i < users.length; i++) {
            require(users[i] != address(0), "Zero address not allowed");
            require(points[users[i]] + amounts[i] >= 0, "Points cannot be negative");
            
            points[users[i]] += amounts[i];
            emit PointsUpdated(users[i], amounts[i]);
        }
    }

    // Get points for an address
    function getPoints(address user) external view returns (int256) {
        return points[user];
    }

    // Get points for multiple addresses
    function getBatchPoints(
        address[] calldata users
    ) external view returns (int256[] memory) {
        int256[] memory userPoints = new int256[](users.length);
        
        for (uint i = 0; i < users.length; i++) {
            userPoints[i] = points[users[i]];
        }
        
        return userPoints;
    }
} 