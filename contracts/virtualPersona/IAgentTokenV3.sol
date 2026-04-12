// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAgentTokenV2.sol";

/**
 * @title IAgentTokenV3
 * @dev Interface for AgentTokenV3. AgentTokenV3 extends AgentTokenV2 with on-chain tax attribution.
 * The interface remains the same as IAgentTokenV2 since the depositTax functionality is internal.
 */
interface IAgentTokenV3 is IAgentTokenV2 {
    // AgentTokenV3 implements IAgentTokenV2 and adds on-chain tax attribution
    // via depositTax() calls in _swapTax(). No additional external functions needed.
}
