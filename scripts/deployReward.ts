import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const Contract = await ethers.getContractFactory("AgentReward");
    const contract = await upgrades.deployProxy(
      Contract,
      [
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
      ],
      { initialOwner: process.env.ADMIN }
    );
    await contract.waitForDeployment();
    const address = await contract.getAddress()

    console.log("AgentReward deployed to:", address);
  } catch (e) {
    console.log(e);
  }
})();
