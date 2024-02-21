import { ethers } from "hardhat";

(async () => {
  try {
    const dao = await ethers.deployContract("PersonaDAO");
    await dao.waitForDeployment();
    console.log("PersonaDAO deployed to:", dao.target);

    const token = await ethers.deployContract("PersonaToken");
    await token.waitForDeployment();
    console.log("PersonaToken deployed to:", token.target);
  } catch (e) {
    console.log(e);
  }
})();
