// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC1155Votes.sol";
import {Time} from "@openzeppelin/contracts/utils/types/Time.sol";

/// @notice A generic interface for a contract which properly accepts ERC1155 tokens.
/// @author Modified from ERC1155V (https://github.com/kalidao/ERC1155V/blob/main/src/ERC1155V.sol)
abstract contract ERC1155TokenReceiver {
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external payable virtual returns (bytes4) {
        return ERC1155TokenReceiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external payable virtual returns (bytes4) {
        return ERC1155TokenReceiver.onERC1155BatchReceived.selector;
    }
}

abstract contract ERC1155V is IERC1155Votes {
    /// -----------------------------------------------------------------------
    /// Events
    /// -----------------------------------------------------------------------

    event SupplyChanged(
        uint256 indexed id,
        uint256 previousBalance,
        uint256 newBalance
    );

    /// -----------------------------------------------------------------------
    /// Custom Errors
    /// -----------------------------------------------------------------------

    error LengthMismatch();

    error NotAuthorized();

    error UnsafeRecipient();

    error InvalidRecipient();

    error Undetermined();

    error Overflow();

    /// -----------------------------------------------------------------------
    /// ERC1155 Storage
    /// -----------------------------------------------------------------------

    mapping(address => mapping(uint256 => uint256)) public balanceOf;

    mapping(address => mapping(address => bool)) public isApprovedForAll;

    /// -----------------------------------------------------------------------
    /// Voting Storage
    /// -----------------------------------------------------------------------

    mapping(uint256 => uint256) public totalSupply;

    mapping(address => mapping(uint256 => address)) internal _delegates;

    mapping(address => mapping(uint256 => uint256)) public numCheckpoints;

    mapping(address => mapping(uint256 => mapping(uint256 => Checkpoint)))
        public checkpoints;

    mapping(uint256 => uint256) public numSupplyCheckpoints;

    mapping(uint256 => mapping(uint256 => Checkpoint)) public supplyCheckpoints;

    struct Checkpoint {
        uint40 fromTimestamp;
        uint216 amount;
    }

    /// -----------------------------------------------------------------------
    /// Metadata Logic
    /// -----------------------------------------------------------------------

    function uri(uint256 id) public view virtual returns (string memory);

    /// -----------------------------------------------------------------------
    /// ERC165 Logic
    /// -----------------------------------------------------------------------

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165 interface ID for ERC165.
            interfaceId == 0xd9b67a26 || // ERC165 interface ID for ERC1155.
            interfaceId == 0x0e89341c; // ERC165 interface ID for ERC1155MetadataURI.
    }

    /// -----------------------------------------------------------------------
    /// ERC1155 Logic
    /// -----------------------------------------------------------------------

    function balanceOfBatch(
        address[] calldata owners,
        uint256[] calldata ids
    ) public view virtual returns (uint256[] memory balances) {
        if (owners.length != ids.length) revert LengthMismatch();

        balances = new uint256[](owners.length);

        for (uint256 i; i < owners.length; ) {
            balances[i] = balanceOf[owners[i]][ids[i]];

            // Unchecked because the only math done is incrementing
            // the array index counter which cannot possibly overflow.
            unchecked {
                ++i;
            }
        }
    }

    function setApprovalForAll(
        address operator,
        bool approved
    ) public payable virtual {
        isApprovedForAll[msg.sender][operator] = approved;

        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes calldata data
    ) public payable virtual {
        if (msg.sender != from && !isApprovedForAll[from][msg.sender])
            revert NotAuthorized();

        balanceOf[from][id] -= amount;

        // Cannot overflow because the sum of all user
        // balances can't exceed the max uint256 value.
        unchecked {
            balanceOf[to][id] += amount;
        }

        emit TransferSingle(msg.sender, from, to, id, amount);

        if (to.code.length != 0) {
            if (
                ERC1155TokenReceiver(to).onERC1155Received(
                    msg.sender,
                    from,
                    id,
                    amount,
                    data
                ) != ERC1155TokenReceiver.onERC1155Received.selector
            ) {
                revert UnsafeRecipient();
            }
        } else {
            if (to == address(0)) {
                revert InvalidRecipient();
            }
        }

        _moveDelegates(delegates(from, id), delegates(to, id), id, amount);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) public payable virtual {
        if (ids.length != amounts.length) revert LengthMismatch();

        if (msg.sender != from && !isApprovedForAll[from][msg.sender])
            revert NotAuthorized();

        // Storing these outside the loop saves ~15 gas per iteration.
        uint256 id;
        uint256 amount;

        for (uint256 i; i < ids.length; ) {
            id = ids[i];
            amount = amounts[i];

            balanceOf[from][id] -= amount;

            // Cannot overflow because the sum of all user
            // balances can't exceed the max uint256 value.
            unchecked {
                balanceOf[to][id] += amount;
            }

            _moveDelegates(delegates(from, id), delegates(to, id), id, amount);

            // An array can't have a total length
            // larger than the max uint256 value.
            unchecked {
                ++i;
            }
        }

        emit TransferBatch(msg.sender, from, to, ids, amounts);

        if (to.code.length != 0) {
            if (
                ERC1155TokenReceiver(to).onERC1155BatchReceived(
                    msg.sender,
                    from,
                    ids,
                    amounts,
                    data
                ) != ERC1155TokenReceiver.onERC1155BatchReceived.selector
            ) {
                revert UnsafeRecipient();
            }
        } else if (to == address(0)) {
            revert InvalidRecipient();
        }
    }

    /// -----------------------------------------------------------------------
    /// Voting Logic
    /// -----------------------------------------------------------------------

    function delegates(
        address account,
        uint256 id
    ) public view virtual returns (address) {
        address current = _delegates[account][id];

        return current == address(0) ? account : current;
    }

    function getVotes(
        address account,
        uint256 id
    ) public view virtual returns (uint256) {
        // Won't underflow because decrement only occurs if positive `nCheckpoints`.
        unchecked {
            uint256 nCheckpoints = numCheckpoints[account][id];

            return
                nCheckpoints != 0
                    ? checkpoints[account][id][nCheckpoints - 1].amount
                    : 0;
        }
    }

    function getPastVotes(
        address account,
        uint256 id,
        uint256 timestamp
    ) public view virtual returns (uint256) {
        if (block.timestamp <= timestamp) revert Undetermined();

        uint256 nCheckpoints = numCheckpoints[account][id];

        if (nCheckpoints == 0) return 0;

        // Won't underflow because decrement only occurs if positive `nCheckpoints`.
        unchecked {
            uint256 prevCheckpoint = nCheckpoints - 1;

            if (
                checkpoints[account][id][prevCheckpoint].fromTimestamp <=
                timestamp
            ) return checkpoints[account][id][prevCheckpoint].amount;

            if (checkpoints[account][id][0].fromTimestamp > timestamp) return 0;

            uint256 lower;

            uint256 upper = prevCheckpoint;

            while (upper > lower) {
                uint256 center = upper - (upper - lower) / 2;

                Checkpoint memory cp = checkpoints[account][id][center];

                if (cp.fromTimestamp == timestamp) {
                    return cp.amount;
                } else if (cp.fromTimestamp < timestamp) {
                    lower = center;
                } else {
                    upper = center - 1;
                }
            }

            return checkpoints[account][id][lower].amount;
        }
    }

    function getPastTotalSupply(
        uint256 id,
        uint256 timestamp
    ) public view returns (uint256) {
        if (block.timestamp <= timestamp) revert Undetermined();

        uint256 nCheckpoints = numSupplyCheckpoints[id];

        if (nCheckpoints == 0) return 0;

        // Won't underflow because decrement only occurs if positive `nCheckpoints`.
        unchecked {
            uint256 prevCheckpoint = nCheckpoints - 1;

            if (
                supplyCheckpoints[id][prevCheckpoint].fromTimestamp <= timestamp
            ) return supplyCheckpoints[id][prevCheckpoint].amount;

            if (supplyCheckpoints[id][0].fromTimestamp > timestamp) return 0;

            uint256 lower;

            uint256 upper = prevCheckpoint;

            while (upper > lower) {
                uint256 center = upper - (upper - lower) / 2;

                Checkpoint memory cp = supplyCheckpoints[id][center];

                if (cp.fromTimestamp == timestamp) {
                    return cp.amount;
                } else if (cp.fromTimestamp < timestamp) {
                    lower = center;
                } else {
                    upper = center - 1;
                }
            }

            return supplyCheckpoints[id][lower].amount;
        }
    }

    function delegate(address delegatee, uint256 id) public virtual {
        _delegate(msg.sender, delegatee, id);
    }

    function _delegate(address delegator, address delegatee, uint256 id) internal {
        address currentDelegate = delegates(delegator, id);

        _delegates[delegator][id] = delegatee;

        emit DelegateChanged(delegator, currentDelegate, delegatee, id);

        _moveDelegates(
            currentDelegate,
            delegatee,
            id,
            balanceOf[delegator][id]
        );
    }

    function _moveDelegates(
        address srcRep,
        address dstRep,
        uint256 id,
        uint256 amount
    ) internal virtual {
        if (srcRep != dstRep && amount != 0) {
            if (srcRep != address(0)) {
                uint256 srcRepNum = numCheckpoints[srcRep][id];

                uint256 srcRepOld;

                // Won't underflow because decrement only occurs if positive `srcRepNum`.
                unchecked {
                    srcRepOld = srcRepNum != 0
                        ? checkpoints[srcRep][id][srcRepNum - 1].amount
                        : 0;
                }

                _writeCheckpoint(
                    srcRep,
                    id,
                    srcRepNum,
                    srcRepOld,
                    srcRepOld - amount
                );
            }

            if (dstRep != address(0)) {
                uint256 dstRepNum = numCheckpoints[dstRep][id];

                uint256 dstRepOld;

                // Won't underflow because decrement only occurs if positive `dstRepNum`.
                unchecked {
                    dstRepOld = dstRepNum != 0
                        ? checkpoints[dstRep][id][dstRepNum - 1].amount
                        : 0;
                }

                _writeCheckpoint(
                    dstRep,
                    id,
                    dstRepNum,
                    dstRepOld,
                    dstRepOld + amount
                );
            }
        }
    }

    function _writeSupplyCheckpoint(
        uint256 id,
        uint256 nCheckpoints,
        uint256 oldAmount,
        uint256 newAmount
    ) internal virtual {
        // Won't underflow because decrement only occurs if positive `nCheckpoints`.
        unchecked {
            if (
                nCheckpoints != 0 &&
                supplyCheckpoints[id][nCheckpoints - 1].fromTimestamp ==
                block.timestamp
            ) {
                supplyCheckpoints[id][nCheckpoints - 1].amount = _safeCastTo216(
                    newAmount
                );
            } else {
                supplyCheckpoints[id][nCheckpoints] = Checkpoint(
                    _safeCastTo40(block.timestamp),
                    _safeCastTo216(newAmount)
                );

                // Won't realistically overflow.
                ++numSupplyCheckpoints[id];
            }
        }

        emit SupplyChanged(id, oldAmount, newAmount);
    }

    function _writeCheckpoint(
        address delegatee,
        uint256 id,
        uint256 nCheckpoints,
        uint256 oldVotes,
        uint256 newVotes
    ) internal virtual {
        // Won't underflow because decrement only occurs if positive `nCheckpoints`.
        unchecked {
            if (
                nCheckpoints != 0 &&
                checkpoints[delegatee][id][nCheckpoints - 1].fromTimestamp ==
                block.timestamp
            ) {
                checkpoints[delegatee][id][nCheckpoints - 1]
                    .amount = _safeCastTo216(newVotes);
            } else {
                checkpoints[delegatee][id][nCheckpoints] = Checkpoint(
                    _safeCastTo40(block.timestamp),
                    _safeCastTo216(newVotes)
                );

                // Won't realistically overflow.
                ++numCheckpoints[delegatee][id];
            }
        }

        emit DelegateVotesChanged(delegatee, id, oldVotes, newVotes);
    }

    function _safeCastTo40(uint256 x) internal pure virtual returns (uint40 y) {
        if (x >= (1 << 40)) revert Overflow();

        y = uint40(x);
    }

    function _safeCastTo216(
        uint256 x
    ) internal pure virtual returns (uint216 y) {
        if (x >= (1 << 216)) revert Overflow();

        y = uint216(x);
    }

    /// -----------------------------------------------------------------------
    /// Internal ID Logic
    /// -----------------------------------------------------------------------

    function _mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes calldata data
    ) internal virtual {
        _safeCastTo216(totalSupply[id] += amount);

        // Cannot overflow because the sum of all user
        // balances can't exceed the max uint256 value.
        unchecked {
            balanceOf[to][id] += amount;
        }

        emit TransferSingle(msg.sender, address(0), to, id, amount);

        if (to.code.length != 0) {
            if (
                ERC1155TokenReceiver(to).onERC1155Received(
                    msg.sender,
                    address(0),
                    id,
                    amount,
                    data
                ) != ERC1155TokenReceiver.onERC1155Received.selector
            ) {
                revert UnsafeRecipient();
            }
        } else if (to == address(0)) {
            revert InvalidRecipient();
        }

        _moveDelegates(address(0), delegates(to, id), id, amount);

        uint256 nCheckpoints = numSupplyCheckpoints[id];

        uint256 oldAmount;

        // Won't underflow because decrement only occurs if positive `nCheckpoints`.
        unchecked {
            oldAmount = nCheckpoints != 0
                ? supplyCheckpoints[id][nCheckpoints - 1].amount
                : 0;
        }
        _writeSupplyCheckpoint(id, nCheckpoints, oldAmount, oldAmount + amount);
    }

    function _burn(address from, uint256 id, uint256 amount) internal virtual {
        balanceOf[from][id] -= amount;

        // Cannot underflow because a user's balance
        // will never be larger than the total supply.
        unchecked {
            totalSupply[id] -= amount;
        }

        emit TransferSingle(msg.sender, from, address(0), id, amount);

        _moveDelegates(delegates(from, id), address(0), id, amount);

        uint256 nCheckpoints = numSupplyCheckpoints[id];

        uint256 oldAmount;

        // Won't underflow because decrement only occurs if positive `nCheckpoints`.
        unchecked {
            oldAmount = nCheckpoints != 0
                ? supplyCheckpoints[id][nCheckpoints - 1].amount
                : 0;
        }
        _writeSupplyCheckpoint(id, nCheckpoints, oldAmount, oldAmount - amount);
    }
}
