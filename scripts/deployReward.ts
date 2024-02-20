import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const Contract = await ethers.getContractFactory("PersonaReward");
    const contract = await upgrades.deployProxy(Contract, [
      process.env.ASSET_TOKEN,
      process.env.VIRTUAL_NFT,
      process.env.CONTRIBUTION_NFT,
      process.env.SERVICE_NFT,
      process.env.VIRTUAL_IP_NFT,
      {
        uptimeWeight: process.env.UPTIME_WEIGHT,
        stakeWeight: process.env.STAKE_WEIGHT,
        protocolShares: process.env.PROTOCOL_SHARES,
        contributorShares: process.env.CONTRIBUTOR_SHARES,
        stakerShares: process.env.STAKER_SHARES,
        datasetShares: process.env.DATASET_SHARES,
        impactShares: process.env.IMPACT_SHARES
      },
      process.env.REWARD_THRESHOLD,
      process.env.PARENT_SHARES,
    ]);
    const deployed = await contract.deployed();
    console.log(deployed);

    console.log("PersonaReward deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
