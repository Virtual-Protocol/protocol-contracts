// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/interfaces/IERC5805.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../virtualPersona/IAgentNft.sol";
import "../virtualPersona/IAgentDAO.sol";
import "./IContributionNft.sol";
import "./IServiceNft.sol";

contract ServiceNft is
    IServiceNft,
    Initializable,
    ERC721Upgradeable,
    ERC721EnumerableUpgradeable,
    ERC721URIStorageUpgradeable,
    OwnableUpgradeable
{
    uint256 private _nextTokenId;

    address public personaNft;
    address public contributionNft;

    uint16 public datasetImpactWeight;

    mapping(uint256 tokenId => uint8 coreId) private _cores;
    mapping(uint256 tokenId => uint256 maturity) private _maturities;
    mapping(uint256 tokenId => uint256 impact) private _impacts;
    mapping(uint256 tokenId => uint256 blockNumber) private _mintedAts;

    mapping(uint256 personaId => mapping(uint8 coreId => uint256 serviceId))
        private _coreServices; // Latest service NFT id for a core
    mapping(uint256 personaId => mapping(uint8 coreId => uint256[] serviceId))
        private _coreDatasets;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address initialAgentNft,
        address initialContributionNft,
        uint16 initialDatasetImpactWeight
    ) public initializer {
        __ERC721_init("Service", "VS");
        personaNft = initialAgentNft;
        contributionNft = initialContributionNft;
        datasetImpactWeight = initialDatasetImpactWeight;
    }

    function mint(
        uint256 virtualId,
        bytes32 descHash
    ) public returns (uint256) {
        IAgentNft.VirtualInfo memory info = IAgentNft(personaNft).virtualInfo(
            virtualId
        );
        require(_msgSender() == info.dao, "Caller is not VIRTUAL DAO");

        IGovernor personaDAO = IGovernor(info.dao);
        bytes memory mintCalldata = abi.encodeWithSignature(
            "mint(uint256,bytes32)",
            virtualId,
            descHash
        );
        address[] memory targets = new address[](1);
        targets[0] = address(this);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = mintCalldata;
        uint256 proposalId = personaDAO.hashProposal(
            targets,
            values,
            calldatas,
            descHash
        );
        _mint(info.tba, proposalId);
        _cores[proposalId] = IContributionNft(contributionNft).getCore(
            proposalId
        );
        // Calculate maturity
        _maturities[proposalId] = IAgentDAO(info.dao).getMaturity(proposalId);

        bool isModel = IContributionNft(contributionNft).isModel(proposalId);
        if (isModel) {
            emit CoreServiceUpdated(virtualId, _cores[proposalId], proposalId);
            updateImpact(virtualId, proposalId);
            _coreServices[virtualId][_cores[proposalId]] = proposalId;
        } else {
            _coreDatasets[virtualId][_cores[proposalId]].push(proposalId);
        }

        emit NewService(
            proposalId,
            _cores[proposalId],
            _maturities[proposalId],
            _impacts[proposalId],
            isModel
        );

        return proposalId;
    }

    function updateImpact(uint256 virtualId, uint256 proposalId) public {
        // Calculate impact
        // Get current service maturity
        uint256 prevServiceId = _coreServices[virtualId][_cores[proposalId]];
        uint256 rawImpact = (_maturities[proposalId] >
            _maturities[prevServiceId])
            ? _maturities[proposalId] - _maturities[prevServiceId]
            : 0;
        uint256 datasetId = IContributionNft(contributionNft).getDatasetId(
            proposalId
        );

        _impacts[proposalId] = rawImpact;
        if (datasetId > 0) {
            _impacts[datasetId] = (rawImpact * datasetImpactWeight) / 10000;
            _impacts[proposalId] = rawImpact - _impacts[datasetId];
            emit SetServiceScore(
                datasetId,
                _maturities[proposalId],
                _impacts[datasetId]
            );
            _maturities[datasetId] = _maturities[proposalId];
        }

        emit SetServiceScore(
            proposalId,
            _maturities[proposalId],
            _impacts[proposalId]
        );
    }

    function getCore(uint256 tokenId) public view returns (uint8) {
        _requireOwned(tokenId);
        return _cores[tokenId];
    }

    function getMaturity(uint256 tokenId) public view returns (uint256) {
        _requireOwned(tokenId);
        return _maturities[tokenId];
    }

    function getImpact(uint256 tokenId) public view returns (uint256) {
        _requireOwned(tokenId);
        return _impacts[tokenId];
    }

    function getMintedAt(uint256 tokenId) public view returns (uint256) {
        _requireOwned(tokenId);
        return _mintedAts[tokenId];
    }

    function getCoreService(
        uint256 virtualId,
        uint8 coreType
    ) public view returns (uint256) {
        return _coreServices[virtualId][coreType];
    }

    function getCoreDatasetAt(
        uint256 virtualId,
        uint8 coreType,
        uint256 index
    ) public view returns (uint256) {
        return _coreDatasets[virtualId][coreType][index];
    }

    function totalCoreDatasets(
        uint256 virtualId,
        uint8 coreType
    ) public view returns (uint256) {
        return _coreDatasets[virtualId][coreType].length;
    }

    function getCoreDatasets(
        uint256 virtualId,
        uint8 coreType
    ) public view returns (uint256[] memory) {
        return _coreDatasets[virtualId][coreType];
    }

    function setDatasetImpactWeight(uint16 weight) public onlyOwner {
        datasetImpactWeight = weight;
        emit DatasetImpactUpdated(weight);
    }

    // The following functions are overrides required by Solidity.

    function tokenURI(
        uint256 tokenId
    )
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable)
        returns (string memory)
    {
        // Service NFT is a mirror of Contribution NFT
        return IContributionNft(contributionNft).tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(
            ERC721Upgradeable,
            ERC721URIStorageUpgradeable,
            ERC721EnumerableUpgradeable
        )
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _increaseBalance(
        address account,
        uint128 amount
    ) internal override(ERC721Upgradeable, ERC721EnumerableUpgradeable) {
        return super._increaseBalance(account, amount);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    )
        internal
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }
}
