// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract veVirtual is
    Initializable,
    ReentrancyGuardUpgradeable,
    AccessControlUpgradeable
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
    uint256 private constant FAR_FUTURE = type(uint256).max;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public baseToken;
    mapping(address => Lock[]) public locks;

    uint8 public maxWeeks;

    event Stake(address indexed user, uint256 amount, uint8 numWeeks);
    event Withdraw(address indexed user, uint256 index, uint256 amount);

    function initialize(
        address baseToken_,
        uint8 maxWeeks_
    ) external initializer {
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

    function balanceOf(address account) public view returns (uint256) {
        uint256 balance = 0;
        for (uint i = 0; i < locks[account].length; i++) {
            balance += _balanceOfLock(locks[account][i]);
        }
        return balance;
    }

    function balanceOfLock(
        address account,
        uint256 index
    ) public view returns (uint256) {
        return _balanceOfLock(locks[account][index]);
    }

    function _balanceOfLock(Lock memory lock) internal view returns (uint256) {
        uint256 value = lock.value;
        if (lock.autoRenew) {
            return value;
        }

        if (block.timestamp >= lock.end) {
            return 0;
        }

        uint256 duration = lock.end - lock.start;
        uint256 elapsed = block.timestamp - lock.start;
        uint256 decayRate = (value * DENOM) / duration;

        return value - (elapsed * decayRate) / DENOM;
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

        uint multiplier = (numWeeks * DENOM) / maxWeeks;
        uint256 value = (amount * multiplier) / DENOM;

        uint256 end = block.timestamp + numWeeks * 1 weeks;

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
    }

    function withdraw(uint256 index) external nonReentrant {
        require(index < locks[_msgSender()].length, "Invalid index");
        Lock memory lock = locks[_msgSender()][index];
        require(block.timestamp >= lock.end, "Lock is not expired");

        IERC20(baseToken).safeTransfer(_msgSender(), lock.amount);
        emit Withdraw(_msgSender(), index, lock.amount);

        uint256 lastIndex = locks[_msgSender()].length - 1;
        if (index != lastIndex) {
            locks[_msgSender()][index] = locks[_msgSender()][lastIndex];
        }
        delete locks[_msgSender()][lastIndex];
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
        lock.end = block.timestamp + lock.numWeeks * 1 weeks;
        uint multiplier = (lock.numWeeks * DENOM) / maxWeeks;
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
}
