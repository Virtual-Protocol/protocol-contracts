const { ethers, upgrades } = require("hardhat");

(async () => {
  try {
    console.log("\n=== NewLaunchpad Deployment Starting ===");

    // Basic check for .env variables

    // Load arguments directly from environment variables
    const creationFeeToAddress =
      process.env.LAUNCHPAD_V2_CREATION_FEE_TO_ADDRESS;
    if (!creationFeeToAddress) {
      throw new Error("LAUNCHPAD_V2_FEE_ADDRESS not set in environment");
    }
    const feeAmount = process.env.LAUNCHPAD_V2_FEE_AMOUNT;
    if (!feeAmount) {
      throw new Error("LAUNCHPAD_V2_FEE_AMOUNT not set in environment");
    }
    const initialSupply = process.env.INITIAL_SUPPLY;
    if (!initialSupply) {
      throw new Error("INITIAL_SUPPLY not set in environment");
    }
    const assetRate = process.env.ASSET_RATE;
    if (!assetRate) {
      throw new Error("ASSET_RATE not set in environment");
    }
    const maxTx = process.env.MAX_TX;
    if (!maxTx) {
      throw new Error("MAX_TX not set in environment");
    }
    const gradThreshold = process.env.GRAD_THRESHOLD;
    if (!gradThreshold) {
      throw new Error("GRAD_THRESHOLD not set in environment");
    }
    const startTimeDelay = process.env.LAUNCHPAD_V2_START_TIME_DELAY;
    if (!startTimeDelay) {
      throw new Error("LAUNCHPAD_V2_START_TIME_DELAY not set in environment");
    }
    const tbaSalt = process.env.TBA_SALT;
    if (!tbaSalt) {
      throw new Error("TBA_SALT not set in environment");
    }
    const tbaImplementation = process.env.TBA_IMPLEMENTATION;
    if (!tbaImplementation) {
      throw new Error("TBA_IMPLEMENTATION not set in environment");
    }
    const daoVotingPeriod = process.env.DAO_VOTING_PERIOD;
    if (!daoVotingPeriod) {
      throw new Error("DAO_VOTING_PERIOD not set in environment");
    }
    const daoThreshold = process.env.DAO_THRESHOLD;
    if (!daoThreshold) {
      throw new Error("DAO_THRESHOLD not set in environment");
    }
    const teamTokenReservedSupply = process.env.TEAM_TOKEN_RESERVED_SUPPLY;
    if (!teamTokenReservedSupply) {
      throw new Error("TEAM_TOKEN_RESERVED_SUPPLY not set in environment");
    }
    const teamTokenReservedWallet = process.env.TEAM_TOKEN_RESERVED_WALLET;
    if (!teamTokenReservedWallet) {
      throw new Error("TEAM_TOKEN_RESERVED_WALLET not set in environment");
    }

    const fFactoryV2Address = process.env.FFactoryV2_ADDRESS;
    if (!fFactoryV2Address) {
      throw new Error("FFactoryV2_ADDRESS not set in environment");
    }
    const fRouterV2Address = process.env.FRouterV2_ADDRESS;
    if (!fRouterV2Address) {
      throw new Error("FRouterV2_ADDRESS not set in environment");
    }
    const agentFactoryV6Address = process.env.AGENT_FACTORY_V6_ADDRESS;
    if (!agentFactoryV6Address) {
      throw new Error("AGENT_FACTORY_V6_ADDRESS not set in environment");
    }

    console.log("Deployment arguments loaded:", {
      creationFeeToAddress,
      feeAmount,
      initialSupply,
      assetRate,
      maxTx,
      gradThreshold,
      startTimeDelay,
      tbaSalt,
      tbaImplementation,
      daoVotingPeriod,
      daoThreshold,
      teamTokenReservedSupply,
      teamTokenReservedWallet,
      fFactoryV2Address,
      fRouterV2Address,
      agentFactoryV6Address,
    });

    // 1. Deploy BondingV4
    console.log("\n--- Deploying BondingV4 ---");
    const BondingV4 = await ethers.getContractFactory("BondingV4");
    const bondingV4 = await upgrades.deployProxy(
      BondingV4,
      [
        fFactoryV2Address, // factory_
        fRouterV2Address, // router_
        creationFeeToAddress, // feeTo_ (fee address)
        feeAmount, // fee_ (fee amount)
        initialSupply, // initialSupply_
        assetRate, // assetRate_
        maxTx, // maxTx_
        agentFactoryV6Address, // agentFactory_
        gradThreshold, // gradThreshold_
        startTimeDelay, // startTimeDelay_
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await bondingV4.waitForDeployment();
    const bondingV4Address = await bondingV4.getAddress();
    console.log("BondingV4 deployed at:", bondingV4Address);

    // 2. Set DeployParams and LaunchParams for BondingV4 (deployer is owner initially)
    console.log("\n--- Setting DeployParams for BondingV4 ---");
    const deployParams = {
      tbaSalt: tbaSalt, // tbaSalt
      tbaImplementation: tbaImplementation, // tbaImplementation
      daoVotingPeriod: daoVotingPeriod, // daoVotingPeriod
      daoThreshold: daoThreshold, // daoThreshold
    };
    const tx4 = await bondingV4.setDeployParams(deployParams);
    await tx4.wait();
    console.log("DeployParams set for BondingV4");

    // 3. Set LaunchParams for BondingV4
    console.log("\n--- Setting LaunchParams for BondingV4 ---");
    const launchParams = {
      startTimeDelay: startTimeDelay, // startTimeDelay
      teamTokenReservedSupply: teamTokenReservedSupply, // teamTokenReservedSupply
      teamTokenReservedWallet: teamTokenReservedWallet, // teamTokenReservedWallet
    };
    const tx5 = await bondingV4.setLaunchParams(launchParams);
    await tx5.wait();
    console.log("LaunchParams set for BondingV4");

    // 4. Grant necessary roles and Transfer ownership
    console.log("\n--- Granting necessary roles, Transfer ownership ---");

    // Validate ADMIN_PRIVATE_KEY
    if (!process.env.ADMIN_PRIVATE_KEY) {
      throw new Error("ADMIN_PRIVATE_KEY not set in environment");
    }

    const adminSigner = new ethers.Wallet(
      process.env.ADMIN_PRIVATE_KEY,
      ethers.provider
    );
    const adminAddress = await adminSigner.getAddress();
    console.log("Using admin signer:", adminAddress);

    // 4.1 Grant CREATOR_ROLE of FFactoryV2 to BondingV4, for createPair()
    console.log("\n--- Granting CREATOR_ROLE of FFactoryV2 to BondingV4 ---");
    const fFactoryV2 = await ethers.getContractAt(
      "FFactoryV2",
      fFactoryV2Address,
      adminSigner
    );

    try {
      const creatorRole = await fFactoryV2.CREATOR_ROLE();
      console.log("CREATOR_ROLE:", creatorRole);

      // Check admin permission
      const adminRole = await fFactoryV2.DEFAULT_ADMIN_ROLE();
      const hasAdminRole = await fFactoryV2.hasRole(adminRole, adminAddress);
      console.log("Admin has DEFAULT_ADMIN_ROLE on FFactoryV2:", hasAdminRole);

      if (!hasAdminRole) {
        throw new Error(
          `Account ${adminAddress} does not have DEFAULT_ADMIN_ROLE on FFactoryV2`
        );
      }

      const tx10 = await fFactoryV2.grantRole(creatorRole, bondingV4Address);
      console.log("Transaction hash:", tx10.hash);
      await tx10.wait();
      console.log("✅ Granted CREATOR_ROLE of FFactoryV2 to BondingV4");
    } catch (error: any) {
      console.error(
        "❌ Failed to grant CREATOR_ROLE on FFactoryV2:",
        error.message
      );
      throw error;
    }

    // 4.2 Grant EXECUTOR_ROLE of FRouterV2 to BondingV4, for buy(), sell(), addInitialLiquidity()
    console.log("\n--- Granting EXECUTOR_ROLE of FRouterV2 to BondingV4 ---");
    const fRouterV2 = await ethers.getContractAt(
      "FRouterV2",
      fRouterV2Address,
      adminSigner
    );

    try {
      const executorRole = await fRouterV2.EXECUTOR_ROLE();
      console.log("EXECUTOR_ROLE:", executorRole);

      // Check admin permission
      const adminRole = await fRouterV2.DEFAULT_ADMIN_ROLE();
      const hasAdminRole = await fRouterV2.hasRole(adminRole, adminAddress);
      console.log("Admin has DEFAULT_ADMIN_ROLE on FRouterV2:", hasAdminRole);

      if (!hasAdminRole) {
        throw new Error(
          `Account ${adminAddress} does not have DEFAULT_ADMIN_ROLE on FRouterV2`
        );
      }

      const tx7 = await fRouterV2.grantRole(executorRole, bondingV4Address);
      console.log("Transaction hash:", tx7.hash);
      await tx7.wait();
      console.log("✅ Granted EXECUTOR_ROLE of FRouterV2 to BondingV4");
    } catch (error: any) {
      console.error(
        "❌ Failed to grant EXECUTOR_ROLE on FRouterV2:",
        error.message
      );
      throw error;
    }

    // 4.3 Grant BONDING_ROLE of AgentFactoryV6 to BondingV4,
    // for createNewAgentTokenAndApplication(), updateApplicationThresholdWithApplicationId()
    // for executeBondingCurveApplicationSalt(),
    // for addBlacklistAddress(), removeBlacklistAddress()
    console.log(
      "\n--- Granting BONDING_ROLE of AgentFactoryV6 to BondingV4 ---"
    );
    const agentFactoryV6 = await ethers.getContractAt(
      "AgentFactoryV6",
      agentFactoryV6Address,
      adminSigner
    );

    try {
      const bondingRole = await agentFactoryV6.BONDING_ROLE();
      console.log("BONDING_ROLE:", bondingRole);

      // Check admin permission
      const adminRole = await agentFactoryV6.DEFAULT_ADMIN_ROLE();
      const hasAdminRole = await agentFactoryV6.hasRole(
        adminRole,
        adminAddress
      );
      console.log(
        "Admin has DEFAULT_ADMIN_ROLE on AgentFactoryV6:",
        hasAdminRole
      );

      if (!hasAdminRole) {
        throw new Error(
          `Account ${adminAddress} does not have DEFAULT_ADMIN_ROLE on AgentFactoryV6`
        );
      }

      const tx9 = await agentFactoryV6.grantRole(bondingRole, bondingV4Address);
      console.log("Transaction hash:", tx9.hash);
      await tx9.wait();
      console.log("✅ Granted BONDING_ROLE of AgentFactoryV6 to BondingV4");
    } catch (error: any) {
      console.error(
        "❌ Failed to grant BONDING_ROLE on AgentFactoryV6:",
        error.message
      );
      throw error;
    }

    // 4.4 Transfer ownership of BondingV4 to CONTRACT_CONTROLLER
    console.log(
      "\n--- Transferring BondingV4 ownership to CONTRACT_CONTROLLER ---"
    );
    const tx3_5 = await bondingV4.transferOwnership(
      process.env.CONTRACT_CONTROLLER
    );
    await tx3_5.wait();
    console.log("BondingV4 ownership transferred to CONTRACT_CONTROLLER");

    // 5. Print deployment summary
    console.log("\n=== NewLaunchpad Deployment Summary ===");
    console.log("All contracts deployed and configured:");
    console.log("- FFactoryV2:", fFactoryV2Address);
    console.log("- FRouterV2:", fRouterV2Address);
    console.log("- AgentFactoryV6:", agentFactoryV6Address);
    console.log("- BondingV4:", bondingV4Address);

    console.log("\nDeployment and role setup completed successfully!");
  } catch (e) {
    console.error("Deployment failed:", e);
    throw e;
  }
})();
