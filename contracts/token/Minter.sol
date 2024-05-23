pragma solidity ^0.8.20;

// SPDX-License-Identifier: MIT

import "./IMinter.sol";
import "../contribution/IServiceNft.sol";
import "../contribution/IContributionNft.sol";
import "../virtualPersona/IAgentNft.sol";
import "../virtualPersona/IAgentToken.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Minter is IMinter, Ownable {
    address public serviceNft;
    address public contributionNft;
    address public agentNft;
    address public ipVault;

    uint256 public ipShare; // Share for IP holder
    uint256 public dataShare; // Share for Dataset provider

    uint256 public bootstrapAmount; // Amount for initial LP bootstrap

    mapping(uint256 => bool) _minted;

    bool internal locked;

    address agentFactory;

    constructor(
        address serviceAddress,
        address contributionAddress,
        address agentAddress,
        uint256 _ipShare,
        address _ipVault,
        address _agentFactory,
        address initialOwner
    ) Ownable(initialOwner) {
        serviceNft = serviceAddress;
        contributionNft = contributionAddress;
        agentNft = agentAddress;
        ipShare = _ipShare;
        ipVault = _ipVault;
        agentFactory = _agentFactory;
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

    function setIpShare(uint256 _ipShare) public onlyOwner {
        ipShare = _ipShare;
    }

    function setDataShare(uint256 _dataShare) public onlyOwner {
        dataShare = _dataShare;
    }

    function setIPVault(address _ipVault) public onlyOwner {
        ipVault = _ipVault;
    }

    function setAgentFactory(address _factory) public onlyOwner {
        agentFactory = _factory;
    }

    function setBootstrapAmount(uint256 amount) public onlyOwner {
        bootstrapAmount = amount;
    }

    function mintInitial(address token) public onlyFactory {
        IAgentToken(token).mint(_msgSender(), bootstrapAmount);
    }

    function mint(uint256 nftId) public {
        // Mint configuration:
        // 1. ELO impact amount, to be shared between model and dataset owner
        // 2. IP share amount, ontop of the ELO impact

        require(!_minted[nftId], "Already minted");

        uint256 agentId = IContributionNft(contributionNft).tokenVirtualId(
            nftId
        );
        require(agentId != 0, "Agent not found");

        address dao = address(IContributionNft(contributionNft).getAgentDAO(agentId));
        require(_msgSender() == dao, "Caller is not Agent DAO");

        _minted[nftId] = true;

        address tokenAddress = IAgentNft(agentNft).virtualInfo(agentId).token;
        uint256 datasetId = IContributionNft(contributionNft).getDatasetId(
            nftId
        );
        uint256 amount = IServiceNft(serviceNft).getImpact(nftId);
        uint256 ipAmount = (amount * ipShare) / 10000;
        uint256 dataAmount = 0;

        if (datasetId != 0) {
            dataAmount = (amount * ipShare) / 10000;
            amount = amount - dataAmount;
        }

        // Mint to model owner
        if (amount > 0) {
            address modelOwner = IERC721(contributionNft).ownerOf(nftId);
            IAgentToken(tokenAddress).mint(modelOwner, amount);
        }

        // Mint to Dataset owner
        if (datasetId != 0 && dataAmount > 0) {
            address datasetOwner = IERC721(contributionNft).ownerOf(datasetId);
            IAgentToken(tokenAddress).mint(datasetOwner, dataAmount);
        }

        // To IP vault
        if (ipAmount > 0) {
            IAgentToken(tokenAddress).mint(ipVault, ipAmount);
        }
    }
}