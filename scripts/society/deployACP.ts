import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const args = require("../arguments/acpArguments");
    const Contract = await ethers.getContractFactory("ACPSimple");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("ACPSimple deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
