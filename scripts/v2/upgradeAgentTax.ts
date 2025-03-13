import { ethers, upgrades } from "hardhat";

const adminSigner = new ethers.Wallet(
  process.env.ADMIN_PRIVATE_KEY,
  ethers.provider
);

(async () => {
  try {
    const Contract = await ethers.getContractFactory("AgentTax", adminSigner)
    const contract = await upgrades.upgradeProxy(process.env.AGENT_TAX_MANAGER, Contract);
    console.log("Contract upgraded:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
