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
        uint256 amount;
        uint256 start;
        uint256 end;
        uint8 numWeeks; // Active duration in weeks. Reset to maxWeeks if autoRenew is true.
        uint256 value;
        bool autoRenew;
    }

    uint16 public constant DENOM = 10000;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public baseToken;
    mapping(address => Lock[]) public locks;

    uint8 public maxWeeks;

    event Stake(address indexed user, uint256 amount, uint8 numWeeks);
    event Withdraw(address indexed user, uint256 index, uint256 amount);

    bool public adminUnlocked;

    event AdminUnlocked(bool adminUnlocked);

    function initialize(
        address baseToken_,
        uint8 maxWeeks_
    ) external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        __Votes_init();

        require(baseToken_ != address(0), "Invalid token");
        baseToken = baseToken_;
        maxWeeks = maxWeeks_;

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
        return balance;
    }

    function balanceOf(address account) public view returns (uint256) {
        return balanceOfAt(account, block.timestamp);
    }

    function balanceOfLock(
        address account,
        uint256 index
    ) public view returns (uint256) {
        return _balanceOfLock(locks[account][index]);
    }

    function _balanceOfLockAt(
        Lock memory lock,
        uint256 timestamp
    ) internal pure returns (uint256) {
        uint256 value = lock.value;
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

        IERC20(baseToken).safeTransferFrom(_msgSender(), address(this), amount);

        if (autoRenew == true) {
            numWeeks = maxWeeks;
        }

        uint multiplier = (uint(numWeeks) * DENOM) / uint(maxWeeks);
        uint256 value = (amount * multiplier) / DENOM;

        uint256 end = block.timestamp + uint256(numWeeks) * 1 weeks;

        Lock memory lock = Lock({
            amount: amount,
            start: block.timestamp,
            end: end,
            numWeeks: numWeeks,
            value: value,
            autoRenew: autoRenew
        });
        locks[_msgSender()].push(lock);
        emit Stake(_msgSender(), amount, numWeeks);
        _transferVotingUnits(address(0), _msgSender(), amount);
    }

    function withdraw(uint256 index) external nonReentrant {
        require(index < locks[_msgSender()].length, "Invalid index");
        Lock memory lock = locks[_msgSender()][index];
        require(
            block.timestamp >= lock.end || adminUnlocked,
            "Lock is not expired"
        );

        uint256 amount = lock.amount;

        uint256 lastIndex = locks[_msgSender()].length - 1;
        if (index != lastIndex) {
            locks[_msgSender()][index] = locks[_msgSender()][lastIndex];
        }
        delete locks[_msgSender()][lastIndex];

        IERC20(baseToken).safeTransfer(_msgSender(), amount);
        emit Withdraw(_msgSender(), index, amount);
        _transferVotingUnits(_msgSender(), address(0), amount);
    }

    function toggleAutoRenew(uint256 index) external nonReentrant {
        require(index < locks[_msgSender()].length, "Invalid index");
        Lock storage lock = locks[_msgSender()][index];
        require(block.timestamp < lock.end, "Lock is expired");
        lock.autoRenew = !lock.autoRenew;

        if (lock.autoRenew) {
            lock.numWeeks = maxWeeks;
        }

        lock.start = block.timestamp;
        lock.end = block.timestamp + uint(lock.numWeeks) * 1 weeks;
        uint multiplier = (uint(lock.numWeeks) * DENOM) / uint(maxWeeks);
        lock.value = (lock.amount * multiplier) / DENOM;
    }

    function extend(uint256 index, uint8 numWeeks) external nonReentrant {
        require(index < locks[_msgSender()].length, "Invalid index");
        Lock storage lock = locks[_msgSender()][index];
        require(lock.autoRenew == false, "Lock is auto-renewing");
        require(block.timestamp < lock.end, "Lock is expired");
        require(
            (lock.numWeeks + numWeeks) <= maxWeeks,
            "Num weeks must be less than max weeks"
        );
        uint256 newEnd = lock.end + uint256(numWeeks) * 1 weeks;

        lock.numWeeks += numWeeks;
        lock.end = newEnd;
        uint multiplier = ((uint(newEnd) - lock.start) * DENOM) /
            (uint(maxWeeks) * 1 weeks);
        lock.value = (lock.amount * multiplier) / DENOM;
    }

    function setMaxWeeks(uint8 maxWeeks_) external onlyRole(ADMIN_ROLE) {
        maxWeeks = maxWeeks_;
    }

    function getMaturity(
        address account,
        uint256 index
    ) public view returns (uint256) {
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
        return amount;
    }
}
