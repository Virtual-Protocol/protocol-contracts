import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const args = require("../arguments/contributionNft");
    const Contribution = await ethers.getContractFactory("ContributionNft");
    const contribution = await upgrades.deployProxy(
      Contribution,
      args,
      { initialOwner: process.env.CONTRACT_CONTROLLER }
    );
    const contributionAddress = await contribution.getAddress();
    await contribution.setAdmin(process.env.ADMIN);
    console.log("ContributionNft deployed to:", contributionAddress);
  } catch (e) {
    console.log(e);
  }
})();
