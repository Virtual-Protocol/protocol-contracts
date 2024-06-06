// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./base/BaseToken.sol";
import "./interfaces/ITimeLockDeposits.sol";

contract TimeLock is BaseToken, ITimeLockDeposits {
    using Math for uint256;
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");

    uint256 public constant MIN_LOCK_DURATION = 10 minutes;
    bool public isAllowPositionStaking = true;
    bool public isAllowDeposits = true;
    bool public isAdminUnlock = false;

    address _treasury; // Recipient of withdrawal fees

    mapping(address => Deposit[]) public depositsOf;

    struct Deposit {
        uint256 amount;
        uint64 start;
        uint64 end;
        address token;
        bool cancelled;
        uint16 fees; // Cancellation fees in percentage with divisor 10000
    }

    constructor(
        string memory _name,
        string memory _symbol,
        address treasury_
    ) BaseToken(_name, _symbol) {
        _treasury = treasury_;
    }

    event Deposited(
        uint256 amount,
        uint256 duration,
        address indexed receiver,
        address indexed from,
        address token
    );

    event Withdrawn(
        uint256 amount,
        uint256 indexed depositId,
        address indexed receiver,
        address indexed from,
        address token
    );

    event Cancelled(address indexed from, address token, uint16 fees);

    function deposit(
        uint256 _amount,
        uint256 _duration,
        address _receiver,
        address _token
    ) external {
        require(isAllowDeposits, "Cannot deposit now");
        require(_amount > 0, "Cannot deposit 0");

        IERC20(_token).safeTransferFrom(_msgSender(), address(this), _amount);

        depositsOf[_receiver].push(
            Deposit({
                amount: _amount,
                start: uint64(block.timestamp),
                end: uint64(block.timestamp) + uint64(_duration),
                token: _token,
                cancelled: false,
                fees: 0
            })
        );

        _mint(_receiver, _amount);
        emit Deposited(_amount, _duration, _receiver, _msgSender(), _token);
    }

    function withdraw(uint256 _depositId, address _receiver) external {
        require(
            _depositId < depositsOf[_msgSender()].length,
            "Deposit does not exist"
        );
        Deposit memory userDeposit = depositsOf[_msgSender()][_depositId];
        if (!isAdminUnlock) {
            require(block.timestamp >= userDeposit.end, "Too soon");
        }

        // User must have enough to wthdraw
        require(
            balanceOf(_msgSender()) >= userDeposit.amount,
            "User does not have enough Staking Tokens to withdraw"
        );
        // remove Deposit
        depositsOf[_msgSender()][_depositId] = depositsOf[_msgSender()][
            depositsOf[_msgSender()].length - 1
        ];
        depositsOf[_msgSender()].pop();

        // burn pool shares
        _burn(_msgSender(), userDeposit.amount);

        // return tokens
        IERC20(userDeposit.token).safeTransfer(_receiver, userDeposit.amount);
        emit Withdrawn(
            userDeposit.amount,
            _depositId,
            _receiver,
            _msgSender(),
            userDeposit.token
        );
    }

    // Force withdrawing a deposit as proposed by DAO
    function forceWithdraw(
        address _token,
        address _account
    ) external onlyRole(ADMIN_ROLE) {
        for (uint256 i = 0; i < depositsOf[_account].length; i++) {
            Deposit memory userDeposit = depositsOf[_account][i];
            if (userDeposit.token == _token && userDeposit.cancelled == true) {
                uint256 fees = (userDeposit.amount * userDeposit.fees) / 10000;
                uint256 amount = userDeposit.amount - fees;
                depositsOf[_account][i] = depositsOf[_account][
                    depositsOf[_account].length - 1
                ];
                depositsOf[_account].pop();
                _burn(_account, userDeposit.amount);
                IERC20(userDeposit.token).safeTransfer(_treasury, fees);
                IERC20(userDeposit.token).safeTransfer(_account, amount);
                emit Withdrawn(
                    userDeposit.amount,
                    i,
                    _account,
                    _account,
                    userDeposit.token
                );
                break;
            }
        }
    }

    function cancelDeposit(
        address _token,
        address _account,
        uint16 _fees
    ) external onlyRole(GOV_ROLE) {
        for (uint256 i = 0; i < depositsOf[_account].length; i++) {
            Deposit storage userDeposit = depositsOf[_account][i];
            // Leave out the cancelled == false check to allow for fees adjustment
            if (userDeposit.token == _token) {
                userDeposit.cancelled = true;
                userDeposit.fees = _fees;
                emit Cancelled(_account, _token, _fees);
                break;
            }
        }
    }

    function getTotalDeposit(address _account) public view returns (uint256) {
        uint256 total;
        for (uint256 i = 0; i < depositsOf[_account].length; i++) {
            total += depositsOf[_account][i].amount;
        }

        return total;
    }

    function getDepositsOf(
        address _account
    ) public view returns (Deposit[] memory) {
        return depositsOf[_account];
    }

    function getDepositsOfLength(
        address _account
    ) public view returns (uint256) {
        return depositsOf[_account].length;
    }

    function adjustPositionStaking() external onlyRole(ADMIN_ROLE) {
        isAllowPositionStaking = !isAllowPositionStaking;
    }

    function adjustDeposits() external onlyRole(ADMIN_ROLE) {
        isAllowDeposits = !isAllowDeposits;
    }

    function adjustAdminUnlock() external onlyRole(ADMIN_ROLE) {
        isAdminUnlock = !isAdminUnlock;
    }

    function adjustTreasury(address treasury_) external onlyRole(ADMIN_ROLE) {
        _treasury = treasury_;
    }
}
