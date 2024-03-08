// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "./IAgentToken.sol";
import "./IAgentDAO.sol";
import "./IAgentNft.sol";
import "../libs/IERC6551Registry.sol";

contract AgentFactory is Initializable, AccessControl {
    using SafeERC20 for IERC20;

    uint256 private _nextId;
    address public tokenImplementation;
    address public daoImplementation;
    address public nft;
    address public tbaRegistry; // Token bound account
    uint256 public applicationThreshold;

    address[] public allTokens;
    address[] public allDAOs;

    address public assetToken; // Staked token
    uint256 public maturityDuration; // Maturity duration in seconds

    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    event NewPersona(
        uint256 virtualId,
        address token,
        address dao,
        address tba
    );
    event NewApplication(uint256 id);

    enum ApplicationStatus {
        Active,
        Executed,
        Withdrawn
    }

    struct Application {
        string name;
        string symbol;
        string tokenURI;
        ApplicationStatus status;
        uint256 withdrawableAmount;
        address proposer;
        uint8[] cores;
        uint256 proposalEndBlock;
        uint256 virtualId;
        bytes32 tbaSalt;
        address tbaImplementation;
        uint32 daoVotingPeriod;
        uint256 daoThreshold;
    }

    mapping(uint256 => Application) private _applications;

    address public gov;

    modifier onlyGov() {
        require(msg.sender == gov, "Only DAO can execute proposal");
        _;
    }

    event ApplicationThresholdUpdated(uint256 newThreshold);
    event GovUpdated(address newGov);
    event ImplContractsUpdated(address token, address dao);

    address private _vault; // Vault to hold all Virtual NFTs

    bool internal locked;

    modifier noReentrant() {
        require(!locked, "cannot reenter");
        locked = true;
        _;
        locked = false;
    }

    function initialize(
        address tokenImplementation_,
        address daoImplementation_,
        address tbaRegistry_,
        address assetToken_,
        address nft_,
        uint256 applicationThreshold_,
        uint256 maturityDuration_,
        address gov_,
        address vault_
    ) public initializer {
        tokenImplementation = tokenImplementation_;
        daoImplementation = daoImplementation_;
        assetToken = assetToken_;
        tbaRegistry = tbaRegistry_;
        nft = nft_;
        applicationThreshold = applicationThreshold_;
        maturityDuration = maturityDuration_;
        _nextId = 1;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(WITHDRAW_ROLE, msg.sender);
        gov = gov_;
        _vault = vault_;
    }

    function getApplication(
        uint256 proposalId
    ) public view returns (Application memory) {
        return _applications[proposalId];
    }

    function proposePersona(
        string memory name,
        string memory symbol,
        string memory tokenURI,
        uint8[] memory cores,
        bytes32 tbaSalt,
        address tbaImplementation,
        uint32 daoVotingPeriod,
        uint256 daoThreshold
    ) external returns (uint256) {
        address sender = msg.sender;
        require(
            IERC20(assetToken).balanceOf(sender) >= applicationThreshold,
            "Insufficient asset token"
        );
        require(
            IERC20(assetToken).allowance(sender, address(this)) >=
                applicationThreshold,
            "Insufficient asset token allowance"
        );
        require(cores.length > 0, "Cores must be provided");

        IERC20(assetToken).safeTransferFrom(
            sender,
            address(this),
            applicationThreshold
        );

        uint256 id = _nextId++;
        uint256 proposalEndBlock = block.number +
            IGovernor(gov).votingPeriod() +
            IGovernor(gov).votingDelay();
        Application memory application = Application(
            name,
            symbol,
            tokenURI,
            ApplicationStatus.Active,
            applicationThreshold,
            sender,
            cores,
            proposalEndBlock,
            0,
            tbaSalt,
            tbaImplementation,
            daoVotingPeriod,
            daoThreshold
        );
        _applications[id] = application;
        emit NewApplication(id);

        return id;
    }

    function withdraw(uint256 id) public noReentrant {
        Application storage application = _applications[id];

        require(
            msg.sender == application.proposer ||
                hasRole(WITHDRAW_ROLE, msg.sender),
            "Not proposer"
        );

        require(
            application.status == ApplicationStatus.Active,
            "Application is not active"
        );

        require(
            block.number > application.proposalEndBlock,
            "Application is not matured yet"
        );

        application.withdrawableAmount = 0;
        application.status = ApplicationStatus.Withdrawn;

        IERC20(assetToken).safeTransfer(
            application.proposer,
            application.withdrawableAmount
        );
    }

    function executeApplication(uint256 id) public onlyGov {
        require(
            _applications[id].status == ApplicationStatus.Active,
            "Application is not active"
        );

        Application storage application = _applications[id];
        address token = _createNewAgentToken(
            application.name,
            application.symbol,
            application.proposer
        );
        string memory daoName = string.concat(application.name, " DAO");
        address payable dao = payable(
            _createNewDAO(
                daoName,
                IVotes(token),
                application.daoVotingPeriod,
                application.daoThreshold
            )
        );
        uint256 virtualId = IAgentNft(nft).mint(
            _vault,
            application.tokenURI,
            dao,
            application.proposer,
            application.cores
        );

        IERC20(assetToken).forceApprove(token, application.withdrawableAmount);
        IAgentToken(token).stake(
            application.withdrawableAmount,
            application.proposer,
            application.proposer
        );
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        address tbaAddress = IERC6551Registry(tbaRegistry).createAccount(
            application.tbaImplementation,
            application.tbaSalt,
            chainId,
            nft,
            virtualId
        );

        IAgentNft(nft).setTBA(virtualId, tbaAddress);

        application.withdrawableAmount = 0;
        application.status = ApplicationStatus.Executed;
        application.virtualId = virtualId;

        emit NewPersona(virtualId, token, dao, tbaAddress);
    }

    function _createNewDAO(
        string memory name,
        IVotes token,
        uint32 daoVotingPeriod,
        uint256 daoThreshold
    ) internal returns (address instance) {
        instance = Clones.clone(daoImplementation);
        IAgentDAO(instance).initialize(
            name,
            token,
            IAgentNft(nft).getContributionNft(),
            daoThreshold,
            daoVotingPeriod
        );

        allDAOs.push(instance);
        return instance;
    }

    function _createNewAgentToken(
        string memory name,
        string memory symbol,
        address founder
    ) internal returns (address instance) {
        instance = Clones.clone(tokenImplementation);
        IAgentToken(instance).initialize(
            name,
            symbol,
            founder,
            assetToken,
            nft,
            block.timestamp + maturityDuration
        );

        allTokens.push(instance);
        return instance;
    }

    function totalPersonas() public view returns (uint256) {
        return allTokens.length;
    }

    function setApplicationThreshold(
        uint256 newThreshold
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        applicationThreshold = newThreshold;
        emit ApplicationThresholdUpdated(newThreshold);
    }

    function setGov(address newGov) public onlyRole(DEFAULT_ADMIN_ROLE) {
        gov = newGov;
        emit GovUpdated(newGov);
    }

    function setVault(address newVault) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _vault = newVault;
    }

    function setImplementations(
        address token,
        address dao
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        tokenImplementation = token;
        daoImplementation = dao;
    }
}
