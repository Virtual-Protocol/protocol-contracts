import { ethers, upgrades } from "hardhat";

async function migrateImplementations(){
  
}

(async () => {
  try {
    // Deploy impl
    const Contract = await ethers.getContractFactory("AgentRewardV2");
    const contract = await upgrades.upgradeProxy(process.env.PERSONA_REWARD, Contract);
    console.log("Upgraded", contract.target)
  } catch (e) {
    console.log(e);
  }
})();
