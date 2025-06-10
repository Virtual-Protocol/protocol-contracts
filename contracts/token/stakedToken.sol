// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import "@openzeppelin/contracts-upgradeable/governance/utils/VotesUpgradeable.sol";

contract StakedToken is
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
        bool autoRenew;
        uint256 id;
    }

    uint16 public constant DENOM = 10000;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant MAX_POSITIONS = 200;

    address public baseToken;
    mapping(address => Lock[]) public locks;
    uint256 private _nextId;

    uint8 public maxWeeks;

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
    bool public adminUnlocked;
    string private _name;
    string private _symbol;

    function initialize(
        address baseToken_,
        uint8 maxWeeks_,
        string memory name_,
        string memory symbol_
    ) external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        __Votes_init();
        __EIP712_init(name_, "1");

        require(baseToken_ != address(0), "Invalid token");
        baseToken = baseToken_;
        maxWeeks = maxWeeks_;
        _nextId = 1;
        _name = name_;
        _symbol = symbol_;

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
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(
            locks[_msgSender()].length < MAX_POSITIONS,
            "Over max positions"
        );

        IERC20(baseToken).safeTransferFrom(_msgSender(), address(this), amount);

        bool autoRenew = true;
        uint8 numWeeks = maxWeeks;

        uint256 end = block.timestamp + uint256(numWeeks) * 1 weeks;

        Lock memory lock = Lock({
            amount: amount,
            start: block.timestamp,
            end: end,
            numWeeks: numWeeks,
            autoRenew: autoRenew,
            id: _nextId++
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

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
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
