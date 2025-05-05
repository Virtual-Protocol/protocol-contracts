// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Genesis} from "./Genesis.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../virtualPersona/AgentFactoryV3.sol";
import "./GenesisTypes.sol";
import "./GenesisLib.sol";
import "../virtualPersona/AgentFactoryV3.sol";

contract FGenesis is Initializable, AccessControlUpgradeable {
    using GenesisLib for *;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");

    struct Params {
        address virtualToken;
        uint256 reserve;
        uint256 maxContribution;
        address feeAddr;
        uint256 feeAmt;
        uint256 duration;
        bytes32 tbaSalt;
        address tbaImpl;
        uint32 votePeriod;
        uint256 threshold;
        address agentFactory;
        uint256 agentTokenTotalSupply;
        uint256 agentTokenLpSupply;
    }

    Params public params;
    mapping(uint256 => address) public genesisContracts;
    uint256 public genesisID;

    event GenesisCreated(uint256 indexed id, address indexed addr);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(Params memory p) external initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _setParams(p);
    }

    function setParams(
        Params calldata p
    ) external onlyRole(ADMIN_ROLE) {
        _setParams(p);
    }

    function _setParams(Params memory p) internal {
        require(
            p.virtualToken != address(0) &&
                p.feeAddr != address(0) &&
                p.tbaImpl != address(0) &&
                p.agentFactory != address(0),
            "Invalid addr"
        );

        require(
            p.reserve > 0 &&
                p.maxContribution > 0 &&
                p.feeAmt > 0 &&
                p.duration > 0,
            "Invalid amt"
        );

        require(
            p.agentTokenTotalSupply > 0 &&
                p.agentTokenLpSupply > 0 &&
                p.agentTokenTotalSupply >= p.agentTokenLpSupply,
            "Invalid amt"
        );

        params = p;
    }

    function createGenesis(
        GenesisCreationParams memory gParams
    ) external returns (address) {
        require(
            IERC20(params.virtualToken).transferFrom(
                msg.sender,
                params.feeAddr,
                params.feeAmt
            ),
            "transfer createGenesis fee failed"
        );

        gParams.endTime = gParams.startTime + params.duration;

        genesisID++;
        address addr = GenesisLib.validateAndDeploy(
            genesisID,
            address(this),
            gParams,
            params.tbaSalt,
            params.tbaImpl,
            params.votePeriod,
            params.threshold,
            params.agentFactory,
            params.virtualToken,
            params.reserve,
            params.maxContribution,
            params.agentTokenTotalSupply,
            params.agentTokenLpSupply
        );

        // Grant BONDING_ROLE of ato the new Genesis contract
        bytes32 BONDING_ROLE = AgentFactoryV3(params.agentFactory)
            .BONDING_ROLE();
        AgentFactoryV3(params.agentFactory).grantRole(
            BONDING_ROLE,
            address(addr)
        );

        genesisContracts[genesisID] = addr;
        emit GenesisCreated(genesisID, addr);
        return addr;
    }

    function _getGenesis(uint256 id) internal view returns (Genesis) {
        address addr = genesisContracts[id];
        require(addr != address(0), "Not found");
        return Genesis(addr);
    }

    function onGenesisSuccess(
        uint256 id,
        SuccessParams calldata p
    ) external onlyRole(OPERATION_ROLE) returns (address) {
        return
            _getGenesis(id).onGenesisSuccess(
                p.refundAddresses,
                p.refundAmounts,
                p.distributeAddresses,
                p.distributeAmounts,
                p.creator
            );
    }

    function onGenesisFailed(
        uint256 id,
        uint256[] calldata participantIndexes
    ) external onlyRole(OPERATION_ROLE) {
        _getGenesis(id).onGenesisFailed(participantIndexes);
    }

    function withdrawLeftAssetsAfterFinalized(
        uint256 id,
        address to,
        address token,
        uint256 amount
    ) external onlyRole(ADMIN_ROLE) {
        _getGenesis(id).withdrawLeftAssetsAfterFinalized(to, token, amount);
    }

    function resetTime(
        uint256 id,
        uint256 newStartTime,
        uint256 newEndTime
    ) external onlyRole(OPERATION_ROLE) {
        _getGenesis(id).resetTime(newStartTime, newEndTime);
    }

    function cancelGenesis(uint256 id) external onlyRole(OPERATION_ROLE) {
        _getGenesis(id).cancelGenesis();
    }
}
