// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ============================================================================
// DpnmTemplate — orchestrator for a closed-system, USDT-backed dPNM-style
// token launch (the $FLOW model).
//
// Each clone of this template owns one *ecosystem*:
//
//   ┌──────────── DpnmTemplate (clone) ────────────┐
//   │                                              │
//   │   ┌──────────┐  ┌──────────┐  ┌──────────┐   │
//   │   │  Flow    │  │  GWT     │  │  Tree    │   │
//   │   │  (clone) │  │  (clone) │  │  (clone) │   │
//   │   └──────────┘  └──────────┘  └──────────┘   │
//   │           ▲           ▲           ▲          │
//   │           └───────────┴───────────┘          │
//   │                       │                       │
//   │              ┌────────┴────────┐              │
//   │              │  FlowProtocol   │              │
//   │              │     (clone)     │ ← MINTER /   │
//   │              └─────────────────┘   TREE_OP    │
//   └──────────────────────────────────────────────┘
//
// At `initialize` time the template:
//   1. Clones each implementation (Flow / GWT / Tree / Protocol).
//   2. Initializes each clone with template-specific params.
//   3. Grants the necessary roles (Flow.MINTER -> Protocol,
//      GWT.MINTER -> Protocol, Tree.TREE_OPERATOR -> Protocol).
//   4. Renounces its own admin on the four sub-contracts to `admin`.
//
// Why clones (not `new`)?
//   The four sub-contracts are themselves `Initializable` with
//   `_disableInitializers()` baked into their constructors. That makes
//   `new` instances unusable. EIP-1167 minimal-proxy clones bypass the
//   constructor entirely, so we get cheap per-launch deployment AND can
//   actually call `initialize`.
// ============================================================================

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../../flow/FlowToken.sol";
import "../../flow/FlowGrowToken.sol";
import "../../flow/PhenomenalTree.sol";
import "../../flow/FlowProtocol.sol";
import "../../flow/interfaces/IFlowToken.sol";
import "../../flow/interfaces/IFlowGrowToken.sol";
import "../../flow/interfaces/IPhenomenalTree.sol";

contract DpnmTemplate is Initializable, AccessControlUpgradeable {
    bytes32 public constant TEMPLATE_ID = keccak256("dpnm");

    /// @notice Implementation contracts cloned by `initialize`. Stored
    ///         per-instance to keep the factory's launch payload self-
    ///         describing (the template doesn't read any external
    ///         registry to know what to clone).
    struct Impls {
        address flow;
        address gwt;
        address tree;
        address protocol;
    }

    /// @notice Live ecosystem addresses for THIS clone.
    struct Ecosystem {
        address flow;
        address gwt;
        address tree;
        address protocol;
    }

    Ecosystem public ecosystem;
    address public admin;
    address public treasury;
    string public ecosystemName;
    string public ecosystemSymbol;

    event EcosystemDeployed(
        address indexed admin,
        address flow,
        address gwt,
        address tree,
        address protocol,
        string name,
        string symbol
    );

    error ZeroAddress();
    error EmptyString();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ------------------------------------------------------------------
    // Initialize
    // ------------------------------------------------------------------

    /// @notice Stand up a complete dPNM ecosystem in a single transaction.
    /// @dev    Selector ABI:
    ///         initialize(
    ///           address admin,
    ///           address treasury,
    ///           address usdt,
    ///           uint256 initialPrice,
    ///           address treeRoot,
    ///           string  ecosystemName,
    ///           string  ecosystemSymbol,
    ///           string  gwtName,
    ///           string  gwtSymbol,
    ///           (address flow, address gwt, address tree, address protocol) impls
    ///         )
    ///         The trailing tuple lets the factory hand-off implementation
    ///         pointers without baking them into the template bytecode.
    function initialize(
        address admin_,
        address treasury_,
        address usdt_,
        uint256 initialPrice_,
        address treeRoot_,
        string calldata ecosystemName_,
        string calldata ecosystemSymbol_,
        string calldata gwtName_,
        string calldata gwtSymbol_,
        Impls calldata impls
    ) external initializer {
        if (
            admin_ == address(0) ||
            treasury_ == address(0) ||
            usdt_ == address(0) ||
            treeRoot_ == address(0) ||
            impls.flow == address(0) ||
            impls.gwt == address(0) ||
            impls.tree == address(0) ||
            impls.protocol == address(0)
        ) revert ZeroAddress();
        if (bytes(ecosystemName_).length == 0 || bytes(ecosystemSymbol_).length == 0) {
            revert EmptyString();
        }

        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);

        admin = admin_;
        treasury = treasury_;
        ecosystemName = ecosystemName_;
        ecosystemSymbol = ecosystemSymbol_;

        // 1. Clone each sub-contract. The DpnmTemplate clone is the
        //    initial admin so it can grant inter-contract roles. After
        //    wiring it transfers admin to `admin_` and renounces itself.
        address flowAddr = Clones.clone(impls.flow);
        address gwtAddr = Clones.clone(impls.gwt);
        address treeAddr = Clones.clone(impls.tree);
        address protocolAddr = Clones.clone(impls.protocol);

        Flow(flowAddr).initialize(address(this), ecosystemName_, ecosystemSymbol_);
        FlowGrowToken(gwtAddr).initialize(address(this), gwtName_, gwtSymbol_);
        PhenomenalTree(treeAddr).initialize(address(this), treeRoot_);
        FlowProtocol(protocolAddr).initialize(
            admin_,
            IERC20(usdt_),
            IFlowToken(flowAddr),
            IFlowGrowToken(gwtAddr),
            IPhenomenalTree(treeAddr),
            treasury_,
            initialPrice_
        );

        // 2. Grant inter-contract roles: Protocol must be able to mint/
        //    burn Flow + GWT and place users in the Tree.
        Flow(flowAddr).grantRole(Flow(flowAddr).MINTER_ROLE(), protocolAddr);
        FlowGrowToken(gwtAddr).grantRole(
            FlowGrowToken(gwtAddr).MINTER_ROLE(),
            protocolAddr
        );
        PhenomenalTree(treeAddr).grantRole(
            PhenomenalTree(treeAddr).TREE_OPERATOR_ROLE(),
            protocolAddr
        );

        // 3. Hand DEFAULT_ADMIN_ROLE on each sub-contract to the supplied
        //    admin and drop the template's bootstrap role. After this
        //    block the template clone has no privileged powers — the
        //    ecosystem belongs to `admin_`.
        bytes32 daRole = 0x00; // DEFAULT_ADMIN_ROLE
        Flow(flowAddr).grantRole(daRole, admin_);
        Flow(flowAddr).renounceRole(daRole, address(this));
        FlowGrowToken(gwtAddr).grantRole(daRole, admin_);
        FlowGrowToken(gwtAddr).renounceRole(daRole, address(this));
        PhenomenalTree(treeAddr).grantRole(daRole, admin_);
        PhenomenalTree(treeAddr).renounceRole(daRole, address(this));

        ecosystem = Ecosystem({
            flow: flowAddr,
            gwt: gwtAddr,
            tree: treeAddr,
            protocol: protocolAddr
        });

        emit EcosystemDeployed(
            admin_,
            flowAddr,
            gwtAddr,
            treeAddr,
            protocolAddr,
            ecosystemName_,
            ecosystemSymbol_
        );
    }

    // ------------------------------------------------------------------
    // Convenience views
    // ------------------------------------------------------------------

    function flow() external view returns (address) { return ecosystem.flow; }
    function gwt() external view returns (address) { return ecosystem.gwt; }
    function tree() external view returns (address) { return ecosystem.tree; }
    function protocol() external view returns (address) { return ecosystem.protocol; }
}
