pragma solidity ^0.8.20;

// SPDX-License-Identifier: MIT
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./IMinter.sol";
import "../contribution/IServiceNft.sol";
import "../contribution/IContributionNft.sol";
import "../virtualPersona/IAgentNft.sol";
import "../virtualPersona/IAgentToken.sol";

contract Minter is IMinter, Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    address public serviceNft;
    address public contributionNft;
    address public agentNft;
    address public ipVault;

    uint256 public ipShare; // Share for IP holder
    uint256 public impactMultiplier;

    uint256 public maxImpact;

    uint256 public constant DENOM = 10000;

    mapping(uint256 => bool) _mintedNfts;

    mapping(uint256 => uint256) public impactMulOverrides;
    mapping(uint256 => uint256) public ipShareOverrides;

    bool internal locked;
    event TokenSaved(
        address indexed by,
        address indexed receiver,
        address indexed token,
        uint256 amount
    );

    modifier noReentrant() {
        require(!locked, "cannot reenter");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyAgentDAO(uint256 virtualId) {
        address daoAddress = IAgentNft(agentNft).virtualInfo(virtualId).dao;
        require(daoAddress == _msgSender(), "Only Agent DAO can operate");
        _;
    }

    address agentFactory;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address serviceAddress,
        address contributionAddress,
        address agentAddress,
        uint256 ipShare_,
        uint256 impactMultiplier_,
        address ipVault_,
        address agentFactory_,
        address initialOwner,
        uint256 maxImpact_
    ) public initializer {
        __Ownable_init(initialOwner);
        
        serviceNft = serviceAddress;
        contributionNft = contributionAddress;
        agentNft = agentAddress;
        ipShare = ipShare_;
        impactMultiplier = impactMultiplier_;
        ipVault = ipVault_;
        agentFactory = agentFactory_;
        maxImpact = maxImpact_;
    }

    modifier onlyFactory() {
        require(_msgSender() == agentFactory, "Caller is not Agent Factory");
        _;
    }

    function setServiceNft(address serviceAddress) public onlyOwner {
        serviceNft = serviceAddress;
    }

    function setContributionNft(address contributionAddress) public onlyOwner {
        contributionNft = contributionAddress;
    }

    function setIPShare(uint256 _ipShare) public onlyOwner {
        ipShare = _ipShare;
        emit IPShareUpdated(_ipShare);
    }

    function setIPShareOverride(
        uint256 virtualId,
        uint256 _ipShare
    ) public onlyAgentDAO(virtualId) {
        ipShareOverrides[virtualId] = _ipShare;
        emit AgentIPShareUpdated(virtualId, _ipShare);
    }

    function setIPVault(address _ipVault) public onlyOwner {
        ipVault = _ipVault;
    }

    function setAgentFactory(address _factory) public onlyOwner {
        agentFactory = _factory;
    }

    function setImpactMultiplier(uint256 _multiplier) public onlyOwner {
        impactMultiplier = _multiplier;
        emit ImpactMultiplierUpdated(_multiplier);
    }

    function setImpactMulOverride(
        uint256 virtualId,
        uint256 mul
    ) public onlyOwner {
        impactMulOverrides[virtualId] = mul;
        emit AgentImpactMultiplierUpdated(virtualId, mul);
    }

    function setMaxImpact(uint256 maxImpact_) public onlyOwner {
        maxImpact = maxImpact_;
    }

    function _getImpactMultiplier(
        uint256 virtualId
    ) internal view returns (uint256) {
        uint256 mul = impactMulOverrides[virtualId];
        if (mul == 0) {
            mul = impactMultiplier;
        }
        return mul;
    }

    function mint(uint256 nftId) public noReentrant {
        // Mint configuration:
        // 1. ELO impact amount, to be shared between model and dataset owner
        // 2. IP share amount, ontop of the ELO impact
        // This is safe to be called by anyone as the minted token will be sent to NFT owner only.

        require(!_mintedNfts[nftId], "Already minted");

        uint256 virtualId = IContributionNft(contributionNft).tokenVirtualId(
            nftId
        );
        require(virtualId != 0, "Agent not found");

        _mintedNfts[nftId] = true;

        address tokenAddress = IAgentNft(agentNft).virtualInfo(virtualId).token;
        IContributionNft contribution = IContributionNft(contributionNft);
        require(contribution.isModel(nftId), "Not a model contribution");

        uint256 finalImpactMultiplier = _getImpactMultiplier(virtualId);
        uint256 datasetId = contribution.getDatasetId(nftId);
        uint256 impact = IServiceNft(serviceNft).getImpact(nftId);
        if (impact > maxImpact) {
            impact = maxImpact;
        }
        uint256 amount = (impact * finalImpactMultiplier * 10 ** 18) / DENOM;
        uint256 dataAmount = datasetId > 0
            ? (IServiceNft(serviceNft).getImpact(datasetId) *
                finalImpactMultiplier *
                10 ** 18) / DENOM
            : 0;
        uint256 ipAmount = ((amount + dataAmount) * ipShare) / DENOM;

        // Mint to model owner
        if (amount > 0) {
            address modelOwner = IERC721(contributionNft).ownerOf(nftId);
            IAgentToken(tokenAddress).transfer(modelOwner, amount);
        }

        // Mint to Dataset owner
        if (datasetId != 0) {
            address datasetOwner = IERC721(contributionNft).ownerOf(datasetId);
            IAgentToken(tokenAddress).transfer(datasetOwner, dataAmount);
        }

        // To IP vault
        if (ipAmount > 0) {
            IAgentToken(tokenAddress).transfer(ipVault, ipAmount);
        }
    }

    function saveToken(
        address _token,
        address _receiver,
        uint256 _amount
    ) external onlyOwner {
        IERC20(_token).safeTransfer(_receiver, _amount);
        emit TokenSaved(_msgSender(), _receiver, _token, _amount);
    }
}
