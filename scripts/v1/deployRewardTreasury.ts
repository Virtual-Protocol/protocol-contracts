import { ethers } from "hardhat";
const deployArguments = require("../arguments/rewardTreasuryArguments");

(async () => {
  try {
    const contract = await ethers.deployContract(
      "RewardTreasury",
      deployArguments
    );
    await contract.waitForDeployment();

    console.log(`Reward Treasury Contract deployed to ${contract.target}`);
  } catch (e) {
    console.log(e);
  }
})();
