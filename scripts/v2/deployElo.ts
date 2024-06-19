import { ethers, upgrades } from "hardhat";

const adminSigner = new ethers.Wallet(
  process.env.ADMIN_PRIVATE_KEY,
  ethers.provider
);

(async () => {
  try {
    const args = require("../arguments/elo");
    const Contract = await ethers.getContractFactory("EloCalculator");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("EloCalculator deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
