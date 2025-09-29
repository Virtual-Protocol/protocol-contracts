import { parseEther } from "ethers";
const { ethers, upgrades } = require("hardhat");

(async () => {
  try {
    console.log("\n=== NewLaunchpad Deployment Starting ===");

    // Basic check for .env variables
    const deployerAddress = process.env.DEPLOYER;
    if (!deployerAddress) {
      throw new Error("DEPLOYER not set in environment");
    }
    const beOpsWallet = process.env.NEW_LAUNCHPAD_BE_OPS_WALLET;
    if (!beOpsWallet) {
      throw new Error("NEW_LAUNCHPAD_BE_OPS_WALLET not set in environment");
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
    const args = require("../arguments/launchpadv2Arguments");

    console.log("Deployment arguments loaded:", {
      virtualToken: args[0],
      buyTax: args[1],
      sellTax: args[2],
      antiSniperBuyTaxStartValue: args[3],
      feeAddress: args[4],
      feeAmount: args[5],
      initialSupply: args[6],
      assetRate: args[7],
      maxTx: args[8],
      gradThreshold: args[9],
      startTimeDelay: args[10],
      tbaSalt: args[11],
      tbaRegistry: args[12],
      tbaImplementation: args[13],
      daoVotingPeriod: args[14],
      daoThreshold: args[15],
      teamTokenReservedSupply: args[16],
      applicationThreshold: args[17],
      uniswapV2Factory: args[18],
      uniswapV2Router: args[19],
      agentNftV2: args[20],
    });

    // 1. Deploy FFactoryV2
    console.log("\n--- Deploying FFactoryV2 ---");
    const FFactoryV2 = await ethers.getContractFactory("FFactoryV2");
    const fFactoryV2 = await upgrades.deployProxy(
      FFactoryV2,
      [
        process.env.CONTRACT_CONTROLLER, // initialOwner
        args[1], // buyTax
        args[2], // sellTax
        args[3], // antiSniperBuyTaxStartValue
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await fFactoryV2.waitForDeployment();
    const fFactoryV2Address = await fFactoryV2.getAddress();
    console.log("FFactoryV2 deployed at:", fFactoryV2Address);

    // 2. Deploy FRouterV2
    console.log("\n--- Deploying FRouterV2 ---");
    const FRouterV2 = await ethers.getContractFactory("FRouterV2");
    const fRouterV2 = await upgrades.deployProxy(
      FRouterV2,
      [
        fFactoryV2Address, // factory
        args[0], // virtualToken (assetToken)
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await fRouterV2.waitForDeployment();
    const fRouterV2Address = await fRouterV2.getAddress();
    console.log("FRouterV2 deployed at:", fRouterV2Address);

    // 3. Grant ADMIN_ROLE to deployer temporarily, then set Router in FFactoryV2
    console.log("\n--- Granting ADMIN_ROLE to deployer temporarily ---");
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const tx0 = await fFactoryV2.grantRole(
      await fFactoryV2.ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx0.wait();
    console.log("ADMIN_ROLE granted to deployer");

    console.log("\n--- Setting Router in FFactoryV2 ---");
    const tx1 = await fFactoryV2.setRouter(fRouterV2Address);
    await tx1.wait();
    console.log("Router set in FFactoryV2");

    // Grant ADMIN_ROLE to CONTRACT_CONTROLLER
    console.log("\n--- Granting ADMIN_ROLE to CONTRACT_CONTROLLER ---");
    const tx0_5 = await fFactoryV2.grantRole(
      await fFactoryV2.ADMIN_ROLE(),
      process.env.CONTRACT_CONTROLLER
    );
    await tx0_5.wait();
    console.log("ADMIN_ROLE granted to CONTRACT_CONTROLLER");

    // 4. Deploy AgentToken implementation
    console.log("\n--- Deploying AgentToken implementation ---");
    const AgentToken = await ethers.getContractFactory("AgentToken");
    const agentToken = await AgentToken.deploy();
    await agentToken.waitForDeployment();
    const agentTokenAddress = await agentToken.getAddress();
    console.log("AgentToken implementation deployed at:", agentTokenAddress);

    // 5. Deploy MockAgentVeToken implementation (for production, use real AgentVeToken)
    console.log("\n--- Deploying AgentVeToken implementation ---");
    const AgentVeToken = await ethers.getContractFactory("AgentVeToken");
    const agentVeToken = await AgentVeToken.deploy();
    await agentVeToken.waitForDeployment();
    const agentVeTokenAddress = await agentVeToken.getAddress();
    console.log(
      "AgentVeToken implementation deployed at:",
      agentVeTokenAddress
    );

    // 6. Deploy AgentDAO implementation
    console.log("\n--- Deploying AgentDAO implementation ---");
    const AgentDAO = await ethers.getContractFactory("AgentDAO");
    const agentDAO = await AgentDAO.deploy();
    await agentDAO.waitForDeployment();
    const agentDAOAddress = await agentDAO.getAddress();
    console.log("AgentDAO implementation deployed at:", agentDAOAddress);

    // 7. Deploy ERC6551Registry implementation
    console.log("\n--- Deploying ERC6551Registry implementation ---");
    const ERC6551Registry = await ethers.getContractFactory("ERC6551Registry");
    const erc6551Registry = await ERC6551Registry.deploy();
    await erc6551Registry.waitForDeployment();
    const erc6551RegistryAddress = await erc6551Registry.getAddress();
    console.log(
      "ERC6551Registry implementation deployed at:",
      erc6551RegistryAddress
    );

    // 8. Deploy AgentFactoryV6
    console.log("\n--- Deploying AgentFactoryV6 ---");
    const AgentFactoryV6 = await ethers.getContractFactory("AgentFactoryV6");
    const agentFactoryV6 = await upgrades.deployProxy(
      AgentFactoryV6,
      [
        agentTokenAddress, // tokenImplementation_
        agentVeTokenAddress, // veTokenImplementation_
        agentDAOAddress, // daoImplementation_
        args[12], // tbaRegistry_
        args[0], // assetToken_ (virtualToken)
        args[20], // nft_ (AgentNftV2)
        args[17], // applicationThreshold_
        args[4], // vault_ (fee address)
        1, // nextId_
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await agentFactoryV6.waitForDeployment();
    const agentFactoryV6Address = await agentFactoryV6.getAddress();
    console.log("AgentFactoryV6 deployed at:", agentFactoryV6Address);

    // 9. Grant DEFAULT_ADMIN_ROLE to deployer temporarily for AgentFactoryV6
    console.log(
      "\n--- Granting DEFAULT_ADMIN_ROLE to deployer temporarily for AgentFactoryV6 ---"
    );
    const tx1_5 = await agentFactoryV6.grantRole(
      await agentFactoryV6.DEFAULT_ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx1_5.wait();
    console.log("DEFAULT_ADMIN_ROLE granted to deployer");

    // 10. Set params for AgentFactoryV6
    console.log("\n--- Setting params for AgentFactoryV6 ---");
    const tx2 = await agentFactoryV6.setParams(
      10 * 365 * 24 * 60 * 60, // maturityDuration (10 years)
      args[19], // uniswapRouter
      process.env.CONTRACT_CONTROLLER, // defaultDelegatee
      process.env.CONTRACT_CONTROLLER // tokenAdmin
    );
    await tx2.wait();
    console.log("Params set for AgentFactoryV6");

    // Grant DEFAULT_ADMIN_ROLE to CONTRACT_CONTROLLER
    console.log(
      "\n--- Granting DEFAULT_ADMIN_ROLE to CONTRACT_CONTROLLER for AgentFactoryV6 ---"
    );
    const tx1_6 = await agentFactoryV6.grantRole(
      await agentFactoryV6.DEFAULT_ADMIN_ROLE(),
      process.env.CONTRACT_CONTROLLER
    );
    await tx1_6.wait();
    console.log("DEFAULT_ADMIN_ROLE granted to CONTRACT_CONTROLLER");

    // 10. Set token params for AgentFactoryV6
    console.log("\n--- Setting token params for AgentFactoryV6 ---");
    const tx3 = await agentFactoryV6.setTokenParams(
      args[6], // maxSupply (initialSupply)
      "0", // lpSupply
      args[6], // vaultSupply (initialSupply)
      args[6], // maxTokensPerWallet (initialSupply)
      args[6], // maxTokensPerTxn (initialSupply)
      0, // botProtectionDurationInSeconds
      args[4], // vault (fee address)
      args[1], // projectBuyTaxBasisPoints (buyTax)
      args[2], // projectSellTaxBasisPoints (sellTax)
      1000, // taxSwapThresholdBasisPoints
      args[4] // projectTaxRecipient (fee address)
    );
    await tx3.wait();
    console.log("Token params set for AgentFactoryV6");

    // 11. Deploy BondingV2
    console.log("\n--- Deploying BondingV2 ---");
    const BondingV2 = await ethers.getContractFactory("BondingV2");
    const bondingV2 = await upgrades.deployProxy(
      BondingV2,
      [
        fFactoryV2Address, // factory_
        fRouterV2Address, // router_
        args[4], // feeTo_ (fee address)
        args[5], // fee_ (fee amount)
        args[6], // initialSupply_
        args[7], // assetRate_
        args[8], // maxTx_
        agentFactoryV6Address, // agentFactory_
        args[9], // gradThreshold_
        args[10], // startTimeDelay_
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await bondingV2.waitForDeployment();
    const bondingV2Address = await bondingV2.getAddress();
    console.log("BondingV2 deployed at:", bondingV2Address);

    // 12. Set DeployParams and LaunchParams for BondingV2 (deployer is owner initially)
    console.log("\n--- Setting DeployParams for BondingV2 ---");
    const deployParams = {
      tbaSalt: args[11], // tbaSalt
      tbaImplementation: args[13], // tbaImplementation
      daoVotingPeriod: args[14], // daoVotingPeriod
      daoThreshold: args[15], // daoThreshold
    };
    const tx4 = await bondingV2.setDeployParams(deployParams);
    await tx4.wait();
    console.log("DeployParams set for BondingV2");

    // 13. Set LaunchParams for BondingV2
    console.log("\n--- Setting LaunchParams for BondingV2 ---");
    const launchParams = {
      startTimeDelay: args[10], // startTimeDelay
      teamTokenReservedSupply: args[16], // teamTokenReservedSupply
      teamTokenReservedWallet: args[4], // teamTokenReservedWallet (fee address)
    };
    const tx5 = await bondingV2.setLaunchParams(launchParams);
    await tx5.wait();
    console.log("LaunchParams set for BondingV2");

    // 14. Transfer ownership of BondingV2 to CONTRACT_CONTROLLER
    console.log(
      "\n--- Transferring BondingV2 ownership to CONTRACT_CONTROLLER ---"
    );
    const tx3_5 = await bondingV2.transferOwnership(
      process.env.CONTRACT_CONTROLLER
    );
    await tx3_5.wait();
    console.log("BondingV2 ownership transferred to CONTRACT_CONTROLLER");

    // 14. Grant necessary roles
    console.log("\n--- Granting necessary roles ---");

    // Grant ADMIN_ROLE to admin in FFactoryV2
    const tx6 = await fFactoryV2.grantRole(
      await fFactoryV2.ADMIN_ROLE(),
      process.env.ADMIN
    );
    await tx6.wait();
    console.log(
      "Granted ADMIN_ROLE of FFactoryV2 to Admin:",
      process.env.ADMIN
    );

    // Grant DEFAULT_ADMIN_ROLE to deployer temporarily for FRouterV2
    const tx6_4 = await fRouterV2.grantRole(
      await fRouterV2.DEFAULT_ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx6_4.wait();
    console.log("Granted DEFAULT_ADMIN_ROLE of FRouterV2 to deployer");

    // Grant EXECUTOR_ROLE to BondingV2 in FRouterV2
    const tx7 = await fRouterV2.grantRole(
      await fRouterV2.EXECUTOR_ROLE(),
      bondingV2Address
    );
    await tx7.wait();
    console.log(
      "Granted EXECUTOR_ROLE of FRouterV2 to BondingV2:",
      bondingV2Address
    );

    // Grant DEFAULT_ADMIN_ROLE to CONTRACT_CONTROLLER for FRouterV2
    const tx6_5 = await fRouterV2.grantRole(
      await fRouterV2.DEFAULT_ADMIN_ROLE(),
      process.env.CONTRACT_CONTROLLER
    );
    await tx6_5.wait();
    console.log(
      "Granted DEFAULT_ADMIN_ROLE of FRouterV2 to CONTRACT_CONTROLLER:",
      process.env.CONTRACT_CONTROLLER
    );

    // Grant EXECUTOR_ROLE to admin in FRouterV2
    const tx8 = await fRouterV2.grantRole(
      await fRouterV2.EXECUTOR_ROLE(),
      process.env.ADMIN
    );
    await tx8.wait();
    console.log(
      "Granted EXECUTOR_ROLE of FRouterV2 to Admin:",
      process.env.ADMIN
    );

    // Grant BONDING_ROLE to BondingV2 in AgentFactoryV6
    const tx9 = await agentFactoryV6.grantRole(
      await agentFactoryV6.BONDING_ROLE(),
      bondingV2Address
    );
    await tx9.wait();
    console.log(
      "Granted BONDING_ROLE of AgentFactoryV6 to BondingV2:",
      bondingV2Address
    );

    // Grant CREATOR_ROLE to BondingV2 in FFactoryV2
    const tx10 = await fFactoryV2.grantRole(
      await fFactoryV2.CREATOR_ROLE(),
      bondingV2Address
    );
    await tx10.wait();
    console.log(
      "Granted CREATOR_ROLE of FFactoryV2 to BondingV2:",
      bondingV2Address
    );

    // MANUAL STEP REQUIRED: Grant MINTER_ROLE to AgentFactoryV6 in AgentNftV2
    // This must be done by the ADMIN account (DEFAULT_ADMIN_ROLE holder)
    console.log("\n⚠️  MANUAL STEP REQUIRED:");
    console.log(
      "The following role must be granted manually by the ADMIN account:"
    );
    console.log(`AgentNftV2.grantRole(MINTER_ROLE, ${agentFactoryV6Address})`);
    console.log(`AgentNftV2 address: ${args[20]}`);
    console.log(`ADMIN account: ${process.env.ADMIN}`);
    console.log(
      "This step is skipped in automated deployment due to permission requirements."
    );

    // BondingV2 uses OwnableUpgradeable, ownership was already transferred to CONTRACT_CONTROLLER
    console.log(
      "BondingV2 ownership management completed (uses OwnableUpgradeable)"
    );

    // 15. Revoke deployer roles (security best practice)
    console.log("\n--- Revoking deployer roles ---");

    // Revoke deployer roles from FFactoryV2
    const tx13 = await fFactoryV2.revokeRole(
      await fFactoryV2.ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx13.wait();
    console.log(
      "Revoked ADMIN_ROLE of FFactoryV2 from Deployer:",
      await deployer.getAddress()
    );

    // Revoke deployer roles from FRouterV2
    const tx14 = await fRouterV2.revokeRole(
      await fRouterV2.DEFAULT_ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx14.wait();
    console.log(
      "Revoked DEFAULT_ADMIN_ROLE of FRouterV2 from Deployer:",
      await deployer.getAddress()
    );

    // Revoke deployer roles from AgentFactoryV6
    const tx15 = await agentFactoryV6.revokeRole(
      await agentFactoryV6.DEFAULT_ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx15.wait();
    console.log(
      "Revoked DEFAULT_ADMIN_ROLE of AgentFactoryV6 from Deployer:",
      await deployer.getAddress()
    );

    // BondingV2 ownership was already transferred, no need to revoke roles

    // 16. Print deployment summary
    console.log("\n=== NewLaunchpad Deployment Summary ===");
    console.log("All contracts deployed and configured:");
    console.log("- AgentToken (implementation):", agentTokenAddress);
    console.log("- AgentVeToken (implementation):", agentVeTokenAddress);
    console.log("- AgentDAO (implementation):", agentDAOAddress);
    // console.log("- ERC6551Registry (implementation):", erc6551RegistryAddress);
    console.log("- FFactoryV2:", fFactoryV2Address);
    console.log("- FRouterV2:", fRouterV2Address);
    console.log("- AgentFactoryV6:", agentFactoryV6Address);
    console.log("- BondingV2:", bondingV2Address);

    console.log("\nDeployment and role setup completed successfully!");
  } catch (e) {
    console.error("Deployment failed:", e);
    throw e;
  }
})();
