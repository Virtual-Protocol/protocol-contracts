import { ethers } from "hardhat";

(async () => {
  try {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const token = await ethers.deployContract(
      "veVirtualToken",
      [deployer],
      {}
    );
    console.log("veVirtualToken deployed to:", token.target);
  } catch (e) {
    console.log(e);
  }
})();
