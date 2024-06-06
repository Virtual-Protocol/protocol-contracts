import { ethers } from "hardhat";

(async () => {
  try {
    const dao = await ethers.deployContract("AgentDAO");
    await dao.waitForDeployment();
    console.log("AgentDAO deployed to:", dao.target);

    const token = await ethers.deployContract("AgentToken");
    await token.waitForDeployment();
    console.log("AgentToken deployed to:", token.target);
  } catch (e) {
    console.log(e);
  }
})();
