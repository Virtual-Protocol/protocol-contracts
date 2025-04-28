const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Contract Size", function () {
  it("Should be within size limits", async function () {
    const Genesis = await ethers.getContractFactory("Genesis");
    const FGenesis = await ethers.getContractFactory("FGenesis");
    
    const genesisSize = Genesis.bytecode.length / 2;
    const fGenesisSize = FGenesis.bytecode.length / 2;
    
    console.log('Genesis size:', genesisSize, 'bytes');
    console.log('FGenesis size:', fGenesisSize, 'bytes');
    
    // 24576 是 EVM 的大小限制
    expect(genesisSize).to.be.lessThan(24576, "Genesis contract too large");
    expect(fGenesisSize).to.be.lessThan(24576, "FGenesis contract too large");
  });
});