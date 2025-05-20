// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

struct GenesisCreationParams {
    uint256 startTime;
    uint256 endTime;
    string genesisName;
    string genesisTicker;
    uint8[] genesisCores;
}

struct SuccessParams {
    address[] refundAddresses;
    uint256[] refundAmounts;
    address[] distributeAddresses;
    uint256[] distributeAmounts;
    address creator;
}

struct GenesisInitParams {
    uint256 genesisID;
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
}
