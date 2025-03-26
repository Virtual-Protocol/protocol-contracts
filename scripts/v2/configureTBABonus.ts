import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const Contract = await ethers.getContractFactory("AgentTax");

    const contract = await ethers.getContractAt(
      "AgentTax",
      process.env.AGENT_TAX_MANAGER
    );
    await contract.updateTbaBonus(process.env.TBABONUS);

    console.log("TBABonus address updated");
  } catch (e) {
    console.log(e);
  }
})();
