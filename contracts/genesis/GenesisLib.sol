// GenesisLib.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Genesis} from "./Genesis.sol";
import "./GenesisTypes.sol";

library GenesisLib {
    function validateAndDeploy(
        uint256 genesisID,
        address factory,
        GenesisCreationParams memory params,
        bytes32 tbaSalt,
        address tbaImpl,
        uint32 daoVotingPeriod,
        uint256 daoThreshold,
        address agentFactoryAddress,
        address virtualToken,
        uint256 reserve,
        uint256 maxContribution,
        uint256 agentTokenTotalSupply,
        uint256 agentTokenLpSupply
    ) internal returns (address) {
        require(
            bytes(params.genesisName).length > 0 &&
                bytes(params.genesisTicker).length > 0 &&
                params.genesisCores.length > 0,
            "Invalid params"
        );

        Genesis newGenesis = new Genesis();

        GenesisInitParams memory initParams = GenesisInitParams({
            genesisID: genesisID,
            factory: factory,
            startTime: params.startTime,
            endTime: params.endTime,
            genesisName: params.genesisName,
            genesisTicker: params.genesisTicker,
            genesisCores: params.genesisCores,
            tbaSalt: tbaSalt,
            tbaImplementation: tbaImpl,
            daoVotingPeriod: daoVotingPeriod,
            daoThreshold: daoThreshold,
            agentFactoryAddress: agentFactoryAddress,
            virtualTokenAddress: virtualToken,
            reserveAmount: reserve,
            maxContributionVirtualAmount: maxContribution,
            agentTokenTotalSupply: agentTokenTotalSupply,
            agentTokenLpSupply: agentTokenLpSupply
        });

        newGenesis.initialize(initParams);
        return address(newGenesis);
    }
}
