import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const AgentFactory = await ethers.getContractFactory("AgentFactory");
    const factory = await upgrades.upgradeProxy(
      process.env.VIRTUAL_FACTORY,
      AgentFactory
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
