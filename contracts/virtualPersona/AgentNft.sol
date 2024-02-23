// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC5805} from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/interfaces/IERC5805.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./IAgentNft.sol";
import "./CoreRegistry.sol";
import "./ValidatorRegistry.sol";
import "./IAgentDAO.sol";

contract AgentNft is
    IAgentNft,
    Initializable,
    ERC721Upgradeable,
    ERC721URIStorageUpgradeable,
    AccessControlUpgradeable,
    CoreRegistry,
    ValidatorRegistry
{
    uint256 private _nextVirtualId;
    mapping(address => uint256) private _stakingTokenToVirtualId;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant VALIDATOR_ADMIN_ROLE =
        keccak256("VALIDATOR_ADMIN_ROLE"); // Validator admin can manage validators for all personas

    modifier onlyVirtualDAO(uint256 virtualId) {
        require(
            _msgSender() == virtualInfos[virtualId].dao,
            "Caller is not VIRTUAL DAO"
        );
        _;
    }

    modifier onlyService() {
        require(_msgSender() == _serviceNft, "Caller is not Service NFT");
        _;
    }

    mapping(uint256 => VirtualInfo) public virtualInfos;

    address private _contributionNft;
    address private _serviceNft;

    function initialize(address defaultAdmin) public initializer {
        __ERC721_init("Persona", "PERSONA");
        __CoreRegistry_init();
        __ValidatorRegistry_init(
            _validatorScoreOf,
            totalProposals,
            _getPastValidatorScore
        );
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(VALIDATOR_ADMIN_ROLE, defaultAdmin);
        _nextVirtualId = 1;
    }

    function setContributionService(
        address contributionNft_,
        address serviceNft_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _contributionNft = contributionNft_;
        _serviceNft = serviceNft_;
    }

    function mint(
        address to,
        string memory newTokenURI,
        address payable theDAO,
        address founder,
        uint8[] memory coreTypes
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        uint256 virtualId = _nextVirtualId++;
        _mint(to, virtualId);
        _setTokenURI(virtualId, newTokenURI);
        VirtualInfo storage info = virtualInfos[virtualId];
        info.dao = theDAO;
        info.coreTypes = coreTypes;
        info.founder = founder;
        IERC5805 daoToken = GovernorVotes(theDAO).token();
        info.token = address(daoToken);
        _stakingTokenToVirtualId[address(daoToken)] = virtualId;
        _addValidator(virtualId, founder);
        return virtualId;
    }

    function addCoreType(
        string memory label
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        super._addCoreType(label);
    }

    function virtualInfo(
        uint256 virtualId
    ) public view returns (VirtualInfo memory) {
        return virtualInfos[virtualId];
    }

    // Get VIRTUAL ID of a staking token
    function stakingTokenToVirtualId(
        address stakingToken
    ) external view returns (uint256) {
        return _stakingTokenToVirtualId[stakingToken];
    }

    function addValidator(
        uint256 virtualId,
        address validator
    ) public onlyRole(VALIDATOR_ADMIN_ROLE) {
        _addValidator(virtualId, validator);
        _initValidatorScore(virtualId, validator);
    }

    function _validatorScoreOf(
        uint256 virtualId,
        address account
    ) internal view returns (uint256) {
        VirtualInfo memory info = virtualInfos[virtualId];
        IAgentDAO dao = IAgentDAO(info.dao);
        return dao.scoreOf(account);
    }

    function _getPastValidatorScore(
        uint256 virtualId,
        address account,
        uint256 timepoint
    ) internal view returns (uint256) {
        VirtualInfo memory info = virtualInfos[virtualId];
        IAgentDAO dao = IAgentDAO(info.dao);
        return dao.getPastScore(account, timepoint);
    }

    function totalProposals(uint256 virtualId) public view returns (uint256) {
        VirtualInfo memory info = virtualInfos[virtualId];
        IAgentDAO dao = IAgentDAO(info.dao);
        return dao.proposalCount();
    }

    function setCoreTypes(
        uint256 virtualId,
        uint8[] memory coreTypes
    ) external onlyVirtualDAO(virtualId) {
        VirtualInfo storage info = virtualInfos[virtualId];
        info.coreTypes = coreTypes;
        emit CoresUpdated(virtualId, coreTypes);
    }

    function setTokenURI(
        uint256 virtualId,
        string memory newTokenURI
    ) public onlyVirtualDAO(virtualId) {
        return _setTokenURI(virtualId, newTokenURI);
    }

    function setTBA(
        uint256 virtualId,
        address tba
    ) external onlyRole(MINTER_ROLE) {
        VirtualInfo storage info = virtualInfos[virtualId];
        require(info.tba == address(0), "TBA already set");
        info.tba = tba;
    }

    function setDAO(uint256 virtualId, address newDAO) public {
        require(
            _msgSender() == virtualInfos[virtualId].dao,
            "Caller is not VIRTUAL DAO"
        );
        VirtualInfo storage info = virtualInfos[virtualId];
        info.dao = newDAO;
    }

    function totalStaked(uint256 virtualId) public view returns (uint256) {
        return IERC20(virtualInfos[virtualId].token).totalSupply();
    }

    function getVotes(
        uint256 virtualId,
        address validator
    ) public view returns (uint256) {
        return IERC5805(virtualInfos[virtualId].token).getVotes(validator);
    }

    function getContributionNft() public view returns (address) {
        return _contributionNft;
    }

    function getServiceNft() public view returns (address) {
        return _serviceNft;
    }

    function getAllServices(
        uint256 virtualId
    ) public view returns (uint256[] memory) {
        VirtualInfo memory info = virtualInfos[virtualId];
        IERC721Enumerable serviceNft = IERC721Enumerable(_serviceNft);
        uint256 total = serviceNft.balanceOf(info.tba);
        uint256[] memory services = new uint256[](total);
        for (uint256 i = 0; i < total; i++) {
            services[i] = serviceNft.tokenOfOwnerByIndex(info.tba, i);
        }
        return services;
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
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(
            ERC721Upgradeable,
            ERC721URIStorageUpgradeable,
            AccessControlUpgradeable
        )
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function totalSupply() public view returns (uint256) {
        return _nextVirtualId - 1;
    }
}
