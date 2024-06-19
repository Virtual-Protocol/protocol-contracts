import { ethers, upgrades } from "hardhat";

const adminSigner = new ethers.Wallet(
  process.env.ADMIN_PRIVATE_KEY,
  ethers.provider
);

(async () => {
  try {
    const args = require("../arguments/minter");
    const Contract = await ethers.getContractFactory("Minter");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("Minter deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
