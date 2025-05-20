const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Contract Size", function () {
  it("Should be within size limits", async function () {
    const Genesis = await ethers.getContractFactory("Genesis");
    const AgentFactoryV3 = await ethers.getContractFactory("AgentFactoryV3");
    const AgentFactoryV5 = await ethers.getContractFactory("AgentFactoryV5");
    const FGenesis = await ethers.getContractFactory("FGenesis");

    const genesisSize = Genesis.bytecode.length / 2;
    const fGenesisSize = FGenesis.bytecode.length / 2;
    const agentFactoryV5Size = AgentFactoryV5.bytecode.length / 2;
    const agentFactoryV3Size = AgentFactoryV3.bytecode.length / 2;
    console.log('Genesis size:', genesisSize, 'bytes');
    console.log('FGenesis size:', fGenesisSize, 'bytes');
    console.log('AgentFactoryV5 size:', agentFactoryV5Size, 'bytes');
    console.log('AgentFactoryV3 size:', agentFactoryV3Size, 'bytes');

    // 24576 is EVM contract size limit
    expect(genesisSize).to.be.lessThan(24576, "Genesis contract too large");
    expect(fGenesisSize).to.be.lessThan(24576, "FGenesis contract too large");
    expect(agentFactoryV5Size).to.be.lessThan(24576, "AgentFactoryV5 contract too large");
    expect(agentFactoryV3Size).to.be.lessThan(24576, "AgentFactoryV3 contract too large");
  });
});