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
import "./IAgentVeToken.sol";
import "./IAgentDAO.sol";
import "./IAgentNft.sol";
import "../libs/IERC6551Registry.sol";
import "../pool/IUniswapV2Router02.sol";
import "../pool/IUniswapV2Factory.sol";
import "../pool/IUniswapV2Pair.sol";
import "../governance/IERC1155Votes.sol";

contract AgentFactory is Initializable, AccessControl {
    using SafeERC20 for IERC20;

    uint256 private _nextId;
    IUniswapV2Router02 internal _uniswapRouter;

    address public tokenImplementation;
    address public veTokenImplementation;
    address public daoImplementation;
    address public nft;
    address public tbaRegistry; // Token bound account
    uint256 public applicationThreshold;
    IERC1155Votes public voteToken;

    address[] public allTokens;
    address[] public allDAOs;

    address public assetToken; // Base currency
    uint256 public maturityDuration; // Maturity duration in seconds

    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    event NewPersona(
        uint256 virtualId,
        address token,
        address veToken,
        address dao,
        address tba,
        address lp
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

    event ApplicationThresholdUpdated(uint256 newThreshold);
    event ImplContractsUpdated(address token, address dao);

    address private _vault; // Vault to hold all Virtual NFTs

    bool internal locked;

    // V2 Storage
    address[] public allTradingTokens;

    modifier noReentrant() {
        require(!locked, "cannot reenter");
        locked = true;
        _;
        locked = false;
    }

    address minter;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address tokenImplementation_,
        address veTokenImplementation_,
        address daoImplementation_,
        address tbaRegistry_,
        address assetToken_,
        address nft_,
        uint256 applicationThreshold_,
        address vault_,
        address minter_,
        address uniswapRouter_,
        address voteToken_,
        uint256 maturityDuration_
    ) public initializer {
        tokenImplementation = tokenImplementation_;
        veTokenImplementation = veTokenImplementation_;
        daoImplementation = daoImplementation_;
        assetToken = assetToken_;
        tbaRegistry = tbaRegistry_;
        nft = nft_;
        applicationThreshold = applicationThreshold_;
        _nextId = 1;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(WITHDRAW_ROLE, msg.sender);
        _vault = vault_;
        minter = minter_;
        _uniswapRouter = IUniswapV2Router02(uniswapRouter_);
        voteToken = IERC1155Votes(voteToken_);
        maturityDuration = maturityDuration_;
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
    ) public returns (uint256) {
        address sender = _msgSender();
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
        uint256 proposalEndBlock = block.number; // No longer required in v2
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

    function executeApplication(uint256 id) public noReentrant {
        require(
            _applications[id].status == ApplicationStatus.Active,
            "Application is not active"
        );

        Application storage application = _applications[id];

        application.withdrawableAmount = 0;
        application.status = ApplicationStatus.Executed;

        address token = _createNewAgentToken(
            application.name,
            application.symbol
        );

        // Create LP
        address lp = _createLP(token, assetToken);
        uint256 virtualId = IAgentNft(nft).nextVirtualId();

        // Create Staking Token
        address veToken = _createNewAgentVeToken(
            string.concat("Staked ", application.name),
            string.concat("s", application.symbol),
            lp,
            application.proposer
        );

        string memory daoName = string.concat(application.name, " DAO");
        address payable dao = payable(
            _createNewDAO(
                daoName,
                voteToken,
                virtualId,
                application.daoVotingPeriod,
                application.daoThreshold
            )
        );

        IAgentNft(nft).mint(
            virtualId,
            _vault,
            application.tokenURI,
            dao,
            application.proposer,
            application.cores
        );
        application.virtualId = virtualId;

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

        // Call minter to mint initial tokens
        // Stake in LP
        // Add liquidity
        IAgentToken(token).mint(address(this), application.withdrawableAmount);
        IERC20(token).transfer(lp, application.withdrawableAmount ** 18);
        IERC20(assetToken).transfer(lp, application.withdrawableAmount ** 18);
        uint256 liq = IUniswapV2Pair(lp).mint(address(this));
        // TODO: Check how much LP token minted

        // IERC20(assetToken).forceApprove(token, application.withdrawableAmount);
        IAgentVeToken(token).stake(
            liq,
            application.proposer,
            application.proposer
        );

        emit NewPersona(virtualId, token, veToken, dao, tbaAddress, lp);
    }

    function _createLP(
        address token_,
        address assetToken_
    ) internal returns (address uniswapV2Pair) {
        uniswapV2Pair = IUniswapV2Factory(_uniswapRouter.factory()).createPair(
            token_,
            assetToken_
        );

        return uniswapV2Pair;
    }

    function _createNewDAO(
        string memory name,
        IERC1155Votes token,
        uint256 tokenId,
        uint32 daoVotingPeriod,
        uint256 daoThreshold
    ) internal returns (address instance) {
        instance = Clones.clone(daoImplementation);
        IAgentDAO(instance).initialize(
            name,
            token,
            tokenId,
            IAgentNft(nft).getContributionNft(),
            daoThreshold,
            daoVotingPeriod
        );

        allDAOs.push(instance);
        return instance;
    }

    function _createNewAgentToken(
        string memory name,
        string memory symbol
    ) internal returns (address instance) {
        instance = Clones.clone(tokenImplementation);
        IAgentToken(instance).initialize(name, symbol, minter);

        allTradingTokens.push(instance);
        return instance;
    }

    function _createNewAgentVeToken(
        string memory name,
        string memory symbol,
        address stakingAsset,
        address founder
    ) internal returns (address instance) {
        instance = Clones.clone(tokenImplementation);
        IAgentVeToken(instance).initialize(
            name,
            symbol,
            founder,
            stakingAsset,
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

    function setMinter(address newMinter) public onlyRole(DEFAULT_ADMIN_ROLE) {
        minter = newMinter;
    }

    function setMaturityDuration(
        uint256 newDuration
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        maturityDuration = newDuration;
    }
}
