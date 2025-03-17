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
        uint8 evaluatorCount;
    }

    mapping(uint256 => Job) public jobs;
    uint256 public jobCounter;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider
    );
    event JobPhaseUpdated(uint256 indexed jobId, uint8 oldPhase, uint8 phase);

    mapping(address => bool) public evaluators;
    uint256 public evaluatorCounter;

    mapping(uint256 jobId => mapping(uint8 phase => uint256[] memoIds))
        public jobMemoIds;
    mapping(uint256 jobId => address[] evaluators) public jobEvaluators;

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
        uint8 numEvaluatorsPerJob_,
        uint256 platformFeeBP_,
        address platformTreasury_
    ) public initializer {
        require(
            paymentTokenAddress != address(0),
            "Zero address payment token"
        );
        require(platformTreasury_ != address(0), "Zero address treasury");
        require(numEvaluatorsPerJob_ > 0, "Invalid evaluator count");

        __AccessControl_init();
        __ReentrancyGuard_init();

        jobCounter = 0;
        evaluatorCounter = 0;
        memoCounter = 0;
        evaluatorFeeBP = evaluatorFeeBP_;
        numEvaluatorsPerJob = numEvaluatorsPerJob_;
        // Setup initial admin
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        paymentToken = IERC20(paymentTokenAddress);
        platformFeeBP = platformFeeBP_;
        platformTreasury = platformTreasury_;
    }

    modifier jobExists(uint256 jobId) {
        require(jobId > 0 && jobId <= jobCounter, "Job does not exist");
        _;
    }

    // Maintain evaluators
    function addEvaluator(address evaluator) external onlyRole(ADMIN_ROLE) {
        evaluators[evaluator] = true;
        evaluatorCounter++;
    }

    function removeEvaluator(address evaluator) external onlyRole(ADMIN_ROLE) {
        evaluators[evaluator] = false;
        evaluatorCounter--;
    }

    function isEvaluator(address evaluator) public view returns (bool) {
        return evaluators[evaluator] == true;
    }

    function updateEvaluatorConfigs(
        uint256 evaluatorFeeBP_,
        uint8 numEvaluatorsPerJob_
    ) external onlyRole(ADMIN_ROLE) {
        evaluatorFeeBP = evaluatorFeeBP_;
        numEvaluatorsPerJob = numEvaluatorsPerJob_;
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
        uint256 expiredAt
    ) external returns (uint256) {
        require(provider != address(0), "Zero address provider");
        require(expiredAt > (block.timestamp + 5 minutes), "Expiry too short");

        uint256 newJobId = ++jobCounter;

        jobs[newJobId] = Job({
            id: newJobId,
            client: msg.sender,
            provider: provider,
            budget: 0,
            amountClaimed: 0,
            phase: 0,
            memoCount: 0,
            expiredAt: expiredAt,
            evaluatorCount: 0
        });

        emit JobCreated(newJobId, msg.sender, provider);
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
        } else if (oldPhase == PHASE_EVALUATION && phase == PHASE_COMPLETED) {
            claimBudget(jobId);
        }
    }

    function setBudget(uint256 jobId, uint256 amount) public nonReentrant {
        Job storage job = jobs[jobId];
        require(job.client == msg.sender, "Only client can set budget");
        require(amount > 0, "Zero amount");
        require(
            job.phase == PHASE_NEGOTIATION,
            "Budget can only be set in negotiation phase"
        );

        job.budget = amount;

        paymentToken.safeIncreaseAllowance(address(this), amount);

        emit BudgetSet(jobId, amount);
    }

    function _payToEvaluators(
        uint256 jobId,
        uint256 evaluatorFee
    ) internal returns (uint256) {
        uint256 totalEvaluatorFee = 0;
        uint256 totalEvaluators = jobEvaluators[jobId].length;

        require(totalEvaluators > 0, "No evaluators");
        uint256 singleEvaluatorFee = evaluatorFee / totalEvaluators;
        require(singleEvaluatorFee > 0, "Fee too small");

        for (uint256 i = 0; i < totalEvaluators; i++) {
            paymentToken.safeTransferFrom(
                address(this),
                jobEvaluators[jobId][i],
                singleEvaluatorFee
            );
            emit ClaimedEvaluatorFee(
                jobId,
                jobEvaluators[jobId][i],
                singleEvaluatorFee
            );
            totalEvaluatorFee += singleEvaluatorFee;
        }
        return totalEvaluatorFee;
    }

    function claimBudget(uint256 id) public nonReentrant {
        Job storage job = jobs[id];
        require(job.budget > job.amountClaimed, "No budget to claim");

        job.amountClaimed = job.budget;
        uint256 claimableAmount = job.budget;
        uint256 evaluatorFee = (job.budget * evaluatorFeeBP) / 10000;
        uint256 platformFee = (job.budget * platformFeeBP) / 10000;

        if (job.phase == PHASE_COMPLETED) {
            if (platformFee > 0) {
                paymentToken.safeTransferFrom(
                    address(this),
                    platformTreasury,
                    platformFee
                );
            }
            uint256 paidToEvaluators = _payToEvaluators(id, evaluatorFee);
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
            _updateJobPhase(id, PHASE_REJECTED);

            paymentToken.safeTransferFrom(
                address(this),
                job.client,
                claimableAmount
            );
            emit RefundedBudget(id, job.client, claimableAmount);
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
            msg.sender == jobs[jobId].client ||
                msg.sender == jobs[jobId].provider,
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
            msg.sender == job.provider
        ) {
            _updateJobPhase(jobId, PHASE_EVALUATION);
        }

        return newMemoId;
    }

    function canSign(
        address account,
        uint256 jobId
    ) public view returns (bool) {
        Job memory job = jobs[jobId];
        return
            job.phase < PHASE_COMPLETED &&
            ((job.phase == PHASE_EVALUATION && isEvaluator(account)) ||
                (job.client == account || job.provider == account));
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

    function isJobEvaluator(
        uint256 jobId,
        address account
    ) public view returns (bool) {
        for (uint256 i = 0; i < jobEvaluators[jobId].length; i++) {
            if (jobEvaluators[jobId][i] == account) {
                return true;
            }
        }
        return false;
    }

    function signMemo(
        uint256 memoId,
        bool isApproved,
        string memory reason
    ) public override {
        Memo storage memo = memos[memoId];
        require(canSign(msg.sender, memo.jobId), "Unauthorised");

        Job storage job = jobs[memo.jobId];

        if (signatories[memoId][msg.sender] > 0) {
            revert("Already signed");
        }

        // if this is evaluation phase, only evaluators can sign
        if (job.phase == PHASE_EVALUATION) {
            require(isEvaluator(msg.sender), "Only evaluators can sign");

            if (!isJobEvaluator(memo.jobId, msg.sender)) {
                if (job.evaluatorCount >= numEvaluatorsPerJob) {
                    revert("Max evaluators reached");
                } else {
                    jobEvaluators[memo.jobId].push(msg.sender);
                    job.evaluatorCount++;
                }
            }
        } else if (
            !(job.phase == PHASE_TRANSACTION &&
                memo.nextPhase == PHASE_EVALUATION)
        ) {
            // For other phases, only counter party can sign
            require(msg.sender != memo.sender, "Only counter party can sign");
        }

        signatories[memoId][msg.sender] = isApproved ? 1 : 2;
        emit MemoSigned(memoId, isApproved, reason);

        if (job.phase == PHASE_EVALUATION) {
            if (isApproved) {
                memo.evalApprovals++;
            } else {
                memo.evalRejections++;
            }
            uint256 mid = (numEvaluatorsPerJob - 1) / 2;
            if (memo.evalApprovals > mid) {
                _updateJobPhase(memo.jobId, PHASE_COMPLETED);
            }
            if (memo.evalRejections > mid) {
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
}
