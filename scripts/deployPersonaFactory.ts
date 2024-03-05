import { ethers, upgrades } from "hardhat";
const deployParams = require("./arguments/personaFactoryArguments.js");

(async () => {
  try {
    const AgentFactory = await ethers.getContractFactory("AgentFactory");
    const factory = await upgrades.deployProxy(AgentFactory, deployParams);
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();

    console.log("AgentFactory deployed to:", factoryAddress);

    // Grant factory to mint NFTs
    const adminSigner = new ethers.Wallet(
      process.env.ADMIN_PRIVATE_KEY,
      ethers.provider
    );
    const nft = await ethers.getContractAt("AgentNft", process.env.VIRTUAL_NFT, adminSigner);
    await nft.grantRole(ethers.id("MINTER_ROLE"), factoryAddress);
  } catch (e) {
    console.log(e);
  }
})();
