// SPDX-License-Identifier: MIT
// This is sample implementation of ATIP to handle selling of tokens/ NFT
pragma solidity ^0.8.20;

abstract contract InteractionLedger {
    struct Memo {
        string content; // deprecated. content only emitted in event
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
        TXHASH,
        PAYABLE_REQUEST,
        PAYABLE_TRANSFER
    }

    mapping(uint256 => Memo) public memos;
    
    event NewMemo(
        uint256 indexed jobId,
        address indexed sender,
        uint256 memoId,
        string content
    );
    event MemoSigned(uint256 memoId, bool isApproved, string reason);
    function _createMemo(
        uint256 jobId,
        string calldata content,
        MemoType memoType,
        bool isSecured,
        uint8 nextPhase
    ) internal returns (uint256) {
        uint256 newMemoId = ++memoCounter;
        memos[newMemoId] = Memo({
            content: "", // deprecated. content only emitted in event
            memoType: memoType,
            isSecured: isSecured,
            nextPhase: nextPhase,
            jobId: jobId,
            sender: msg.sender
        });

        emit NewMemo(jobId, msg.sender, newMemoId, content);

        return newMemoId;
    }

    function signMemo(
        uint256 memoId,
        bool isApproved,
        string calldata reason
    ) public virtual;
    
    function isPayableMemo(uint256 memoId) public view returns (bool) {
        MemoType mType = memos[memoId].memoType;
        return mType == MemoType.PAYABLE_REQUEST || mType == MemoType.PAYABLE_TRANSFER;
    }
}
