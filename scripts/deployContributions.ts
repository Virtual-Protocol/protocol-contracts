import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const Contribution = await ethers.getContractFactory("ContributionNft");
    const contribution = await upgrades.deployProxy(Contribution, [
      process.env.VIRTUAL_NFT,
    ]);
    console.log("ContributionNft deployed to:", contribution.target);

    const Service = await ethers.getContractFactory("ServiceNft");
    const service = await upgrades.deployProxy(Service, [
      process.env.VIRTUAL_NFT,
      contribution.target,
      process.env.DATASET_SHARES
    ]);
    console.log("ServiceNft deployed to:", service.target);

    const nft = await ethers.getContractAt(
      "AgentNft",
      process.env.VIRTUAL_NFT
    );
    await nft.setContributionService(contribution.target, service.target);
  } catch (e) {
    console.log(e);
  }
})();
