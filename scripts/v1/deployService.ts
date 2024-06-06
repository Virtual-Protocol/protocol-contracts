import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const args = require("../arguments/serviceNft");

    const Service = await ethers.getContractFactory("ServiceNft");
    const service = await upgrades.deployProxy(Service, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    const serviceAddress = await service.getAddress();
    console.log("ServiceNft deployed to:", serviceAddress);
    await service.transferOwnership(process.env.ADMIN);

    const adminSigner = new ethers.Wallet(
      process.env.ADMIN_PRIVATE_KEY,
      ethers.provider
    );
    const nft = await ethers.getContractAt(
      "AgentNft",
      process.env.VIRTUAL_NFT,
      adminSigner
    );
    await nft.setContributionService(process.env.CONTRIBUTION_NFT, serviceAddress);
  } catch (e) {
    console.log(e);
  }
})();
