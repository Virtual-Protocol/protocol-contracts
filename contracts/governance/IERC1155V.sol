// SPDX-License-Identifier: MIT
// Modified from OpenZeppelin Contracts (last updated v5.0.0) (governance/utils/IVotes.sol)
pragma solidity ^0.8.20;

interface IERC1155V {

    error VotesExpiredSignature(uint256 expiry);

    event DelegateChanged(
        address indexed delegator,
        address indexed fromDelegate,
        address indexed toDelegate,
        uint256 id
    );

    event DelegateVotesChanged(
        address indexed delegate,
        uint256 indexed id,
        uint256 previousBalance,
        uint256 newBalance
    );

    event TransferSingle(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256 id,
        uint256 amount
    );

    event TransferBatch(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256[] ids,
        uint256[] amounts
    );

    event ApprovalForAll(
        address indexed owner,
        address indexed operator,
        bool approved
    );

    event TransferabilitySet(
        address indexed operator,
        uint256 indexed id,
        bool set
    );

    event URI(string value, uint256 indexed id);

    /**
     * @dev Returns the current amount of votes that `account` has.
     */
    
    function getVotes(address account, uint256 id) external view returns (uint256);

    /**
     * @dev Returns the amount of votes that `account` had at a specific moment in the past. If the `clock()` is
     * configured to use block numbers, this will return the value at the end of the corresponding block.
     */
    function getPastVotes(
        address account,
        uint256 id,
        uint256 timepoint
    ) external view returns (uint256);

    /**
     * @dev Returns the total supply of votes available at a specific moment in the past. If the `clock()` is
     * configured to use block numbers, this will return the value at the end of the corresponding block.
     *
     * NOTE: This value is the sum of all available votes, which is not necessarily the sum of all delegated votes.
     * Votes that have not been delegated are still part of total supply, even though they would not participate in a
     * vote.
     */
    function getPastTotalSupply(
        uint256 id,
        uint256 timepoint
    ) external view returns (uint256);

    /**
     * @dev Returns the delegate that `account` has chosen.
     */
    function delegates(address account, uint256 id) external view returns (address);

    /**
     * @dev Delegates votes from the sender to `delegatee`.
     */
    function delegate(address delegatee, uint256 id) external;

    // TODO
    // /**
    //  * @dev Delegates votes from signer to `delegatee`.
    //  */
    // function delegateBySig(
    //     address delegatee,
    //     uint256 id,
    //     uint256 nonce,
    //     uint256 expiry,
    //     uint8 v,
    //     bytes32 r,
    //     bytes32 s
    // ) external;
}
