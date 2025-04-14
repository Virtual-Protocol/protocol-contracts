import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const args = require("../arguments/staking");
    const Contract = await ethers.getContractFactory("veVirtual");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("veVIRTUAL deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
