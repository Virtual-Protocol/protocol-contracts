import { ethers } from "hardhat";
const deployArguments = require("./arguments/stakingArguments");

(async () => {
  try {
    const contract = await ethers.deployContract(
      "TimeLockStaking",
      deployArguments
    );

    await contract.waitForDeployment();

    console.log(`Staking Contract deployed to ${contract.target}`);
  } catch (e) {
    console.log(e);
  }
})();
