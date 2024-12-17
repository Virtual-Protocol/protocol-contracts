import { ethers, upgrades } from "hardhat";

const adminSigner = new ethers.Wallet(
  process.env.ADMIN_PRIVATE_KEY,
  ethers.provider
);

(async () => {
  try {
    const args = require("../arguments/bondingTax");
    const Contract = await ethers.getContractFactory("BondingTax");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("BondingTax deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
