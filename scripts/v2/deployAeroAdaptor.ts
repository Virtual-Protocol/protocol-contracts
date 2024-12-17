import { ethers, upgrades } from "hardhat";

const adminSigner = new ethers.Wallet(
  process.env.ADMIN_PRIVATE_KEY,
  ethers.provider
);

(async () => {
  try {
    const args = require("../arguments/aeroAdaptor");
    const contract = await ethers.deployContract("AeroAdaptor", args);
    await contract.waitForDeployment();
    console.log("AeroAdaptor deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
