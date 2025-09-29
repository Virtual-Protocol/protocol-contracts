// SPDX-License-Identifier: MIT
// This is sample implementation of ACP
// - all phases requires counter party approval except for evaluation phase
// - evaluation phase requires evaluators to sign
// - payment token defaults to global paymentToken but can be set per job in setBudget

pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./InteractionLedger.sol";

contract ACPSimple is
    Initializable,
    AccessControlUpgradeable,
    InteractionLedger,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    uint8 public constant PHASE_REQUEST = 0;
    uint8 public constant PHASE_NEGOTIATION = 1;
    uint8 public constant PHASE_TRANSACTION = 2;
    uint8 public constant PHASE_EVALUATION = 3;
    uint8 public constant PHASE_COMPLETED = 4;
    uint8 public constant PHASE_REJECTED = 5;
    uint8 public constant PHASE_EXPIRED = 6;
    uint8 public constant TOTAL_PHASES = 7;

    IERC20 public paymentToken;

    uint256 public evaluatorFeeBP; // 10000 = 100%
    uint8 public numEvaluatorsPerJob;

    event ClaimedEvaluatorFee(
        uint256 jobId,
        address indexed evaluator,
        uint256 evaluatorFee
    );

    // Job State Machine
    struct Job {
        uint256 id;
        address client;
        address provider;
        uint256 budget;
        uint256 amountClaimed;
        uint8 phase;
        uint256 memoCount;
        uint256 expiredAt; // Client can claim back the budget if job is not completed within expiry
        address evaluator;
        IERC20 jobPaymentToken;
    }

    mapping(uint256 => Job) public jobs;
    uint256 public jobCounter;

    event JobCreated(
        uint256 jobId,
        address indexed client,
        address indexed provider,
        address indexed evaluator
    );
    event JobPhaseUpdated(uint256 indexed jobId, uint8 oldPhase, uint8 phase);

    mapping(uint256 jobId => mapping(uint8 phase => uint256[] memoIds))
        public jobMemoIds;

    event ClaimedProviderFee(
        uint256 jobId,
        address indexed provider,
        uint256 providerFee
    );

    event RefundedBudget(uint256 jobId, address indexed client, uint256 amount);

    uint256 public platformFeeBP;
    address public platformTreasury;

    event BudgetSet(uint256 indexed jobId, uint256 newBudget);

    event JobPaymentTokenSet(uint256 indexed jobId, address indexed paymentToken, uint256 newBudget);

    mapping(uint256 jobId => uint256) public jobAdditionalFees;

    event RefundedAdditionalFees(
        uint256 indexed jobId,
        address indexed client,
        uint256 amount
    );

    mapping(uint256 memoId => PayableDetails) public payableDetails;

    struct PayableDetails {
        address token;
        uint256 amount;
        address recipient;
        uint256 feeAmount;
        FeeType feeType;
        bool isExecuted;
    }

    mapping(uint256 memoId => uint256 expiredAt) public memoExpiredAt;

    enum FeeType {
        NO_FEE,
        IMMEDIATE_FEE,
        DEFERRED_FEE
    }

    event PayableRequestExecuted(
        uint256 indexed jobId,
        uint256 indexed memoId,
        address indexed from,
        address to,
        address token,
        uint256 amount
    );

    event PayableTransferExecuted(
        uint256 indexed jobId,
        uint256 indexed memoId,
        address indexed from,
        address to,
        address token,
        uint256 amount
    );

    event PayableFeeCollected(
        uint256 indexed jobId,
        uint256 indexed memoId,
        address indexed payer,
        uint256 amount
    );

    event PayableFeeRequestExecuted(
        uint256 indexed jobId,
        uint256 indexed memoId,
        address indexed payer,
        address recipient,
        uint256 netAmount
    );

    event PayableFundsEscrowed(
        uint256 indexed jobId,
        uint256 indexed memoId,
        address indexed sender,
        address token,
        uint256 amount,
        uint256 feeAmount
    );

    event PayableFundsRefunded(
        uint256 indexed jobId,
        uint256 indexed memoId,
        address indexed sender,
        address token,
        uint256 amount
    );

    event PayableFeeRefunded(
        uint256 indexed jobId,
        uint256 indexed memoId,
        address indexed sender,
        address token,
        uint256 amount
    );


    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address paymentTokenAddress,
        uint256 evaluatorFeeBP_,
        uint256 platformFeeBP_,
        address platformTreasury_
    ) public initializer {
        require(
            paymentTokenAddress != address(0),
            "Zero address payment token"
        );
        require(platformTreasury_ != address(0), "Zero address treasury");

        __AccessControl_init();
        __ReentrancyGuard_init();

        jobCounter = 0;
        memoCounter = 0;
        evaluatorFeeBP = evaluatorFeeBP_;

        // Setup initial admin
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());

        paymentToken = IERC20(paymentTokenAddress);
        platformFeeBP = platformFeeBP_;
        platformTreasury = platformTreasury_;
    }

    modifier jobExists(uint256 jobId) {
        require(jobId > 0 && jobId <= jobCounter, "Job does not exist");
        _;
    }

    function _getJobPaymentToken(uint256 jobId) internal view returns (IERC20) {
        Job storage job = jobs[jobId];
        return address(job.jobPaymentToken) == address(0) ? paymentToken : job.jobPaymentToken;
    }

    function updateEvaluatorFee(
        uint256 evaluatorFeeBP_
    ) external onlyRole(ADMIN_ROLE) {
        evaluatorFeeBP = evaluatorFeeBP_;
    }

    function getPhases() public pure returns (string[TOTAL_PHASES] memory) {
        return [
            "REQUEST",
            "NEGOTIATION",
            "TRANSACTION",
            "EVALUATION",
            "COMPLETED",
            "REJECTED",
            "EXPIRED"
        ];
    }

    // Job State Machine Functions
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt
    ) external returns (uint256) {
        require(provider != address(0), "Zero address provider");
        require(expiredAt > (block.timestamp + 5 minutes), "Expiry too short");

        uint256 newJobId = ++jobCounter;

        jobs[newJobId] = Job({
            id: newJobId,
            client: _msgSender(),
            provider: provider,
            budget: 0,
            amountClaimed: 0,
            phase: 0,
            memoCount: 0,
            expiredAt: expiredAt,
            evaluator: evaluator,
            jobPaymentToken: paymentToken
        });

        emit JobCreated(newJobId, _msgSender(), provider, evaluator);
        return newJobId;
    }

    function _updateJobPhase(uint256 jobId, uint8 phase) internal {
        require(phase < TOTAL_PHASES, "Invalid phase");
        Job storage job = jobs[jobId];
        if (phase == job.phase) {
            return;
        }
        uint8 oldPhase = job.phase;
        job.phase = phase;
        emit JobPhaseUpdated(jobId, oldPhase, phase);

        // Handle transition logic
        if (oldPhase == PHASE_NEGOTIATION && phase == PHASE_TRANSACTION) {
            // Transfer the budget to current contract
            if (job.budget > 0) {
                _getJobPaymentToken(jobId).safeTransferFrom(
                    job.client,
                    address(this),
                    job.budget
                );
            }
        } else if (
            (oldPhase >= PHASE_TRANSACTION && oldPhase <= PHASE_EVALUATION) &&
            phase >= PHASE_COMPLETED &&
            phase <= PHASE_REJECTED
        ) {
            _claimBudget(jobId);
        }
    }

    function setBudgetWithPaymentToken(uint256 jobId, uint256 amount, IERC20 jobPaymentToken_) public nonReentrant {
        Job storage job = jobs[jobId];
        require(job.client == _msgSender(), "Only client can set budget");
        require(
            job.phase < PHASE_TRANSACTION,
            "Budget can only be set before transaction phase"
        );
        
        IERC20 jobPaymentToken = jobPaymentToken_;

        if (address(jobPaymentToken_) == address(0)) {
            jobPaymentToken = paymentToken;
        }

        require(_isERC20(address(jobPaymentToken)), "Token must be ERC20");

        job.budget = amount;
        emit BudgetSet(jobId, amount);

        // Set payment token if provided
        job.jobPaymentToken = jobPaymentToken_;
        emit JobPaymentTokenSet(jobId, address(jobPaymentToken_), amount);
    }

    function setBudget(uint256 jobId, uint256 amount) public {
        setBudgetWithPaymentToken(jobId, amount, IERC20(address(paymentToken)));
    }

    function claimBudget(uint256 id) public nonReentrant {
        Job storage job = jobs[id];
        if (job.phase < PHASE_TRANSACTION && block.timestamp > job.expiredAt) {
            _updateJobPhase(id, PHASE_EXPIRED);
        } else {
            _claimBudget(id);
        }
    }

    function _claimBudget(uint256 jobId) internal {
        Job storage job = jobs[jobId];
        IERC20 jobPaymentToken = _getJobPaymentToken(jobId);
        uint256 totalFees = jobAdditionalFees[jobId];
        uint256 totalAmount = job.budget + totalFees;
        require(totalAmount > 0, "No budget or fees to claim");
        uint256 claimableAmount = totalAmount - job.amountClaimed;
        job.amountClaimed = totalAmount;

        if (job.phase == PHASE_COMPLETED) {
            if (claimableAmount <= 0) {
                return;
            }

            uint256 evaluatorFee = (claimableAmount * evaluatorFeeBP) / 10000;
            uint256 platformFee = (claimableAmount * platformFeeBP) / 10000;

            if (platformFee > 0) {
                jobPaymentToken.safeTransfer(platformTreasury, platformFee);
            }

            if (job.evaluator != address(0) && evaluatorFee > 0) {
                jobPaymentToken.safeTransfer(job.evaluator, evaluatorFee);
                emit ClaimedEvaluatorFee(jobId, job.evaluator, evaluatorFee);
            }

            uint256 netAmount = claimableAmount - platformFee - evaluatorFee;

            if (netAmount > 0) {
                jobPaymentToken.safeTransfer(job.provider, netAmount);
                emit ClaimedProviderFee(jobId, job.provider, netAmount);
            }
        } else {
            require(
                (job.phase < PHASE_EVALUATION &&
                    block.timestamp > job.expiredAt) ||
                    job.phase == PHASE_REJECTED,
                "Unable to refund budget"
            );

            if (claimableAmount > 0) {
                uint256 budgetToRefund = claimableAmount - totalFees;

                if (job.phase >= PHASE_TRANSACTION && budgetToRefund > 0) {
                    jobPaymentToken.safeTransfer(job.client, budgetToRefund);
                    emit RefundedBudget(jobId, job.client, budgetToRefund);
                }

                if (totalFees > 0) {
                    jobPaymentToken.safeTransfer(job.client, totalFees);
                    emit RefundedAdditionalFees(jobId, job.client, totalFees);
                }
            }

            if (job.phase != PHASE_REJECTED && job.phase != PHASE_EXPIRED) {
                _updateJobPhase(jobId, PHASE_EXPIRED);
            }
        }
    }

    function createPayableMemo(
        uint256 jobId,
        string calldata content,
        address token,
        uint256 amount,
        address recipient,
        uint256 feeAmount,
        FeeType feeType,
        MemoType memoType,
        uint8 nextPhase,
        uint256 expiredAt
    ) external returns (uint256) {
        require(
            amount > 0 || feeAmount > 0,
            "Either amount or fee amount must be greater than 0"
        );
        require(
            memoType == MemoType.PAYABLE_REQUEST ||
                memoType == MemoType.PAYABLE_TRANSFER ||
                memoType == MemoType.PAYABLE_TRANSFER_ESCROW,
            "Invalid memo type"
        );
        require(expiredAt == 0 || expiredAt > block.timestamp + 1 minutes, "Expired at must be in the future");

        // If amount > 0, recipient must be valid
        if (amount > 0) {
            require(recipient != address(0), "Invalid recipient");
            require(token != address(0), "Token address required");
            require(_isERC20(token), "Token must be ERC20");
        }

        uint256 memoId = _createNewMemo(jobId, content, memoType, false, nextPhase);

        payableDetails[memoId] = PayableDetails({
            token: token,
            amount: amount,
            recipient: recipient,
            feeAmount: feeAmount,
            feeType: feeType,
            isExecuted: false
        });

        memoExpiredAt[memoId] = expiredAt;

        // Escrow funds if this is a PAYABLE_TRANSFER with amount > 0
        if (memoType == MemoType.PAYABLE_TRANSFER_ESCROW && amount > 0) {
            IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
        }

        if (memoType == MemoType.PAYABLE_TRANSFER_ESCROW && feeAmount > 0) {
            IERC20 jobPaymentToken = _getJobPaymentToken(jobId);
            jobPaymentToken.safeTransferFrom(_msgSender(), address(this), feeAmount);
        }

        if (amount > 0 || feeAmount > 0) {
            emit PayableFundsEscrowed(jobId, memoId, _msgSender(), token, amount, feeAmount);
        }

        return memoId;
    }

    function _isERC20(address token) internal view returns (bool) {
        try IERC20(token).totalSupply() returns (uint256) {
            return true;
        } catch {
            return false;
        }
    }

    function _executePayableMemo(uint256 memoId, Memo storage memo) internal {
        PayableDetails storage details = payableDetails[memoId];

        require(!details.isExecuted, "Payable memo already executed");

        address token = details.token;
        uint256 amount = details.amount;
        address recipient = details.recipient;
        uint256 feeAmount = details.feeAmount;
        FeeType feeType = details.feeType;
        MemoType memoType = memo.memoType;

        // Handle fund transfer
        if (amount > 0) {

            if (memoType == MemoType.PAYABLE_REQUEST) {
                IERC20(token).safeTransferFrom(_msgSender(), recipient, amount);

                emit PayableRequestExecuted(
                    memo.jobId,
                    memoId,
                    _msgSender(),
                    recipient,
                    token,
                    amount
                );
            } else if (memoType == MemoType.PAYABLE_TRANSFER) {
                IERC20(token).safeTransferFrom(memo.sender, recipient, amount);

                emit PayableTransferExecuted(
                    memo.jobId,
                    memoId,
                    memo.sender,
                    recipient,
                    token,
                    amount
                );
            } else if (memoType == MemoType.PAYABLE_TRANSFER_ESCROW) {
                // Transfer from escrowed funds
                IERC20(token).safeTransfer(recipient, amount);
                emit PayableTransferExecuted(
                    memo.jobId,
                    memoId,
                    memo.sender,
                    recipient,
                    token,
                    amount
                );
            }
        }

        // Handle fee transfer
        if (feeAmount > 0) {
            address payer = _msgSender();
            address eventPayer = _msgSender(); // For event emission
            IERC20 jobPaymentToken = _getJobPaymentToken(memo.jobId);
            
            if (memoType == MemoType.PAYABLE_TRANSFER) {
                payer = memo.sender;
                eventPayer = memo.sender;
            } else if (memoType == MemoType.PAYABLE_TRANSFER_ESCROW) {
                payer = address(this); // fee is already escrowed
                eventPayer = memo.sender; // Use memo creator for event
                jobPaymentToken.forceApprove(address(this), feeAmount);
            }
            if (feeType == FeeType.DEFERRED_FEE) {
                jobPaymentToken.safeTransferFrom(
                    payer,
                    address(this),
                    feeAmount
                );
                emit PayableFeeCollected(
                    memo.jobId,
                    memoId,
                    eventPayer,
                    feeAmount
                );
            } else {
                Job storage job = jobs[memo.jobId];
                address provider = job.provider;

                uint256 platformFee = (feeAmount * platformFeeBP) / 10000;
                if (platformFee > 0) {
                    jobPaymentToken.safeTransferFrom(
                        payer,
                        platformTreasury,
                        platformFee
                    );
                }
                uint256 netAmount = feeAmount - platformFee;
                jobPaymentToken.safeTransferFrom(
                    payer,
                    provider,
                    netAmount
                );
                emit PayableFeeRequestExecuted(
                    memo.jobId,
                    memoId,
                    eventPayer,
                    provider,
                    netAmount
                );
                job.amountClaimed += feeAmount;
            }
            jobAdditionalFees[memo.jobId] += feeAmount;
        }

        details.isExecuted = true;
    }

    function createMemo(
        uint256 jobId,
        string calldata content,
        MemoType memoType,
        bool isSecured,
        uint8 nextPhase
    ) public returns (uint256) {
        require(!isPayableMemoType(memoType), "Invalid memo type");
        return _createNewMemo(jobId, content, memoType, isSecured, nextPhase);
    }

    function _createNewMemo(
        uint256 jobId,
        string calldata content,
        MemoType memoType,
        bool isSecured,
        uint8 nextPhase
    ) internal returns (uint256) {
        require(jobId > 0 && jobId <= jobCounter, "Job does not exist");
        Job storage job = jobs[jobId];
        require(
            _msgSender() == job.client ||
                _msgSender() == job.provider,
            "Only client or provider can create memo"
        );
        require(job.phase < PHASE_COMPLETED, "Job is already completed");

        uint256 newMemoId = _createMemo(
            jobId,
            content,
            memoType,
            isSecured,
            nextPhase
        );

        job.memoCount++;
        jobMemoIds[jobId][job.phase].push(newMemoId);

        if (
            nextPhase == PHASE_COMPLETED &&
            job.phase == PHASE_TRANSACTION &&
            _msgSender() == job.provider
        ) {
            _updateJobPhase(jobId, PHASE_EVALUATION);
        }

        return newMemoId;
    } 

    function isJobEvaluator(
        uint256 jobId,
        address account
    ) public view returns (bool) {
        Job memory job = jobs[jobId];
        bool canClientSign = job.evaluator == address(0) &&
            account == job.client;
        return (account == jobs[jobId].evaluator || canClientSign);
    }

    function canSign(
        address account,
        Job memory job
    ) public pure returns (bool) {
        return ((job.client == account || job.provider == account) ||
            ((job.evaluator == account || job.evaluator == address(0)) &&
                job.phase == PHASE_EVALUATION));
    }

    function getAllMemos(
        uint256 jobId,
        uint256 offset,
        uint256 limit
    ) external view returns (Memo[] memory, uint256 total) {
        uint256 memoCount = jobs[jobId].memoCount;
        require(offset < memoCount, "Offset out of bounds");

        uint256 size = (offset + limit > memoCount)
            ? memoCount - offset
            : limit;
        Memo[] memory allMemos = new Memo[](size);

        uint256 k = 0;
        uint256 current = 0;
        for (uint8 i = 0; i < TOTAL_PHASES && k < size; i++) {
            uint256[] memory tmpIds = jobMemoIds[jobId][i];
            for (uint256 j = 0; j < tmpIds.length && k < size; j++) {
                if (current >= offset) {
                    allMemos[k++] = memos[tmpIds[j]];
                }
                current++;
            }
        }
        return (allMemos, memoCount);
    }

    function getMemosForPhase(
        uint256 jobId,
        uint8 phase,
        uint256 offset,
        uint256 limit
    ) external view returns (Memo[] memory, uint256 total) {
        uint256 count = jobMemoIds[jobId][phase].length;
        require(offset < count, "Offset out of bounds");

        uint256 size = (offset + limit > count) ? count - offset : limit;
        Memo[] memory memosForPhase = new Memo[](size);

        for (uint256 i = 0; i < size; i++) {
            uint256 memoId = jobMemoIds[jobId][phase][offset + i];
            memosForPhase[i] = memos[memoId];
        }
        return (memosForPhase, count);
    }

    function signMemo(
        uint256 memoId,
        bool isApproved,
        string calldata reason
    ) public override nonReentrant {
        Memo storage memo = memos[memoId];
        Job memory job = jobs[memo.jobId];

        require(job.phase < PHASE_COMPLETED, "Job is already completed");
        require(canSign(_msgSender(), job), "Unauthorised memo signer");

        if (memoExpiredAt[memoId] > 0 && memoExpiredAt[memoId] < block.timestamp) {
            revert("Memo expired");
        }

        if (signatories[memoId][_msgSender()] > 0) {
            revert("Already signed");
        }

        // if this is evaluation phase, only evaluators can sign
        if (job.phase == PHASE_EVALUATION) {
            require(
                isJobEvaluator(memo.jobId, _msgSender()),
                "Only evaluators can sign"
            );
        } else if (
            !(job.phase == PHASE_TRANSACTION &&
                memo.nextPhase == PHASE_EVALUATION)
        ) {
            // For other phases, only counter party can sign
            require(_msgSender() != memo.sender, "Only counter party can sign");
        }

        signatories[memoId][_msgSender()] = isApproved ? 1 : 2;

        if (isApproved && isPayableMemo(memoId)) {
            _executePayableMemo(memoId, memo);
        } else if(!isApproved && memo.memoType == MemoType.PAYABLE_TRANSFER_ESCROW) {
            _refundEscrowedFunds(memoId, memo);
        }

        emit MemoSigned(memoId, isApproved, reason);

        if (job.phase == PHASE_EVALUATION) {
            if (isApproved) {
                _updateJobPhase(memo.jobId, PHASE_COMPLETED);
            } else {
                _updateJobPhase(memo.jobId, PHASE_REJECTED);
            }
        } else if (job.phase == PHASE_REQUEST && !isApproved) {
            _updateJobPhase(memo.jobId, PHASE_REJECTED);
        } else {
            if (isApproved) {
                _updateJobPhase(memo.jobId, memo.nextPhase);
            }
        }
    }

    function updatePlatformFee(
        uint256 platformFeeBP_,
        address platformTreasury_
    ) external onlyRole(ADMIN_ROLE) {
        platformFeeBP = platformFeeBP_;
        platformTreasury = platformTreasury_;
    }

    function getJobPhaseMemoIds(
        uint256 jobId,
        uint8 phase
    ) external view returns (uint256[] memory) {
        return jobMemoIds[jobId][phase];
    }


    function _refundEscrowedFunds(uint256 memoId, Memo storage memo) internal { 
        PayableDetails storage details = payableDetails[memoId];
        
        require(memo.memoType == MemoType.PAYABLE_TRANSFER_ESCROW, "Not a payable transfer memo");
        require(!details.isExecuted, "Memo already executed");

        // Withdraw escrowed amount
        if (details.amount > 0) {
            IERC20(details.token).safeTransfer(memo.sender, details.amount);
            emit PayableFundsRefunded(
                memo.jobId,
                memoId,
                memo.sender,
                details.token,
                details.amount
            );
        }
        
        // Withdraw escrowed fee
        if (details.feeAmount > 0) {
            IERC20 jobPaymentToken = _getJobPaymentToken(memo.jobId);
            jobPaymentToken.safeTransfer(memo.sender, details.feeAmount);
            emit PayableFeeRefunded(
                memo.jobId,
                memoId,
                memo.sender,
                address(jobPaymentToken),
                details.feeAmount
            );
        }
        
        // Mark as executed to prevent double withdrawal
        details.isExecuted = true;
    }

    function withdrawEscrowedFunds(uint256 memoId) external nonReentrant {
        // Check if memo is expired or job is in a state where funds can be withdrawn
        Memo storage memo = memos[memoId];
        Job storage job = jobs[memo.jobId];
        bool canWithdraw = false;
        
        // Allow withdrawal if memo is expired
        if (memoExpiredAt[memoId] > 0 && memoExpiredAt[memoId] < block.timestamp) {
            canWithdraw = true;
        }
        
        // Allow withdrawal if job is rejected or expired
        if (job.phase == PHASE_REJECTED || job.phase == PHASE_EXPIRED) {
            canWithdraw = true;
        }
        
        require(canWithdraw, "Cannot withdraw funds yet");

        _refundEscrowedFunds(memoId, memo);
    }
}
