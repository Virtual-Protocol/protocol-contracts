import { ethers } from "hardhat";

(async () => {
  try {
    const initialOwner = process.env.DEPLOYER
    const token = await ethers.deployContract("Token", [initialOwner]);
    await token.waitForDeployment();
    console.log("Token deployed to:", token.target);
  } catch (e) {
    console.log(e);
  }
})();



