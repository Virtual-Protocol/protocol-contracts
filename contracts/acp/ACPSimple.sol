// SPDX-License-Identifier: MIT
// This is sample implementation of ACP
// - all phases requires counter party approval except for evaluation phase
// - evaluation phase requires evaluators to sign
// - payment token is fixed

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
    uint8 public constant TOTAL_PHASES = 6;

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
            "REJECTED"
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
            evaluator: evaluator
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
            paymentToken.safeTransferFrom(
                job.client,
                address(this),
                job.budget
            );
        } else if (oldPhase == PHASE_EVALUATION && phase >= PHASE_COMPLETED) {
            _claimBudget(jobId);
        }
    }

    function setBudget(uint256 jobId, uint256 amount) public nonReentrant {
        Job storage job = jobs[jobId];
        require(job.client == _msgSender(), "Only client can set budget");
        require(amount > 0, "Zero amount");
        require(
            job.phase == PHASE_NEGOTIATION,
            "Budget can only be set in negotiation phase"
        );

        job.budget = amount;

        emit BudgetSet(jobId, amount);
    }

    function claimBudget(uint256 id) public nonReentrant {
        _claimBudget(id);
    }

    function _claimBudget(uint256 id) internal {
        Job storage job = jobs[id];
        require(job.budget > job.amountClaimed, "No budget to claim");

        job.amountClaimed = job.budget;
        uint256 claimableAmount = job.budget - job.amountClaimed;
        uint256 evaluatorFee = (claimableAmount * evaluatorFeeBP) / 10000;
        uint256 platformFee = (claimableAmount * platformFeeBP) / 10000;

        if (job.phase == PHASE_COMPLETED) {
            if (platformFee > 0) {
                paymentToken.safeTransferFrom(
                    address(this),
                    platformTreasury,
                    platformFee
                );
            }
            uint256 paidToEvaluators = 0;
            if (job.evaluator != address(0)) {
                paymentToken.safeTransferFrom(
                    address(this),
                    job.evaluator,
                    evaluatorFee
                );
                emit ClaimedEvaluatorFee(id, job.evaluator, evaluatorFee);
            }

            claimableAmount = claimableAmount - platformFee - paidToEvaluators;

            paymentToken.safeTransferFrom(
                address(this),
                job.provider,
                claimableAmount
            );

            emit ClaimedProviderFee(id, job.provider, claimableAmount);
        } else {
            // Refund the budget if job is not completed within expiry or rejected
            require(
                (job.phase < PHASE_EVALUATION &&
                    block.timestamp > job.expiredAt) ||
                    job.phase == PHASE_REJECTED,
                "Unable to refund budget"
            );

            paymentToken.safeTransferFrom(
                address(this),
                job.client,
                claimableAmount
            );
            emit RefundedBudget(id, job.client, claimableAmount);

            if (job.phase != PHASE_REJECTED) {
                _updateJobPhase(id, PHASE_REJECTED);
            }
        }
    }

    function createMemo(
        uint256 jobId,
        string memory content,
        MemoType memoType,
        bool isSecured,
        uint8 nextPhase
    ) public returns (uint256) {
        require(
            _msgSender() == jobs[jobId].client ||
                _msgSender() == jobs[jobId].provider,
            "Only client or provider can create memo"
        );
        require(jobId > 0 && jobId <= jobCounter, "Job does not exist");
        Job storage job = jobs[jobId];
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
        uint256 jobId
    ) public view returns (bool) {
        Job memory job = jobs[jobId];
        return
            job.phase < PHASE_COMPLETED &&
            ((job.client == account || job.provider == account) ||
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
        string memory reason
    ) public override nonReentrant {
        Memo storage memo = memos[memoId];
        require(canSign(_msgSender(), memo.jobId), "Unauthorised");

        Job storage job = jobs[memo.jobId];

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
        emit MemoSigned(memoId, isApproved, reason);

        if (job.phase == PHASE_EVALUATION) {
            if (isApproved) {
                _updateJobPhase(memo.jobId, PHASE_COMPLETED);
            } else {
                _updateJobPhase(memo.jobId, PHASE_REJECTED);
                claimBudget(memo.jobId);
            }
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
}
