// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IPhenomenalTree
/// @notice 3-branch x 10-level placement tree. All write methods are
///         restricted to the protocol via TREE_OPERATOR_ROLE. Reward
///         distribution returns the dust (inactive / empty slots) so the
///         protocol can forward it to treasury.
interface IPhenomenalTree {
    /// @notice Place `user` under `referrer`. Spillover applies if the
    ///         referrer's first 3 slots are taken: descend into the
    ///         lightest branch until a free slot is found, bounded by
    ///         the 10-level depth limit.
    /// @return depth depth of `user` after placement (1..10)
    function placeUser(address user, address referrer) external returns (uint256 depth);

    /// @notice Mark `user` active until `until` (>= block.timestamp).
    function setActiveUntil(address user, uint256 until) external;

    /// @notice Distribute the marketing reward (5 USDT split per the
    ///         level table) walking up from `payer`. Returns the amount
    ///         that landed on inactive / missing ancestors so the caller
    ///         (FlowProtocol) can route it to treasury.
    /// @dev    `totalReward` MUST equal sum of the level table (5 USDT
    ///         in the canonical extendTree call). The contract enforces
    ///         a strict equality check.
    /// @return paid amount distributed to active ancestors
    /// @return dust amount that should go to treasury
    function payTreeReward(address payer, uint256 totalReward)
        external
        returns (uint256 paid, uint256 dust);

    /// @notice Distribute a buy reward of `totalReward` (in USDT, 18-dec)
    ///         along the same level proportions as `payTreeReward`. The
    ///         per-level share is `totalReward * levelTable[i] / 5e18`.
    /// @return paid amount distributed
    /// @return dust amount routed to treasury
    function payBuyTreeReward(address buyer, uint256 totalReward)
        external
        returns (uint256 paid, uint256 dust);

    /// @notice True if `user` is active right now (active_until > now).
    function isActive(address user) external view returns (bool);

    /// @notice Depth of `user` (1..10). Returns 0 if not placed.
    function getDepth(address user) external view returns (uint256);

    /// @notice Returns up to `depth` ancestors of `user`, root-first.
    function getAncestors(address user, uint256 depth)
        external
        view
        returns (address[] memory);

    /// @notice True if `user` has been placed in the tree.
    function isPlaced(address user) external view returns (bool);

    /// @notice The amount each level receives in the canonical 5-USDT
    ///         marketing payout. Indexed 0..9 for levels 1..10.
    function levelReward(uint256 levelIndex) external pure returns (uint256);

    /// @notice Pure view: compute the per-ancestor split FlowProtocol
    ///         will execute. Returns recipient/amount arrays of length
    ///         10 (zero-filled for missing/inactive levels) plus the
    ///         total paid and total dust (unreachable shares + rounding).
    function previewRewardWalk(address payer, uint256 totalReward, bool scaled)
        external
        view
        returns (
            address[] memory recipients,
            uint256[] memory amounts,
            uint256 totalPaid,
            uint256 totalDust
        );
}
