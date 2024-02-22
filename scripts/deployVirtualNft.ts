import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const AgentNft = await ethers.getContractFactory("ServiceNft");
    const nft = await upgrades.deployProxy(AgentNft, [process.env.DEPLOYER]);
    console.log("AgentNft deployed to:", nft.target);
  } catch (e) {
    console.log(e);
  }
})();
