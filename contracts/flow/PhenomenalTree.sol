// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ----------------------------------------------------------------------------
// PhenomenalTree — 3-branch x 10-level placement tree (88,572 positions
// per root: 3^1 + 3^2 + ... + 3^10 = (3^11 - 3) / 2 = 88,572).
//
// Every active user is a node with up to 3 children. New users referred
// by `R` are placed under R if R has a free child slot; otherwise the
// new user spills over into R's lightest subtree (the child branch with
// the smallest descendant count) and the search recurses up to the
// 10-level depth cap.
//
// Reward distribution walks UP from the payer's parent for 10 levels.
// At each level, the contract pays the level-table amount in USDT to the
// ancestor IF (a) ancestor exists AND (b) ancestor is active. Otherwise
// the share is treated as "dust" and returned to the caller for treasury
// routing. The protocol contract performs the actual USDT transfers —
// PhenomenalTree only computes the per-recipient amounts and emits
// events, then returns aggregate (paid, dust). USDT transfers happen in
// FlowProtocol via `_payAncestor` callback through `payRewards`.
//
// To keep this contract focused on placement & accounting only, USDT is
// NOT held by the tree. Instead `payTreeReward` returns a per-ancestor
// distribution list via the `Reward` event so the protocol can settle.
// However, for atomicity and gas, we adopt a pull-from-protocol model:
// the protocol calls `payTreeReward(payer, amount)`; the tree emits
// `Payout` events and returns (paid, dust); the protocol then transfers
// `paid` to a designated `rewardSink` address (set by the protocol)
// after iterating the same ancestor walk in its own loop. To avoid
// double iteration, the protocol uses `getAncestors` once and applies
// the level table itself for the actual transfers.
//
// SECURITY:
//   * `placeUser`, `setActiveUntil`, `payTreeReward`, `payBuyTreeReward`
//     are restricted to TREE_OPERATOR_ROLE (granted to FlowProtocol).
//   * Spillover BFS depth is bounded by `MAX_DEPTH = 10`. Each iteration
//     descends one level, so worst-case work is 10 hops.
//   * Self-referral (`user == referrer`) reverts.
//   * Re-placement of the same user reverts.
// ----------------------------------------------------------------------------

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./interfaces/IPhenomenalTree.sol";

contract PhenomenalTree is Initializable, AccessControlUpgradeable, IPhenomenalTree {
    bytes32 public constant TREE_OPERATOR_ROLE = keccak256("TREE_OPERATOR_ROLE");

    uint256 public constant MAX_DEPTH = 10;
    uint256 public constant BRANCHES = 3;

    // Level rewards (1..10) in 18-decimal USDT units. Sum = 5 USDT.
    // L1 .. L3 = 0.1 ; L4 .. L6 = 0.5 ; L7 .. L10 = 0.8.
    uint256 public constant LEVEL_TOTAL = 5e18;

    struct Position {
        address parent;
        address[BRANCHES] children;
        uint256 depth;          // 0 = root, 1..10 = placed user
        uint256 subtreeSize;    // descendants under this node (used for spillover heuristic)
        uint256 activeUntil;    // unix ts; 0 = never active
        bool placed;
    }

    /// @notice Root sentinel — every chain bottoms out here. The protocol
    ///         passes its `treeRoot` (any address it owns) at initialize.
    ///         No longer `immutable` to support EIP-1167 minimal-proxy clones
    ///         (clones must derive all state from `initialize`, not bytecode).
    address public root;

    mapping(address => Position) private _pos;

    error ZeroAdmin();
    error AlreadyPlaced();
    error ReferrerNotPlaced();
    error SelfReferral();
    error TreeFull();
    error InvalidLevelIndex();
    error RewardMismatch();
    error UnknownPayer();

    event UserPlaced(
        address indexed user,
        address indexed referrer,
        address indexed parent,
        uint256 depth
    );
    event ActiveUntilSet(address indexed user, uint256 activeUntil);
    event RewardPaid(
        address indexed payer,
        address indexed ancestor,
        uint256 levelIndex, // 0..9
        uint256 amount,
        bool active
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address treeRoot) external initializer {
        if (admin == address(0) || treeRoot == address(0)) revert ZeroAdmin();
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        // Bootstrap root at depth 0 with infinite active window.
        Position storage r = _pos[treeRoot];
        r.placed = true;
        r.depth = 0;
        r.activeUntil = type(uint256).max;
        root = treeRoot;
    }

    // ----------------------------------------------------------------
    // Placement
    // ----------------------------------------------------------------

    /// @inheritdoc IPhenomenalTree
    function placeUser(address user, address referrer)
        external
        onlyRole(TREE_OPERATOR_ROLE)
        returns (uint256 depth)
    {
        if (user == address(0)) revert ZeroAdmin();
        if (user == referrer) revert SelfReferral();
        if (_pos[user].placed) revert AlreadyPlaced();

        // If referrer is not the root and not placed yet, fail loudly —
        // referrer must already be in tree.
        address effectiveRef = referrer;
        if (effectiveRef == address(0)) effectiveRef = root;
        if (!_pos[effectiveRef].placed) revert ReferrerNotPlaced();

        // Walk down: at each node try a free child slot; otherwise pick
        // the child branch with the smallest subtree and recurse. Bounded
        // by MAX_DEPTH so worst-case work is ~10 SLOAD/SSTORE hops.
        address parent = effectiveRef;
        for (uint256 step = 0; step < MAX_DEPTH; ++step) {
            Position storage p = _pos[parent];
            if (p.depth >= MAX_DEPTH) revert TreeFull();

            // Try free slot.
            uint256 freeIdx = type(uint256).max;
            uint256 minSize = type(uint256).max;
            uint256 minIdx;
            for (uint256 i = 0; i < BRANCHES; ++i) {
                address child = p.children[i];
                if (child == address(0)) {
                    freeIdx = i;
                    break;
                }
                uint256 sz = _pos[child].subtreeSize;
                if (sz < minSize) {
                    minSize = sz;
                    minIdx = i;
                }
            }

            if (freeIdx != type(uint256).max) {
                // Place here.
                p.children[freeIdx] = user;
                Position storage u = _pos[user];
                u.placed = true;
                u.parent = parent;
                u.depth = p.depth + 1;
                if (u.depth > MAX_DEPTH) revert TreeFull();

                _bumpSubtreeSize(parent);
                emit UserPlaced(user, referrer, parent, u.depth);
                return u.depth;
            }

            // All 3 children present — descend into the lightest subtree.
            // Guard: chosen child must not be at MAX_DEPTH already. If
            // the lightest subtree is saturated, the loop guard at next
            // iteration (`p.depth >= MAX_DEPTH`) trips.
            parent = p.children[minIdx];
        }

        revert TreeFull();
    }

    /// @dev Walk from `node` up to root incrementing each ancestor's
    ///      `subtreeSize` by 1. O(depth) writes; depth is capped at 10.
    function _bumpSubtreeSize(address node) internal {
        address cur = node;
        // Iterate at most MAX_DEPTH + 1 times (parent walk).
        for (uint256 i = 0; i <= MAX_DEPTH; ++i) {
            _pos[cur].subtreeSize += 1;
            address par = _pos[cur].parent;
            if (cur == root || par == address(0)) break;
            cur = par;
        }
    }

    // ----------------------------------------------------------------
    // Activity
    // ----------------------------------------------------------------

    /// @inheritdoc IPhenomenalTree
    function setActiveUntil(address user, uint256 until)
        external
        onlyRole(TREE_OPERATOR_ROLE)
    {
        if (!_pos[user].placed) revert ReferrerNotPlaced(); // reuse: not placed
        _pos[user].activeUntil = until;
        emit ActiveUntilSet(user, until);
    }

    /// @inheritdoc IPhenomenalTree
    function isActive(address user) public view returns (bool) {
        return _pos[user].activeUntil > block.timestamp;
    }

    /// @inheritdoc IPhenomenalTree
    function getDepth(address user) external view returns (uint256) {
        return _pos[user].depth;
    }

    /// @inheritdoc IPhenomenalTree
    function isPlaced(address user) external view returns (bool) {
        return _pos[user].placed;
    }

    /// @inheritdoc IPhenomenalTree
    function getAncestors(address user, uint256 depth)
        public
        view
        returns (address[] memory out)
    {
        if (depth == 0) return new address[](0);
        if (depth > MAX_DEPTH) depth = MAX_DEPTH;

        address[] memory tmp = new address[](depth);
        uint256 n;
        address cur = _pos[user].parent;
        while (cur != address(0) && n < depth) {
            tmp[n++] = cur;
            if (cur == root) break;
            cur = _pos[cur].parent;
        }
        out = new address[](n);
        for (uint256 i = 0; i < n; ++i) out[i] = tmp[i];
    }

    /// @inheritdoc IPhenomenalTree
    function levelReward(uint256 levelIndex) public pure returns (uint256) {
        // Index 0..9 maps to L1..L10.
        if (levelIndex < 3) return 0.1e18;       // L1..L3
        if (levelIndex < 6) return 0.5e18;       // L4..L6
        if (levelIndex < 10) return 0.8e18;      // L7..L10
        revert InvalidLevelIndex();
    }

    // ----------------------------------------------------------------
    // Reward distribution — NOT a state-mutating split.
    //
    // The tree intentionally does NOT hold USDT. FlowProtocol computes
    // the per-ancestor split via `previewRewardWalk` (pure view) and
    // executes the transfers itself in the same atomic call, emitting
    // its own RewardPaid events. The mutating wrappers below exist only
    // so external automations / scripts can verify the split deterministically
    // and so we can emit indexer events from the tree side as a
    // historical record.
    // ----------------------------------------------------------------

    /// @inheritdoc IPhenomenalTree
    /// @dev MUST be called with `totalReward == LEVEL_TOTAL` (5 USDT).
    function payTreeReward(address payer, uint256 totalReward)
        external
        onlyRole(TREE_OPERATOR_ROLE)
        returns (uint256 paid, uint256 dust)
    {
        if (totalReward != LEVEL_TOTAL) revert RewardMismatch();
        if (!_pos[payer].placed) revert UnknownPayer();
        return _walkAndEmit(payer, totalReward, /*scaled=*/ false);
    }

    /// @inheritdoc IPhenomenalTree
    function payBuyTreeReward(address payer, uint256 totalReward)
        external
        onlyRole(TREE_OPERATOR_ROLE)
        returns (uint256 paid, uint256 dust)
    {
        if (totalReward == 0) revert RewardMismatch();
        if (!_pos[payer].placed) revert UnknownPayer();
        return _walkAndEmit(payer, totalReward, /*scaled=*/ true);
    }

    /// @dev Walks from payer's parent for up to 10 levels emitting
    ///      `RewardPaid` events. Returns aggregates so the protocol can
    ///      cross-check against its `previewRewardWalk` settlement.
    function _walkAndEmit(address payer, uint256 totalReward, bool scaled)
        internal
        returns (uint256 paid, uint256 dust)
    {
        uint256 distributedSum;
        address cur = _pos[payer].parent;
        for (uint256 i = 0; i < MAX_DEPTH; ++i) {
            uint256 share = scaled
                ? (totalReward * levelReward(i)) / LEVEL_TOTAL
                : levelReward(i);
            distributedSum += share;

            if (cur == address(0)) {
                dust += share;
                emit RewardPaid(payer, address(0), i, 0, false);
            } else if (cur == root) {
                dust += share;
                emit RewardPaid(payer, root, i, 0, false);
                cur = address(0);
            } else {
                bool active = isActive(cur);
                if (active) {
                    paid += share;
                    emit RewardPaid(payer, cur, i, share, true);
                } else {
                    dust += share;
                    emit RewardPaid(payer, cur, i, 0, false);
                }
                cur = _pos[cur].parent;
            }
        }

        if (scaled && distributedSum < totalReward) {
            dust += (totalReward - distributedSum);
        }
        return (paid, dust);
    }

    // ----------------------------------------------------------------
    // Views for FlowProtocol settlement
    // ----------------------------------------------------------------

    /// @notice Compute the per-ancestor reward split WITHOUT mutating
    ///         state. FlowProtocol calls this to learn (recipient,
    ///         amount) pairs and execute USDT transfers atomically.
    /// @return recipients length-MAX_DEPTH array; address(0) for missing
    ///         or inactive levels.
    /// @return amounts   length-MAX_DEPTH array; share assigned to that
    ///         level. Zero if recipient is missing/inactive.
    /// @return totalPaid sum of `amounts`
    /// @return totalDust totalReward - totalPaid (goes to treasury)
    function previewRewardWalk(address payer, uint256 totalReward, bool scaled)
        external
        view
        returns (
            address[] memory recipients,
            uint256[] memory amounts,
            uint256 totalPaid,
            uint256 totalDust
        )
    {
        recipients = new address[](MAX_DEPTH);
        amounts = new uint256[](MAX_DEPTH);
        if (!_pos[payer].placed) return (recipients, amounts, 0, totalReward);

        uint256 distributedSum;
        address cur = _pos[payer].parent;
        for (uint256 i = 0; i < MAX_DEPTH; ++i) {
            uint256 share = scaled
                ? (totalReward * levelReward(i)) / LEVEL_TOTAL
                : levelReward(i);
            distributedSum += share;

            if (cur == address(0) || cur == root) {
                totalDust += share;
                if (cur == root) cur = address(0);
            } else if (isActive(cur)) {
                recipients[i] = cur;
                amounts[i] = share;
                totalPaid += share;
                cur = _pos[cur].parent;
            } else {
                totalDust += share;
                cur = _pos[cur].parent;
            }
        }

        if (scaled && distributedSum < totalReward) {
            totalDust += (totalReward - distributedSum);
        }
    }

    /// @notice Subtree size view for spillover diagnostics.
    function getSubtreeSize(address user) external view returns (uint256) {
        return _pos[user].subtreeSize;
    }

    /// @notice Active-until timestamp view.
    function activeUntil(address user) external view returns (uint256) {
        return _pos[user].activeUntil;
    }

    /// @notice Direct child at slot `i` (0..2).
    function getChild(address user, uint256 i) external view returns (address) {
        if (i >= BRANCHES) revert InvalidLevelIndex();
        return _pos[user].children[i];
    }

    /// @notice Parent of `user`. address(0) if not placed or is root.
    function getParent(address user) external view returns (address) {
        return _pos[user].parent;
    }
}
