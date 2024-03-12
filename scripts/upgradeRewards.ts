import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const adminSigner = new ethers.Wallet(
      process.env.ADMIN_PRIVATE_KEY,
      ethers.provider
    );
    const Contract = await ethers.getContractFactory("AgentReward", adminSigner);
    const contract = await upgrades.upgradeProxy(process.env.PERSONA_REWARD, Contract);
    console.log("Upgraded", contract.target)
  } catch (e) {
    console.log(e);
  }
})();
