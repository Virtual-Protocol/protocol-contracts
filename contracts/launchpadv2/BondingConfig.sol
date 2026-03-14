// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title BondingConfig
 * @notice Configuration contract for BondingV5 multi-chain launch modes
 * @dev Stores configurable parameters for different launch modes.
 *      gradThreshold is calculated per-token based on airdropBips and needAcf.
 *      project60days is handled by backend (not a separate launch mode).
 */
contract BondingConfig is Initializable, OwnableUpgradeable {
    // Launch mode constants (only 3 modes)
    uint8 public constant LAUNCH_MODE_NORMAL = 0;
    uint8 public constant LAUNCH_MODE_X_LAUNCH = 1;
    uint8 public constant LAUNCH_MODE_ACP_SKILL = 2;

    // Reserve supply parameters struct (in bips, 1 bip = 0.01%, e.g., 5500 = 55.00%)
    struct ReserveSupplyParams {
        uint16 maxAirdropBips; // Maximum airdrop (e.g., 500 = 5.00%)
        uint16 maxTotalReservedBips; // At least (100% - this) must remain in bonding curve (e.g., 5500 = 55.00%)
        uint16 acfReservedBips; // ACF operations reserve (e.g., 5000 = 50.00%)
    }
    ReserveSupplyParams public reserveSupplyParams;

    // Anti-sniper tax type constants
    // These define the duration over which anti-sniper tax decreases from 99% to 0%
    uint8 public constant ANTI_SNIPER_NONE = 0; // No anti-sniper tax (0 seconds)
    uint8 public constant ANTI_SNIPER_60S = 1; // 60 seconds duration (default)
    uint8 public constant ANTI_SNIPER_98M = 2; // 98 minutes duration

    // Scheduled launch parameters
    struct ScheduledLaunchParams {
        uint256 startTimeDelay; // Time delay for scheduled launches (e.g., 24 hours)
        uint256 normalLaunchFee; // Fee for scheduled launches / marketing (e.g., 100 VIRTUAL)
        uint256 acfFee; // Extra fee when needAcf = true (e.g., 10 VIRTUAL on base, 150 VIRTUAL on eth)
    }
    // public for Etherscan visibility; use getScheduledLaunchParams() for memory struct
    ScheduledLaunchParams public scheduledLaunchParams;

    // Global wallet to receive reserved tokens (airdrop + ACF)
    address public teamTokenReservedWallet;

    // Authorized launchers for special modes
    mapping(address => bool) public isXLauncher;
    mapping(address => bool) public isAcpSkillLauncher;

    // Common bonding curve parameters (unified across all launch modes)
    struct BondingCurveParams {
        uint256 fakeInitialVirtualLiq; // Fixed fake initial VIRTUAL liquidity (e.g., 6300 * 1e18)
        uint256 targetRealVirtual; // Target VIRTUAL from users at graduation (e.g., 42000 * 1e18)
    }
    BondingCurveParams public bondingCurveParams;

    struct Data {
        address token;
        string name;
        string _name;
        string ticker;
        uint256 supply;
        uint256 price;
        uint256 marketCap;
        uint256 liquidity;
        uint256 volume;
        uint256 volume24H;
        uint256 prevPrice;
        uint256 lastUpdated;
    }

    struct Token {
        address creator;
        address token;
        address pair;
        address agentToken;
        Data data;
        string description;
        uint8[] cores;
        string image;
        string twitter;
        string telegram;
        string youtube;
        string website;
        bool trading;
        bool tradingOnUniswap;
        uint256 applicationId;
        uint256 initialPurchase;
        uint256 virtualId;
        bool launchExecuted;
    }

    // V5 configurable launch parameters (stored separately per token)
    struct LaunchParams {
        uint8 launchMode;
        uint16 airdropBips; // in bips, 1 bip = 0.01% (e.g., 234 = 2.34%)
        bool needAcf;
        uint8 antiSniperTaxType;
        bool isProject60days;
    }

    // Common deploy parameters shared across all modes
    struct DeployParams {
        bytes32 tbaSalt;
        address tbaImplementation;
        uint32 daoVotingPeriod;
        uint256 daoThreshold;
    }
    // public for Etherscan visibility; use getDeployParams() for memory struct
    DeployParams public deployParams;

    // Common parameters
    uint256 public initialSupply;
    address public feeTo;

    event DeployParamsUpdated(DeployParams params);
    event TeamTokenReservedWalletUpdated(address wallet);
    event CommonParamsUpdated(uint256 initialSupply, address feeTo);
    event BondingCurveParamsUpdated(BondingCurveParams params);
    event ReserveSupplyParamsUpdated(ReserveSupplyParams params);

    error InvalidAntiSniperType();
    error InvalidReserveBips();
    error AirdropBipsExceedsMax();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint256 initialSupply_,
        address feeTo_,
        address teamTokenReservedWallet_,
        ReserveSupplyParams memory reserveSupplyParams_,
        ScheduledLaunchParams memory scheduledLaunchParams_,
        DeployParams memory deployParams_,
        BondingCurveParams memory bondingCurveParams_
    ) external initializer {
        __Ownable_init(msg.sender);

        initialSupply = initialSupply_;
        feeTo = feeTo_;
        teamTokenReservedWallet = teamTokenReservedWallet_;
        reserveSupplyParams = reserveSupplyParams_;
        scheduledLaunchParams = scheduledLaunchParams_;
        deployParams = deployParams_;
        bondingCurveParams = bondingCurveParams_;
    }

    /**
     * @notice Set deploy parameters
     * @param params_ The deploy parameters
     */
    function setDeployParams(DeployParams memory params_) external onlyOwner {
        deployParams = params_;
        emit DeployParamsUpdated(params_);
    }

    /**
     * @notice Set common parameters
     * @param initialSupply_ Initial token supply
     * @param feeTo_ Address to receive fees
     */
    function setCommonParams(
        uint256 initialSupply_,
        address feeTo_
    ) external onlyOwner {
        initialSupply = initialSupply_;
        feeTo = feeTo_;
        emit CommonParamsUpdated(initialSupply_, feeTo_);
    }

    /**
     * @notice Set bonding curve parameters
     * @param params_ The bonding curve parameters (K, assetRate, targetRealVirtual)
     */
    function setBondingCurveParams(
        BondingCurveParams memory params_
    ) external onlyOwner {
        bondingCurveParams = params_;
        emit BondingCurveParamsUpdated(params_);
    }

    /**
     * @notice Calculate bonding curve supply with validation
     * @dev Validates:
     *      1. airdropBips_ <= reserveSupplyParams.maxAirdropBips
     *      2. airdropBips + (needAcf ? acfReservedBips : 0) <= maxTotalReservedBips
     *      All values are in bips (1 bip = 0.01%, e.g., 234 = 2.34%)
     * @param airdropBips_ Airdrop in bips (e.g., 234 = 2.34%)
     * @param needAcf_ Whether ACF operations are needed (adds acfReservedBips reserve)
     * @return bondingCurveSupply The supply available for bonding curve (in base units, not wei)
     */
    function calculateBondingCurveSupply(
        uint16 airdropBips_,
        bool needAcf_
    ) external view returns (uint256) {
        if (airdropBips_ > reserveSupplyParams.maxAirdropBips) {
            revert AirdropBipsExceedsMax();
        }
        uint16 totalReserved = airdropBips_ +
            (needAcf_ ? reserveSupplyParams.acfReservedBips : 0);
        if (totalReserved > reserveSupplyParams.maxTotalReservedBips) {
            revert InvalidReserveBips();
        }
        return (initialSupply * (10000 - totalReserved)) / 10000;
    }

    /**
     * @notice Get the fixed fake initial virtual liquidity
     * @return fakeInitialVirtualLiq The fake initial VIRTUAL liquidity in wei
     */
    function getFakeInitialVirtualLiq() external view returns (uint256) {
        return bondingCurveParams.fakeInitialVirtualLiq;
    }

    /**
     * @notice Calculate graduation threshold for a token
     * @dev Formula: gradThreshold = fakeInitialVirtualLiq * bondingCurveSupply / (targetRealVirtual + fakeInitialVirtualLiq)
     * @param bondingCurveSupplyWei_ Bonding curve supply in wei
     * @return gradThreshold The graduation threshold (agent token amount in wei)
     */
    function calculateGradThreshold(
        uint256 bondingCurveSupplyWei_
    ) external view returns (uint256) {
        // gradThreshold = y0 * x0 / (targetRealVirtual + y0)
        // where y0 = fakeInitialVirtualLiq (fixed), x0 = bondingCurveSupply
        uint256 fakeInitialVirtualLiq = bondingCurveParams
            .fakeInitialVirtualLiq;
        return
            (fakeInitialVirtualLiq * bondingCurveSupplyWei_) /
            (bondingCurveParams.targetRealVirtual + fakeInitialVirtualLiq);
    }

    /**
     * @notice Update scheduled launch parameters
     * @param params_ The new scheduled launch parameters (startTimeDelay, fee)
     */
    function setScheduledLaunchParams(
        ScheduledLaunchParams memory params_
    ) external onlyOwner {
        scheduledLaunchParams = params_;
    }

    /**
     * @notice Update team token reserved wallet
     * @param wallet_ The team token reserved wallet
     */
    function setTeamTokenReservedWallet(address wallet_) external onlyOwner {
        teamTokenReservedWallet = wallet_;
        emit TeamTokenReservedWalletUpdated(wallet_);
    }

    function setXLauncher(address launcher_, bool allowed_) external onlyOwner {
        isXLauncher[launcher_] = allowed_;
    }

    function setAcpSkillLauncher(
        address launcher_,
        bool allowed_
    ) external onlyOwner {
        isAcpSkillLauncher[launcher_] = allowed_;
    }

    /**
     * @notice Get target real VIRTUAL value
     * @return targetRealVirtual value from bondingCurveParams
     */
    function getTargetRealVirtual() external view returns (uint256) {
        return bondingCurveParams.targetRealVirtual;
    }

    /**
     * @notice Check if launch mode is a special mode requiring authorized launcher
     * @param launchMode_ The launch mode identifier
     * @return Whether it's a special launch mode (X_LAUNCH or ACP_SKILL)
     */
    function isSpecialMode(uint8 launchMode_) external pure returns (bool) {
        return
            launchMode_ == LAUNCH_MODE_X_LAUNCH ||
            launchMode_ == LAUNCH_MODE_ACP_SKILL;
    }

    /**
     * @notice Set reserve supply parameters
     * @param params_ The reserve supply parameters (all in bips, 1 bip = 0.01%, e.g., 500 = 5.00%)
     */
    function setReserveSupplyParams(
        ReserveSupplyParams memory params_
    ) external onlyOwner {
        require(params_.maxAirdropBips + params_.acfReservedBips <= params_.maxTotalReservedBips, InvalidReserveBips());
        require(params_.maxAirdropBips <= 10000, InvalidReserveBips());
        require(params_.maxTotalReservedBips <= 10000, InvalidReserveBips());
        require(params_.acfReservedBips <= 10000, InvalidReserveBips());
        
        reserveSupplyParams = params_;
        emit ReserveSupplyParamsUpdated(params_);
    }

    /**
     * @notice Check if anti-sniper tax type is valid
     * @param antiSniperType_ The anti-sniper type (0=none, 1=60s, 2=98min)
     * @return Whether the type is valid
     */
    function isValidAntiSniperType(
        uint8 antiSniperType_
    ) external pure returns (bool) {
        return
            antiSniperType_ == ANTI_SNIPER_NONE ||
            antiSniperType_ == ANTI_SNIPER_60S ||
            antiSniperType_ == ANTI_SNIPER_98M;
    }

    /**
     * @notice Get anti-sniper tax duration in seconds for a given type
     * @param antiSniperType_ The anti-sniper type
     * @return Duration in seconds (0 for NONE, 60 for 60S, 5880 for 98M)
     */
    function getAntiSniperDuration(
        uint8 antiSniperType_
    ) external pure returns (uint256) {
        if (antiSniperType_ == ANTI_SNIPER_NONE) {
            return 0;
        } else if (antiSniperType_ == ANTI_SNIPER_60S) {
            return 60; // 60 seconds
        } else if (antiSniperType_ == ANTI_SNIPER_98M) {
            return 5880; // 98 minutes = 98 * 60 = 5880 seconds
        }
        revert InvalidAntiSniperType();
    }

    /**
     * @notice Get scheduled launch params as memory struct (for contract calls)
     */
    function getScheduledLaunchParams()
        external
        view
        returns (ScheduledLaunchParams memory)
    {
        return scheduledLaunchParams;
    }

    /**
     * @notice Get deploy params as memory struct (for contract calls)
     */
    function getDeployParams() external view returns (DeployParams memory) {
        return deployParams;
    }

    /**
     * @notice Calculate total launch fee based on launch type and ACF requirement
     * @dev Fee structure:
     *      - Immediate launch, no ACF: 0
     *      - Immediate launch, with ACF: acfFee
     *      - Scheduled launch, no ACF: normalLaunchFee
     *      - Scheduled launch, with ACF: normalLaunchFee + acfFee
     * @param isScheduledLaunch_ Whether this is a scheduled launch
     * @param needAcf_ Whether ACF operations are needed
     * @return totalFee The total fee to charge
     */
    function calculateLaunchFee(
        bool isScheduledLaunch_,
        bool needAcf_
    ) external view returns (uint256) {
        uint256 totalFee = 0;
        if (isScheduledLaunch_) {
            totalFee += scheduledLaunchParams.normalLaunchFee;
        }
        if (needAcf_) {
            totalFee += scheduledLaunchParams.acfFee;
        }
        return totalFee;
    }
}
