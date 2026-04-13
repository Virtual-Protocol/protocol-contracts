// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAgentTokenV2.sol";

/**
 * @title IAgentTokenV4
 * @dev AgentToken V4: full `IAgentTokenV2` surface plus 5-argument `initialize`
 *      (tax `bytes` + `taxAccountingAdapter`). The legacy 4-arg `initialize` remains on `IAgentTokenV2` for ABI compatibility; V4 implementations revert it.
 */
interface IAgentTokenV4 is IAgentTokenV2 {
    event TaxAccountingAdapterUpdated(address indexed adapter);

    function initialize(
        address[3] memory integrationAddresses_,
        bytes memory baseParams_,
        bytes memory supplyParams_,
        bytes memory taxParams_,
        address taxAccountingAdapter_
    ) external;
}
