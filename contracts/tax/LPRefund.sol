// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract LPRefund is Initializable, AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    address public taxToken;

    event TaxRefunded(
        bytes32 indexed txhash,
        address recipient,
        uint256 amount
    );

    mapping(bytes32 txhash => uint256 amount) public refunds;

    error TxHashExists(bytes32 txhash);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address defaultAdmin_,
        address taxToken_
    ) external initializer {
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);
        _grantRole(ADMIN_ROLE, defaultAdmin_);

        taxToken = taxToken_;
    }

    function withdraw(address token) external onlyRole(ADMIN_ROLE) {
        IERC20(token).safeTransfer(
            _msgSender(),
            IERC20(token).balanceOf(address(this))
        );
    }

    function refund(
        address recipient,
        bytes32[] memory txhashes,
        uint256[] memory amounts
    ) public onlyRole(EXECUTOR_ROLE) {
        require(txhashes.length == amounts.length, "Unmatched inputs");
        uint256 total = 0;
        for (uint i = 0; i < txhashes.length; i++) {
            bytes32 txhash = txhashes[i];
            uint256 amount = amounts[i];

            if (refunds[txhash] > 0) {
                revert TxHashExists(txhash);
            }
            refunds[txhash] = amount;
            total += amount;
            emit TaxRefunded(txhash, recipient, amount);
        }

        IERC20(taxToken).safeTransfer(recipient, total);
    }

    function manualRefund(
        bytes32 txhash,
        address recipient,
        uint256 amount
    ) public onlyRole(ADMIN_ROLE) {
        refunds[txhash] += amount;
        IERC20(taxToken).safeTransfer(recipient, amount);
    }
}
