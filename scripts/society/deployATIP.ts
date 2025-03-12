import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const args = require("../arguments/atipArguments");
    const Contract = await ethers.getContractFactory("ATIPSimple");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("ATIPSimple deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
