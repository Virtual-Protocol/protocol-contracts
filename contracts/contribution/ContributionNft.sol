// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/interfaces/IERC5805.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./IContributionNft.sol";
import "../virtualPersona/IAgentNft.sol";

contract ContributionNft is
    IContributionNft,
    Initializable,
    ERC721Upgradeable,
    ERC721EnumerableUpgradeable,
    ERC721URIStorageUpgradeable
{
    address public personaNft;

    mapping(uint256 => uint256) private _contributionVirtualId;
    mapping(uint256 => uint256) private _parents;
    mapping(uint256 => uint256[]) private _children;
    mapping(uint256 => uint8) private _cores;

    mapping(uint256 => bool) public modelContributions;
    mapping(uint256 => uint256) public modelDatasets;

    event NewContribution(
        uint256 tokenId,
        uint256 virtualId,
        uint256 parentId,
        uint256 datasetId
    );

    address private _admin; // Admin is able to create contribution proposal without votes

    function initialize(address thePersonaAddress) public initializer {
        __ERC721_init("Contribution", "VC");
        personaNft = thePersonaAddress;
        _admin = _msgSender();
    }

    function tokenVirtualId(uint256 tokenId) public view returns (uint256) {
        return _contributionVirtualId[tokenId];
    }

    function getAgentDAO(uint256 virtualId) public view returns (IGovernor) {
        return IGovernor(IAgentNft(personaNft).virtualInfo(virtualId).dao);
    }

    function isAccepted(uint256 tokenId) public view returns (bool) {
        uint256 virtualId = _contributionVirtualId[tokenId];
        IGovernor personaDAO = getAgentDAO(virtualId);
        return personaDAO.state(tokenId) == IGovernor.ProposalState.Succeeded;
    }

    function mint(
        address to,
        uint256 virtualId,
        uint8 coreId,
        string memory newTokenURI,
        uint256 proposalId,
        uint256 parentId,
        bool isModel_,
        uint256 datasetId
    ) external returns (uint256) {
        IGovernor personaDAO = getAgentDAO(virtualId);
        require(
            msg.sender == personaDAO.proposalProposer(proposalId),
            "Only proposal proposer can mint Contribution NFT"
        );
        require(parentId != proposalId, "Cannot be parent of itself");

        _mint(to, proposalId);
        _setTokenURI(proposalId, newTokenURI);
        _contributionVirtualId[proposalId] = virtualId;
        _parents[proposalId] = parentId;
        _children[parentId].push(proposalId);
        _cores[proposalId] = coreId;

        if (isModel_) {
            modelContributions[proposalId] = true;
            modelDatasets[proposalId] = datasetId;
        }

        emit NewContribution(proposalId, virtualId, parentId, datasetId);

        return proposalId;
    }

    function getAdmin() public view override returns (address) {
        return _admin;
    }

    function setAdmin(address newAdmin) public {
        require(_msgSender() == _admin, "Only admin can set admin");
        _admin = newAdmin;
    }

    // The following functions are overrides required by Solidity.

    function tokenURI(
        uint256 tokenId
    )
        public
        view
        override(
            IContributionNft,
            ERC721Upgradeable,
            ERC721URIStorageUpgradeable
        )
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function getChildren(
        uint256 tokenId
    ) public view returns (uint256[] memory) {
        return _children[tokenId];
    }

    function getParentId(uint256 tokenId) public view returns (uint256) {
        return _parents[tokenId];
    }

    function getCore(uint256 tokenId) public view returns (uint8) {
        return _cores[tokenId];
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

    function isModel(uint256 tokenId) public view returns (bool) {
        return modelContributions[tokenId];
    }

    function ownerOf(
        uint256 tokenId
    ) public view override(IERC721, ERC721Upgradeable) returns (address) {
        return _ownerOf(tokenId);
    }

    function getDatasetId(
        uint256 tokenId
    ) external view returns (uint256) {
        return modelDatasets[tokenId];
    }
}
