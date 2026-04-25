// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ============================================================================
// VirtualsTemplate — orchestrator for a virtuals-style bonding-curve
// launchpad ecosystem (FFactory + FRouter + Bonding + many FERC20s).
//
// Each clone owns one *trio* (factory, router, bonding) and delegates
// per-token creation to `Bonding.launch(...)`. FERC20s are still spawned
// inside `Bonding` via `new` — they are not clones.
//
//   ┌──────── VirtualsTemplate (clone) ────────┐
//   │                                          │
//   │   ┌──────────┐ ┌──────────┐ ┌──────────┐ │
//   │   │ FFactory │ │  FRouter │ │  Bonding │ │
//   │   │ (clone)  │ │  (clone) │ │  (clone) │ │
//   │   └──────────┘ └──────────┘ └──────────┘ │
//   │           ▲          ▲           ▲       │
//   │           └──── wired roles ─────┘       │
//   └──────────────────────────────────────────┘
//
// Bonding/FFactory/FRouter are already `Initializable` (Virtual-Protocol
// upstream made them upgradeable for their own UUPS deploys), so we can
// clone them directly without any contract changes.
// ============================================================================

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../../fun/FFactory.sol";
import "../../fun/FRouter.sol";
import "../../fun/Bonding.sol";

contract VirtualsTemplate is Initializable, AccessControlUpgradeable {
    bytes32 public constant TEMPLATE_ID = keccak256("virtuals");

    /// @notice Implementation pointers cloned at initialize-time.
    struct Impls {
        address factory;
        address router;
        address bonding;
    }

    struct Ecosystem {
        address factory;
        address router;
        address bonding;
    }

    struct BondingParams {
        uint256 fee;            // bps-style fee (kept as Bonding-native)
        uint256 initialSupply;
        uint256 assetRate;
        uint256 maxTx;
        uint256 gradThreshold;
        address agentFactory;   // upstream "AgentFactoryV3" — may be zero on testnets
    }

    Ecosystem public ecosystem;
    address public admin;
    address public treasury;
    address public assetToken;

    event EcosystemDeployed(
        address indexed admin,
        address factory,
        address router,
        address bonding,
        address assetToken
    );

    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin_,
        address treasury_,
        address assetToken_,
        address feeTo_,
        BondingParams calldata bp,
        Impls calldata impls
    ) external initializer {
        if (
            admin_ == address(0) ||
            treasury_ == address(0) ||
            assetToken_ == address(0) ||
            feeTo_ == address(0) ||
            impls.factory == address(0) ||
            impls.router == address(0) ||
            impls.bonding == address(0)
        ) revert ZeroAddress();

        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);

        admin = admin_;
        treasury = treasury_;
        assetToken = assetToken_;

        // 1. Clone the trio.
        address factoryAddr = Clones.clone(impls.factory);
        address routerAddr = Clones.clone(impls.router);
        address bondingAddr = Clones.clone(impls.bonding);

        // 2. Initialize. Each Initializable contract grants
        //    DEFAULT_ADMIN_ROLE to its initializer (msg.sender == this
        //    template clone), so we can finish wiring before handing
        //    admin to `admin_`.
        FFactory(factoryAddr).initialize(treasury_, /*buyTax*/ 1, /*sellTax*/ 1);
        FRouter(routerAddr).initialize(factoryAddr, assetToken_);
        Bonding(bondingAddr).initialize(
            factoryAddr,
            routerAddr,
            feeTo_,
            bp.fee,
            bp.initialSupply,
            bp.assetRate,
            bp.maxTx,
            bp.agentFactory,
            bp.gradThreshold
        );

        // 3. Wire factory ↔ router. setRouter requires ADMIN_ROLE on
        //    FFactory; grant it to ourselves first.
        bytes32 factoryAdmin = FFactory(factoryAddr).ADMIN_ROLE();
        FFactory(factoryAddr).grantRole(factoryAdmin, address(this));
        FFactory(factoryAddr).setRouter(routerAddr);

        // CREATOR_ROLE on the factory must be granted to whoever creates
        // pairs (the router). Required by FFactory.createPair.
        bytes32 creatorRole = FFactory(factoryAddr).CREATOR_ROLE();
        FFactory(factoryAddr).grantRole(creatorRole, routerAddr);

        // EXECUTOR_ROLE on FRouter must be held by Bonding (Bonding calls
        // router.buy / router.sell on swaps).
        bytes32 routerExecutor = FRouter(routerAddr).EXECUTOR_ROLE();
        FRouter(routerAddr).grantRole(routerExecutor, bondingAddr);

        // 4. Hand admin to `admin_` and renounce the template's bootstrap
        //    role on each sub-contract.
        bytes32 daRole = 0x00; // DEFAULT_ADMIN_ROLE
        FFactory(factoryAddr).grantRole(daRole, admin_);
        FFactory(factoryAddr).renounceRole(daRole, address(this));

        FRouter(routerAddr).grantRole(daRole, admin_);
        FRouter(routerAddr).renounceRole(daRole, address(this));

        // Bonding uses Ownable (single owner), not AccessControl.
        Bonding(bondingAddr).transferOwnership(admin_);

        ecosystem = Ecosystem({
            factory: factoryAddr,
            router: routerAddr,
            bonding: bondingAddr
        });

        emit EcosystemDeployed(admin_, factoryAddr, routerAddr, bondingAddr, assetToken_);
    }

    function factory() external view returns (address) { return ecosystem.factory; }
    function router() external view returns (address) { return ecosystem.router; }
    function bonding() external view returns (address) { return ecosystem.bonding; }
}
