import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const args = require("../arguments/tbaBonus");
    const Contract = await ethers.getContractFactory("TBABonus");

    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("TBABonus deployed to:", contract.target);

    await contract.grantRole(
      contract.EXECUTOR_ROLE(),
      process.env.AGENT_TAX_MANAGER
    );
  } catch (e) {
    console.log(e);
  }
})();
