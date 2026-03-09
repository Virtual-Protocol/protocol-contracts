import { parseEther } from "ethers";
const { ethers, upgrades } = require("hardhat");

// Environment variables are loaded via hardhat.config.js
// Make sure hardhat.config.js has: require("dotenv").config({ path: ".env.launchpadv5_dev" });

/**
 * Deploy FFactoryV2 and FRouterV2
 * Run this script first, then use the output addresses in deployPrerequisitesV5.ts
 */
(async () => {
  try {
    console.log("\n=== FFactoryV2 & FRouterV2 Deployment Starting ===");

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
    const admin = process.env.ADMIN;
    if (!admin) {
      throw new Error("ADMIN not set in environment");
    }
    const virtualTokenAddress = process.env.VIRTUAL_TOKEN_ADDRESS;
    if (!virtualTokenAddress) {
      throw new Error("VIRTUAL_TOKEN_ADDRESS not set in environment");
    }

    // FFactoryV2 parameters (Prototype phase - bonding curve)
    const taxVault = process.env.FFactoryV2_TAX_VAULT;
    if (!taxVault) {
      throw new Error("FFactoryV2_TAX_VAULT not set in environment");
    }
    const antiSniperTaxVault = process.env.FFactoryV2_ANTI_SNIPER_TAX_VAULT;
    if (!antiSniperTaxVault) {
      throw new Error(
        "FFactoryV2_ANTI_SNIPER_TAX_VAULT not set in environment"
      );
    }
    const prototypeBuyTax = process.env.PROTOTYPE_BUY_TAX;
    if (!prototypeBuyTax) {
      throw new Error("PROTOTYPE_BUY_TAX not set in environment");
    }
    const prototypeSellTax = process.env.PROTOTYPE_SELL_TAX;
    if (!prototypeSellTax) {
      throw new Error("PROTOTYPE_SELL_TAX not set in environment");
    }
    const antiSniperBuyTaxStartValue =
      process.env.ANTI_SNIPER_BUY_TAX_START_VALUE;
    if (!antiSniperBuyTaxStartValue) {
      throw new Error("ANTI_SNIPER_BUY_TAX_START_VALUE not set in environment");
    }
    const beOpsWallet = process.env.BE_OPS_WALLET;
    if (!beOpsWallet) {
      throw new Error("BE_OPS_WALLET not set in environment");
    }

    console.log("\nDeployment arguments loaded:", {
      contractController,
      admin,
      virtualTokenAddress,
      taxVault,
      antiSniperTaxVault,
      prototypeBuyTax,
      beOpsWallet,
      prototypeSellTax,
      antiSniperBuyTaxStartValue,
    });

    // Track deployed/reused contracts
    const deployedContracts: { [key: string]: string } = {};
    const reusedContracts: { [key: string]: string } = {};

    // Check if contracts already exist
    const existingFFactoryV2 = process.env.FFactoryV2_ADDRESS;
    const existingFRouterV2 = process.env.FRouterV2_ADDRESS;

    // ============================================
    // 1. Deploy or reuse FFactoryV2
    // ============================================
    let fFactoryV2Address: string;
    let fFactoryV2: any;

    if (existingFFactoryV2) {
      console.log("\n--- FFactoryV2 already exists, skipping deployment ---");
      fFactoryV2Address = existingFFactoryV2;
      fFactoryV2 = await ethers.getContractAt("FFactoryV2", fFactoryV2Address);
      reusedContracts.FFactoryV2 = fFactoryV2Address;
      console.log("Using existing FFactoryV2 at:", fFactoryV2Address);
    } else {
      console.log("\n--- Deploying FFactoryV2 ---");
      const FFactoryV2Factory = await ethers.getContractFactory("FFactoryV2");
      fFactoryV2 = await upgrades.deployProxy(
        FFactoryV2Factory,
        [
          taxVault,
          prototypeBuyTax,
          prototypeSellTax,
          antiSniperBuyTaxStartValue,
          antiSniperTaxVault,
        ],
        {
          initializer: "initialize",
          initialOwner: contractController,
        }
      );
      await fFactoryV2.waitForDeployment();
      fFactoryV2Address = await fFactoryV2.getAddress();
      deployedContracts.FFactoryV2 = fFactoryV2Address;
      console.log("FFactoryV2 deployed at:", fFactoryV2Address);
    }

    // ============================================
    // 2. Deploy or reuse FRouterV2
    // ============================================
    let fRouterV2Address: string;
    let fRouterV2: any;

    if (existingFRouterV2) {
      console.log("\n--- FRouterV2 already exists, skipping deployment ---");
      fRouterV2Address = existingFRouterV2;
      fRouterV2 = await ethers.getContractAt("FRouterV2", fRouterV2Address);
      reusedContracts.FRouterV2 = fRouterV2Address;
      console.log("Using existing FRouterV2 at:", fRouterV2Address);
    } else {
      console.log("\n--- Deploying FRouterV2 ---");
      const FRouterV2Factory = await ethers.getContractFactory("FRouterV2");
      fRouterV2 = await upgrades.deployProxy(
        FRouterV2Factory,
        [fFactoryV2Address, virtualTokenAddress],
        {
          initializer: "initialize",
          initialOwner: contractController,
        }
      );
      await fRouterV2.waitForDeployment();
      fRouterV2Address = await fRouterV2.getAddress();
      deployedContracts.FRouterV2 = fRouterV2Address;
      console.log("FRouterV2 deployed at:", fRouterV2Address);
    }

    // If both contracts were reused, skip configuration
    if (existingFFactoryV2 && existingFRouterV2) {
      console.log("\n=== Both contracts already exist, skipping configuration ===");
      console.log("FFactoryV2:", fFactoryV2Address);
      console.log("FRouterV2:", fRouterV2Address);
      console.log("\nNo changes made. Proceed to next deployment step.");
      return;
    }

    // ============================================
    // 3. Configure FFactoryV2 (only if newly deployed)
    // ============================================
    if (!existingFFactoryV2) {
      console.log("\n--- Configuring FFactoryV2 ---");
      const adminRole = await fFactoryV2.ADMIN_ROLE();
      const defaultAdminRole = await fFactoryV2.DEFAULT_ADMIN_ROLE();

      // Grant ADMIN_ROLE to deployer temporarily
      await fFactoryV2.grantRole(adminRole, deployerAddress);
      console.log("ADMIN_ROLE granted to deployer temporarily");

      // Set Router
      await fFactoryV2.setRouter(fRouterV2Address);
      console.log("Router set in FFactoryV2");

      // Grant roles to admin
      await fFactoryV2.grantRole(adminRole, admin);
      console.log("ADMIN_ROLE granted to admin:", admin);

      await fFactoryV2.grantRole(defaultAdminRole, admin);
      console.log("DEFAULT_ADMIN_ROLE granted to admin:", admin);
    }

    // ============================================
    // 4. Configure FRouterV2 (only if newly deployed)
    // ============================================
    if (!existingFRouterV2) {
      console.log("\n--- Configuring FRouterV2 ---");

      // Grant ADMIN_ROLE to admin (needed for setBondingV5)
      await fRouterV2.grantRole(await fRouterV2.ADMIN_ROLE(), admin);
      console.log("ADMIN_ROLE granted to admin on FRouterV2");

      // Grant DEFAULT_ADMIN_ROLE to admin
      await fRouterV2.grantRole(await fRouterV2.DEFAULT_ADMIN_ROLE(), admin);
      console.log("DEFAULT_ADMIN_ROLE granted to admin on FRouterV2");

      // Grant EXECUTOR_ROLE to BE_OPS_WALLET (for resetTime)
      const executorRole = await fRouterV2.EXECUTOR_ROLE();
      await fRouterV2.grantRole(executorRole, beOpsWallet);
      console.log("EXECUTOR_ROLE granted to BE_OPS_WALLET:", beOpsWallet);
    }

    // NOTE: Deployer roles are NOT revoked here
    // Run deployRevokeRoles.ts after all deployments are complete

    // ============================================
    // 5. Print Deployment Summary
    // ============================================
    console.log("\n=== FFactoryV2 & FRouterV2 Deployment Summary ===");
    
    if (Object.keys(deployedContracts).length > 0) {
      console.log("\n--- Newly Deployed Contracts ---");
      for (const [name, address] of Object.entries(deployedContracts)) {
        console.log(`- ${name}: ${address}`);
      }
      console.log("\nCopy the following to your .env file:");
      for (const [name, address] of Object.entries(deployedContracts)) {
        console.log(`${name}_ADDRESS=${address}`);
      }
    }

    if (Object.keys(reusedContracts).length > 0) {
      console.log("\n--- Reused Contracts (already existed) ---");
      for (const [name, address] of Object.entries(reusedContracts)) {
        console.log(`- ${name}: ${address}`);
      }
    }

    console.log("\n--- Final Contract Addresses ---");
    console.log(`FFactoryV2_ADDRESS=${fFactoryV2Address}`);
    console.log(`FRouterV2_ADDRESS=${fRouterV2Address}`);

    console.log("\n--- Deployment Order ---");
    console.log("1. ✅ deployLaunchpadv5_1.ts (FFactoryV2, FRouterV2) - DONE");
    console.log("2. ⏳ deployLaunchpadv5_2.ts (AgentFactoryV6)");
    console.log("3. ⏳ deployLaunchpadv5_3.ts (BondingConfig, BondingV5)");
    console.log("4. ⏳ deployLaunchpadv5_4.ts (Revoke deployer roles)");

    console.log("\n--- Next Step ---");
    console.log(
      "1. Add FFactoryV2_ADDRESS and FRouterV2_ADDRESS to your .env file"
    );
    console.log(
      "2. Run: npx hardhat run scripts/launchpadv5/deployLaunchpadv5_2.ts --network <network>"
    );

    console.log("\nDeployment completed successfully!");
  } catch (e) {
    console.error("Deployment failed:", e);
    throw e;
  }
})();
