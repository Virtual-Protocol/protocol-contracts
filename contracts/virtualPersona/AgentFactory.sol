// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "./IAgentFactory.sol";
import "./IAgentToken.sol";
import "./IAgentVeToken.sol";
import "./IAgentDAO.sol";
import "./IAgentNft.sol";
import "../libs/IERC6551Registry.sol";
import "../pool/IUniswapV2Router02.sol";
import "../pool/IUniswapV2Factory.sol";
import "../pool/IUniswapV2Pair.sol";
import "../token/IMinter.sol";

contract AgentFactoryV2 is IAgentFactory, Initializable, AccessControl {
    using SafeERC20 for IERC20;

    uint256 private _nextId;
    address public tokenImplementation;
    address public daoImplementation;
    address public nft;
    address public tbaRegistry; // Token bound account
    uint256 public applicationThreshold;

    address[] public allTokens;
    address[] public allDAOs;

    address public assetToken; // Base currency
    uint256 public maturityDuration; // Staking duration in seconds for initial LP. eg: 100years

    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE"); // Able to withdraw and execute applications

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

    address public gov; // Deprecated in v2, execution of application does not require DAO decision anymore

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

    ///////////////////////////////////////////////////////////////
    // V2 Storage
    ///////////////////////////////////////////////////////////////
    address[] public allTradingTokens;
    IUniswapV2Router02 internal _uniswapRouter;
    address public veTokenImplementation;
    address private _minter;

    ///////////////////////////////////////////////////////////////

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
        address vault_
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
        _vault = vault_;
    }

    function getApplication(
        uint256 proposalId
    ) public view returns (Application memory) {
        return _applications[proposalId];
    }

    function proposeAgent(
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

        uint256 withdrawableAmount = application.withdrawableAmount;

        application.withdrawableAmount = 0;
        application.status = ApplicationStatus.Withdrawn;

        IERC20(assetToken).safeTransfer(
            application.proposer,
            withdrawableAmount
        );
    }

    function executeApplication(uint256 id) public noReentrant {
        // This will bootstrap an Agent with following components:
        // C1: Agent Token
        // C2: LP Pool
        // C3: Agent veToken
        // C4: Agent DAO
        // C5: Agent NFT
        // C6: TBA
        // C7: Mint initial Agent tokens
        // C8: Provide liquidity
        // C9: Stake liquidity token to get veToken
        require(
            _applications[id].status == ApplicationStatus.Active,
            "Application is not active"
        );

        Application storage application = _applications[id];

        require(
            msg.sender == application.proposer ||
                hasRole(WITHDRAW_ROLE, msg.sender),
            "Not proposer"
        );

        uint256 initialSupply = application.withdrawableAmount; // Initial LP supply

        application.withdrawableAmount = 0;
        application.status = ApplicationStatus.Executed;

        // C1
        address token = _createNewAgentToken(
            application.name,
            application.symbol
        );

        // C2
        address lp = _createLP(token, assetToken);

        // C3
        address veToken = _createNewAgentVeToken(
            string.concat("Staked ", application.name),
            string.concat("s", application.symbol),
            lp,
            application.proposer
        );

        // C4
        string memory daoName = string.concat(application.name, " DAO");
        address payable dao = payable(
            _createNewDAO(
                daoName,
                IVotes(veToken),
                application.daoVotingPeriod,
                application.daoThreshold
            )
        );

        // C5
        uint256 virtualId = IAgentNft(nft).nextVirtualId();
        IAgentNft(nft).mint(
            virtualId,
            _vault,
            application.tokenURI,
            dao,
            application.proposer,
            application.cores
        );
        application.virtualId = virtualId;

        // C6
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

        // C7
        IMinter(_minter).mintInitial(token, initialSupply);

        // C8
        IERC20(assetToken).approve(address(_uniswapRouter), initialSupply);
        IERC20(token).approve(address(_uniswapRouter), initialSupply);
        (, , uint liquidity) = _uniswapRouter.addLiquidity(
            token,
            assetToken,
            initialSupply,
            initialSupply,
            0,
            0,
            address(this),
            block.timestamp + 60
        );

        // C9
        IERC20(lp).approve(veToken, liquidity);
        IAgentVeToken(veToken).stake(
            liquidity,
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
        string memory symbol
    ) internal returns (address instance) {
        instance = Clones.clone(tokenImplementation);
        IAgentToken(instance).initialize(name, symbol);

        allTradingTokens.push(instance);
        return instance;
    }

    function _createNewAgentVeToken(
        string memory name,
        string memory symbol,
        address stakingAsset,
        address founder
    ) internal returns (address instance) {
        instance = Clones.clone(veTokenImplementation);
        IAgentVeToken(instance).initialize(
            name,
            symbol,
            founder,
            stakingAsset,
            block.timestamp + maturityDuration,
            address(nft)
        );

        allTokens.push(instance);
        return instance;
    }

    function totalAgents() public view returns (uint256) {
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
        _minter = newMinter;
    }

    function minter() public view override returns (address) {
        return _minter;
    }

    function setMaturityDuration(
        uint256 newDuration
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        maturityDuration = newDuration;
    }

    function setUniswapRouter(
        address router
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _uniswapRouter = IUniswapV2Router02(router);
    }
}
