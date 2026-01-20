// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    SafeERC20,
    IERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {ICumulativeMerkleDrop} from "./ICumulativeMerkleDrop.sol";
import "./veVirtual.sol";

contract CumulativeMerkleDrop is Ownable, ICumulativeMerkleDrop {
    using SafeERC20 for IERC20;
    // using MerkleProof for bytes32[];

    // solhint-disable-next-line immutable-vars-naming
    address public immutable override token;
    address public immutable veVirtualContract;

    bytes32 public override merkleRoot;
    mapping(address => uint256) public cumulativeClaimed;

    constructor(
        address token_,
        address veVirtualContract_
    ) Ownable(msg.sender) {
        token = token_;
        veVirtualContract = veVirtualContract_;
    }

    function setMerkleRoot(bytes32 merkleRoot_) external override onlyOwner {
        emit MerkelRootUpdated(merkleRoot, merkleRoot_);
        merkleRoot = merkleRoot_;
    }

    /// @notice Claim tokens and stake them in veVirtual as eco trader lock
    /// @dev Anyone can call this for any account if they have valid merkleProof
    ///      Tokens will be claimed and automatically staked in veVirtual with autoRenew = true
    ///      The tokens should already be in this contract (injected by backend weekly)
    /// @param account The account to claim and stake for
    /// @param cumulativeAmount The cumulative amount the account can claim
    /// @param expectedMerkleRoot The expected merkle root (must match current merkleRoot)
    /// @param merkleProof The merkle proof for the claim
    function claimAndMaxStake(
        address account,
        uint256 cumulativeAmount,
        bytes32 expectedMerkleRoot,
        bytes32[] calldata merkleProof
    ) public {
        if (merkleRoot != expectedMerkleRoot) revert MerkleRootWasUpdated();

        // Verify the merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(account, cumulativeAmount));
        if (!_verifyAsm(merkleProof, expectedMerkleRoot, leaf))
            revert InvalidProof();

        // Mark it claimed
        uint256 preclaimed = cumulativeClaimed[account];
        if (preclaimed >= cumulativeAmount) revert NothingToClaim();
        cumulativeClaimed[account] = cumulativeAmount;

        // Stake the token
        unchecked {
            uint256 amount = cumulativeAmount - preclaimed;
            // Approve veVirtual contract to spend tokens from this contract
            IERC20(token).forceApprove(veVirtualContract, amount);

            // Call ecoTraderStakeFor on veVirtual contract
            // This will transfer tokens from this contract and create an eco lock for the account
            veVirtual(veVirtualContract).ecoTraderStakeFor(account, amount);

            emit Claimed(account, amount);
        }
    }

    function claim(
        address account,
        uint256 cumulativeAmount,
        bytes32 expectedMerkleRoot,
        bytes32[] calldata merkleProof
    ) external override {
        claimAndMaxStake(
            account,
            cumulativeAmount,
            expectedMerkleRoot,
            merkleProof
        );
    }

    // function verify(bytes32[] calldata merkleProof, bytes32 root, bytes32 leaf) public pure returns (bool) {
    //     return merkleProof.verify(root, leaf);
    // }

    function _verifyAsm(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) private pure returns (bool valid) {
        /// @solidity memory-safe-assembly
        assembly {
            // solhint-disable-line no-inline-assembly
            let ptr := proof.offset
            for {
                let end := add(ptr, mul(0x20, proof.length))
            } lt(ptr, end) {
                ptr := add(ptr, 0x20)
            } {
                let node := calldataload(ptr)

                switch lt(leaf, node)
                case 1 {
                    mstore(0x00, leaf)
                    mstore(0x20, node)
                }
                default {
                    mstore(0x00, node)
                    mstore(0x20, leaf)
                }
                leaf := keccak256(0x00, 0x40)
            }

            valid := eq(root, leaf)
        }
    }

    function adminWithdraw(
        address tokenAddress,
        uint256 amount
    ) external onlyOwner {
        IERC20(tokenAddress).safeTransfer(msg.sender, amount);
    }
}
