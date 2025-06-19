import { ethers, upgrades } from "hardhat";

(async () => {
  try {

    const [deployer] = await ethers.getSigners()
    console.log(deployer.address)

    const token = await ethers.deployContract("AgentToken");
    await token.waitForDeployment();
    console.log("AgentToken deployed to:", token.target);

    const agentToken = token.target
    const virtualToken = process.env.BRIDGED_TOKEN

    const agentFactory = await upgrades.deployProxy(
      await ethers.getContractFactory("SimpleAgentFactory"),
      [
        agentToken,
        virtualToken,
        deployer.address,
      ]
    );
    await agentFactory.waitForDeployment();
    console.log("AgentTokenFactory deployed to:", agentFactory.target);
  } catch (e) {
    console.log(e);
  }
})();



