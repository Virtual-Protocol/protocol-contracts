import { parseEther } from "ethers";
import { ethers, upgrades } from "hardhat";

// const adminSigner = new ethers.Wallet(
//   process.env.ADMIN_PRIVATE_KEY,
//   ethers.provider
// );

(async () => {
  try {
    // Load arguments from the arguments file
    const args = require("../arguments/fgenesis");

    // Create the params struct
    const params = {
      virtualToken: args[0],
      reserve: args[1],
      maxContribution: args[2],
      feeAddr: args[3],
      feeAmt: args[4],
      duration: args[5],
      tbaSalt: args[6],
      tbaImpl: args[7],
      votePeriod: args[8],
      threshold: args[9],
      agentFactory: args[10],
      agentTokenTotalSupply: args[11],
      agentTokenLpSupply: args[12],
    };

    console.log("Deploying FGenesis with params:", params);

    const FGenesis = await ethers.getContractFactory("FGenesis");
    const fGenesis = await upgrades.deployProxy(FGenesis, [params]);
    await fGenesis.waitForDeployment();

    const deployedFGenesisAddress = await fGenesis.getAddress();
    console.log("FGenesis deployed to:", deployedFGenesisAddress);

    // Get the roles
    const DEFAULT_ADMIN_ROLE = await fGenesis.DEFAULT_ADMIN_ROLE();
    const ADMIN_ROLE = await fGenesis.ADMIN_ROLE();

    // Get the existed AgentFactory contract instance
    const agentFactory = await ethers.getContractAt(
      "AgentFactoryV3",
      params.agentFactory
    );

    // Get the BE ops wallet signer
    const beOpsWallet = process.env.GENESIS_BE_OPS_WALLET;
    if (!beOpsWallet) {
      throw new Error("GENESIS_BE_OPS_WALLET not set in environment");
    }

    // Get the DEFAULT_ADMIN_ROLE from AgentFactory
    const AGENT_FACTORY_ADMIN_ROLE = await agentFactory.DEFAULT_ADMIN_ROLE();

    // Grant DEFAULT_ADMIN_ROLE to FGenesis in AgentFactory
    console.log("Granting DEFAULT_ADMIN_ROLE to FGenesis in AgentFactory");
    const tx = await agentFactory.grantRole(
      AGENT_FACTORY_ADMIN_ROLE,
      deployedFGenesisAddress
    );
    await tx.wait();
    console.log("Granted DEFAULT_ADMIN_ROLE to FGenesis in AgentFactory");

    // Transfer admin rights if needed
    if (process.env.ADMIN) {
      console.log("Granting DEFAULT_ADMIN_ROLE to:", process.env.ADMIN);
      const tx1 = await fGenesis.grantRole(
        DEFAULT_ADMIN_ROLE,
        process.env.ADMIN
      );
      await tx1.wait();
    }

    if (process.env.GENESIS_BE_OPS_WALLET) {
      console.log("Granting ADMIN_ROLE to:", process.env.GENESIS_BE_OPS_WALLET);
      const tx2 = await fGenesis.grantRole(
        ADMIN_ROLE,
        process.env.GENESIS_BE_OPS_WALLET
      );
      await tx2.wait();
    }

    if (process.env.CONTRACT_CONTROLLER) {
      console.log(
        "Revoking DEFAULT_ADMIN_ROLE from:",
        process.env.CONTRACT_CONTROLLER
      );
      const tx3 = await fGenesis.revokeRole(
        DEFAULT_ADMIN_ROLE,
        process.env.CONTRACT_CONTROLLER
      );
      await tx3.wait();
    }

    // Print deployed parameters
    const deployedParams = await fGenesis.params();
    console.log("\nDeployed contract parameters:");
    console.log(deployedParams);

    console.log("Deployment and role setup completed");
  } catch (e) {
    console.error("Deployment failed:", e);
    throw e;
  }
})();
