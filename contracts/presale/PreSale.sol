// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "../fun/FRouter.sol";
import "../presale/Points.sol";

contract PreSale is 
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable 
{
    using SafeERC20 for IERC20;

    address private _feeTo;
    string private _name; // name of the token
    string private _symbol; // symbol of the token

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // Router contract address
    FRouter public router;
    
    // Virtual Token address
    address public virtualToken;

    // Presale status
    enum PresaleStatus { Initialized, NotStarted, Active, Ended }
    PresaleStatus public status;

    event Buy(
        address indexed user,
        uint256 pointAmount,
        uint256 virtualTokenAmount
    );

    event PresaleStarted(uint256 timestamp);
    event PresaleEnded(
        address indexed presaleContract,
        uint256 totalDeposited
    );

    // Maximum virtual token cap
    uint256 public constant MAX_VIRTUAL_TOKEN_CAP = 42000 * 10**18; // 42K tokens with 18 decimals
    
    // Track total points committted and total virtual tokens deposited
    uint256 public totalPointsCommitted;
    uint256 public totalVirtualTokensDeposited;

    event TokensWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    uint256 public constant LAUNCH_FEE = 100 * 10**18; // 100 tokens with 18 decimals

    event Launched(
        address indexed launcher,
        address indexed presaleContract,
        uint256 virtualTokenAmount,
        uint256 fee
    );

    // Points contract reference
    Points public pointsContract;

    // Simple mappings for tracking points and virtual tokens
    mapping(address => uint256) public userPointsCommitted;
    mapping(address => uint256) public userVirtualTokensCommitted;

    // Add array to track all committers
    address[] public allCommitters;

    uint256 devInitialPurchase;

    // Add a flag to track if launch has been called
    bool private _hasLaunched;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address router_,
        address virtualToken_,
        address pointsContract_
    ) external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);

        require(router_ != address(0), "Zero addresses are not allowed");
        require(virtualToken_ != address(0), "Zero addresses are not allowed");
        require(pointsContract_ != address(0), "Zero addresses are not allowed");

        router = FRouter(router_);
        virtualToken = virtualToken_;
        status = PresaleStatus.Initialized;
        pointsContract = Points(pointsContract_);
    }

    function startPresale() external onlyRole(OPERATOR_ROLE) {
        require(status == PresaleStatus.NotStarted, "Presale must be in NotStarted status");
        status = PresaleStatus.Active;
        emit PresaleStarted(block.timestamp);
    }

    function endPresale() external onlyRole(OPERATOR_ROLE) {
        require(status == PresaleStatus.Active, "Presale must be in Active status");
        status = PresaleStatus.Ended;

        if (totalVirtualTokensDeposited >= MAX_VIRTUAL_TOKEN_CAP) {
            // todo: launch sentient token
            // todo: mint sentient token to msg.sender
        }

        emit PresaleEnded(address(this), totalVirtualTokensDeposited);
    }

    function launch(
        string memory name_,
        string memory symbol_,
        uint256 virtualTokenAmount
    ) external nonReentrant {
        require(!_hasLaunched, "Already launched");
        require(status == PresaleStatus.Initialized, "Presale must be in Initialized status");
        require(virtualTokenAmount >= LAUNCH_FEE, "Virtual Token amount must be at least fee");
        require(
            IERC20(virtualToken).balanceOf(msg.sender) >= virtualTokenAmount,
            "Insufficient amount"
        );
        
        // Add name and symbol length checks
        require(bytes(name_).length > 0 && bytes(name_).length <= 32, "Invalid name length");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 8, "Invalid symbol length");
        _name = name_;
        _symbol = symbol_;

        uint256 initialPurchase = (virtualTokenAmount - LAUNCH_FEE);
        IERC20(virtualToken).safeTransferFrom(msg.sender, _feeTo, LAUNCH_FEE); // no refund for launch fee
        IERC20(virtualToken).safeTransferFrom(msg.sender, address(this), initialPurchase); // Transfer init buy amount of Virtual Token

        // Store dev info
        devInitialPurchase = initialPurchase;

        // Add dev to allCommitters
        if (userPointsCommitted[msg.sender] == 0 && userVirtualTokensCommitted[msg.sender] == 0) {
            allCommitters.push(msg.sender);
        }

        // Record dev's initial purchase
        userVirtualTokensCommitted[msg.sender] += initialPurchase;
        totalVirtualTokensDeposited = totalVirtualTokensDeposited + initialPurchase;

        // Set launch flag
        _hasLaunched = true;

        // Change status to NotStarted
        status = PresaleStatus.NotStarted;
        
        emit Launched(msg.sender, address(this), virtualTokenAmount, LAUNCH_FEE);
    }

    function buy(
        uint256 pointAmount,
        uint256 virtualTokenAmount
    ) external nonReentrant {
        require(status == PresaleStatus.Active, "Presale is not active");
        require(pointAmount > 0, "Point amount must be greater than 0");
        require(virtualTokenAmount > 0, "Virtual Token amount must be greater than 0");
        
        // Check if user has enough points
        require(pointsContract.points(msg.sender) >= pointAmount, "Insufficient points");

        // Deduct points (negative amount to reduce points)
        pointsContract.addPoints(msg.sender, -int256(pointAmount));

        // Transfer Virtual Token
        IERC20(virtualToken).safeTransferFrom(
            msg.sender,
            address(this),
            virtualTokenAmount
        );
        
        // Add to allCommitters if first time (if both amounts are 0)
        if (userPointsCommitted[msg.sender] == 0 && userVirtualTokensCommitted[msg.sender] == 0) {
            allCommitters.push(msg.sender);
        }

        // Update user commitments
        userPointsCommitted[msg.sender] += pointAmount;
        userVirtualTokensCommitted[msg.sender] += virtualTokenAmount;
        
        // Update total virtual tokens deposited
        totalVirtualTokensDeposited = totalVirtualTokensDeposited + virtualTokenAmount;
        totalPointsCommitted = totalPointsCommitted + pointAmount;

        // If cap is reached, end the presale early
        if (totalVirtualTokensDeposited >= MAX_VIRTUAL_TOKEN_CAP) {
            endPresale();
        }

        emit Buy(msg.sender, pointAmount, virtualTokenAmount);
    }

    function withdrawToken(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(OPERATOR_ROLE) {
        require(status == PresaleStatus.Ended, "Presale must be ended");
        require(to != address(0), "Zero address not allowed");
        require(token == virtualToken, "Invalid token");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");
        
        // If amount is 0, withdraw all balance
        uint256 withdrawAmount = amount == 0 ? balance : amount;
        require(withdrawAmount <= balance, "Insufficient balance");
        
        IERC20(token).safeTransfer(to, withdrawAmount);
        
        emit TokensWithdrawn(token, to, withdrawAmount);
    }

    // Get user commitment info
    function getUserCommitments(address user) external view returns (uint256 points, uint256 virtualTokens) {
        return (userPointsCommitted[user], userVirtualTokensCommitted[user]);
    }

    // Get all commitments
    function getAllCommitments() external view returns (
        address[] memory users,
        uint256[] memory points,
        uint256[] memory virtualTokens
    ) {
        uint256 length = allCommitters.length;
        points = new uint256[](length);
        virtualTokens = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            address user = allCommitters[i];
            points[i] = userPointsCommitted[user];
            virtualTokens[i] = userVirtualTokensCommitted[user];
        }

        return (allCommitters, points, virtualTokens);
    }

    // Get total number of committers
    function getTotalCommitters() external view returns (uint256) {
        return allCommitters.length;
    }

    // Get dev initial purchase
    function getDevInitialPurchase() external view returns (uint256) {
        return devInitialPurchase;
    }

    // Get total points committed
    function getTotalPointsCommitted() external view returns (uint256) {
        return totalPointsCommitted;
    }

    // Get total virtual tokens deposited
    function getTotalVirtualTokensDeposited() external view returns (uint256) {
        return totalVirtualTokensDeposited;
    }

    // Optional: Add a function to check if presale has been launched
    function hasLaunched() external view returns (bool) {
        return _hasLaunched;
    }
} 