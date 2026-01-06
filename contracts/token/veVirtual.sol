// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import "@openzeppelin/contracts-upgradeable/governance/utils/VotesUpgradeable.sol";

contract veVirtual is
    Initializable,
    ReentrancyGuardUpgradeable,
    AccessControlUpgradeable,
    VotesUpgradeable
{
    using SafeERC20 for IERC20;
    struct Lock {
        uint256 amount; // if isEco is true, then this is the percentage of the totalEcoLockAmount, otherwise it is the amount of tokens staked
        uint256 start;
        uint256 end;
        uint8 numWeeks; // Active duration in weeks. Reset to maxWeeks if autoRenew is true.
        bool autoRenew;
        uint256 id;
        bool isEco; // If true, this is an eco lock managed by ecoVeVirtualStaker, cannot be withdrawn by user
    }

    uint16 public constant DENOM = 10000;
    uint256 public constant DENOM_18 = 1e18; // For percentage calculations (1e18 = 100%)
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant MAX_POSITIONS = 200;

    address public baseToken;
    mapping(address => Lock[]) public locks;
    mapping(address => Lock) public ecoLocks; // Separate mapping for eco locks (one per trader)
    uint256 private _nextId;

    uint8 public maxWeeks;
    address public ecoVeVirtualStaker; // Address that holds the underlying tokens for eco locks
    uint256 public totalEcoLockAmount; // Total amount of tokens staked for eco traders (held by ecoVeVirtualStaker)

    event Stake(
        address indexed user,
        uint256 id,
        uint256 amount,
        uint8 numWeeks
    );
    event Withdraw(address indexed user, uint256 id, uint256 amount);
    event Extend(address indexed user, uint256 id, uint8 numWeeks);
    event AutoRenew(address indexed user, uint256 id, bool autoRenew);

    event AdminUnlocked(bool adminUnlocked);
    event StakeForEcoTraders(
        address indexed trader,
        uint256 id,
        uint256 amount,
        uint8 numWeeks
    );
    bool public adminUnlocked;

    function initialize(
        address baseToken_,
        uint8 maxWeeks_
    ) external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        __Votes_init();
        __EIP712_init("veVIRTUAL", "1");

        require(baseToken_ != address(0), "Invalid token");
        baseToken = baseToken_;
        maxWeeks = maxWeeks_;
        _nextId = 1;

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
    }

    function numPositions(address account) public view returns (uint256) {
        return locks[account].length;
    }

    function getPositions(
        address account,
        uint256 start,
        uint256 count
    ) public view returns (Lock[] memory) {
        Lock[] memory results = new Lock[](count);
        uint j = 0;
        for (
            uint i = start;
            i < (start + count) && i < locks[account].length;
            i++
        ) {
            results[j] = locks[account][i];
            j++;
        }
        return results;
    }

    // Query balance at a specific timestamp
    // If the timestamp is before the lock was created, it will return 0
    // This does not work on withdrawn locks
    function balanceOfAt(
        address account,
        uint256 timestamp
    ) public view returns (uint256) {
        uint256 balance = 0;
        for (uint i = 0; i < locks[account].length; i++) {
            balance += _balanceOfLockAt(locks[account][i], timestamp);
        }
        // Include eco lock if it exists (with actual amount calculation)
        if (ecoLocks[account].id != 0) {
            Lock memory ecoLock = ecoLocks[account];
            // Calculate actual amount for eco lock
            uint256 actualAmount = _getEcoLockActualAmount(account);

            // Create a temporary lock with actual amount for balance calculation
            Lock memory tempLock = Lock({
                amount: actualAmount,
                start: ecoLock.start,
                end: ecoLock.end,
                numWeeks: ecoLock.numWeeks,
                autoRenew: ecoLock.autoRenew,
                id: ecoLock.id,
                isEco: ecoLock.isEco
            });
            balance += _balanceOfLockAt(tempLock, timestamp);
        }
        return balance;
    }

    function balanceOf(address account) public view returns (uint256) {
        return balanceOfAt(account, block.timestamp);
    }

    function balanceOfLock(
        address account,
        uint256 index
    ) public view returns (uint256) {
        Lock memory lock = locks[account][index];
        // If it's an eco lock, calculate actual amount
        if (lock.isEco) {
            uint256 actualAmount = _getEcoLockActualAmount(account);
            Lock memory tempLock = Lock({
                amount: actualAmount,
                start: lock.start,
                end: lock.end,
                numWeeks: lock.numWeeks,
                autoRenew: lock.autoRenew,
                id: lock.id,
                isEco: lock.isEco
            });
            return _balanceOfLock(tempLock);
        }
        return _balanceOfLock(lock);
    }

    function _balanceOfLockAt(
        Lock memory lock,
        uint256 timestamp
    ) internal view returns (uint256) {
        uint256 value = _calcValue(
            lock.amount,
            lock.autoRenew ? maxWeeks : lock.numWeeks
        );

        if (lock.autoRenew) {
            return value;
        }

        if (timestamp < lock.start || timestamp >= lock.end) {
            return 0;
        }

        uint256 duration = lock.end - lock.start;
        uint256 elapsed = timestamp - lock.start;
        uint256 decayRate = (value * DENOM) / duration;

        return value - (elapsed * decayRate) / DENOM;
    }

    function _balanceOfLock(Lock memory lock) internal view returns (uint256) {
        return _balanceOfLockAt(lock, block.timestamp);
    }

    function stake(
        uint256 amount,
        uint8 numWeeks,
        bool autoRenew
    ) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(numWeeks <= maxWeeks, "Num weeks must be less than max weeks");
        require(numWeeks > 0, "Num weeks must be greater than 0");

        IERC20(baseToken).safeTransferFrom(_msgSender(), address(this), amount);

        if (autoRenew == true) {
            numWeeks = maxWeeks;
        }

        uint256 end = block.timestamp + uint256(numWeeks) * 1 weeks;

        Lock memory lock = Lock({
            amount: amount,
            start: block.timestamp,
            end: end,
            numWeeks: numWeeks,
            autoRenew: autoRenew,
            id: _nextId++,
            isEco: false
        });
        locks[_msgSender()].push(lock);
        emit Stake(_msgSender(), lock.id, amount, numWeeks);
        _transferVotingUnits(address(0), _msgSender(), amount);
    }

    function _calcValue(
        uint256 amount,
        uint8 numWeeks
    ) internal view returns (uint256) {
        return
            (amount *
                (
                    numWeeks >= maxWeeks
                        ? DENOM
                        : (uint256(numWeeks) * DENOM) / maxWeeks
                )) / DENOM;
    }

    function _indexOf(
        address account,
        uint256 id
    ) internal view returns (uint256) {
        for (uint i = 0; i < locks[account].length; i++) {
            if (locks[account][i].id == id) {
                return i;
            }
        }
        revert("Lock not found");
    }

    function withdraw(uint256 id) external nonReentrant {
        address account = _msgSender();
        uint256 index = _indexOf(account, id);
        Lock memory lock = locks[account][index];
        require(!lock.isEco, "Cannot withdraw eco lock");
        require(
            block.timestamp >= lock.end || adminUnlocked,
            "Lock is not expired"
        );
        require(lock.autoRenew == false, "Lock is auto-renewing");

        uint256 amount = lock.amount;

        uint256 lastIndex = locks[account].length - 1;
        if (index != lastIndex) {
            locks[account][index] = locks[account][lastIndex];
        }
        locks[account].pop();

        IERC20(baseToken).safeTransfer(account, amount);
        emit Withdraw(account, id, amount);
        _transferVotingUnits(account, address(0), amount);
    }

    function toggleAutoRenew(uint256 id) external nonReentrant {
        address account = _msgSender();
        uint256 index = _indexOf(account, id);

        Lock storage lock = locks[account][index];
        require(!lock.isEco, "Cannot modify eco lock");
        lock.autoRenew = !lock.autoRenew;
        lock.numWeeks = maxWeeks;
        lock.start = block.timestamp;
        lock.end = block.timestamp + uint(lock.numWeeks) * 1 weeks;

        emit AutoRenew(account, id, lock.autoRenew);
    }

    function extend(uint256 id, uint8 numWeeks) external nonReentrant {
        address account = _msgSender();
        uint256 index = _indexOf(account, id);
        Lock storage lock = locks[account][index];
        require(!lock.isEco, "Cannot modify eco lock");
        require(lock.autoRenew == false, "Lock is auto-renewing");
        require(block.timestamp < lock.end, "Lock is expired");
        require(
            (lock.numWeeks + numWeeks) <= maxWeeks,
            "Num weeks must be less than max weeks"
        );
        uint256 newEnd = lock.end + uint256(numWeeks) * 1 weeks;

        lock.numWeeks += numWeeks;
        lock.end = newEnd;

        emit Extend(account, id, numWeeks);
    }

    function setMaxWeeks(uint8 maxWeeks_) external onlyRole(ADMIN_ROLE) {
        maxWeeks = maxWeeks_;
    }

    function getMaturity(
        address account,
        uint256 id
    ) public view returns (uint256) {
        uint256 index = _indexOf(account, id);
        Lock memory lock = locks[account][index];
        if (!lock.autoRenew) {
            return locks[account][index].end;
        }

        return block.timestamp + maxWeeks * 1 weeks;
    }

    function name() public pure returns (string memory) {
        return "veVIRTUAL";
    }

    function symbol() public pure returns (string memory) {
        return "veVIRTUAL";
    }

    function decimals() public pure returns (uint8) {
        return 18;
    }

    function setAdminUnlocked(
        bool adminUnlocked_
    ) external onlyRole(ADMIN_ROLE) {
        adminUnlocked = adminUnlocked_;
        emit AdminUnlocked(adminUnlocked);
    }

    function _getVotingUnits(
        address account
    ) internal view virtual override returns (uint256) {
        return stakedAmountOf(account);
    }

    function stakedAmountOf(address account) public view returns (uint256) {
        uint256 amount = 0;
        for (uint i = 0; i < locks[account].length; i++) {
            amount += locks[account][i].amount;
        }
        // Include eco lock if it exists (with actual amount calculation)
        if (ecoLocks[account].id != 0) {
            uint256 actualAmount = _getEcoLockActualAmount(account);
            amount += actualAmount;
        }
        return amount;
    }

    /// @notice Set the ecoVeVirtualStaker that holds underlying tokens for eco locks
    /// @param ecoVeVirtualStaker_ The address that holds the underlying tokens
    function setEcoVeVirtualStaker(
        address ecoVeVirtualStaker_
    ) external onlyRole(ADMIN_ROLE) {
        require(
            ecoVeVirtualStaker_ != address(0),
            "Invalid ecoVeVirtualStaker"
        );
        ecoVeVirtualStaker = ecoVeVirtualStaker_;
    }

    /// @notice Get the actual amount for an eco lock (multiplied by totalEcoLockAmount)
    /// @param account The account to get the actual amount for
    /// @return The actual amount (percentage * totalEcoLockAmount / DENOM_18)
    function _getEcoLockActualAmount(
        address account
    ) internal view returns (uint256) {
        if (ecoLocks[account].id == 0) {
            return 0;
        }
        if (totalEcoLockAmount == 0) {
            return 0;
        }
        // trader's actual amount = trader's percentage * totalEcoLockAmount / DENOM_18
        return (ecoLocks[account].amount * totalEcoLockAmount) / DENOM_18;
    }

    /// @notice Internal function to create or update an eco lock
    /// @param account The account to create/update eco lock for
    /// @param amount The percentage for the eco lock (in 1e18 format)
    function _createOrUpdateEcoLock(address account, uint256 amount) internal {
        require(
            account != ecoVeVirtualStaker,
            "Cannot create lock for ecoVeVirtualStaker"
        );
        require(
            totalEcoLockAmount > 0,
            "totalEcoLockAmount must be greater than 0"
        );

        uint8 numWeeks = maxWeeks;
        uint256 end = block.timestamp + uint256(numWeeks) * 1 weeks;

        Lock storage existingLock = ecoLocks[account];

        // Calculate old actual amount before updating
        uint256 oldActualAmount = 0;
        if (existingLock.id != 0) {
            oldActualAmount =
                (existingLock.amount * totalEcoLockAmount) /
                DENOM_18;
        }

        if (existingLock.id == 0) {
            // Create new eco lock
            Lock memory newLock = Lock({
                amount: amount,
                start: block.timestamp,
                end: end,
                numWeeks: numWeeks,
                autoRenew: true,
                id: _nextId++,
                isEco: true
            });
            ecoLocks[account] = newLock;
            emit StakeForEcoTraders(account, newLock.id, amount, numWeeks);

            // Calculate actual amount for voting units
            uint256 actualAmount = (amount * totalEcoLockAmount) / DENOM_18;
            if (actualAmount > 0) {
                _transferVotingUnits(address(0), account, actualAmount);
            }
        } else {
            // Update existing eco lock
            existingLock.amount = amount;
            existingLock.start = block.timestamp;
            existingLock.end = end;

            // Calculate new actual amount for voting units
            uint256 newActualAmount = (amount * totalEcoLockAmount) / DENOM_18;

            // Update voting units (ensure positive difference)
            if (newActualAmount > oldActualAmount) {
                // mint voting units
                _transferVotingUnits(
                    address(0),
                    account,
                    newActualAmount - oldActualAmount
                );
            } else if (newActualAmount < oldActualAmount) {
                // Ensure we don't underflow, and also burn voting units
                _transferVotingUnits(
                    account,
                    address(0),
                    oldActualAmount - newActualAmount
                );
            }
        }
    }

    function stakeForEcoTraders(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(
            _msgSender() == ecoVeVirtualStaker,
            "sender is not ecoVeVirtualStaker"
        );

        IERC20(baseToken).safeTransferFrom(_msgSender(), address(this), amount);

        // Add to total eco lock amount (no lock created for ecoVeVirtualStaker)
        totalEcoLockAmount += amount;
    }

    /// @notice Stake tokens for eco traders (tokens are held by ecoVeVirtualStaker)
    /// @param userAddresses Array of trader addresses to receive locks
    /// @param percentages Array of percentages for each trader (in 1e18 format, must sum to DENOM_18)
    /// @dev This function creates or updates eco locks for traders but doesn't transfer tokens
    ///      The underlying tokens are held by ecoVeVirtualStaker
    ///      Percentages are in 1e18 format (1e18 = 100%)
    function updateEcoTradersPercentages(
        address[] calldata userAddresses,
        uint256[] calldata percentages
    ) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(
            userAddresses.length == percentages.length,
            "Arrays length mismatch"
        );
        require(
            ecoVeVirtualStaker != address(0),
            "ecoVeVirtualStaker not set"
        );
        require(
            totalEcoLockAmount > 0,
            "totalEcoLockAmount must be greater than 0"
        );

        for (uint i = 0; i < percentages.length; i++) {
            require(percentages[i] > 0, "Percentage must be greater than 0");
            require(
                percentages[i] <= DENOM_18,
                "Percentage cannot exceed 100%"
            );
        }

        for (uint i = 0; i < userAddresses.length; i++) {
            address trader = userAddresses[i];
            require(trader != address(0), "Invalid trader address");
            require(
                trader != ecoVeVirtualStaker,
                "Cannot set percentage for ecoVeVirtualStaker"
            );

            // Create or update eco lock for trader (store percentage)
            _createOrUpdateEcoLock(trader, percentages[i]);
        }
    }

    /// @notice Get the eco lock for a trader
    /// @param trader The trader address
    /// @return lock The eco lock (id will be 0 if no eco lock exists)
    function getEcoLock(address trader) external view returns (Lock memory) {
        return ecoLocks[trader];
    }
}
