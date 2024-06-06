import { ethers, upgrades } from "hardhat";

const deployParams = require("../arguments/nft.js");

(async () => {
  try {
    const AgentNft = await ethers.getContractFactory("AgentNft");
    const nft = await upgrades.deployProxy(AgentNft, deployParams, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    console.log("AgentNft deployed to:", nft.target);
  } catch (e) {
    console.log(e);
  }
})();
