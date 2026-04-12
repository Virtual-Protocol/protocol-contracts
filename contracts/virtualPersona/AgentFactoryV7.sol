// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "./IAgentFactoryV7.sol";
import "./IAgentTokenV3.sol";
import "./IAgentTokenV4.sol";
import "./IAgentVeTokenV2.sol";
import "./IAgentDAO.sol";
import "./IAgentNft.sol";
import "../libs/IERC6551Registry.sol";
import "../pool/IUniswapV2Router02.sol";

/// @dev Minimal surface for AgentTokenV3 tax migration (same clone shape as V4-bound factory).
interface IAgentTokenV3Sweep {
    function swapThresholdBasisPoints() external view returns (uint16);

    function distributeTaxTokens() external;

    function setProjectTaxRecipient(address projectTaxRecipient_) external;
}

interface IAgentTaxV2Deposit {
    function depositTax(address tokenAddress, uint256 amount) external;
}

/**
 * @title AgentFactoryV7
 * @notice Factory contract for creating V3 agent tokens used with BondingV5
 * @dev This is a separate factory from AgentFactoryV6 to ensure clean separation of V4 and V5 ecosystems:
 *      - AgentFactoryV6 + AgentTokenV2 + BondingV4 + FRouterV2 → AgentTax (tax-listener)
 *      - AgentFactoryV7 + AgentTokenV4 + BondingV5 + FRouterV3 → AgentTaxV2 (on-chain attribution)
 *
 *      The key difference is that AgentFactoryV7's `projectTaxRecipient` in _tokenTaxParams
 *      should be set to AgentTaxV2 address, enabling on-chain tax attribution for graduated tokens.
 *
 *      Why separate factory instead of reusing AgentFactoryV6?
 *      - AgentFactoryV6 has a single _tokenTaxParams containing projectTaxRecipient
 *      - If projectTaxRecipient = AgentTax: V5 graduated tokens fail (AgentTax lacks depositTax interface)
 *      - If projectTaxRecipient = AgentTaxV2: V4 graduated tokens fail (not registered via registerToken)
 *      - Solution: Separate factories with their own projectTaxRecipient configuration
 */
contract AgentFactoryV7 is
    IAgentFactoryV7,
    Initializable,
    AccessControl,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    uint256 private _nextId;
    // this is for BE to fill virtual.personaProposalId field, AgentFactoryV7 should start from 70_000_000_000
    // (AgentFactoryV6 uses 60_000_000_000)
    uint256 public constant nextIdBase = 70_000_000_000;
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
    bytes private _tokenSupplyParams; // deprecated
    bytes private _tokenTaxParams; // Contains projectTaxRecipient - should be AgentTaxV2 for V7
    uint16 private _tokenMultiplier; // Unused

    bytes32 public constant BONDING_ROLE = keccak256("BONDING_ROLE");
    bytes32 public constant REMOVE_LIQUIDITY_ROLE =
        keccak256("REMOVE_LIQUIDITY_ROLE");

    ///////////////////////////////////////////////////////////////

    mapping(address => bool) private _existingAgents;

    /// @dev Injected into each new AgentTokenV4 via `initialize(..., taxAccountingAdapter)`.
    address public taxAccountingAdapter;

    /// @dev Matches AgentTokenV3 `SWAP_THRESHOLD_DENOMINATOR` / `MAX_SWAP_THRESHOLD_MULTIPLE` for capped sweeps.
    uint256 private constant V3_SWAP_THRESHOLD_DENOMINATOR = 1_000_000;
    uint256 private constant V3_MAX_SWAP_THRESHOLD_MULTIPLE = 20;

    error AgentAlreadyExists();
    error RouterNotSet();
    error TokenTaxParamsNotSet();

    event V3ProjectTaxSwept(
        address indexed agentToken,
        uint256 agentSold,
        uint256 virtualDeposited
    );

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
        address lp = IAgentTokenV3(token).liquidityPools()[0];
        IERC20(assetToken).safeTransfer(token, initialAmount);
        IAgentTokenV3(token).addInitialLiquidity(address(this));

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
        IAgentTokenV4(instance).initialize(
            [_tokenAdmin, _uniswapRouter, assetToken],
            abi.encode(name, symbol),
            tokenSupplyParams_,
            _tokenTaxParams,
            taxAccountingAdapter
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

    /**
     * @notice Set token tax parameters including projectTaxRecipient
     * @dev For V7, projectTaxRecipient MUST be set to AgentTaxV2 address
     *      to enable on-chain tax attribution for graduated tokens.
     *      This is the key configuration difference from AgentFactoryV6.
     *      Tax accounting adapter is configured separately via `setTaxAccountingAdapter`.
     */
    function setTokenParams(
        uint256 projectBuyTaxBasisPoints,
        uint256 projectSellTaxBasisPoints,
        uint256 taxSwapThresholdBasisPoints,
        address projectTaxRecipient
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _tokenTaxParams = abi.encode(
            projectBuyTaxBasisPoints,
            projectSellTaxBasisPoints,
            taxSwapThresholdBasisPoints,
            projectTaxRecipient
        );
    }

    /**
     * @notice Sets the TaxAccountingAdapter address injected into new AgentTokenV4 clones at initialize.
     */
    function setTaxAccountingAdapter(
        address taxAccountingAdapter_
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        taxAccountingAdapter = taxAccountingAdapter_;
    }

    /**
     * @notice Sets `projectTaxRecipient` on a graduated agent token (legacy AgentTokenV3-shaped clone) to this factory (required before sweeping).
     * @dev Existing agent tokens are not upgraded: they already expose `setProjectTaxRecipient` under `onlyOwnerOrFactory`.
     *      When the token's `_factory` is this contract, factory admin can call this with no bytecode change on the token.
     *      Off-chain (e.g. tax-listener): call once per agent token before the first `sweepV3ProjectTaxToVirtualAndDeposit` for that token.
     */
    function setV3ProjectTaxRecipientToFactory(
        address agentToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IAgentTokenV3Sweep(agentToken).setProjectTaxRecipient(address(this));
    }

    function _projectTaxRecipientFromTokenTaxParams() internal view returns (address) {
        if (_tokenTaxParams.length == 0) revert TokenTaxParamsNotSet();
        (, , , address recipient) = abi.decode(
            _tokenTaxParams,
            (uint256, uint256, uint256, address)
        );
        return recipient;
    }

    /**
     * @notice Pulls pending project-tax agent tokens via `distributeTaxTokens`, swaps to `assetToken` with the same per-tx cap as in-token autoswap, then `depositTax` on AgentTaxV2.
     * @dev Per-token migration (no token upgrade — uses existing `onlyOwnerOrFactory` on deployed agent tokens):
     *      1) `setV3ProjectTaxRecipientToFactory(agentToken)` (requires `_factory == address(this)` on the token).
     *      2) `sweepV3ProjectTaxToVirtualAndDeposit(agentToken)` (repeat until idle if above cap).
     *      If `_factory` is not this contract, the token owner must coordinate — the factory cannot migrate alone.
     *      `depositTax` recipient is read from this factory's `_tokenTaxParams` (AgentTaxV2).
     *
     *      Tax-listener / backend batching (e.g. Base mainnet pre–TaxAccountingAdapter cohort):
     *      - Record `minVirtualId` / `maxVirtualId` from `BondingV5` at the cutoff (e.g. block before adapter go-live): virtual ids are
     *        `BondingV5.VirtualIdBase + 1` … `VirtualIdBase + tokenInfos.length` at that snapshot (see `tokenInfo[token].virtualId` on each launch).
     *      - For each `virtualId` in `[minVirtualId, maxVirtualId]`, resolve the bonding `token` (iterate `BondingV5.tokenInfos` or index events), read
     *        `BondingV5.tokenInfo(token).tradingOnUniswap` and `agentToken`; only for graduated rows call this contract with `agentToken` (not the bonding-curve token).
     *      - Run periodically: for each candidate `agentToken`, ensure recipient was set, then `sweepV3ProjectTaxToVirtualAndDeposit(agentToken)` (handle revert/skips per token).
     */
    function sweepV3ProjectTaxToVirtualAndDeposit(
        address agentToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) noReentrant {
        if (_uniswapRouter == address(0)) revert RouterNotSet();

        IAgentTokenV3Sweep token = IAgentTokenV3Sweep(agentToken);
        token.distributeTaxTokens();

        uint256 balance = IERC20(agentToken).balanceOf(address(this));
        if (balance == 0) {
            return;
        }

        uint256 totalSupply = IERC20(agentToken).totalSupply();
        uint256 swapThresholdInTokens = (totalSupply *
            uint256(token.swapThresholdBasisPoints())) /
            V3_SWAP_THRESHOLD_DENOMINATOR;

        uint256 swapBalance = balance;
        if (swapThresholdInTokens > 0) {
            uint256 cap = swapThresholdInTokens *
                V3_MAX_SWAP_THRESHOLD_MULTIPLE;
            if (swapBalance > cap) {
                swapBalance = cap;
            }
        }

        if (swapBalance == 0) {
            return;
        }

        IERC20(agentToken).forceApprove(_uniswapRouter, swapBalance);

        address[] memory path = new address[](2);
        path[0] = agentToken;
        path[1] = assetToken;

        uint256 virtualBefore = IERC20(assetToken).balanceOf(address(this));
        IUniswapV2Router02(_uniswapRouter)
            .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                swapBalance,
                0,
                path,
                address(this),
                block.timestamp + 600
            );
        uint256 received = IERC20(assetToken).balanceOf(address(this)) -
            virtualBefore;

        IERC20(agentToken).forceApprove(_uniswapRouter, 0);

        if (received == 0) {
            return;
        }

        // here cannot use agenTokenV3.projectTaxRecipient because it's been updated to agentFactoryV7
        address agentTaxV2 = _projectTaxRecipientFromTokenTaxParams();
        require(agentTaxV2 != address(0), "project tax recipient unset");

        IERC20(assetToken).forceApprove(agentTaxV2, received);
        IAgentTaxV2Deposit(agentTaxV2).depositTax(agentToken, received);
        IERC20(assetToken).forceApprove(agentTaxV2, 0);

        emit V3ProjectTaxSwept(agentToken, swapBalance, received);
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
        IAgentTokenV3(token).addBlacklistAddress(blacklistAddress);
    }

    function removeBlacklistAddress(
        address token,
        address blacklistAddress
    ) public onlyRole(BONDING_ROLE) {
        IAgentTokenV3(token).removeBlacklistAddress(blacklistAddress);
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
