// SPDX-License-Identifier: MIT
// This is sample implementation of ATIP to handle selling of tokens/ NFT
pragma solidity ^0.8.20;

abstract contract InteractionLedger {
    struct Memo {
        string content;
        MemoType memoType;
        bool isSecured;
        uint8 nextPhase;
        uint256 jobId;
        address sender;
    }
    uint256 public memoCounter;

    mapping(uint256 memoId => mapping(address signer => uint8 res))
        public signatories;

    enum MemoType {
        MESSAGE,
        CONTEXT_URL,
        IMAGE_URL,
        VOICE_URL,
        OBJECT_URL,
        TXHASH
    }

    mapping(uint256 => Memo) public memos;

    event NewMemo(
        uint256 indexed jobId,
        address indexed sender,
        uint256 memoId
    );
    event MemoSigned(uint256 memoId, bool isApproved, string reason);

    function _createMemo(
        uint256 jobId,
        string memory content,
        MemoType memoType,
        bool isSecured,
        uint8 nextPhase
    ) internal returns (uint256) {
        uint256 newMemoId = ++memoCounter;
        memos[newMemoId] = Memo({
            content: content,
            memoType: memoType,
            isSecured: isSecured,
            nextPhase: nextPhase,
            jobId: jobId,
            sender: msg.sender
        });

        emit NewMemo(jobId, msg.sender, newMemoId);

        return newMemoId;
    }

    function signMemo(
        uint256 memoId,
        bool isApproved,
        string memory reason
    ) public virtual;
}
