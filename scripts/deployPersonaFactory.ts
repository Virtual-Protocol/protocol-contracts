import { ethers, upgrades } from "hardhat";
const deployParams = require("./arguments/personaFactoryArguments.js");

(async () => {
  try {
    const AgentFactory = await ethers.getContractFactory("AgentFactory");
    const factory = await upgrades.deployProxy(AgentFactory, deployParams);
    await factory.waitForDeployment();

    console.log("AgentFactory deployed to:", factory.target);

    // Grant factory to mint NFTs
    const AgentNft = await ethers.getContractFactory("AgentNft");
    const nft = AgentNft.attach(process.env.VIRTUAL_NFT);

    await nft.grantRole(ethers.id("MINTER_ROLE"), factory.target);
    
  } catch (e) {
    console.log(e);
  }
})();
