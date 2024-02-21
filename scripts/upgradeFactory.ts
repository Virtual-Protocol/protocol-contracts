import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const PersonaFactory = await ethers.getContractFactory("PersonaFactory");
    const factory = await upgrades.upgradeProxy(
      process.env.VIRTUAL_FACTORY,
      PersonaFactory
    );
    await factory.setImplementations(
      process.env.VIRTUAL_TOKEN_IMPL,
      process.env.VIRTUAL_DAO_IMPL
    );
    console.log("Upgraded", factory.target);
  } catch (e) {
    console.log(e);
  }
})();
