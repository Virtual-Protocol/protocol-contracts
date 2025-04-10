// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./FGenesis.sol";
import "../virtualPersona/IAgentFactoryV3.sol";
// import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./GenesisTypes.sol";

contract Genesis is ReentrancyGuard, AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    mapping(address => uint256) public mapAddrToVirtuals;
    mapping(address => uint256) public claimableAgentTokens;
    address[] public participants;
    
    uint256 public genesisId;
    FGenesis public factory;

    // Genesis-related variables
    uint256 public startTime;
    uint256 public endTime;
    string public genesisName;
    string public genesisTicker;
    uint8[] public genesisCores;

    // TBA and DAO parameters
    bytes32 public tbaSalt;
    address public tbaImplementation;
    uint32 public daoVotingPeriod;
    uint256 public daoThreshold;
    address public agentFactoryAddress;
    address public virtualTokenAddress;
    uint256 public reserveAmount;
    uint256 public maxContributionVirtualAmount;
    uint256 public agentTokenTotalSupply;
    uint256 public agentTokenLpSupply;

    address public agentTokenAddress;
    bool public isFailed;

    event GenesisFinalized(uint256 indexed genesisID, bool isSuccess);
    event Participated(uint256 indexed genesisID, address indexed user, uint256 point, uint256 virtuals);
    event RefundClaimed(uint256 indexed genesisID, address indexed user, uint256 amount);
    event AgentTokenClaimed(uint256 indexed genesisID, address indexed user, uint256 amount);
    event VirtualsWithdrawn(uint256 indexed genesisID, address indexed to, address token, uint256 amount);
    
    struct ParticipantInfo {
        address userAddress;
        uint256 virtuals;
    }

    function initialize(GenesisInitParams calldata params) external initializer {
        __AccessControl_init();

        require(params.genesisID > 0, "Invalid genesis ID");
        require(params.factory != address(0), "Invalid factory address");
        require(params.startTime > block.timestamp, "Start time must be in the future");
        require(params.endTime > params.startTime, "End time must be after start time");
        require(bytes(params.genesisName).length > 0, "Invalid genesis name");
        require(bytes(params.genesisTicker).length > 0, "Invalid genesis ticker");
        require(params.genesisCores.length > 0, "Invalid genesis cores");
        require(params.tbaImplementation != address(0), "Invalid TBA implementation address");
        require(params.agentFactoryAddress != address(0), "Invalid agent factory address");
        require(params.virtualTokenAddress != address(0), "Invalid virtual token address");
        require(params.reserveAmount > 0, "Reserve amount must be greater than 0");
        require(params.maxContributionVirtualAmount > 0, "Max contribution must be greater than 0");
        require(params.agentTokenTotalSupply > 0, "Agent token total supply must be greater than 0");
        require(params.agentTokenLpSupply > 0, "Agent token lp supply must be greater than 0");
        require(params.agentTokenTotalSupply >= params.agentTokenLpSupply, "Agent token total supply must be greater than agent token lp supply");
        
        genesisId = params.genesisID;
        factory = FGenesis(params.factory);
        startTime = params.startTime;
        endTime = params.endTime;
        genesisName = params.genesisName;
        genesisTicker = params.genesisTicker;
        genesisCores = params.genesisCores;
        tbaSalt = params.tbaSalt;
        tbaImplementation = params.tbaImplementation;
        daoVotingPeriod = params.daoVotingPeriod;
        daoThreshold = params.daoThreshold;
        agentFactoryAddress = params.agentFactoryAddress;
        virtualTokenAddress = params.virtualTokenAddress;
        reserveAmount = params.reserveAmount;
        maxContributionVirtualAmount = params.maxContributionVirtualAmount;
        agentTokenTotalSupply = params.agentTokenTotalSupply;
        agentTokenLpSupply = params.agentTokenLpSupply;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(FACTORY_ROLE, msg.sender);
        _grantRole(FACTORY_ROLE, params.factory);
    }

    function participate(
        uint256 pointAmt,
        uint256 virtualsAmt,
        address userAddress
    ) external nonReentrant {
        require(isStarted(), "Genesis has not started yet");
        require(!isEnded(), "Genesis has ended");
        require(!isFailed, "Genesis has failed");

        require(pointAmt > 0, "Point amount must be greater than 0");
        require(virtualsAmt > 0, "Virtuals must be greater than 0");
        
        // Check single submission upper limit
        require(virtualsAmt <= maxContributionVirtualAmount, 
            "Exceeds maximum virtuals per contribution");

        // Add balance check
        require(
            IERC20(virtualTokenAddress).balanceOf(msg.sender) >= virtualsAmt,
            "Insufficient Virtual Token balance"
        );
        // Add allowance check
        require(
            IERC20(virtualTokenAddress).allowance(msg.sender, address(this)) >= virtualsAmt,
            "Insufficient Virtual Token allowance"
        );
        
        // Update participant list
        if (mapAddrToVirtuals[userAddress] == 0) {
            participants.push(userAddress);
        }
        
        // Update state
        mapAddrToVirtuals[userAddress] += virtualsAmt;

        IERC20(virtualTokenAddress).safeTransferFrom(msg.sender, address(this), virtualsAmt);
        
        emit Participated(genesisId, userAddress, pointAmt, virtualsAmt);
    }

    function onGenesisSuccess(
        address[] calldata refundVirtualsTokenUserAddresses,
        uint256[] calldata refundVirtualsTokenUserAmounts,
        address[] calldata distributeAgentTokenUserAddresses,
        uint256[] calldata distributeAgentTokenUserAmounts
    ) external onlyRole(FACTORY_ROLE) nonReentrant returns (address) {
        require(isEnded(), "Genesis not ended yet");
        require(!isFailed, "Genesis has failed");
        require(
            refundVirtualsTokenUserAddresses.length == refundVirtualsTokenUserAmounts.length, 
            "Mismatched refund arrays"
        );
        require(
            distributeAgentTokenUserAddresses.length == distributeAgentTokenUserAmounts.length, 
            "Mismatched distribution arrays"
        );

        // Calculate total refund amount
        uint256 totalRefundAmount = 0;
        for (uint256 i = 0; i < refundVirtualsTokenUserAmounts.length; i++) {
            // check if the user has enough virtuals committed
            require(
                mapAddrToVirtuals[refundVirtualsTokenUserAddresses[i]] >= refundVirtualsTokenUserAmounts[i],
                "Insufficient Virtual Token committed"
            );
            totalRefundAmount += refundVirtualsTokenUserAmounts[i];
        }

        // Check if launch has been called before
        bool isFirstLaunch = agentTokenAddress == address(0);
        // Calculate required balance based on whether this is first launch
        uint256 requiredVirtualsBalance = isFirstLaunch ? 
            totalRefundAmount + reserveAmount : 
            totalRefundAmount;
        // Check if contract has enough virtuals balance
        require(
            IERC20(virtualTokenAddress).balanceOf(address(this)) >= requiredVirtualsBalance,
            "Insufficient Virtual Token balance"
        );

        // Only do launch related operations if this is first launch
        if (isFirstLaunch) {
            // grant allowance to agentFactoryAddress for launch
            IERC20(virtualTokenAddress).approve(agentFactoryAddress, reserveAmount);

            // Call initFromBondingCurve and executeBondingCurveApplication
            uint256 id = IAgentFactoryV3(agentFactoryAddress).initFromBondingCurve(
                string.concat(genesisName, " by Virtuals"),
                genesisTicker,
                genesisCores,
                tbaSalt,
                tbaImplementation,
                daoVotingPeriod,
                daoThreshold,
                reserveAmount,
                msg.sender
            );

            address agentToken = IAgentFactoryV3(agentFactoryAddress)
                .executeBondingCurveApplication(
                    id,
                    agentTokenTotalSupply,
                    agentTokenLpSupply,
                    address(this) // vault
                );

            // Store the created agent token address
            agentTokenAddress = agentToken;
        }

        // Calculate total distribution amount
        uint256 totalDistributionAmount = 0;
        for (uint256 i = 0; i < distributeAgentTokenUserAmounts.length; i++) {
            totalDistributionAmount += distributeAgentTokenUserAmounts[i];
        }
        // Check if contract has enough agent token balance only after agentTokenAddress be set
        require(
            IERC20(agentTokenAddress).balanceOf(address(this)) >= totalDistributionAmount,
            "Insufficient Agent Token balance"
        );

        // Directly transfer Virtual Token refunds
        for (uint256 i = 0; i < refundVirtualsTokenUserAddresses.length; i++) {
            // first decrease the virtuals mapping of the user to prevent reentrancy attacks
            mapAddrToVirtuals[refundVirtualsTokenUserAddresses[i]] -= refundVirtualsTokenUserAmounts[i];
            // then transfer the virtuals
            IERC20(virtualTokenAddress).safeTransfer(
                refundVirtualsTokenUserAddresses[i], 
                refundVirtualsTokenUserAmounts[i]
            );
            emit RefundClaimed(
                genesisId, 
                refundVirtualsTokenUserAddresses[i], 
                refundVirtualsTokenUserAmounts[i]
            );
        }

        // save the amount of agent tokens to claim
        for (uint256 i = 0; i < distributeAgentTokenUserAddresses.length; i++) {
            claimableAgentTokens[distributeAgentTokenUserAddresses[i]] = distributeAgentTokenUserAmounts[i];
        }

        emit GenesisFinalized(genesisId, true);
        return agentTokenAddress;
    }

    function claimAgentToken(address userAddress) external nonReentrant {
        require(isEnded(), "Genesis not ended yet");
        require(!isFailed, "Genesis has failed");
        require(agentTokenAddress != address(0), "Agent token not launched");
        
        uint256 amount = claimableAgentTokens[userAddress];
        require(amount > 0, "No tokens to claim");
        
        // set the amount of claimable agent tokens to 0, to prevent duplicate claims
        claimableAgentTokens[userAddress] = 0;
        
        // transfer the agent token
        IERC20(agentTokenAddress).safeTransfer(userAddress, amount);
        
        emit AgentTokenClaimed(genesisId, userAddress, amount);
    }

    function getClaimableAgentToken(address userAddress) external view returns (uint256) {
        return claimableAgentTokens[userAddress];
    }

    function onGenesisFailed() external onlyRole(FACTORY_ROLE) nonReentrant {
        require(isEnded(), "Genesis not ended yet");
        require(!isFailed, "Genesis already failed");
        require(agentTokenAddress == address(0), "Cannot fail if agent token has been launched");
        isFailed = true;

        // Return all virtuals to participants
        for (uint256 i = 0; i < participants.length; i++) {
            address participant = participants[i];
            uint256 virtualsAmt = mapAddrToVirtuals[participant];
            if (virtualsAmt > 0) {
                // first clear the virtuals mapping of the user to prevent reentrancy attacks
                mapAddrToVirtuals[participant] = 0;
                // then transfer the virtuals
                IERC20(virtualTokenAddress).safeTransfer(participant, virtualsAmt);
                emit RefundClaimed(genesisId, participant, virtualsAmt);
            }
        }

        emit GenesisFinalized(genesisId, false);
    }

    function isEnded() public view returns (bool) {
        return block.timestamp >= endTime;
    }

    function isStarted() public view returns (bool) {
        return block.timestamp >= startTime;
    }

    function getParticipantCount() external view returns (uint256) {
        return participants.length;
    }

    function getParticipantsPaginated(uint256 startIndex, uint256 pageSize) 
        external 
        view 
        returns (address[] memory) 
    {
        require(startIndex < participants.length, "Start index out of bounds");
        
        uint256 actualPageSize = pageSize;
        if (startIndex + pageSize > participants.length) {
            actualPageSize = participants.length - startIndex;
        }
        
        address[] memory page = new address[](actualPageSize);
        for (uint256 i = 0; i < actualPageSize; i++) {
            page[i] = participants[startIndex + i];
        }
        
        return page;
    }

    function getParticipantsInfo(uint256[] calldata participantIndexes) 
        external 
        view 
        returns (ParticipantInfo[] memory) 
    {
        uint256 length = participantIndexes.length;
        ParticipantInfo[] memory result = new ParticipantInfo[](length);
        
        for (uint256 i = 0; i < length; i++) {
            // check if the index is out of bounds
            require(participantIndexes[i] < participants.length, "Index out of bounds");
            
            address userAddress = participants[participantIndexes[i]];
            result[i] = ParticipantInfo({
                userAddress: userAddress,
                virtuals: mapAddrToVirtuals[userAddress]
            });
        }
        
        return result;
    }

    struct GenesisInfo {
        uint256 genesisId;
        address factory;
        uint256 startTime;
        uint256 endTime;
        string genesisName;
        string genesisTicker;
        uint8[] genesisCores;
        bytes32 tbaSalt;
        address tbaImplementation;
        uint32 daoVotingPeriod;
        uint256 daoThreshold;
        address agentFactoryAddress;
        address virtualTokenAddress;
        uint256 reserveAmount;
        uint256 maxContributionVirtualAmount;
        uint256 agentTokenTotalSupply;
        uint256 agentTokenLpSupply;
        address agentTokenAddress;
        bool isFailed;
    }

    function getGenesisInfo() public view returns (GenesisInfo memory) {
        return GenesisInfo({
            genesisId: genesisId,
            factory: address(factory),
            startTime: startTime,
            endTime: endTime,
            genesisName: genesisName,
            genesisTicker: genesisTicker,
            genesisCores: genesisCores,
            tbaSalt: tbaSalt,
            tbaImplementation: tbaImplementation,
            daoVotingPeriod: daoVotingPeriod,
            daoThreshold: daoThreshold,
            agentFactoryAddress: agentFactoryAddress,
            virtualTokenAddress: virtualTokenAddress,
            reserveAmount: reserveAmount,
            maxContributionVirtualAmount: maxContributionVirtualAmount,
            agentTokenTotalSupply: agentTokenTotalSupply,
            agentTokenLpSupply: agentTokenLpSupply,
            agentTokenAddress: agentTokenAddress,
            isFailed: isFailed
        });
    }

    function withdrawLeftVirtualsAfterFinalized(address to, address token) external onlyRole(FACTORY_ROLE) nonReentrant {
        // check if Genesis has ended
        require(isEnded(), "Genesis not ended yet");
        
        // check if Genesis has been finalized (success or failed)
        require(
            isFailed || agentTokenAddress != address(0),
            "Genesis not finalized yet"
        );

        require(token != address(0), "Invalid token address");
        
        // get the remaining virtuals balance of the contract
        uint256 remainingBalance = IERC20(token).balanceOf(address(this));
        require(remainingBalance > 0, "No token left to withdraw");
        
        // transfer all the remaining virtuals
        IERC20(token).safeTransfer(to, remainingBalance);
        
        // emit an event to record the withdrawal
        emit VirtualsWithdrawn(genesisId, to, token, remainingBalance);
    }
}