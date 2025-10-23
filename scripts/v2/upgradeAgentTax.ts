import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    console.log("AGENT_TAX_MANAGER:", process.env.AGENT_TAX_MANAGER);

    if (!process.env.AGENT_TAX_MANAGER) {
      throw new Error("AGENT_TAX_MANAGER environment variable is not set");
    }

    // Use admin private key for upgrade
    if (!process.env.ADMIN_PRIVATE_KEY) {
      throw new Error("ADMIN_PRIVATE_KEY environment variable is not set");
    }

    const adminWallet = new ethers.Wallet(
      process.env.ADMIN_PRIVATE_KEY,
      ethers.provider
    );
    console.log("Using admin address:", adminWallet.address);

    const Contract = await ethers.getContractFactory("AgentTax");
    const contract = Contract.connect(adminWallet);
    console.log("Contract factory created with admin wallet");

    const upgraded = await upgrades.upgradeProxy(
      process.env.AGENT_TAX_MANAGER,
      contract
    );
    console.log("Contract upgraded:", upgraded.target);
  } catch (e) {
    console.error("Error:", e);
    if ((e as Error).message.includes("execution reverted")) {
      console.log("This might be due to:");
      console.log("1. Storage layout incompatibility");
      console.log("2. Missing upgrade permissions");
      console.log("3. The address is not a proxy contract");
    }
  }
})();
