// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/interfaces/IERC5805.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../virtualPersona/IPersonaNft.sol";
import "../virtualPersona/IPersonaDAO.sol";
import "./IContributionNft.sol";
import "./IServiceNft.sol";

contract ServiceNft is IServiceNft, ERC721, ERC721Enumerable, ERC721URIStorage {
    uint256 private _nextTokenId;

    address public immutable personaNft;
    address public immutable contributionNft;

    mapping(uint256 tokenId => uint8 coreId) private _cores;
    mapping(uint256 tokenId => uint16 maturity) private _maturities;
    mapping(uint256 tokenId => uint16 impact) private _impacts;
    mapping(uint256 tokenId => uint256 blockNumber) private _mintedAts;

    mapping(uint256 personaId => mapping(uint8 coreId => uint256 serviceId))
        private _coreServices; // Latest service NFT id for a core
    mapping(uint256 personaId => mapping(uint8 coreId => uint256[] serviceId))
        private _coreDatasets;

    event NewService(
        uint256 tokenId,
        uint8 coreId,
        uint16 maturity,
        uint16 impact,
        bool isModel
    );

    constructor(
        address initialPersonaNft,
        address initialContributionNft
    ) ERC721("Service", "VS") {
        personaNft = initialPersonaNft;
        contributionNft = initialContributionNft;
    }

    function mint(
        uint256 virtualId,
        bytes32 descHash
    ) external returns (uint256) {
        IPersonaNft.VirtualInfo memory info = IPersonaNft(personaNft)
            .virtualInfo(virtualId);
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
        _maturities[proposalId] = IPersonaDAO(info.dao).getMaturity(proposalId);
        // Calculate impact
        // Get current service maturity
        uint256 prevServiceId = _coreServices[virtualId][_cores[proposalId]];

        _impacts[proposalId] = _maturities[proposalId] >
            _maturities[prevServiceId]
            ? _maturities[proposalId] - _maturities[prevServiceId]
            : 0;

        bool isModel = IContributionNft(contributionNft).isModel(proposalId);

        if (isModel) {
            _coreServices[virtualId][_cores[proposalId]] = proposalId;
            emit CoreServiceUpdated(virtualId, _cores[proposalId], proposalId);
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

    function getCore(uint256 tokenId) public view returns (uint8) {
        _requireOwned(tokenId);
        return _cores[tokenId];
    }

    function getMaturity(uint256 tokenId) public view returns (uint16) {
        _requireOwned(tokenId);
        return _maturities[tokenId];
    }

    function getImpact(uint256 tokenId) public view returns (uint16) {
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

    // The following functions are overrides required by Solidity.

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        // Service NFT is a mirror of Contribution NFT
        return IContributionNft(contributionNft).tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(ERC721, ERC721URIStorage, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _increaseBalance(
        address account,
        uint128 amount
    ) internal override(ERC721, ERC721Enumerable) {
        return super._increaseBalance(account, amount);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }
}
