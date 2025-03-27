// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

import "./AgentNftV2.sol";
import "./IAgentVeToken.sol";
import "./IAgentDAO.sol";
import "./IAgentToken.sol";

contract AgentMigrator is Ownable, Pausable {
    AgentNftV2 private _nft;

    bytes private _tokenSupplyParams;
    bytes private _tokenTaxParams;
    address private _tokenAdmin;
    address private _assetToken;
    address private _uniswapRouter;
    uint256 public initialAmount;
    address public tokenImplementation;
    address public daoImplementation;
    address public veTokenImplementation;
    uint256 public maturityDuration;

    mapping(uint256 => bool) public migratedAgents;

    bool internal locked;

    event AgentMigrated(
        uint256 virtualId,
        address dao,
        address token,
        address lp,
        address veToken
    );

    modifier noReentrant() {
        require(!locked, "cannot reenter");
        locked = true;
        _;
        locked = false;
    }

    constructor(address agentNft_) Ownable(_msgSender()) {
        _nft = AgentNftV2(agentNft_);
    }

    function setInitParams(
        address tokenAdmin_,
        address assetToken_,
        address uniswapRouter_,
        uint256 initialAmount_,
        uint256 maturityDuration_
    ) external onlyOwner {
        _tokenAdmin = tokenAdmin_;
        _assetToken = assetToken_;
        _uniswapRouter = uniswapRouter_;
        initialAmount = initialAmount_;
        maturityDuration = maturityDuration_;
    }

    function setTokenSupplyParams(
        uint256 maxSupply,
        uint256 lpSupply,
        uint256 vaultSupply,
        uint256 maxTokensPerWallet,
        uint256 maxTokensPerTxn,
        uint256 botProtectionDurationInSeconds,
        address vault
    ) public onlyOwner {
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
    }

    function setTokenTaxParams(
        uint256 projectBuyTaxBasisPoints,
        uint256 projectSellTaxBasisPoints,
        uint256 taxSwapThresholdBasisPoints,
        address projectTaxRecipient
    ) public onlyOwner {
        require(
            projectBuyTaxBasisPoints <= 10000 &&
                projectSellTaxBasisPoints <= 10000 &&
                taxSwapThresholdBasisPoints <= 10000,
            "Invalid tax params"
        );
        _tokenTaxParams = abi.encode(
            projectBuyTaxBasisPoints,
            projectSellTaxBasisPoints,
            taxSwapThresholdBasisPoints,
            projectTaxRecipient
        );
    }

    function setImplementations(
        address token,
        address veToken,
        address dao
    ) external onlyOwner {
        tokenImplementation = token;
        daoImplementation = dao;
        veTokenImplementation = veToken;
    }

    function migrateAgent(
        uint256 id,
        string memory name,
        string memory symbol,
        bool canStake
    ) external noReentrant whenNotPaused {
        require(!migratedAgents[id], "Agent already migrated");

        IAgentNft.VirtualInfo memory virtualInfo = _nft.virtualInfo(id);
        address founder = virtualInfo.founder;
        require(founder == _msgSender(), "Not founder");

        // Deploy Agent token & LP
        address token = _createNewAgentToken(name, symbol);
        address lp = IAgentToken(token).liquidityPools()[0];
        IERC20(_assetToken).transferFrom(founder, token, initialAmount);
        IAgentToken(token).addInitialLiquidity(address(this));

        // Deploy AgentVeToken
        address veToken = _createNewAgentVeToken(
            string.concat("Staked ", name),
            string.concat("s", symbol),
            lp,
            founder,
            canStake
        );

        // Deploy DAO
        IGovernor oldDAO = IGovernor(virtualInfo.dao);
        address payable dao = payable(
            _createNewDAO(
                oldDAO.name(),
                IVotes(veToken),
                uint32(oldDAO.votingPeriod()),
                oldDAO.proposalThreshold()
            )
        );
        // Update AgentNft
        _nft.migrateVirtual(id, dao, token, lp, veToken);

        IERC20(lp).approve(veToken, type(uint256).max);
        IAgentVeToken(veToken).stake(
            IERC20(lp).balanceOf(address(this)),
            founder,
            founder
        );

        migratedAgents[id] = true;

        emit AgentMigrated(id, dao, token, lp, veToken);
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
            address(_nft),
            daoThreshold,
            daoVotingPeriod
        );

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
        IAgentVeToken(instance).initialize(
            name,
            symbol,
            founder,
            stakingAsset,
            block.timestamp + maturityDuration,
            address(_nft),
            canStake
        );

        return instance;
    }

    function _createNewAgentToken(
        string memory name,
        string memory symbol
    ) internal returns (address instance) {
        instance = Clones.clone(tokenImplementation);
        IAgentToken(instance).initialize(
            [_tokenAdmin, _uniswapRouter, _assetToken],
            abi.encode(name, symbol),
            _tokenSupplyParams,
            _tokenTaxParams
        );

        return instance;
    }

    function pause() external onlyOwner {
        super._pause();
    }

    function unpause() external onlyOwner {
        super._unpause();
    }

    function reset(uint256 id) external onlyOwner {
        migratedAgents[id] = false;
    }
}
