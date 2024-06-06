import { ethers } from "hardhat";
const deployArguments = require("../arguments/lockArguments");

(async () => {
  try {
    const contract = await ethers.deployContract(
      "TimeLock",
      deployArguments
    );
    await contract.waitForDeployment();
    await contract.grantRole(await contract.GOV_ROLE(), process.env.DAO)
    await contract.grantRole(await contract.ADMIN_ROLE(), process.env.ADMIN)
    await contract.grantRole(await contract.DEFAULT_ADMIN_ROLE(), process.env.ADMIN)
    await contract.renounceRole(await contract.DEFAULT_ADMIN_ROLE(), process.env.DEPLOYER)

    console.log(`Staking Contract deployed to ${contract.target}`);
  } catch (e) {
    console.log(e);
  }
})();
