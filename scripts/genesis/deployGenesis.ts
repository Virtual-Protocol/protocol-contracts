import { parseEther } from "ethers";
import { ethers, upgrades } from "hardhat";

// const adminSigner = new ethers.Wallet(
//   process.env.ADMIN_PRIVATE_KEY,
//   ethers.provider
// );

(async () => {
  try {
    // Basic check for .env variables
    const deployer = process.env.DEPLOYER;
    if (!deployer) {
      throw new Error("DEPLOYER not set in environment");
    }
    const beOpsWallet = process.env.GENESIS_BE_OPS_WALLET;
    if (!beOpsWallet) {
      throw new Error("GENESIS_BE_OPS_WALLET not set in environment");
    }
    const contractController = process.env.CONTRACT_CONTROLLER;
    if (!contractController) {
      throw new Error("CONTRACT_CONTROLLER not set in environment");
    }
    const admin = process.env.ADMIN;
    if (!admin) {
      throw new Error("ADMIN not set in environment");
    }

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

    console.log("Deploying FGenesis Proxy with params:", params);

    const FGenesis = await ethers.getContractFactory("FGenesis");
    const fGenesis = await upgrades.deployProxy(
      FGenesis,
      [params],
      {
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await fGenesis.waitForDeployment();

    const deployedFGenesisAddress = await fGenesis.getAddress();
    console.log("FGenesis Proxy deployed to:", deployedFGenesisAddress);

    // Reason: because Admin need to have the rights to call setParams for the fgenesis proxy
    const tx1 = await fGenesis.grantRole(
      await fGenesis.DEFAULT_ADMIN_ROLE(),
      process.env.ADMIN
    );
    await tx1.wait();
    console.log("Granted DEFAULT_ADMIN_ROLE of fGenesis Proxy to Admin: ", process.env.ADMIN);

    // Reason: because Admin need to have the rights to call withdrawLeftAssetsAfterFinalized for the fgenesis proxy
    const tx2 = await fGenesis.grantRole(
      await fGenesis.ADMIN_ROLE(),
      process.env.ADMIN
    );
    await tx2.wait();
    console.log("Granted ADMIN_ROLE of fGenesis Proxy to Admin: ", process.env.ADMIN);

    // Reason: because BE Ops need to have the rights to call onGenesisSuccess and onGenesisFailed for the fgenesis proxy
    const tx3 = await fGenesis.grantRole(
      await fGenesis.OPERATION_ROLE(),
      process.env.GENESIS_BE_OPS_WALLET
    );
    await tx3.wait();
    console.log("Granted OPERATION_ROLE of fGenesis Proxy to BE Ops: ", process.env.GENESIS_BE_OPS_WALLET);

    // Get the existed AgentFactory contract instance
    const agentFactory = await ethers.getContractAt(
      "AgentFactoryV3",
      params.agentFactory
    );

    // Reason: because FGenesis Proxy need to have the rights to grant BONDING_ROLE to the new Genesis contract
    const tx4 = await agentFactory.grantRole(
      await agentFactory.DEFAULT_ADMIN_ROLE(),
      deployedFGenesisAddress
    );
    await tx4.wait();
    console.log("Granted DEFAULT_ADMIN_ROLE of AgentFactory to FGenesis Proxy: ", deployedFGenesisAddress);

    // reason: there is no need for deployer to have ADMIN_ROLE
    const tx5 = await fGenesis.revokeRole(
      await fGenesis.ADMIN_ROLE(),
      process.env.DEPLOYER
    );
    await tx5.wait();
    console.log("Revoked ADMIN_ROLE of fGenesis Proxy from Deployer: ", process.env.DEPLOYER);

    // reason: there is no need for deployer to have DEFAULT_ADMIN_ROLE
    const tx6 = await fGenesis.revokeRole(
      await fGenesis.DEFAULT_ADMIN_ROLE(),
      process.env.DEPLOYER
    );
    await tx6.wait();
    console.log("Revoked DEFAULT_ADMIN_ROLE of fGenesis Proxy from Deployer: ", process.env.DEPLOYER);

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
