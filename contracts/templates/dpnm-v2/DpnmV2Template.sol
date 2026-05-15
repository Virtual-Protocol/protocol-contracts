// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ============================================================================
// DpnmV2Template — orchestrator for the new dPNM "Growing Token" ecosystem
// (the 6-contract stack in `contracts/dpnm/`). One clone of this template ==
// one tenant's full dPNM-v2 launch. The single `initialize` call:
//
//   1. Clones each of the 6 sub-implementations (EIP-1167).
//   2. Initializes each clone with the template clone as initial admin so it
//      can wire inter-contract roles in the same tx.
//   3. Wires roles:
//        - DPNMToken.MINTER_ROLE         -> protocol
//        - DPNMGrowToken.MINTER_ROLE     -> protocol
//        - DPNMTree.TREE_OPERATOR_ROLE   -> protocol
//        - BuybackPools.POOL_OPERATOR_ROLE -> protocol
//        - Whitelist.LIST_OPERATOR_ROLE  -> admin AND -> protocol
//   4. Seeds the Whitelist with a caller-provided allowlist (capped at 200 to
//      mirror Whitelist.MAX_BATCH).
//   5. Applies the caller's `Params` via DPNMProtocol.setParams (replacing
//      the protocol initializer's defaults).
//   6. Hands DEFAULT_ADMIN_ROLE on every sub-contract to `admin_` and the
//      template renounces all roles. The protocol additionally has PAUSER_ROLE
//      and PARAM_ROLE; both are granted to admin and renounced from self.
//
// After initialize() returns the template clone holds zero privileges on the
// ecosystem — `admin_` is the sole administrator. The template's only
// post-launch role is providing read-back getters for the deployed addresses
// so off-chain code does not need to parse the constructor logs.
//
// Defense-in-depth: every field in `ParamsInit` is bounded against the same
// ranges enforced in DPNMProtocol.setParams, plus extra string-length and
// price bounds the protocol does not check directly. This means an integrator
// calling the template directly (not through LaunchpadFactory) cannot bypass
// the wizard's validation matrix.
// ============================================================================

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../../dpnm/DPNMToken.sol";
import "../../dpnm/DPNMGrowToken.sol";
import "../../dpnm/DPNMTree.sol";
import "../../dpnm/BuybackPools.sol";
import "../../dpnm/Whitelist.sol";
import "../../dpnm/DPNMProtocol.sol";
import "../../dpnm/interfaces/IDPNMToken.sol";
import "../../dpnm/interfaces/IDPNMGrowToken.sol";
import "../../dpnm/interfaces/IDPNMTree.sol";
import "../../dpnm/interfaces/IBuybackPools.sol";
import "../../dpnm/interfaces/IWhitelist.sol";

contract DpnmV2Template is Initializable, AccessControlUpgradeable {
    bytes32 public constant TEMPLATE_ID = keccak256("dpnm-v2");

    /// @notice 6 implementation pointers — handed in at launch so the
    ///         template bytecode does NOT bake them in (each registered
    ///         template stays generic).
    struct ImplsInit {
        address dpnmToken;     // DPNMToken impl
        address gwt;           // DPNMGrowToken impl
        address tree;          // DPNMTree impl
        address buybackPools;  // BuybackPools impl
        address whitelist;     // Whitelist impl
        address protocol;      // DPNMProtocol impl
    }

    /// @notice Mirrors `DPNMProtocol.Params` exactly. We pass it through
    ///         to `setParams` after initialization so the launch lands with
    ///         tenant-specific tunables, not the protocol's default.
    struct ParamsInit {
        uint256 dailyBuyCap;
        uint256 prestartMaxUsers;
        uint256 earnLimitMultBps;
        uint256 extendPaymentPeriod;
        uint256 extendMaxStack;
        bool    earnLimitEnabled;
        bool    isLocked;
    }

    /// @notice Resulting addresses for THIS clone.
    struct Ecosystem {
        address dpnmToken;
        address gwt;
        address tree;
        address buybackPools;
        address whitelist;
        address protocol;
    }

    Ecosystem public ecosystem;
    address public admin;
    address public commissionCollector;
    string public tokenName;
    string public tokenSymbol;
    /// @notice Locked at init. true = GwtJetton clone deployed and cashback
    ///         flows. false = no GwtJetton clone (saves storage + activation
    ///         cost), `protocol.gwt == address(0)`, all GWT-write sites
    ///         no-op. **Permanent — there is no setter.**
    bool public withGwt;

    // ------------------------------------------------------------------
    // Bounds — defense-in-depth, matched against `DPNMProtocol.setParams`
    // and the wizard spec (audit-dpnm/CONSTRUCTOR_SPEC.md §5).
    // ------------------------------------------------------------------
    uint256 public constant ONE_USDT = 1e18;

    uint256 public constant MIN_INITIAL_PRICE       = 1e14;                  // 0.0001 USDT
    uint256 public constant MAX_INITIAL_PRICE       = 100 * ONE_USDT;        // 100 USDT

    uint256 public constant MIN_DAILY_CAP           = 50 * ONE_USDT;         // 50 USDT
    uint256 public constant MAX_DAILY_CAP           = 1_000_000 * ONE_USDT;  // 1M USDT

    uint256 public constant MIN_EARN_LIMIT_MULT_BPS = 20_000;                // 200%
    uint256 public constant MAX_EARN_LIMIT_MULT_BPS = 25_000;                // 250%

    uint256 public constant MIN_EXTEND_PERIOD       = 30 days;
    uint256 public constant MAX_EXTEND_PERIOD       = 60 days;

    uint256 public constant MIN_EXTEND_MAX_STACK    = 90 days;
    uint256 public constant MAX_EXTEND_MAX_STACK    = 180 days;

    uint256 public constant MIN_TOKEN_NAME_LEN      = 1;
    uint256 public constant MAX_TOKEN_NAME_LEN      = 64;
    uint256 public constant MIN_TOKEN_SYMBOL_LEN    = 2;
    uint256 public constant MAX_TOKEN_SYMBOL_LEN    = 11;

    uint256 public constant MAX_WHITELIST_SEED      = 200; // mirrors Whitelist.MAX_BATCH

    event EcosystemDeployedV2(
        address indexed admin,
        address dpnm,
        address gwt,
        address tree,
        address buyback,
        address whitelist,
        address protocol,
        string name,
        string symbol,
        bool withGwt
    );

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error ZeroAddress();
    error EmptyString();
    error TokenNameTooLong();
    error TokenSymbolOutOfRange();
    error GwtNameTooLong();
    error GwtSymbolOutOfRange();
    error InitialPriceOutOfRange();
    error DailyCapOutOfRange();
    error EarnLimitMultBpsOutOfRange();
    error ExtendPaymentPeriodOutOfRange();
    error ExtendMaxStackOutOfRange();
    error WhitelistSeedTooLarge();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ------------------------------------------------------------------
    // Initialize
    // ------------------------------------------------------------------

    /// @notice Stand up a complete dPNM-v2 ecosystem in a single tx.
    /// @dev Selector layout (must match LaunchpadFactory registration):
    ///      initialize(
    ///        address admin,
    ///        address commissionCollector,
    ///        address usdt,
    ///        uint256 initialPrice,
    ///        address treeRoot,
    ///        string  tokenName,
    ///        string  tokenSymbol,
    ///        string  gwtName,
    ///        string  gwtSymbol,
    ///        bool    withGwt,
    ///        (address dpnmToken, address gwt, address tree,
    ///         address buybackPools, address whitelist, address protocol) impls,
    ///        (uint256 dailyBuyCap, uint256 prestartMaxUsers,
    ///         uint256 earnLimitMultBps, uint256 extendPaymentPeriod,
    ///         uint256 extendMaxStack, bool earnLimitEnabled,
    ///         bool isLocked) paramsInit,
    ///        address[] whitelistSeed
    ///      )
    ///
    ///      `withGwt` is the launch-time cashback toggle and is **locked
    ///      forever** once this initializer returns. When false:
    ///        - `impls.gwt` is ignored; no GwtJetton clone is created
    ///          (saves storage + activation cost).
    ///        - `gwtName_` / `gwtSymbol_` are ignored.
    ///        - `protocol.gwt == address(0)` and `protocol.gwtEnabled()`
    ///          returns false. Buy/sell still work; just no cashback.
    function initialize(
        address admin_,
        address commissionCollector_,
        address usdt_,
        uint256 initialPrice_,
        address treeRoot_,
        string calldata tokenName_,
        string calldata tokenSymbol_,
        string calldata gwtName_,
        string calldata gwtSymbol_,
        bool withGwt_,
        ImplsInit calldata impls,
        ParamsInit calldata paramsInit,
        address[] calldata whitelistSeed
    ) external initializer {
        _validateCoreAddresses(admin_, commissionCollector_, usdt_, treeRoot_, impls, withGwt_);
        _validateStrings(tokenName_, tokenSymbol_, gwtName_, gwtSymbol_, withGwt_);
        _validatePrice(initialPrice_);
        _validateParams(paramsInit);
        if (whitelistSeed.length > MAX_WHITELIST_SEED) revert WhitelistSeedTooLarge();

        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);

        admin = admin_;
        commissionCollector = commissionCollector_;
        tokenName = tokenName_;
        tokenSymbol = tokenSymbol_;
        withGwt = withGwt_;

        // 1. Clone each sub-contract. The GWT clone is skipped when the
        //    creator opted out — `e.gwt` stays `address(0)` and the
        //    protocol initializer accepts that as the "no-GWT mode" sentinel.
        Ecosystem memory e = Ecosystem({
            dpnmToken:    Clones.clone(impls.dpnmToken),
            gwt:          withGwt_ ? Clones.clone(impls.gwt) : address(0),
            tree:         Clones.clone(impls.tree),
            buybackPools: Clones.clone(impls.buybackPools),
            whitelist:    Clones.clone(impls.whitelist),
            protocol:     Clones.clone(impls.protocol)
        });
        ecosystem = e;

        // 2-5. Initialize each clone with `self` as bootstrap admin.
        DPNMToken(e.dpnmToken).initialize(address(this), tokenName_, tokenSymbol_);
        if (withGwt_) {
            DPNMGrowToken(e.gwt).initialize(address(this), gwtName_, gwtSymbol_);
        }
        Whitelist(e.whitelist).initialize(address(this));
        DPNMTree(e.tree).initialize(address(this), treeRoot_);
        BuybackPools(e.buybackPools).initialize(address(this));

        // 6. Initialize the protocol — deferred to a helper to dodge the
        //    16-local-slot stack ceiling.
        _initProtocol(e, usdt_, commissionCollector_, initialPrice_);

        // 7. Inter-contract role grants.
        _wireRoles(e, admin_, withGwt_);

        // 8. Whitelist seed.
        if (whitelistSeed.length > 0) {
            Whitelist(e.whitelist).addBatch(whitelistSeed);
        }

        // 9. Apply tenant params, then hand admin off to `admin_` and renounce.
        DPNMProtocol(e.protocol).setParams(DPNMProtocol.Params({
            dailyBuyCap:         paramsInit.dailyBuyCap,
            prestartMaxUsers:    paramsInit.prestartMaxUsers,
            earnLimitMultBps:    paramsInit.earnLimitMultBps,
            extendPaymentPeriod: paramsInit.extendPaymentPeriod,
            extendMaxStack:      paramsInit.extendMaxStack,
            earnLimitEnabled:    paramsInit.earnLimitEnabled,
            isLocked:            paramsInit.isLocked
        }));

        _handOffAdmin(e, admin_, withGwt_);

        emit EcosystemDeployedV2(
            admin_,
            e.dpnmToken,
            e.gwt,
            e.tree,
            e.buybackPools,
            e.whitelist,
            e.protocol,
            tokenName_,
            tokenSymbol_,
            withGwt_
        );
    }

    // ------------------------------------------------------------------
    // Validators
    // ------------------------------------------------------------------

    function _validateCoreAddresses(
        address admin_,
        address collector_,
        address usdt_,
        address treeRoot_,
        ImplsInit calldata impls,
        bool withGwt_
    ) internal pure {
        if (
            admin_ == address(0) ||
            collector_ == address(0) ||
            usdt_ == address(0) ||
            treeRoot_ == address(0) ||
            impls.dpnmToken == address(0) ||
            impls.tree == address(0) ||
            impls.buybackPools == address(0) ||
            impls.whitelist == address(0) ||
            impls.protocol == address(0)
        ) revert ZeroAddress();
        // GWT impl is only required when the cashback toggle is on; in
        // no-GWT mode the field is ignored and may be left zero.
        if (withGwt_ && impls.gwt == address(0)) revert ZeroAddress();
    }

    function _validateStrings(
        string calldata tokenName_,
        string calldata tokenSymbol_,
        string calldata gwtName_,
        string calldata gwtSymbol_,
        bool withGwt_
    ) internal pure {
        uint256 tnLen = bytes(tokenName_).length;
        if (tnLen == 0) revert EmptyString();
        if (tnLen > MAX_TOKEN_NAME_LEN) revert TokenNameTooLong();

        uint256 tsLen = bytes(tokenSymbol_).length;
        if (tsLen < MIN_TOKEN_SYMBOL_LEN || tsLen > MAX_TOKEN_SYMBOL_LEN) {
            revert TokenSymbolOutOfRange();
        }

        // GWT name/symbol are only material when cashback is on. When the
        // creator opted out, callers may pass empty strings — they are
        // ignored.
        if (withGwt_) {
            uint256 gnLen = bytes(gwtName_).length;
            if (gnLen == 0) revert EmptyString();
            if (gnLen > MAX_TOKEN_NAME_LEN) revert GwtNameTooLong();

            uint256 gsLen = bytes(gwtSymbol_).length;
            if (gsLen < MIN_TOKEN_SYMBOL_LEN || gsLen > MAX_TOKEN_SYMBOL_LEN) {
                revert GwtSymbolOutOfRange();
            }
        }
    }

    function _validatePrice(uint256 initialPrice_) internal pure {
        if (initialPrice_ < MIN_INITIAL_PRICE || initialPrice_ > MAX_INITIAL_PRICE) {
            revert InitialPriceOutOfRange();
        }
    }

    function _validateParams(ParamsInit calldata p) internal pure {
        // dailyBuyCap: 0 disables; otherwise [50 .. 1_000_000] USDT.
        if (p.dailyBuyCap != 0) {
            if (p.dailyBuyCap < MIN_DAILY_CAP || p.dailyBuyCap > MAX_DAILY_CAP) {
                revert DailyCapOutOfRange();
            }
        }
        if (
            p.earnLimitMultBps < MIN_EARN_LIMIT_MULT_BPS ||
            p.earnLimitMultBps > MAX_EARN_LIMIT_MULT_BPS
        ) revert EarnLimitMultBpsOutOfRange();
        if (
            p.extendPaymentPeriod < MIN_EXTEND_PERIOD ||
            p.extendPaymentPeriod > MAX_EXTEND_PERIOD
        ) revert ExtendPaymentPeriodOutOfRange();
        if (
            p.extendMaxStack < MIN_EXTEND_MAX_STACK ||
            p.extendMaxStack > MAX_EXTEND_MAX_STACK
        ) revert ExtendMaxStackOutOfRange();
    }

    // ------------------------------------------------------------------
    // Internal wiring helpers
    // ------------------------------------------------------------------

    function _initProtocol(
        Ecosystem memory e,
        address usdt_,
        address commissionCollector_,
        uint256 initialPrice_
    ) internal {
        DPNMProtocol(e.protocol).initialize(DPNMProtocol.InitArgs({
            admin:               address(this),
            usdt:                IERC20(usdt_),
            dpnm:                IDPNMToken(e.dpnmToken),
            gwt:                 IDPNMGrowToken(e.gwt),
            tree:                IDPNMTree(e.tree),
            buybackPools:        IBuybackPools(e.buybackPools),
            whitelist:           IWhitelist(e.whitelist),
            commissionCollector: commissionCollector_,
            initialPrice:        initialPrice_
        }));
    }

    function _wireRoles(Ecosystem memory e, address admin_, bool withGwt_) internal {
        DPNMToken(e.dpnmToken).grantRole(
            DPNMToken(e.dpnmToken).MINTER_ROLE(),
            e.protocol
        );
        if (withGwt_) {
            DPNMGrowToken(e.gwt).grantRole(
                DPNMGrowToken(e.gwt).MINTER_ROLE(),
                e.protocol
            );
        }
        DPNMTree(e.tree).grantRole(
            DPNMTree(e.tree).TREE_OPERATOR_ROLE(),
            e.protocol
        );
        BuybackPools(e.buybackPools).grantRole(
            BuybackPools(e.buybackPools).POOL_OPERATOR_ROLE(),
            e.protocol
        );
        // List operator must be both admin (manual ops) and protocol (so the
        // protocol can — in some future flow — extend the list itself, e.g.
        // referral-based auto-add).
        bytes32 listOp = Whitelist(e.whitelist).LIST_OPERATOR_ROLE();
        Whitelist(e.whitelist).grantRole(listOp, admin_);
        Whitelist(e.whitelist).grantRole(listOp, e.protocol);
    }

    /// @dev Hand DEFAULT_ADMIN_ROLE on every sub-contract to `admin_` and
    ///      renounce all bootstrap roles from the template. After this the
    ///      template clone has zero privileges anywhere in the ecosystem.
    function _handOffAdmin(Ecosystem memory e, address admin_, bool withGwt_) internal {
        bytes32 daRole = DEFAULT_ADMIN_ROLE;

        // dPNM token.
        DPNMToken(e.dpnmToken).grantRole(daRole, admin_);
        DPNMToken(e.dpnmToken).renounceRole(daRole, address(this));

        // GWT — only present when cashback was enabled at launch.
        if (withGwt_) {
            DPNMGrowToken(e.gwt).grantRole(daRole, admin_);
            DPNMGrowToken(e.gwt).renounceRole(daRole, address(this));
        }

        // Tree.
        DPNMTree(e.tree).grantRole(daRole, admin_);
        DPNMTree(e.tree).renounceRole(daRole, address(this));

        // Buyback.
        BuybackPools(e.buybackPools).grantRole(daRole, admin_);
        BuybackPools(e.buybackPools).renounceRole(daRole, address(this));

        // Whitelist — also drop the LIST_OPERATOR_ROLE the template was granted
        // by `Whitelist.initialize` (so the template cannot tamper with the
        // list post-launch).
        bytes32 listOp = Whitelist(e.whitelist).LIST_OPERATOR_ROLE();
        Whitelist(e.whitelist).grantRole(daRole, admin_);
        Whitelist(e.whitelist).renounceRole(listOp, address(this));
        Whitelist(e.whitelist).renounceRole(daRole, address(this));

        // Protocol — DEFAULT_ADMIN_ROLE plus PAUSER_ROLE and PARAM_ROLE.
        DPNMProtocol p = DPNMProtocol(e.protocol);
        bytes32 pauserRole = p.PAUSER_ROLE();
        bytes32 paramRole  = p.PARAM_ROLE();
        p.grantRole(daRole, admin_);
        p.grantRole(pauserRole, admin_);
        p.grantRole(paramRole, admin_);
        p.renounceRole(paramRole, address(this));
        p.renounceRole(pauserRole, address(this));
        p.renounceRole(daRole, address(this));
    }

    // ------------------------------------------------------------------
    // Convenience views
    // ------------------------------------------------------------------

    function dpnmToken() external view returns (address) { return ecosystem.dpnmToken; }
    function gwt() external view returns (address) { return ecosystem.gwt; }
    function tree() external view returns (address) { return ecosystem.tree; }
    function buybackPools() external view returns (address) { return ecosystem.buybackPools; }
    function whitelist() external view returns (address) { return ecosystem.whitelist; }
    function protocol() external view returns (address) { return ecosystem.protocol; }
}
