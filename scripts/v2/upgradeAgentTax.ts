import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const Contract = await ethers.getContractFactory("AgentTax");
    const contract = await upgrades.upgradeProxy(
      process.env.AGENT_TAX_MANAGER,
      Contract
    );
    console.log("Contract upgraded:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
