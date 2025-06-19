// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "./IAgentToken.sol";
import "./IAgentVeToken.sol";
import "./IAgentDAO.sol";
import "./IAgentNft.sol";
import "../libs/IERC6551Registry.sol";

contract SimpleAgentFactory is
    Initializable,
    AccessControl,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    address public tokenImplementation;

    address public assetToken; // Base currency

    address private _vault; // Vault to hold all Virtual NFTs

    address private _tokenAdmin;

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

    // Default agent token params
    bytes private _tokenSupplyParams;
    bytes private _tokenTaxParams;
    uint16 private _tokenMultiplier; // Unused

    ///////////////////////////////////////////////////////////////

    mapping(address => bool) private _existingAgents;

    error AgentAlreadyExists();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address tokenImplementation_,
        address assetToken_,
        address vault_
    ) public initializer {
        __Pausable_init();

        tokenImplementation = tokenImplementation_;
        assetToken = assetToken_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _vault = vault_;
    }

    function setParams(
        address newRouter,
        address newTokenAdmin
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _uniswapRouter = newRouter;
        _tokenAdmin = newTokenAdmin;
    }

    function createNewAgentToken(
        string memory name,
        string memory symbol,
        bytes32 salt
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (address instance) {
        instance = Clones.cloneDeterministic(tokenImplementation, salt);
        if (_existingAgents[instance]) {
            revert AgentAlreadyExists();
        }
        _existingAgents[instance] = true;
        IAgentToken(instance).initialize(
            [_tokenAdmin, _uniswapRouter, assetToken],
            abi.encode(name, symbol),
            _tokenSupplyParams,
            _tokenTaxParams
        );

        allTradingTokens.push(instance);
        return instance;
    }

    function setVault(address newVault) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _vault = newVault;
    }

    function setImplementations(
        address token
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        tokenImplementation = token;
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
}
