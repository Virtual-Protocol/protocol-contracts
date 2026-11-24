// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Open, permissionless 1:1 converter from VIRTUAL to agVirt.
///
/// Pre-funded with the full agVirt supply before launch - conversions draw down that
/// balance rather than minting on demand. Any caller (a regular wallet, or veVirtual's
/// convertVeVirtualToAgVirt()) uses the exact same convertVirtualToAgVirt() entrypoint;
/// there is no privileged "veVirtual-only" path here.
contract AgVirtConverter is
    Initializable,
    ReentrancyGuardUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public virtualToken;
    address public agVirtToken;
    /// @notice Treasury multisig that every conversion's incoming VIRTUAL is sent to
    ///         directly. Set once at initialize() and never changed at runtime - VIRTUAL
    ///         is never custodied by this contract, so there is no accumulated balance
    ///         for a compromised or malicious admin key to sweep (see audit L-02). This
    ///         is also why there is no adminWallet/withdrawVirtual() sweep mechanism here
    ///         anymore (see audit I-06) - there is nothing left for it to sweep.
    address public treasury;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    event ConvertedVirtualToAgVirt(
        address indexed caller,
        address indexed agVirtReceiver,
        uint256 amount
    );

    function initialize(
        address virtualToken_,
        address agVirtToken_,
        address treasury_
    ) external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        require(virtualToken_ != address(0), "Invalid virtual token");
        require(agVirtToken_ != address(0), "Invalid agVirt token");
        require(treasury_ != address(0), "Invalid treasury");
        require(virtualToken_ != agVirtToken_, "Tokens must differ");
        // The 1:1 conversion below is a raw-integer transfer with no decimals rescaling -
        // only correct when both tokens use the same decimals (18, by protocol design).
        // Asserted here (audit I-03) rather than left as a comment, since a future
        // deployment of this converter against a different pair would otherwise mis-scale
        // every conversion silently.
        require(
            IERC20Metadata(virtualToken_).decimals() == IERC20Metadata(agVirtToken_).decimals(),
            "Decimals mismatch"
        );
        virtualToken = virtualToken_;
        agVirtToken = agVirtToken_;
        treasury = treasury_;

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
    }

    /// @notice Convert `amount` VIRTUAL (pulled from the caller) into `amount` agVirt,
    ///         sent to `agVirtReceiver`. Fully open - no allowlist, no cap.
    function convertVirtualToAgVirt(
        uint256 amount,
        address agVirtReceiver
    ) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(agVirtReceiver != address(0), "Invalid receiver");

        IERC20(virtualToken).safeTransferFrom(
            _msgSender(),
            treasury,
            amount
        );

        uint256 balanceBefore = IERC20(agVirtToken).balanceOf(agVirtReceiver);
        IERC20(agVirtToken).safeTransfer(agVirtReceiver, amount);
        uint256 delivered = IERC20(agVirtToken).balanceOf(agVirtReceiver) - balanceBefore;
        require(delivered == amount, "agVirt delivery mismatch");

        emit ConvertedVirtualToAgVirt(_msgSender(), agVirtReceiver, delivered);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(ADMIN_ROLE) {}
}
