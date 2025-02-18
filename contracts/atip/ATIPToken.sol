// SPDX-License-Identifier: MIT
// This is sample implementation of ATIP to handle selling of tokens/ NFT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./IServiceProviderRegistry.sol";
import "./InteractionLedger.sol";

contract ATIPToken is
    Initializable,
    AccessControlUpgradeable,
    InteractionLedger,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    IServiceProviderRegistry public providerRegistry;

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
    uint8 public minApprovals;

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _providerRegistry,
        address paymentTokenAddress,
        uint256 evaluatorFeeBP_,
        uint8 numEvaluatorsPerJob_,
        uint8 minApprovals_
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();

        providerRegistry = IServiceProviderRegistry(_providerRegistry);
        jobCounter = 0;
        evaluatorCounter = 0;
        memoCounter = 0;
        evaluatorFeeBP = evaluatorFeeBP_;
        numEvaluatorsPerJob = numEvaluatorsPerJob_;
        minApprovals = minApprovals_;
        // Setup initial admin
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        paymentToken = IERC20(paymentTokenAddress);
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
        uint8 numEvaluatorsPerJob_,
        uint8 minApprovals_
    ) external onlyRole(ADMIN_ROLE) {
        evaluatorFeeBP = evaluatorFeeBP_;
        numEvaluatorsPerJob = numEvaluatorsPerJob_;
        minApprovals = minApprovals_;
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
        }
    }

    function setBudget(uint256 jobId, uint256 amount) public nonReentrant {
        Job storage job = jobs[jobId];
        require(job.client == msg.sender, "Only client can set budget");
        require(
            job.phase == PHASE_NEGOTIATION,
            "Budget can only be set in negotiation phase"
        );
        paymentToken.safeIncreaseAllowance(address(this), amount);

        job.budget = amount;
    }

    function _payToEvaluators(uint256 jobId, uint256 evaluatorFee) internal {
        uint256 singleEvaluatorFee = evaluatorFee / numEvaluatorsPerJob;
        for (uint8 i = 0; i < numEvaluatorsPerJob; i++) {
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
        }
    }

    function claimBudget(uint256 id) public nonReentrant {
        Job storage job = jobs[id];
        require(job.budget > job.amountClaimed, "No budget to claim");

        job.amountClaimed = job.budget;
        uint256 evaluatorFee = (job.budget * evaluatorFeeBP) / 10000;

        if (job.phase == PHASE_COMPLETED) {
            require(
                msg.sender == job.provider,
                "Only provider can claim budget"
            );

            _payToEvaluators(id, evaluatorFee);

            paymentToken.safeTransferFrom(
                address(this),
                msg.sender,
                job.budget - evaluatorFee
            );
        } else {
            require(
                msg.sender == job.client && block.timestamp > job.expiredAt,
                "Only client can claim expired budget"
            );
            _updateJobPhase(id, PHASE_REJECTED);

            uint256 claimableAmount = job.budget;
            if (job.phase >= PHASE_COMPLETED) {
                claimableAmount -= evaluatorFee;
                _payToEvaluators(id, evaluatorFee);
            }

            paymentToken.safeTransferFrom(
                address(this),
                msg.sender,
                claimableAmount
            );
            emit RefundedBudget(id, msg.sender, claimableAmount);
        }
    }

    function createMemo(
        uint256 jobId,
        string memory content,
        MemoType memoType,
        bool isSecured,
        uint8 nextPhase
    ) public returns (uint256) {
        uint256 newMemoId = _createMemo(
            jobId,
            content,
            memoType,
            isSecured,
            nextPhase
        );

        Job storage job = jobs[jobId];
        job.memoCount++;
        jobMemoIds[jobId][job.phase].push(newMemoId);

        return newMemoId;
    }

    function canSign(
        address account,
        uint256 jobId
    ) public view returns (bool) {
        Job memory job = jobs[jobId];
        return
            job.phase < PHASE_COMPLETED &&
            (isEvaluator(account) ||
                (job.client == account || job.provider == account));
    }

    function getAllMemos(uint256 jobId) external view returns (Memo[] memory) {
        uint256 memoCount = jobs[jobId].memoCount;
        Memo[] memory allMemos = new Memo[](memoCount);
        uint256 k = 0;
        for (uint8 i = 0; i < TOTAL_PHASES; i++) {
            uint256[] memory tmpIds = jobMemoIds[jobId][i];
            for (uint256 j = 0; j < tmpIds.length; j++) {
                allMemos[k++] = memos[tmpIds[j]];
            }
        }
        return allMemos;
    }

    function getMemosForPhase(
        uint256 jobId,
        uint8 phase
    ) external view returns (Memo[] memory) {
        uint256 count = jobMemoIds[jobId][phase].length;
        uint256 memoId = 0;
        Memo[] memory memosForPhase = new Memo[](count);
        for (uint256 i = 0; i < count; i++) {
            memoId = jobMemoIds[jobId][phase][i];
            memosForPhase[i] = memos[memoId];
        }
        return memosForPhase;
    }

    function isJobEvaluator(
        uint256 jobId,
        address account
    ) public view returns (bool) {
        for (uint8 i = 0; i < jobEvaluators[jobId].length; i++) {
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
        } else {
            // For other phases, only counter party can sign
            require(msg.sender != memo.sender, "Only counter party can sign");
        }

        signatories[memoId][msg.sender] = isApproved ? 1 : 2;

        if (isApproved) {
            memo.numApprovals++;
        }

        emit MemoSigned(memoId, isApproved, reason);

        if (memo.numApprovals >= minApprovals) {
            _updateJobPhase(memo.jobId, memo.nextPhase);
        }
    }
}
