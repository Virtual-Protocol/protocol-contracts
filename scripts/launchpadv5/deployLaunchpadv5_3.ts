/**
 * V5 Suite - Step 3: Deploy BondingConfig and BondingV5
 * 
 * Usage:
 *   ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network local
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network base_sepolia
 *   ENV_FILE=.env.launchpadv5_prod npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network base
 */
import { parseEther } from "ethers";
import { verifyContract } from "./utils";
const { ethers, upgrades } = require("hardhat");

/**
 * V5 Suite - Step 3: Deploy BondingConfig and BondingV5
 * 
 * Deploys:
 * - BondingConfig (configuration contract)
 * - BondingV5 (uses FFactoryV3, FRouterV3, AgentFactoryV7)
 * 
 * Prerequisites:
 * - AgentNftV2, AgentTaxV2 (from deployLaunchpadv5_0.ts)
 * - FFactoryV3, FRouterV3 (from deployLaunchpadv5_1.ts)
 * - AgentFactoryV7 (from deployLaunchpadv5_2.ts)
 * 
 * V5 Suite Architecture:
 * - BondingV5 → FFactoryV3 → FRouterV3 → AgentTaxV2.depositTax()
 * - BondingV5.launch() → AgentFactoryV7 → AgentTokenV3
 * - BondingV5.launch() calls AgentTaxV2.registerToken()
 */
(async () => {
  try {
    console.log("\n" + "=".repeat(80));
    console.log("  V5 Suite - Step 3: Deploy BondingConfig & BondingV5");
    console.log("=".repeat(80));
    console.log("Prerequisites: FFactoryV3, FRouterV3, AgentFactoryV7, AgentTaxV2 must already exist.");

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    console.log("Deployer address:", deployerAddress);

    // ============================================
    // Load required environment variables
    // ============================================
    const contractController = process.env.CONTRACT_CONTROLLER;
    if (!contractController) {
      throw new Error("CONTRACT_CONTROLLER not set in environment");
    }

    // V5 Suite prerequisite contract addresses (required)
    const fFactoryV3Address = process.env.FFactoryV3_ADDRESS;
    if (!fFactoryV3Address) {
      throw new Error("FFactoryV3_ADDRESS not set - run deployLaunchpadv5_1.ts first");
    }
    const fRouterV3Address = process.env.FRouterV3_ADDRESS;
    if (!fRouterV3Address) {
      throw new Error("FRouterV3_ADDRESS not set - run deployLaunchpadv5_1.ts first");
    }
    const agentFactoryV7Address = process.env.AGENT_FACTORY_V7_ADDRESS;
    if (!agentFactoryV7Address) {
      throw new Error("AGENT_FACTORY_V7_ADDRESS not set - run deployLaunchpadv5_2.ts first");
    }
    const agentTaxV2Address = process.env.AGENT_TAX_V2_CONTRACT_ADDRESS;
    if (!agentTaxV2Address) {
      throw new Error("AGENT_TAX_V2_CONTRACT_ADDRESS not set - run deployLaunchpadv5_0.ts first");
    }

    // BondingConfig parameters
    const creationFeeToAddress = process.env.LAUNCHPAD_V5_CREATION_FEE_TO_ADDRESS;
    if (!creationFeeToAddress) {
      throw new Error("LAUNCHPAD_V5_CREATION_FEE_TO_ADDRESS not set in environment");
    }
    const initialSupply = process.env.INITIAL_SUPPLY;
    if (!initialSupply) {
      throw new Error("INITIAL_SUPPLY not set in environment");
    }
    const startTimeDelay = process.env.LAUNCHPAD_V5_START_TIME_DELAY;
    if (!startTimeDelay) {
      throw new Error("LAUNCHPAD_V5_START_TIME_DELAY not set in environment");
    }
    const normalLaunchFee = process.env.LAUNCHPAD_V5_NORMAL_LAUNCH_FEE;
    if (!normalLaunchFee) {
      throw new Error("LAUNCHPAD_V5_NORMAL_LAUNCH_FEE not set in environment");
    }
    const acfFee = process.env.LAUNCHPAD_V5_ACF_FEE;
    if (!acfFee) {
      throw new Error("LAUNCHPAD_V5_ACF_FEE not set in environment");
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
    const teamTokenReservedWallet = process.env.TEAM_TOKEN_RESERVED_WALLET;
    if (!teamTokenReservedWallet) {
      throw new Error("TEAM_TOKEN_RESERVED_WALLET not set in environment");
    }
    const fakeInitialVirtualLiq = process.env.FAKE_INITIAL_VIRTUAL_LIQ;
    if (!fakeInitialVirtualLiq) {
      throw new Error("FAKE_INITIAL_VIRTUAL_LIQ not set in environment");
    }
    const targetRealVirtual = process.env.TARGET_REAL_VIRTUAL;
    if (!targetRealVirtual) {
      throw new Error("TARGET_REAL_VIRTUAL not set in environment");
    }

    const maxAirdropBips = process.env.MAX_AIRDROP_BIPS;
    if (!maxAirdropBips) {
      throw new Error("MAX_AIRDROP_BIPS not set in environment");
    }

    const maxTotalReservedBips = process.env.MAX_TOTAL_RESERVED_BIPS;
    if (!maxTotalReservedBips) {
      throw new Error("MAX_TOTAL_RESERVED_BIPS not set in environment");
    }

    const acfReservedBips = process.env.ACF_RESERVED_BIPS;
    if (!acfReservedBips) {
      throw new Error("ACF_RESERVED_BIPS not set in environment");
    }

    const privilegedLauncherAddresses = process.env.PRIVILEGED_LAUNCHER_ADDRESSES;
    if (!privilegedLauncherAddresses) {
      throw new Error("PRIVILEGED_LAUNCHER_ADDRESSES not set in environment");
    }

    console.log("\nDeployment arguments loaded:", {
      contractController,
      fFactoryV3Address,
      fRouterV3Address,
      agentFactoryV7Address,
      agentTaxV2Address,
      creationFeeToAddress,
      initialSupply,
      startTimeDelay,
      normalLaunchFee,
      acfFee,
      tbaSalt,
      tbaImplementation,
      daoVotingPeriod,
      daoThreshold,
      teamTokenReservedWallet,
      fakeInitialVirtualLiq,
      targetRealVirtual,
      maxAirdropBips,
      maxTotalReservedBips,
      acfReservedBips,
      privilegedLauncherAddresses,
    });

    // ============================================
    // 1. Deploy BondingConfig
    // ============================================
    console.log("\n--- Deploying BondingConfig ---");
    const BondingConfig = await ethers.getContractFactory("BondingConfig");
    
    const reserveSupplyParams = {
      maxAirdropBips: maxAirdropBips,
      maxTotalReservedBips: maxTotalReservedBips,
      acfReservedBips: acfReservedBips,
    };

    const scheduledLaunchParams = {
      startTimeDelay: startTimeDelay,
      normalLaunchFee: parseEther(normalLaunchFee).toString(),
      acfFee: parseEther(acfFee).toString(),
    };
    
    const deployParams = {
      tbaSalt: tbaSalt,
      tbaImplementation: tbaImplementation,
      daoVotingPeriod: daoVotingPeriod,
      daoThreshold: daoThreshold,
    };
    
    const bondingCurveParams = {
      fakeInitialVirtualLiq: parseEther(fakeInitialVirtualLiq).toString(),
      targetRealVirtual: parseEther(targetRealVirtual).toString(),
    };
    
    const bondingConfig = await upgrades.deployProxy(
      BondingConfig,
      [
        initialSupply,
        creationFeeToAddress,
        teamTokenReservedWallet,
        reserveSupplyParams,
        scheduledLaunchParams,
        deployParams,
        bondingCurveParams,
      ],
      {
        initializer: "initialize",
        initialOwner: contractController,
      }
    );
    await bondingConfig.waitForDeployment();
    const bondingConfigAddress = await bondingConfig.getAddress();
    console.log("BondingConfig deployed at:", bondingConfigAddress);

    await verifyContract(bondingConfigAddress);

    // Privileged launchers: preLaunch X/ACP + launch() Project60days (comma-separated)
    const privilegedLauncherAddressList = privilegedLauncherAddresses.split(",").map((addr) => addr.trim()).filter((addr) => addr);
    console.log("\n--- Setting privileged launchers in BondingConfig (setPrivilegedLauncher) ---");
    for (const addr of privilegedLauncherAddressList) {
      const tx = await bondingConfig.setPrivilegedLauncher(addr, true);
      await tx.wait();
      console.log("BondingConfig.setPrivilegedLauncher(true):", addr);
    }

    // ============================================
    // 2. Deploy BondingV5 (uses V5 Suite contracts)
    // ============================================
    console.log("\n--- Deploying BondingV5 (V5 Suite) ---");
    const BondingV5 = await ethers.getContractFactory("BondingV5");
    const bondingV5 = await upgrades.deployProxy(
      BondingV5,
      [
        fFactoryV3Address,       // FFactoryV3 (NOT FFactoryV2!)
        fRouterV3Address,        // FRouterV3 (NOT FRouterV2!)
        agentFactoryV7Address,   // AgentFactoryV7 (NOT AgentFactoryV6!)
        bondingConfigAddress,
      ],
      {
        initializer: "initialize",
        initialOwner: contractController,
      }
    );
    await bondingV5.waitForDeployment();
    const bondingV5Address = await bondingV5.getAddress();
    console.log("BondingV5 deployed at:", bondingV5Address);

    await verifyContract(bondingV5Address);

    // ============================================
    // 3. Transfer Ownership
    // ============================================
    console.log("\n--- Transferring ownership ---");

    const tx5 = await bondingV5.transferOwnership(contractController);
    await tx5.wait();
    console.log("BondingV5 ownership transferred to CONTRACT_CONTROLLER:", contractController);

    const tx6 = await bondingConfig.transferOwnership(contractController);
    await tx6.wait();
    console.log("BondingConfig ownership transferred to CONTRACT_CONTROLLER:", contractController);

    // ============================================
    // 4. Grant Roles and Configure Contracts
    // ============================================
    console.log("\n--- Granting roles and configuring contracts ---");
    
    let fFactoryV3 = await ethers.getContractAt("FFactoryV3", fFactoryV3Address);
    let fRouterV3 = await ethers.getContractAt("FRouterV3", fRouterV3Address);
    let agentFactoryV7 = await ethers.getContractAt("AgentFactoryV7", agentFactoryV7Address);
    let agentTaxV2 = await ethers.getContractAt("AgentTaxV2", agentTaxV2Address);
    
    const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY;
    if (adminPrivateKey) { // If ADMIN_PRIVATE_KEY is set, use it to grant roles, easier for testnet
      const adminSigner = new ethers.Wallet(adminPrivateKey, ethers.provider);
      fFactoryV3 = await ethers.getContractAt("FFactoryV3", fFactoryV3Address, adminSigner);
      fRouterV3 = await ethers.getContractAt("FRouterV3", fRouterV3Address, adminSigner);
      agentFactoryV7 = await ethers.getContractAt("AgentFactoryV7", agentFactoryV7Address, adminSigner);
      agentTaxV2 = await ethers.getContractAt("AgentTaxV2", agentTaxV2Address, adminSigner);
    }

    // Grant CREATOR_ROLE of FFactoryV3 to BondingV5
    const creatorRole = await fFactoryV3.CREATOR_ROLE();
    await (await fFactoryV3.grantRole(creatorRole, bondingV5Address)).wait();
    console.log("✅ CREATOR_ROLE of FFactoryV3 granted to BondingV5:", bondingV5Address);

    // Set BondingV5 and BondingConfig in FRouterV3
    await (await fRouterV3.setBondingV5(bondingV5Address, bondingConfigAddress)).wait();
    console.log("✅ FRouterV3.setBondingV5() called:", { bondingV5: bondingV5Address, bondingConfig: bondingConfigAddress });

    // Grant EXECUTOR_ROLE of FRouterV3 to BondingV5
    const executorRole = await fRouterV3.EXECUTOR_ROLE();
    await (await fRouterV3.grantRole(executorRole, bondingV5Address)).wait();
    console.log("✅ EXECUTOR_ROLE of FRouterV3 granted to BondingV5:", bondingV5Address);

    // Grant BONDING_ROLE of AgentFactoryV7 to BondingV5
    const bondingRole = await agentFactoryV7.BONDING_ROLE();
    await (await agentFactoryV7.grantRole(bondingRole, bondingV5Address)).wait();
    console.log("✅ BONDING_ROLE of AgentFactoryV7 granted to BondingV5:", bondingV5Address);

    // Grant REGISTER_ROLE of AgentTaxV2 to BondingV5 (for registerToken)
    // BondingV5 uses factory.taxVault() to get AgentTaxV2 address
    const agentTaxV2RegisterRole = await agentTaxV2.REGISTER_ROLE();
    await (await agentTaxV2.grantRole(agentTaxV2RegisterRole, bondingV5Address)).wait();
    console.log("✅ REGISTER_ROLE of AgentTaxV2 granted to BondingV5 (for registerToken):", bondingV5Address);
    console.log("   Note: BondingV5 uses FFactoryV3.taxVault() to get AgentTaxV2 address");

    // Set BondingV5 address in AgentTaxV2 (for updateCreatorForSpecialLaunchAgents validation)
    await (await agentTaxV2.setBondingV5(bondingV5Address)).wait();
    console.log("✅ AgentTaxV2.setBondingV5() called:", bondingV5Address);

    console.log("\n✅ All role grants and configurations completed!");

    // ============================================
    // 5. Print Deployment Summary
    // ============================================
    console.log("\n" + "=".repeat(80));
    console.log("  Deployment Summary");
    console.log("=".repeat(80));
    
    console.log("\n--- V5 Suite Prerequisite Contracts ---");
    console.log(`- FFactoryV3: ${fFactoryV3Address}`);
    console.log(`- FRouterV3: ${fRouterV3Address}`);
    console.log(`- AgentFactoryV7: ${agentFactoryV7Address}`);
    console.log(`- AgentTaxV2: ${agentTaxV2Address}`);

    console.log("\n--- Newly Deployed Contracts ---");
    console.log(`- BondingConfig: ${bondingConfigAddress}`);
    console.log(`- BondingV5: ${bondingV5Address}`);

    console.log("\n--- Configuration ---");
    console.log("- Initial Supply:", initialSupply);
    console.log("- Reserve Supply Params (in bips, 1 bip = 0.01%):");
    console.log("  - Max Airdrop Bips:", maxAirdropBips, "(", Number(maxAirdropBips) / 100, "%)");
    console.log("  - Max Total Reserved Bips:", maxTotalReservedBips, "(", Number(maxTotalReservedBips) / 100, "%)");
    console.log("  - ACF Reserved Bips:", acfReservedBips, "(", Number(acfReservedBips) / 100, "%)");
    console.log("- Start Time Delay:", startTimeDelay, "seconds");
    console.log("- Normal Launch Fee:", normalLaunchFee, "VIRTUAL (scheduled/marketing)");
    console.log("- ACF Fee:", acfFee, "VIRTUAL (extra fee when needAcf = true)");
    console.log("- Team Token Reserved Wallet:", teamTokenReservedWallet);
    console.log("- Fake Initial Virtual Liq:", fakeInitialVirtualLiq);
    console.log("- Target Real Virtual:", targetRealVirtual);

    console.log("\n--- Role Grants Completed ---");
    console.log("- FFactoryV3.CREATOR_ROLE → BondingV5 (create preToken pairs)");
    console.log("- FRouterV3.EXECUTOR_ROLE → BondingV5 (buy/sell operations)");
    console.log("- AgentFactoryV7.BONDING_ROLE → BondingV5 (launch tokens)");
    console.log("- AgentTaxV2.REGISTER_ROLE → BondingV5 (registerToken on launch)");
    console.log("- AgentTaxV2.setBondingV5() → BondingV5 (for special launch validation)");

    console.log("\n--- V5 Suite Tax Flow ---");
    console.log("Prototype Buy/Sell:");
    console.log("  User → BondingV5 → FRouterV3 → AgentTaxV2.depositTax(preToken)");
    console.log("Graduated Buy/Sell:");
    console.log("  User → AgentTokenV3._swapTax() → AgentTaxV2.depositTax(tokenAddress)");
    console.log("Tax Distribution:");
    console.log("  Backend → AgentTaxV2.swapForTokenAddress() → Swap & Distribute");

    console.log("\n--- Deployment Order ---");
    console.log("0. ✅ deployLaunchpadv5_0.ts (AgentNftV2, AgentTaxV2) - DONE");
    console.log("1. ✅ deployLaunchpadv5_1.ts (FFactoryV3, FRouterV3) - DONE");
    console.log("2. ✅ deployLaunchpadv5_2.ts (AgentFactoryV7, AgentTokenV3) - DONE");
    console.log("3. ✅ deployLaunchpadv5_3.ts (BondingConfig, BondingV5) - DONE");
    console.log("4. ⏳ deployLaunchpadv5_4.ts (Revoke deployer roles)");

    console.log("\n" + "=".repeat(60));

    console.log("\n--- Environment Variables for .env file ---");
    console.log(`BONDING_CONFIG_ADDRESS=${bondingConfigAddress}`);
    console.log(`BONDING_V5_ADDRESS=${bondingV5Address}`);

    console.log("\n--- Next Step ---");
    console.log("1. Add BONDING_CONFIG_ADDRESS and BONDING_V5_ADDRESS to your .env file");
    console.log("2. Run: npx hardhat run scripts/launchpadv5/deployLaunchpadv5_4.ts --network <network>");

    console.log("\n" + "=".repeat(80));
    console.log("  Step 3 Completed Successfully!");
    console.log("=".repeat(80));
  } catch (e) {
    console.error("❌ Deployment failed:", e);
    process.exit(1);
  }
})();
