import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const Contribution = await ethers.getContractFactory("ContributionNft");
    const contribution = await upgrades.deployProxy(
      Contribution,
      [process.env.VIRTUAL_NFT],
      { initialOwner: process.env.ADMIN }
    );
    const contributionAddress = await contribution.getAddress();
    console.log("ContributionNft deployed to:", contributionAddress);

    const Service = await ethers.getContractFactory("ServiceNft");
    const service = await upgrades.deployProxy(
      Service,
      [process.env.VIRTUAL_NFT, contributionAddress],
      { initialOwner: process.env.ADMIN }
    );
    const serviceAddress = await service.getAddress();
    console.log("ServiceNft deployed to:", serviceAddress);

    const adminSigner = new ethers.Wallet(
      process.env.ADMIN_PRIVATE_KEY,
      ethers.provider
    );
    const nft = await ethers.getContractAt(
      "AgentNft",
      process.env.VIRTUAL_NFT,
      adminSigner
    );
    await nft.setContributionService(contributionAddress, serviceAddress);
  } catch (e) {
    console.log(e);
  }
})();
