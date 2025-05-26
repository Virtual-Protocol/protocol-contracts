import { ethers, upgrades } from "hardhat";


(async () => {
  try {
    const args = require("../arguments/taxSwapper");
    const contract = await ethers.deployContract("TaxSwapper", args);
    await contract.waitForDeployment();
    console.log("Swapper deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
