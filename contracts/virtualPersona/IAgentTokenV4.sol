// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgentTokenV4
 * @dev Minimal interface for AgentFactoryV7: clones use a single 5-argument `initialize`
 *      (standard tax `bytes` + `taxAccountingAdapter`). Full ERC20 / AgentToken surface matches V3 at ABI level but is not declared here to avoid inheriting the legacy 4-arg `initialize` from IAgentTokenV2.
 */
interface IAgentTokenV4 {
    event TaxAccountingAdapterUpdated(address indexed adapter);

    function initialize(
        address[3] memory integrationAddresses_,
        bytes memory baseParams_,
        bytes memory supplyParams_,
        bytes memory taxParams_,
        address taxAccountingAdapter_
    ) external;
}
