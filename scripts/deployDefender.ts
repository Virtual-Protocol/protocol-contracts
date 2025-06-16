import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const args = [process.env.ADMIN, 4, process.env.VEVIRTUAL];
    const Contract = await ethers.getContractFactory("Defender");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("Defender deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
