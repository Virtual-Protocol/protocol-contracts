// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract ACPRegistry is Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    struct EvaluationService {
        address evaluator;
        uint256 price;
        bool isActive;
    }

    mapping(address => bool) public registeredEvaluators;
    mapping(uint256 => EvaluationService) public evaluationServices;
    uint256 public evaluationServiceCounter;

    event EvaluatorRegistered(address indexed evaluator);
    event EvaluatorDeregistered(address indexed evaluator);
    event EvaluationServiceRegistered(uint256 indexed evalId, address indexed evaluator, uint256 price);
    event EvaluationServiceDeregistered(uint256 indexed evalId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();

        // Setup initial admin
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
    }

    /**
     * @notice Register a new evaluator
     */
    function registerEvaluator() external {
        address evaluator = _msgSender();
        require(!registeredEvaluators[evaluator], "Evaluator already registered");
        
        registeredEvaluators[evaluator] = true;
        emit EvaluatorRegistered(evaluator);
    }

    /**
     * @notice Deregister an evaluator
     */
    function deregisterEvaluator() external {
        address evaluator = _msgSender();
        require(registeredEvaluators[evaluator], "Evaluator not registered");
        
        registeredEvaluators[evaluator] = false;
        emit EvaluatorDeregistered(evaluator);
    }

    /**
     * @notice Register a new evaluation service for an evaluator
     * @param price Price for the evaluation service
     * @return evalId The ID of the newly registered evaluation service
     */
    function registerEvaluationService(
        uint256 price
    ) external returns (uint256) {
        address evaluator = _msgSender();
        require(registeredEvaluators[evaluator], "Evaluator not registered");
        require(price > 0, "Price must be greater than 0");

        uint256 evalId = ++evaluationServiceCounter;
        evaluationServices[evalId] = EvaluationService({
            evaluator: evaluator,
            price: price,
            isActive: true
        });

        emit EvaluationServiceRegistered(evalId, evaluator, price);
        return evalId;
    }

    /**
     * @notice Deregister an evaluation service
     * @param evalId ID of the evaluation service to deregister
     */
    function deregisterEvaluationService(uint256 evalId) external {
        address evaluator = _msgSender();
        require(evaluationServices[evalId].evaluator == evaluator, "Not service owner");
        require(evaluationServices[evalId].isActive, "Service not active");
        
        evaluationServices[evalId].isActive = false;
        emit EvaluationServiceDeregistered(evalId);
    }

    /**
     * @notice Check if an address is a registered evaluator
     * @param evaluator Address to check
     * @return bool True if the address is a registered evaluator
     */
    function isRegisteredEvaluator(address evaluator) external view returns (bool) {
        return registeredEvaluators[evaluator];
    }

    /**
     * @notice Get evaluation service details
     * @param evalId ID of the evaluation service
     * @return evaluator Address of the evaluator
     * @return price Price of the service
     * @return isActive Whether the service is active
     */
    function getEvaluationService(uint256 evalId) external view returns (
        address evaluator,
        uint256 price,
        bool isActive
    ) {
        EvaluationService memory service = evaluationServices[evalId];
        return (service.evaluator, service.price, service.isActive);
    }
} 