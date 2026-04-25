// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ============================================================================
// LaunchpadFactory — single entry point for deploying any AgentFlow token
// or token-launchpad ecosystem.
//
// MOTIVATION
//   Before Phase 1 the codebase shipped two parallel launchpad stacks:
//
//     A. virtuals-style fork (Bonding + FFactory + FRouter + FERC20) —
//        x*y=k bonding curve with PancakeSwap V2 graduation.
//     B. dPNM-style closed system (FlowProtocol + Flow + GWT + Tree) —
//        100% USDT-backed token, 3x10 placement tree, daily limits.
//
//   Each had its own ad-hoc deploy script. We unify them behind one
//   factory so:
//     * any future token (agentic memecoin, AI-generated contract,
//       new dPNM-style fork) just registers a new template;
//     * the on-chain registry is the source of truth for what a "token
//       launch" means in this protocol;
//     * users deploy via a single canonical entry point —
//       `factory.launch(templateId, encodedParams)`.
//
// ARCHITECTURE
//
//                ┌──────────────────────────────────┐
//   register --> │  LaunchpadFactory (UUPS proxy)   │
//                │                                  │
//   launch  -->  │  templates[id] = TemplateInfo {  │
//                │      implementation,             │
//                │      initSelector,               │
//                │      paused                      │
//                │  }                               │
//                └──────────────┬───────────────────┘
//                               │ Clones.cloneDeterministic
//                               ▼
//                        ┌──────────────┐
//                        │   instance   │ <- minimal proxy
//                        └──────────────┘
//                               │ initSelector(encodedParams)
//                               ▼
//                          template-specific
//                          orchestrator logic
//
//   * Template implementations are stand-alone Initializable contracts.
//     The factory does NOT prescribe their internal layout — it simply
//     clones them and forwards the init call. This means a future
//     "ai-custom" template could deploy a single ERC20, a full
//     bonding curve cluster, or an entirely novel construct, without
//     touching the factory.
//
// SECURITY
//   * UUPS upgradeable. ADMIN_ROLE controls registration; UPGRADER_ROLE
//     controls factory upgrades. Both granted to the initial admin.
//   * `registerTemplate` is one-way for a given id (no overwrite). To
//     replace a template, register under a new id and pause the old one.
//   * Optional `creationFee` (denominated in native gas-token) routed to
//     `feeRecipient`. Fee is forwarded post-clone, never held by the
//     factory beyond the call.
//   * Per-template pause flag (`pauseTemplate`) lets admin disable a
//     template without rotating ids.
// ============================================================================

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

contract LaunchpadFactory is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    // ------------------------------------------------------------------
    // Roles
    // ------------------------------------------------------------------
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    struct TemplateInfo {
        address implementation;
        bytes4 initSelector;
        bool registered;
        bool paused;
    }

    mapping(bytes32 => TemplateInfo) public templates;
    bytes32[] public templateIds;

    /// @notice Native-gas creation fee taken on every `launch`. 0 disables.
    uint256 public creationFee;
    address public feeRecipient;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event TemplateRegistered(
        bytes32 indexed id,
        address indexed implementation,
        bytes4 initSelector
    );
    event TemplatePaused(bytes32 indexed id, bool paused);
    event Launched(
        bytes32 indexed id,
        address indexed instance,
        address indexed deployer,
        bytes32 salt,
        bytes params
    );
    event CreationFeeUpdated(uint256 fee, address recipient);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error ZeroAddress();
    error TemplateAlreadyRegistered();
    error TemplateNotRegistered();
    error TemplatePausedErr();
    error InsufficientFee();
    error InitFailed();
    error FeeRefundFailed();
    error FeeForwardFailed();

    // ------------------------------------------------------------------
    // Initializer
    // ------------------------------------------------------------------
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        feeRecipient = admin;
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    /// @notice Register a new template. `id` is canonical (e.g.
    ///         `keccak256("dpnm")`, `keccak256("virtuals")`). Each id is
    ///         write-once — to replace, register under a new id and pause
    ///         the old one.
    function registerTemplate(
        bytes32 id,
        address implementation,
        bytes4 initSelector
    ) external onlyRole(ADMIN_ROLE) {
        if (implementation == address(0)) revert ZeroAddress();
        if (templates[id].registered) revert TemplateAlreadyRegistered();
        templates[id] = TemplateInfo({
            implementation: implementation,
            initSelector: initSelector,
            registered: true,
            paused: false
        });
        templateIds.push(id);
        emit TemplateRegistered(id, implementation, initSelector);
    }

    function pauseTemplate(bytes32 id, bool paused)
        external
        onlyRole(ADMIN_ROLE)
    {
        TemplateInfo storage t = templates[id];
        if (!t.registered) revert TemplateNotRegistered();
        t.paused = paused;
        emit TemplatePaused(id, paused);
    }

    function setCreationFee(uint256 fee, address recipient)
        external
        onlyRole(ADMIN_ROLE)
    {
        if (recipient == address(0)) revert ZeroAddress();
        creationFee = fee;
        feeRecipient = recipient;
        emit CreationFeeUpdated(fee, recipient);
    }

    // ------------------------------------------------------------------
    // Launch
    // ------------------------------------------------------------------

    /// @notice Clone a template and initialize it with `encodedParams`.
    /// @param  id           template id (e.g. `keccak256("dpnm")`)
    /// @param  encodedParams ABI-encoded args matching the template's
    ///                      `initSelector` calldata layout.
    /// @param  salt         caller-provided uniqueness seed. Combined with
    ///                      `msg.sender` so the same salt is safe across
    ///                      different deployers.
    /// @return instance     address of the freshly cloned & initialized
    ///                      template.
    function launch(
        bytes32 id,
        bytes calldata encodedParams,
        bytes32 salt
    ) external payable returns (address instance) {
        TemplateInfo memory t = templates[id];
        if (!t.registered) revert TemplateNotRegistered();
        if (t.paused) revert TemplatePausedErr();
        if (msg.value < creationFee) revert InsufficientFee();

        bytes32 finalSalt = keccak256(abi.encode(msg.sender, salt));
        instance = Clones.cloneDeterministic(t.implementation, finalSalt);

        // Call init via low-level so we can pass the selector+params
        // exactly as ABI-encoded by the caller.
        (bool ok, bytes memory ret) = instance.call(
            bytes.concat(t.initSelector, encodedParams)
        );
        if (!ok) {
            // Bubble revert reason where possible.
            if (ret.length > 0) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
            revert InitFailed();
        }

        emit Launched(id, instance, msg.sender, finalSalt, encodedParams);

        // Forward fee.
        if (creationFee > 0) {
            (bool sent,) = feeRecipient.call{value: creationFee}("");
            if (!sent) revert FeeForwardFailed();
        }
        // Refund any over-payment.
        if (msg.value > creationFee) {
            (bool refunded,) = msg.sender.call{value: msg.value - creationFee}("");
            if (!refunded) revert FeeRefundFailed();
        }
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getTemplate(bytes32 id)
        external
        view
        returns (TemplateInfo memory)
    {
        return templates[id];
    }

    function templateCount() external view returns (uint256) {
        return templateIds.length;
    }

    /// @notice Predict the address of a future `launch` call. Mirrors the
    ///         salt-derivation logic in `launch`.
    function predictAddress(
        bytes32 id,
        address deployer,
        bytes32 salt
    ) external view returns (address) {
        TemplateInfo memory t = templates[id];
        if (!t.registered) revert TemplateNotRegistered();
        bytes32 finalSalt = keccak256(abi.encode(deployer, salt));
        return Clones.predictDeterministicAddress(
            t.implementation,
            finalSalt,
            address(this)
        );
    }

    // ------------------------------------------------------------------
    // UUPS
    // ------------------------------------------------------------------
    function _authorizeUpgrade(address)
        internal
        view
        override
        onlyRole(UPGRADER_ROLE)
    {}
}
