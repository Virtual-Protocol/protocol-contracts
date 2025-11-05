// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "./IAgentFactoryV6.sol";
import "./IAgentTokenV2.sol";
import "./IAgentVeTokenV2.sol";
import "./IAgentDAO.sol";
import "./IAgentNft.sol";
import "../libs/IERC6551Registry.sol";

contract AgentFactoryV6 is
    IAgentFactoryV6,
    Initializable,
    AccessControl,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    uint256 private _nextId;
    // this is for BE to fill virtual.personaProposalId field, AgentFactoryV6 should start from 60_000_000_000
    uint256 public constant nextIdBase = 60_000_000_000;
    address public tokenImplementation;
    address public daoImplementation;
    address public nft;
    address public tbaRegistry; // Token bound account

    address[] public allTokens;
    address[] public allDAOs;

    address public assetToken; // Base currency
    uint256 public maturityDuration; // Staking duration in seconds for initial LP. eg: 10years

    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE"); // Able to withdraw and execute applications

    event NewPersona(
        uint256 virtualId,
        address token,
        address dao,
        address tba,
        address veToken,
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
        address proposer; // token creator
        uint8[] cores;
        uint256 proposalEndBlock;
        uint256 virtualId; // this will be set to 0 if the application is not executed, and set to the nft.nextVirtualId() if the application is executed
        bytes32 tbaSalt;
        address tbaImplementation;
        uint32 daoVotingPeriod;
        uint256 daoThreshold;
        address tokenAddress;
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
    address private _uniswapRouter;
    address public veTokenImplementation;
    address private _minter; // Unused
    address private _tokenAdmin;
    address public defaultDelegatee;

    // Default agent token params
    bytes private _tokenSupplyParams;
    bytes private _tokenTaxParams;
    uint16 private _tokenMultiplier; // Unused

    bytes32 public constant BONDING_ROLE = keccak256("BONDING_ROLE");
    bytes32 public constant REMOVE_LIQUIDITY_ROLE =
        keccak256("REMOVE_LIQUIDITY_ROLE");

    ///////////////////////////////////////////////////////////////

    mapping(address => bool) private _existingAgents;

    error AgentAlreadyExists();

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
        address vault_,
        uint256 nextId_
    ) public initializer {
        __Pausable_init();

        tokenImplementation = tokenImplementation_;
        veTokenImplementation = veTokenImplementation_;
        daoImplementation = daoImplementation_;
        assetToken = assetToken_;
        tbaRegistry = tbaRegistry_;
        nft = nft_;
        _nextId = nextId_ + nextIdBase;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _vault = vault_;
    }

    function getApplication(
        uint256 proposalId
    ) public view returns (Application memory) {
        return _applications[proposalId];
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

    function _executeApplication(
        uint256 id,
        bool canStake,
        bytes memory tokenSupplyParams_,
        bytes32 salt,
        bool needCreateAgentToken
    ) internal {
        require(
            _applications[id].status == ApplicationStatus.Active,
            "Application is not active"
        );

        require(_tokenAdmin != address(0), "Token admin not set");

        Application storage application = _applications[id];

        uint256 initialAmount = application.withdrawableAmount;
        application.withdrawableAmount = 0;
        application.status = ApplicationStatus.Executed;

        // C1
        address token;
        if (needCreateAgentToken) {
            token = _createNewAgentToken(
                application.name,
                application.symbol,
                tokenSupplyParams_,
                salt
            );
            application.tokenAddress = token;
        } else {
            require(
                application.tokenAddress != address(0),
                "application tokenAddress not set"
            );
            token = application.tokenAddress;
        }

        // C2
        address lp = IAgentTokenV2(token).liquidityPools()[0];
        IERC20(assetToken).safeTransfer(token, initialAmount);
        IAgentTokenV2(token).addInitialLiquidity(address(this));

        // C3
        address veToken = _createNewAgentVeToken(
            string.concat("Staked ", application.name),
            string.concat("s", application.symbol),
            lp,
            application.proposer,
            canStake
        );

        // C4
        string memory daoName = string.concat(application.name, " DAO");
        address payable dao = payable(
            _createNewDAO(
                daoName,
                IVotes(veToken),
                application.daoVotingPeriod,
                application.daoThreshold,
                salt
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
            application.cores,
            lp,
            token
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
        IERC20(lp).approve(veToken, type(uint256).max);
        IAgentVeTokenV2(veToken).stake(
            IERC20(lp).balanceOf(address(this)),
            application.proposer,
            defaultDelegatee
        );

        emit NewPersona(virtualId, token, dao, tbaAddress, veToken, lp);
    }

    function _createNewDAO(
        string memory name,
        IVotes token,
        uint32 daoVotingPeriod,
        uint256 daoThreshold,
        bytes32 salt
    ) internal returns (address instance) {
        instance = Clones.cloneDeterministic(daoImplementation, salt);
        // here just to share _existingAgents mapping with agentToken and daoImplementation duplication checking
        if (_existingAgents[instance]) {
            revert AgentAlreadyExists();
        }
        IAgentDAO(instance).initialize(
            name,
            token,
            nft,
            daoThreshold,
            daoVotingPeriod
        );

        allDAOs.push(instance);
        return instance;
    }

    function _createNewAgentToken(
        string memory name,
        string memory symbol,
        bytes memory tokenSupplyParams_,
        bytes32 salt
    ) internal returns (address instance) {
        instance = Clones.cloneDeterministic(tokenImplementation, salt);
        if (_existingAgents[instance]) {
            revert AgentAlreadyExists();
        }
        _existingAgents[instance] = true;
        IAgentTokenV2(instance).initialize(
            [_tokenAdmin, _uniswapRouter, assetToken],
            abi.encode(name, symbol),
            tokenSupplyParams_,
            _tokenTaxParams
        );

        allTradingTokens.push(instance);
        return instance;
    }

    function _createNewAgentVeToken(
        string memory name,
        string memory symbol,
        address stakingAsset,
        address founder,
        bool canStake
    ) internal returns (address instance) {
        instance = Clones.clone(veTokenImplementation);
        IAgentVeTokenV2(instance).initialize(
            name,
            symbol,
            founder,
            stakingAsset,
            block.timestamp + maturityDuration,
            address(nft),
            canStake
        );

        allTokens.push(instance);
        return instance;
    }

    function totalAgents() public view returns (uint256) {
        return allTokens.length;
    }

    function setVault(address newVault) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _vault = newVault;
    }

    function setImplementations(
        address token,
        address veToken,
        address dao
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        tokenImplementation = token;
        daoImplementation = dao;
        veTokenImplementation = veToken;
    }

    function setParams(
        uint256 newMaturityDuration,
        address newRouter,
        address newDelegatee,
        address newTokenAdmin
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        maturityDuration = newMaturityDuration;
        _uniswapRouter = newRouter;
        defaultDelegatee = newDelegatee;
        _tokenAdmin = newTokenAdmin;
    }

    function setTokenParams(
        uint256 maxSupply,
        uint256 lpSupply,
        uint256 vaultSupply,
        uint256 maxTokensPerWallet,
        uint256 maxTokensPerTxn,
        uint256 botProtectionDurationInSeconds,
        address vault,
        uint256 projectBuyTaxBasisPoints,
        uint256 projectSellTaxBasisPoints,
        uint256 taxSwapThresholdBasisPoints,
        address projectTaxRecipient
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require((lpSupply + vaultSupply) <= maxSupply, "Invalid supply");
        _tokenSupplyParams = abi.encode(
            maxSupply,
            lpSupply,
            vaultSupply,
            maxTokensPerWallet,
            maxTokensPerTxn,
            botProtectionDurationInSeconds,
            vault
        );
        _tokenTaxParams = abi.encode(
            projectBuyTaxBasisPoints,
            projectSellTaxBasisPoints,
            taxSwapThresholdBasisPoints,
            projectTaxRecipient
        );
    }

    function pause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _msgSender()
        internal
        view
        override(Context, ContextUpgradeable)
        returns (address sender)
    {
        sender = ContextUpgradeable._msgSender();
    }

    function _msgData()
        internal
        view
        override(Context, ContextUpgradeable)
        returns (bytes calldata)
    {
        return ContextUpgradeable._msgData();
    }

    function createNewAgentTokenAndApplication(
        string memory name,
        string memory symbol,
        bytes memory tokenSupplyParams_,
        uint8[] memory cores,
        bytes32 tbaSalt,
        address tbaImplementation,
        uint32 daoVotingPeriod,
        uint256 daoThreshold,
        uint256 applicationThreshold_, // how many assetToken to use for the application
        address creator
    )
        public
        whenNotPaused
        onlyRole(BONDING_ROLE)
        noReentrant
        returns (address, uint256)
    {
        require(cores.length > 0, "Cores must be provided");

        uint256 id = _nextId++;
        // use id as salt, it's ok to be predictable because we will reductive tax in the beginning of the bonding curve
        address token = _createNewAgentToken(
            name,
            symbol,
            tokenSupplyParams_,
            bytes32(id)
        );

        _applications[id] = Application(
            name,
            symbol,
            "",
            ApplicationStatus.Active,
            applicationThreshold_,
            creator,
            cores,
            block.number, // proposalEndBlock, No longer required in v2
            0,
            tbaSalt,
            tbaImplementation,
            daoVotingPeriod,
            daoThreshold,
            token
        );
        emit NewApplication(id);

        return (token, id);
    }

    function updateApplicationThresholdWithApplicationId(
        uint256 id,
        uint256 applicationThreshold_
    ) public onlyRole(BONDING_ROLE) {
        _applications[id].withdrawableAmount = applicationThreshold_;
    }

    function executeBondingCurveApplicationSalt(
        uint256 id,
        uint256 totalSupply,
        uint256 lpSupply,
        address vault,
        bytes32 salt
    ) public onlyRole(BONDING_ROLE) noReentrant returns (address) {
        bytes memory tokenSupplyParams = abi.encode(
            totalSupply,
            lpSupply,
            totalSupply - lpSupply,
            totalSupply,
            totalSupply,
            0,
            vault
        );

        _executeApplication(id, true, tokenSupplyParams, salt, false);

        Application memory application = _applications[id];

        return IAgentNft(nft).virtualInfo(application.virtualId).token;
    }

    function addBlacklistAddress(
        address token,
        address blacklistAddress
    ) public onlyRole(BONDING_ROLE) {
        IAgentTokenV2(token).addBlacklistAddress(blacklistAddress);
    }

    function removeBlacklistAddress(
        address token,
        address blacklistAddress
    ) public onlyRole(BONDING_ROLE) {
        IAgentTokenV2(token).removeBlacklistAddress(blacklistAddress);
    }

    // amountAMin must be the amount of the uniswapPair.token0() that will be received
    // amountBMin must be the amount of the uniswapPair.token1() that will be received
    function removeLpLiquidity(
        address veToken,
        address recipient,
        uint256 veTokenAmount,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) public onlyRole(REMOVE_LIQUIDITY_ROLE) {
        IAgentVeTokenV2(veToken).removeLpLiquidity(
            _uniswapRouter,
            veTokenAmount,
            recipient,
            amountAMin,
            amountBMin,
            deadline
        );
    }
}
