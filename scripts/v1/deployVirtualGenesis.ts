import { ethers } from "hardhat";

const deployParams = require("../arguments/genesisDaoArguments.js");

(async () => {
  try {
    const dao = await ethers.deployContract("VirtualGenesisDAO", deployParams);

    console.log("VirtualGenesisDAO deployed to:", dao.target);
  } catch (e) {
    console.log(e);
  }
})();
