import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const args = require("./arguments/agentETax");
    const Contract = await ethers.getContractFactory("AgentETax");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("AgentETax deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
