import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const contract = await ethers.deployContract("AgentRewardV2")
    await contract.waitForDeployment();
    await contract.initialize(  
      process.env.REWARD_TOKEN,
      process.env.VIRTUAL_NFT,
      process.env.CONTRIBUTION_NFT,
      process.env.SERVICE_NFT,
      {
        protocolShares: process.env.PROTOCOL_SHARES,
        contributorShares: process.env.CONTRIBUTOR_SHARES,
        stakerShares: process.env.STAKER_SHARES,
        parentShares: process.env.PARENT_SHARES,
        stakeThreshold: process.env.REWARD_STAKE_THRESHOLD,
      },
    )
    const address = await contract.getAddress()

    console.log("AgentRewardX2 deployed to:", address);
  } catch (e) {
    console.log(e);
  }
})();
