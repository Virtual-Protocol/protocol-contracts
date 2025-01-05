import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const Contract = await ethers.getContractFactory("FRouter")
    const contract = await ethers.deployContract("FRouter");
    console.log("Contract deployed to:", contract.target);

    const proxyAdmin = await ethers.getContractAt(
      "MyProxyAdmin",
      process.env.FROUTER_PROXY
    );
    await proxyAdmin.upgradeAndCall(process.env.FROUTER, contract.target, "0x");
    console.log("Upgraded FROUTER");
  } catch (e) {
    console.log(e);
  }
})();
