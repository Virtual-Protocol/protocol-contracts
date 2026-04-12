// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/IGovernor.sol";

/**
 * @title IAgentFactoryV7
 * @notice Interface for AgentFactoryV7 - used with BondingV5 and AgentTokenV4
 * @dev Identical to IAgentFactoryV6, maintained separately for clean V5 ecosystem separation
 */
interface IAgentFactoryV7 {
    function withdraw(uint256 id) external;

    function totalAgents() external view returns (uint256);

    function createNewAgentTokenAndApplication(
        string memory name,
        string memory symbol,
        bytes memory tokenSupplyParams_,
        uint8[] memory cores,
        bytes32 tbaSalt,
        address tbaImplementation,
        uint32 daoVotingPeriod,
        uint256 daoThreshold,
        uint256 applicationThreshold_,
        address creator
    ) external returns (address, uint256);

    function updateApplicationThresholdWithApplicationId(
        uint256 id,
        uint256 applicationThreshold_
    ) external;

    function executeBondingCurveApplicationSalt(
        uint256 id,
        uint256 totalSupply,
        uint256 lpSupply,
        address vault,
        bytes32 salt
    ) external returns (address);

    function addBlacklistAddress(address token, address blacklistAddress) external;

    function removeBlacklistAddress(address token, address blacklistAddress) external;

    function removeLpLiquidity(
        address veToken,
        address recipient,
        uint256 veTokenAmount,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external;
}
