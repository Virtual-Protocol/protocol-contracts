// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/types/Time.sol";
import "@openzeppelin/contracts-upgradeable/governance/utils/VotesUpgradeable.sol";

/**
 * @title Virtizen
 * @notice Non-transferable ERC20-like token that represents voting power from Trust Fund Tax (0.7% + 0.3%)
 * @dev This token is 1:1 with veVIRTUAL voting power and supports delegation
 *      Tokens are minted when VIRTUAL from tax is staked forever on behalf of users
 *      Users cannot transfer or approve Virtizen tokens, but can delegate voting power
 */
contract Virtizen is
    Initializable,
    ReentrancyGuardUpgradeable,
    AccessControlUpgradeable,
    VotesUpgradeable
{
    using Checkpoints for Checkpoints.Trace208;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Mapping to track balances at different timestamps
    // account => timestamp => balance
    mapping(address => Checkpoints.Trace208) private _balanceCheckpoints;

    // Current balance of each account
    mapping(address => uint256) private _balances;

    // Total supply tracking
    Checkpoints.Trace208 private _totalSupplyCheckpoints;

    string private _name;
    string private _symbol;

    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_
    ) external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        __Votes_init();
        __EIP712_init(name_, "1");

        _name = name_;
        _symbol = symbol_;

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
    }

    /**
     * @notice Returns the name of the token
     */
    function name() public view returns (string memory) {
        return _name;
    }

    /**
     * @notice Returns the symbol of the token
     */
    function symbol() public view returns (string memory) {
        return _symbol;
    }

    /**
     * @notice Returns the decimals of the token (always 18)
     */
    function decimals() public pure returns (uint8) {
        return 18;
    }

    /**
     * @notice Returns the total supply of tokens
     */
    function totalSupply() public view returns (uint256) {
        return _totalSupplyCheckpoints.latest();
    }

    /**
     * @notice Returns the total supply at a specific timestamp
     */
    function totalSupplyAt(uint256 timestamp) public view returns (uint256) {
        return
            _totalSupplyCheckpoints.upperLookupRecent(
                SafeCast.toUint48(timestamp)
            );
    }

    /**
     * @notice Returns the balance of an account
     */
    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    /**
     * @notice Returns the balance of an account at a specific timestamp
     * @dev This is used by governance contracts to get voting power at proposal snapshot time
     */
    function balanceOfAt(
        address account,
        uint256 timestamp
    ) public view returns (uint256) {
        // If timestamp is in the future, return current balance
        if (timestamp >= block.timestamp) {
            return _balances[account];
        }

        // Otherwise, lookup historical balance
        return
            _balanceCheckpoints[account].upperLookupRecent(
                SafeCast.toUint48(timestamp)
            );
    }

    /**
     * @notice Mint tokens to an account (only MINTER_ROLE can call)
     * @dev This is called by backend when Trust Fund Tax is staked forever
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint (1:1 with veVIRTUAL staked)
     */
    function mint(
        address to,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) nonReentrant {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Amount must be greater than 0");

        uint256 oldBalance = _balances[to];
        uint256 newBalance = oldBalance + amount;

        _balances[to] = newBalance;

        // Update checkpoints for historical balance tracking
        _balanceCheckpoints[to].push(clock(), SafeCast.toUint208(newBalance));

        // Update total supply checkpoints
        uint256 oldTotalSupply = _totalSupplyCheckpoints.latest();
        uint256 newTotalSupply = oldTotalSupply + amount;
        _totalSupplyCheckpoints.push(
            clock(),
            SafeCast.toUint208(newTotalSupply)
        );

        // Update voting units (for delegation system)
        _transferVotingUnits(address(0), to, amount);

        emit Mint(to, amount);
    }

    /**
     * @notice Mint tokens to multiple accounts in batch (only MINTER_ROLE can call)
     * @dev This is called by backend at end of each epoch to distribute Virtizen to traders
     * @param accounts Array of addresses to mint tokens to
     * @param amounts Array of amounts to mint (must be same length as accounts)
     */
    function mintBatch(
        address[] calldata accounts,
        uint256[] calldata amounts
    ) external onlyRole(MINTER_ROLE) nonReentrant {
        require(accounts.length == amounts.length, "Arrays length mismatch");

        uint256 currentTime = clock();
        uint256 oldTotalSupply = _totalSupplyCheckpoints.latest();
        uint256 newTotalSupply = oldTotalSupply;

        for (uint256 i = 0; i < accounts.length; i++) {
            address to = accounts[i];
            uint256 amount = amounts[i];

            require(to != address(0), "Cannot mint to zero address");
            require(amount > 0, "Amount must be greater than 0");

            uint256 oldBalance = _balances[to];
            uint256 newBalance = oldBalance + amount;

            _balances[to] = newBalance;
            newTotalSupply += amount;

            // Update checkpoints for historical balance tracking
            _balanceCheckpoints[to].push(
                currentTime,
                SafeCast.toUint208(newBalance)
            );

            // Update voting units (for delegation system)
            _transferVotingUnits(address(0), to, amount);

            emit Mint(to, amount);
        }

        // Update total supply checkpoints once for all mints
        _totalSupplyCheckpoints.push(
            currentTime,
            SafeCast.toUint208(newTotalSupply)
        );
    }

    /**
     * @notice Burn tokens from an account (only MINTER_ROLE can call)
     * @dev This might be needed if there's an error or adjustment
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burn(
        address from,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) nonReentrant {
        require(from != address(0), "Cannot burn from zero address");
        require(amount > 0, "Amount must be greater than 0");
        require(_balances[from] >= amount, "Insufficient balance");

        uint256 oldBalance = _balances[from];
        uint256 newBalance = oldBalance - amount;

        _balances[from] = newBalance;

        // Update checkpoints for historical balance tracking
        _balanceCheckpoints[from].push(clock(), SafeCast.toUint208(newBalance));

        // Update total supply checkpoints
        uint256 oldTotalSupply = _totalSupplyCheckpoints.latest();
        uint256 newTotalSupply = oldTotalSupply - amount;
        _totalSupplyCheckpoints.push(
            clock(),
            SafeCast.toUint208(newTotalSupply)
        );

        // Update voting units (for delegation system)
        _transferVotingUnits(from, address(0), amount);

        emit Burn(from, amount);
    }

    /**
     * @notice Override clock() to use timestamp instead of block number
     * @dev This matches veVIRTUAL's clock mode for consistency
     */
    function clock() public view override returns (uint48) {
        return Time.timestamp();
    }

    /**
     * @notice Returns the clock mode (timestamp-based)
     */
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    /**
     * @notice Returns the voting units for an account (used by VotesUpgradeable)
     * @dev This is 1:1 with balance for Virtizen token
     */
    function _getVotingUnits(
        address account
    ) internal view override returns (uint256) {
        return _balances[account];
    }

    /**
     * @notice Disable transfer functionality - Virtizen tokens are non-transferable
     */
    function transfer(
        address /*to*/,
        uint256 /*amount*/
    ) public pure returns (bool) {
        revert("Virtizen: transfer not allowed");
    }

    /**
     * @notice Disable transferFrom functionality - Virtizen tokens are non-transferable
     */
    function transferFrom(
        address /*from*/,
        address /*to*/,
        uint256 /*amount*/
    ) public pure returns (bool) {
        revert("Virtizen: transfer not allowed");
    }

    /**
     * @notice Disable approve functionality - Virtizen tokens are non-transferable
     */
    function approve(
        address /*spender*/,
        uint256 /*amount*/
    ) public pure returns (bool) {
        revert("Virtizen: approve not allowed");
    }

    /**
     * @notice Disable allowance functionality - Virtizen tokens are non-transferable
     */
    function allowance(
        address /*owner*/,
        address /*spender*/
    ) public pure returns (uint256) {
        return 0;
    }
}
