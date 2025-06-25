import { ethers } from "hardhat";

(async () => {
  try {
    const args = require("./arguments/gov2");

    const dao = await ethers.deployContract("VirtualProtocolDAOV2", args);

    console.log("VirtualProtocolDAO deployed to:", dao.target);
  } catch (e) {
    console.log(e);
  }
})();
