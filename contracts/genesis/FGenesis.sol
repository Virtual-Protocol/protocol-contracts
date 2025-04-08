// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Genesis.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract FGenesis is Initializable, OwnableUpgradeable {
    address public virtualTokenAddress;
    address public virtualsFactory;
    uint256 public reserveAmount;
    uint256 public maxContributionVirtualAmount;
    uint256 public creationFeeAmount;
    uint256 public duration;

    mapping(uint256 => address) public mapGenesisIDToGenesisContractAddr;
    uint256 public genesisID;
    mapping(address => bool) public isAdmin;
    address[] public adminList;

    event VirtualTokenAddressUpdated(
        address indexed oldAddress,
        address indexed newAddress
    );
    event VirtualsFactoryUpdated(
        address indexed oldAddress,
        address indexed newAddress
    );
    event ReserveAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event MaxContributionVirtualAmountUpdated(
        uint256 oldAmount,
        uint256 newAmount
    );
    event CreationFeeAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event GenesisCreated(
        uint256 indexed genesisID,
        address indexed genesisContract
    );

    modifier onlyAdmin() {
        require(isAdmin[msg.sender] || owner() == msg.sender, "Not an admin");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address virtualTokenAddress_,
        address virtualsFactory_,
        uint256 reserveAmount_,
        uint256 maxContributionVirtualAmount_,
        uint256 creationFeeAmount_,
        uint256 duration_
    ) external initializer {
        __Ownable_init(msg.sender);

        require(duration_ > 0, "Duration must be greater than 0");
        require(virtualTokenAddress_ != address(0), "Invalid virtual token address");
        require(virtualsFactory_ != address(0), "Invalid virtuals factory address");
        require(reserveAmount_ > 0, "Reserve amount must be greater than 0");
        require(maxContributionVirtualAmount_ > 0, "Max contribution virtual amount must be greater than 0");
        require(creationFeeAmount_ > 0, "Creation fee amount must be greater than 0");
        require(reserveAmount_ >= creationFeeAmount_, "Reserve amount must be greater than or equal to creation fee amount");
        virtualTokenAddress = virtualTokenAddress_;
        virtualsFactory = virtualsFactory_;
        reserveAmount = reserveAmount_;
        maxContributionVirtualAmount = maxContributionVirtualAmount_;
        creationFeeAmount = creationFeeAmount_;
        duration = duration_;

        // Set the owner as an admin using setAdmin
        _setAdmin(msg.sender, true);
    }

    function setVirtualTokenAddress(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        address oldAddress = virtualTokenAddress;
        virtualTokenAddress = newAddress;
        emit VirtualTokenAddressUpdated(oldAddress, newAddress);
    }

    function setVirtualsFactory(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        address oldAddress = virtualsFactory;
        virtualsFactory = newAddress;
        emit VirtualsFactoryUpdated(oldAddress, newAddress);
    }

    function setReserveAmount(uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Invalid amount");
        require(newAmount >= creationFeeAmount, "Reserve amount must be greater than or equal to creation fee amount");
        uint256 oldAmount = reserveAmount;
        reserveAmount = newAmount;
        emit ReserveAmountUpdated(oldAmount, newAmount);
    }

    function setMaxContributionVirtualAmount(
        uint256 newAmount
    ) external onlyOwner {
        require(newAmount > 0, "Invalid amount");
        uint256 oldAmount = maxContributionVirtualAmount;
        maxContributionVirtualAmount = newAmount;
        emit MaxContributionVirtualAmountUpdated(oldAmount, newAmount);
    }

    function setCreationFeeAmount(uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Invalid amount");
        require(newAmount <= reserveAmount, "Creation fee amount must be less than or equal to reserve amount");
        uint256 oldAmount = creationFeeAmount;
        creationFeeAmount = newAmount;
        emit CreationFeeAmountUpdated(oldAmount, newAmount);
    }

    function setDuration(uint256 newDuration) external onlyOwner {
        require(newDuration > 0, "Duration must be greater than 0");
        duration = newDuration;
    }

    function setAdmin(address admin, bool status) external onlyOwner {
        _setAdmin(admin, status);
    }

    // Internal function for setting admin to avoid code duplication
    function _setAdmin(address admin, bool status) private {
        require(admin != address(0), "Invalid admin address");
        require(isAdmin[admin] != status, "Admin status not changed");

        isAdmin[admin] = status;

        if (status) {
            adminList.push(admin);
            emit AdminAdded(admin);
        } else {
            // Remove admin from adminList
            for (uint256 i = 0; i < adminList.length; i++) {
                if (adminList[i] == admin) {
                    adminList[i] = adminList[adminList.length - 1];
                    adminList.pop();
                    break;
                }
            }
            emit AdminRemoved(admin);
        }
    }

    struct GenesisInfo {
        uint256 genesisID;
        address genesisContract;
    }

    function createGenesis(
        uint256 _startTime,
        uint256 _endTime,
        string memory _genesisName,
        string memory _genesisTicker,
        uint8[] memory _genesisCores,
        string memory _genesisDesc,
        string memory _genesisImg,
        string[4] memory _genesisUrls
    ) external returns (GenesisInfo memory) {
        require(bytes(_genesisName).length > 0, "Name must be greater than 0");
        require(bytes(_genesisTicker).length > 0, "Ticker must be greater than 0");
        require(_genesisCores.length > 0, "Cores must be greater than 0");
        
        genesisID++;
        Genesis newGenesis = new Genesis(
            genesisID,
            address(this),
            _startTime,
            _endTime,
            _genesisName,
            _genesisTicker,
            _genesisCores,
            _genesisDesc,
            _genesisImg,
            _genesisUrls
        );
        address genesisAddr = address(newGenesis);
        mapGenesisIDToGenesisContractAddr[genesisID] = genesisAddr;

        emit GenesisCreated(genesisID, genesisAddr);
        require(
            IERC20(virtualTokenAddress).transferFrom(
                msg.sender,
                genesisAddr,
                creationFeeAmount
            ),
            "Creation fee transfer failed"
        );

        return
            GenesisInfo({genesisID: genesisID, genesisContract: genesisAddr});
    }

    function getGenesisContractByID(
        uint256 _genesisID
    ) external view returns (address) {
        address contractAddr = mapGenesisIDToGenesisContractAddr[_genesisID];
        require(contractAddr != address(0), "Genesis ID not found");
        return contractAddr;
    }
}
