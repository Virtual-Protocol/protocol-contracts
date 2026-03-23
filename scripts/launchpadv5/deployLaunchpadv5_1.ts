/**
 * V5 Suite - Step 1: Deploy FFactoryV3 and FRouterV3
 * 
 * Usage:
 *   ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/deployLaunchpadv5_1.ts --network local
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/deployLaunchpadv5_1.ts --network base_sepolia
 *   ENV_FILE=.env.launchpadv5_prod npx hardhat run scripts/launchpadv5/deployLaunchpadv5_1.ts --network base
 */
import { parseEther } from "ethers";
import { verifyContract } from "./utils";
const { ethers, upgrades } = require("hardhat");

/**
 * V5 Suite - Step 1: Deploy FFactoryV3 and FRouterV3
 * 
 * Deploys:
 * - FFactoryV3 (NEW - for V5 Suite, same code as FFactoryV2 but separate instance)
 * - FRouterV3 (NEW - calls depositTax() for on-chain tax attribution)
 * 
 * Prerequisites: AgentTaxV2 must be deployed (run deployLaunchpadv5_0.ts first)
 * 
 * V5 Suite Architecture:
 * - FFactoryV3 creates pairs that use FRouterV3
 * - FRouterV3 calls AgentTaxV2.depositTax() for tax attribution
 */
(async () => {
  try {
    console.log("\n" + "=".repeat(80));
    console.log("  V5 Suite - Step 1: Deploy FFactoryV3 & FRouterV3");
    console.log("=".repeat(80));

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

    // FFactoryV3 parameters (taxVault = AgentTaxV2)
    const taxVault = process.env.FFactoryV3_TAX_VAULT;
    if (!taxVault) {
      throw new Error("FFactoryV3_TAX_VAULT not set - run deployLaunchpadv5_0.ts first");
    }
    const antiSniperTaxVault = process.env.FFactoryV3_ANTI_SNIPER_TAX_VAULT;
    if (!antiSniperTaxVault) {
      throw new Error("FFactoryV3_ANTI_SNIPER_TAX_VAULT not set in environment");
    }
    const prototypeBuyTax = process.env.PROTOTYPE_BUY_TAX;
    if (!prototypeBuyTax) {
      throw new Error("PROTOTYPE_BUY_TAX not set in environment");
    }
    const prototypeSellTax = process.env.PROTOTYPE_SELL_TAX;
    if (!prototypeSellTax) {
      throw new Error("PROTOTYPE_SELL_TAX not set in environment");
    }
    const antiSniperBuyTaxStartValue = process.env.ANTI_SNIPER_BUY_TAX_START_VALUE;
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
      prototypeSellTax,
      antiSniperBuyTaxStartValue,
      beOpsWallet,
    });

    // Track deployed/reused contracts
    const deployedContracts: { [key: string]: string } = {};
    const reusedContracts: { [key: string]: string } = {};

    // Check if contracts already exist
    const existingFFactoryV3 = process.env.FFactoryV3_ADDRESS;
    const existingFRouterV3 = process.env.FRouterV3_ADDRESS;

    // ============================================
    // 1. Deploy or reuse FFactoryV3
    // ============================================
    let fFactoryV3Address: string;
    let fFactoryV3: any;

    if (existingFFactoryV3) {
      console.log("\n--- FFactoryV3 already exists, skipping deployment ---");
      fFactoryV3Address = existingFFactoryV3;
      fFactoryV3 = await ethers.getContractAt("FFactoryV3", fFactoryV3Address);
      reusedContracts.FFactoryV3 = fFactoryV3Address;
      console.log("Using existing FFactoryV3 at:", fFactoryV3Address);
    } else {
      console.log("\n--- Deploying FFactoryV3 (NEW for V5 Suite) ---");
      const FFactoryV3Factory = await ethers.getContractFactory("FFactoryV3");
      fFactoryV3 = await upgrades.deployProxy(
        FFactoryV3Factory,
        [
          taxVault,                   // AgentTaxV2 address
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
      await fFactoryV3.waitForDeployment();
      fFactoryV3Address = await fFactoryV3.getAddress();
      deployedContracts.FFactoryV3 = fFactoryV3Address;
      console.log("FFactoryV3 deployed at:", fFactoryV3Address);

      await verifyContract(fFactoryV3Address);
    }

    // ============================================
    // 2. Deploy or reuse FRouterV3
    // ============================================
    let fRouterV3Address: string;
    let fRouterV3: any;

    if (existingFRouterV3) {
      console.log("\n--- FRouterV3 already exists, skipping deployment ---");
      fRouterV3Address = existingFRouterV3;
      fRouterV3 = await ethers.getContractAt("FRouterV3", fRouterV3Address);
      reusedContracts.FRouterV3 = fRouterV3Address;
      console.log("Using existing FRouterV3 at:", fRouterV3Address);
    } else {
      console.log("\n--- Deploying FRouterV3 (NEW for V5 Suite) ---");
      const FRouterV3Factory = await ethers.getContractFactory("FRouterV3");
      fRouterV3 = await upgrades.deployProxy(
        FRouterV3Factory,
        [fFactoryV3Address, virtualTokenAddress],
        {
          initializer: "initialize",
          initialOwner: contractController,
        }
      );
      await fRouterV3.waitForDeployment();
      fRouterV3Address = await fRouterV3.getAddress();
      deployedContracts.FRouterV3 = fRouterV3Address;
      console.log("FRouterV3 deployed at:", fRouterV3Address);

      await verifyContract(fRouterV3Address);
    }

    // If both contracts were reused, skip configuration
    if (existingFFactoryV3 && existingFRouterV3) {
      console.log("\n=== Both contracts already exist, skipping configuration ===");
      console.log("FFactoryV3:", fFactoryV3Address);
      console.log("FRouterV3:", fRouterV3Address);
      console.log("\nNo changes made. Proceed to next deployment step.");
      return;
    }

    // ============================================
    // 3. Configure FFactoryV3 (only if newly deployed)
    // ============================================
    if (!existingFFactoryV3) {
      console.log("\n--- Configuring FFactoryV3 ---");
      const adminRole = await fFactoryV3.ADMIN_ROLE();
      const defaultAdminRole = await fFactoryV3.DEFAULT_ADMIN_ROLE();

      // Grant ADMIN_ROLE to deployer temporarily (needed for setRouter)
      const tx1 = await fFactoryV3.grantRole(adminRole, deployerAddress);
      await tx1.wait();
      console.log("ADMIN_ROLE of FFactoryV3 granted to deployer (temporary)");

      // Set Router
      const tx2 = await fFactoryV3.setRouter(fRouterV3Address);
      await tx2.wait();
      console.log("FFactoryV3.setRouter() called with:", fRouterV3Address);

      // Grant roles to admin
      const tx3 = await fFactoryV3.grantRole(adminRole, admin);
      await tx3.wait();
      console.log("ADMIN_ROLE of FFactoryV3 granted to admin:", admin);

      const tx4 = await fFactoryV3.grantRole(defaultAdminRole, admin);
      await tx4.wait();
      console.log("DEFAULT_ADMIN_ROLE of FFactoryV3 granted to admin:", admin);
    }

    // ============================================
    // 4. Configure FRouterV3 (only if newly deployed)
    // ============================================
    if (!existingFRouterV3) {
      console.log("\n--- Configuring FRouterV3 ---");

      // Grant ADMIN_ROLE to admin
      const tx5 = await fRouterV3.grantRole(await fRouterV3.ADMIN_ROLE(), admin);
      await tx5.wait();
      console.log("ADMIN_ROLE of FRouterV3 granted to admin:", admin);

      // Grant DEFAULT_ADMIN_ROLE to admin
      const tx6 = await fRouterV3.grantRole(await fRouterV3.DEFAULT_ADMIN_ROLE(), admin);
      await tx6.wait();
      console.log("DEFAULT_ADMIN_ROLE of FRouterV3 granted to admin:", admin);

      // Grant EXECUTOR_ROLE to BE_OPS_WALLET (for resetTime)
      const executorRole = await fRouterV3.EXECUTOR_ROLE();
      const tx7 = await fRouterV3.grantRole(executorRole, beOpsWallet);
      await tx7.wait();
      console.log("EXECUTOR_ROLE of FRouterV3 granted to BE_OPS_WALLET:", beOpsWallet);
    }

    // ============================================
    // 5. Print Deployment Summary
    // ============================================
    console.log("\n" + "=".repeat(80));
    console.log("  Deployment Summary");
    console.log("=".repeat(80));
    
    if (Object.keys(deployedContracts).length > 0) {
      console.log("\n--- Newly Deployed Contracts ---");
      for (const [name, address] of Object.entries(deployedContracts)) {
        console.log(`${name}_ADDRESS=${address}`);
      }
    }

    if (Object.keys(reusedContracts).length > 0) {
      console.log("\n--- Reused Contracts (already existed) ---");
      for (const [name, address] of Object.entries(reusedContracts)) {
        console.log(`${name}_ADDRESS=${address}`);
      }
    }

    console.log("\n--- Environment Variables for .env file ---");
    console.log(`FFactoryV3_ADDRESS=${fFactoryV3Address}`);
    console.log(`FRouterV3_ADDRESS=${fRouterV3Address}`);

    console.log("\n--- V5 Suite Note ---");
    console.log("FRouterV3 calls AgentTaxV2.depositTax() for on-chain tax attribution");
    console.log("This eliminates the need for tax-listener service for V5 tokens");

    console.log("\n--- Deployment Order ---");
    console.log("0. ✅ deployLaunchpadv5_0.ts (AgentNftV2, AgentTaxV2) - DONE");
    console.log("1. ✅ deployLaunchpadv5_1.ts (FFactoryV3, FRouterV3) - DONE");
    console.log("2. ⏳ deployLaunchpadv5_2.ts (AgentFactoryV7, AgentTokenV3)");
    console.log("3. ⏳ deployLaunchpadv5_3.ts (BondingConfig, BondingV5)");
    console.log("4. ⏳ deployLaunchpadv5_4.ts (Revoke deployer roles)");

    console.log("\n--- Next Step ---");
    console.log("1. Add FFactoryV3_ADDRESS and FRouterV3_ADDRESS to your .env file");
    console.log("2. Run: npx hardhat run scripts/launchpadv5/deployLaunchpadv5_2.ts --network <network>");

    console.log("\n" + "=".repeat(80));
    console.log("  Step 1 Completed Successfully!");
    console.log("=".repeat(80));
  } catch (e) {
    console.error("❌ Deployment failed:", e);
    process.exit(1);
  }
})();
