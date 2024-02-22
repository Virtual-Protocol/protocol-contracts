import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const Contract = await ethers.getContractFactory("AgentReward");
    const contract = await upgrades.upgradeProxy(process.env.PERSONA_REWARD, Contract);
    console.log("Upgraded", contract.target)
  } catch (e) {
    console.log(e);
  }
})();
