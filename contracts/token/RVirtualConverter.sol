// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Open, permissionless 1:1 converter from VIRTUAL to rVirtual.
///
/// Pre-funded with the full rVirtual supply before launch - conversions draw down that
/// balance rather than minting on demand. Any caller (a regular wallet, or veVirtual's
/// convertVeVirtualToRVirtual()) uses the exact same convertVirtualToRVirtual() entrypoint;
/// there is no privileged "veVirtual-only" path here.
contract RVirtualConverter is
    Initializable,
    ReentrancyGuardUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public virtualToken;
    address public rVirtualToken;
    address public adminWallet;

    event ConvertedVirtualToRVirtual(
        address indexed caller,
        address indexed rVirtualReceiver,
        uint256 amount
    );
    event AdminWalletUpdated(address adminWallet);
    event VirtualWithdrawn(address adminWallet, uint256 amount);

    function initialize(
        address virtualToken_,
        address rVirtualToken_
    ) external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        require(virtualToken_ != address(0), "Invalid virtual token");
        require(rVirtualToken_ != address(0), "Invalid rVirtual token");
        // NOTE (audit M-02): the 1:1 conversion below is a raw-integer transfer with no
        // decimals rescaling. This is safe only because VIRTUAL and rVirtual are both
        // guaranteed by protocol design to use 18 decimals - if either token is ever
        // redeployed/migrated to a different decimals value, this invariant must be
        // re-verified (or an explicit decimals() equivalence check added) before wiring
        // it in here.
        virtualToken = virtualToken_;
        rVirtualToken = rVirtualToken_;

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
    }

    /// @notice Convert `amount` VIRTUAL (pulled from the caller) into `amount` rVirtual,
    ///         sent to `rVirtualReceiver`. Fully open - no allowlist, no cap.
    function convertVirtualToRVirtual(
        uint256 amount,
        address rVirtualReceiver
    ) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(rVirtualReceiver != address(0), "Invalid receiver");

        IERC20(virtualToken).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );

        uint256 balanceBefore = IERC20(rVirtualToken).balanceOf(rVirtualReceiver);
        IERC20(rVirtualToken).safeTransfer(rVirtualReceiver, amount);
        uint256 delivered = IERC20(rVirtualToken).balanceOf(rVirtualReceiver) - balanceBefore;
        require(delivered == amount, "rVirtual delivery mismatch");

        emit ConvertedVirtualToRVirtual(_msgSender(), rVirtualReceiver, delivered);
    }

    function setAdminWallet(address adminWallet_) external onlyRole(ADMIN_ROLE) {
        require(adminWallet_ != address(0), "Invalid admin wallet");
        adminWallet = adminWallet_;
        emit AdminWalletUpdated(adminWallet_);
    }

    /// @notice Withdraw accumulated VIRTUAL out of this contract. Only VIRTUAL - there is
    ///         intentionally no withdrawal path for rVirtual or any other token here, so
    ///         adminWallet is never exposed to rVirtual's transfer tax.
    function withdrawVirtual(uint256 amount) external nonReentrant {
        require(_msgSender() == adminWallet, "Only admin wallet");
        IERC20(virtualToken).safeTransfer(adminWallet, amount);
        emit VirtualWithdrawn(adminWallet, amount);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(ADMIN_ROLE) {}
}
