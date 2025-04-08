// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./FGenesis.sol";
import "./IVirtuals.sol";

contract Genesis is ReentrancyGuard, Ownable {
    mapping(address => uint256) public mapAddrToVirtuals;
    address[] public participants;
    
    address public agentTokenAddress;
    bool public isFailed;
    FGenesis public immutable factory;

    // Cached factory values
    address public immutable virtualTokenAddress;
    address public immutable virtualsFactoryAddress;
    uint256 public immutable reserveAmount;
    uint256 public immutable maxContributionVirtualAmount;

    // Genesis-related variables
    uint256 public immutable START_TIME;
    uint256 public immutable END_TIME;
    string public genesisName;
    string public genesisTicker;
    uint8[] public genesisCores;
    string public genesisDesc;
    string public genesisImg;
    string[4] public genesisUrls;

    uint256 public immutable GENESIS_ID;

    event GenesisFinalized(uint256 indexed genesisID, bool isSuccess);
    event Participated(uint256 indexed genesisID, address indexed user, uint256 virtuals);
    event RefundClaimed(uint256 indexed genesisID, address indexed user, uint256 amount);
    event AgentTokenClaimed(uint256 indexed genesisID, address indexed user, uint256 amount);
    event VirtualsWithdrawn(uint256 indexed genesisID, address indexed to, uint256 amount);

    // Add a struct to organize return data
    struct ParticipantInfo {
        address userAddress;
        uint256 virtuals;
    }

    // Use factory's admin check
    modifier onlyAdmin() {
        require(factory.isAdmin(msg.sender) || factory.owner() == msg.sender, "Not an admin");
        _;
    }

    constructor(
        uint256 genesisID_, // todo: will we have issue with this to let ppl use?
        address factory_,
        uint256 startTime_,
        uint256 endTime_,
        string memory genesisName_,
        string memory genesisTicker_,
        uint8[] memory genesisCores_,
        string memory genesisDesc_,
        string memory genesisImg_,
        string[4] memory genesisUrls_
    ) Ownable(FGenesis(factory_).owner()) {
        GENESIS_ID = genesisID_;
        factory = FGenesis(factory_);

        // Cache factory values
        virtualTokenAddress = factory.virtualTokenAddress();
        virtualsFactoryAddress = factory.virtualsFactory();
        reserveAmount = factory.reserveAmount();
        maxContributionVirtualAmount = factory.maxContributionVirtualAmount();

        require(startTime_ > block.timestamp, "Start time must be in the future");
        require(endTime_ > startTime_, "End time must be after start time");
        START_TIME = startTime_;
        END_TIME = endTime_;
        genesisName = genesisName_;
        genesisTicker = genesisTicker_;
        genesisCores = genesisCores_;
        genesisDesc = genesisDesc_;
        genesisImg = genesisImg_;
        genesisUrls = genesisUrls_;
    }

    function participate(
        uint256 virtualsAmt,
        address userAddress
    ) external nonReentrant {
        require(isStarted(), "Genesis has not started yet");
        require(!isEnded(), "Genesis has ended");
        require(!isFailed, "Genesis has failed");

        // Add checks for positive values
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

        IERC20(virtualTokenAddress).transferFrom(msg.sender, address(this), virtualsAmt);
        
        emit Participated(GENESIS_ID, userAddress, virtualsAmt);
    }

    function onGenesisSuccess(
        address[] calldata refundVirtualsTokenUserAddresses,
        uint256[] calldata refundVirtualsTokenUserAmounts,
        address[] calldata distributeAgentTokenUserAddresses,
        uint256[] calldata distributeAgentTokenUserAmounts
    ) external onlyAdmin nonReentrant {
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
            // grant allowance to VirtualsFactory for launch
            IERC20(virtualTokenAddress).approve(virtualsFactoryAddress, reserveAmount);

            // Call launch function on VirtualsFactory
            (address funToken, , ) = IVirtualsFactory(virtualsFactoryAddress).launch(
                genesisName,
                genesisTicker,
                genesisCores,
                genesisDesc,
                genesisImg,
                genesisUrls,
                reserveAmount
            );

            // Store the created agent token address
            agentTokenAddress = funToken;
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
            IERC20(virtualTokenAddress).transfer(
                refundVirtualsTokenUserAddresses[i], 
                refundVirtualsTokenUserAmounts[i]
            );
            emit RefundClaimed(
                GENESIS_ID, 
                refundVirtualsTokenUserAddresses[i], 
                refundVirtualsTokenUserAmounts[i]
            );
        }

        // Directly transfer Agent Tokens
        for (uint256 i = 0; i < distributeAgentTokenUserAddresses.length; i++) {
            IERC20(agentTokenAddress).transfer(
                distributeAgentTokenUserAddresses[i], 
                distributeAgentTokenUserAmounts[i]
            );
            emit AgentTokenClaimed(
                GENESIS_ID, 
                distributeAgentTokenUserAddresses[i], 
                distributeAgentTokenUserAmounts[i]
            );
        }

        emit GenesisFinalized(GENESIS_ID, true);
    }

    function onGenesisFailed() external onlyAdmin nonReentrant {
        require(!isFailed, "Genesis already failed");
        require(isEnded(), "Genesis not ended yet");
        require(agentTokenAddress == address(0), "Cannot fail after agent token launch");
        isFailed = true;

        // Return all virtuals to participants
        for (uint256 i = 0; i < participants.length; i++) {
            address participant = participants[i];
            uint256 virtualsAmt = mapAddrToVirtuals[participant];
            if (virtualsAmt > 0) {
                // first clear the virtuals mapping of the user to prevent reentrancy attacks
                mapAddrToVirtuals[participant] = 0;
                // then transfer the virtuals
                IERC20(virtualTokenAddress).transfer(participant, virtualsAmt);
                emit RefundClaimed(GENESIS_ID, participant, virtualsAmt);
            }
        }

        emit GenesisFinalized(GENESIS_ID, false);
    }

    function isEnded() public view returns (bool) {
        return block.timestamp >= END_TIME;
    }

    function isStarted() public view returns (bool) {
        return block.timestamp >= START_TIME;
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
        address agentTokenAddress;
        uint256 endTime;
        bool isFailed;
        address factory;

        address virtualTokenAddress;
        address virtualsFactoryAddress;
        uint256 reserveAmount;
        uint256 maxContributionVirtualAmount;

        uint256 startTime;
        string genesisName;
        string genesisTicker;
        uint8[] genesisCores;
        string genesisDesc;
        string genesisImg;
        string[4] genesisUrls;
    }

    function getGenesisInfo() public view returns (GenesisInfo memory) {
        return GenesisInfo({
            genesisId: GENESIS_ID,
            agentTokenAddress: agentTokenAddress,
            isFailed: isFailed,
            factory: address(factory),
            virtualTokenAddress: virtualTokenAddress,
            virtualsFactoryAddress: virtualsFactoryAddress,
            reserveAmount: reserveAmount,
            maxContributionVirtualAmount: maxContributionVirtualAmount,
            startTime: START_TIME,
            endTime: END_TIME,
            genesisName: genesisName,
            genesisTicker: genesisTicker,
            genesisCores: genesisCores,
            genesisDesc: genesisDesc,
            genesisImg: genesisImg,
            genesisUrls: genesisUrls
        });
    }

    function withdrawLeftVirtualsAfterFinalized(address to) external onlyAdmin nonReentrant {
        // check if Genesis has ended
        require(isEnded(), "Genesis not ended yet");
        
        // check if Genesis has been finalized (success or failed)
        require(
            isFailed || agentTokenAddress != address(0),
            "Genesis not finalized yet"
        );
        
        // get the remaining virtuals balance of the contract
        uint256 remainingBalance = IERC20(virtualTokenAddress).balanceOf(address(this));
        require(remainingBalance > 0, "No virtuals left to withdraw");
        
        // transfer all the remaining virtuals
        require(
            IERC20(virtualTokenAddress).transfer(to, remainingBalance),
            "Transfer failed"
        );
        
        // emit an event to record the withdrawal
        emit VirtualsWithdrawn(GENESIS_ID, to, remainingBalance);
    }
}