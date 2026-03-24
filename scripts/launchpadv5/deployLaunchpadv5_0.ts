/**
 * V5 Suite - Step 0: Deploy Prerequisites (AgentNftV2, AgentTaxV2)
 * 
 * Usage:
 *   ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/deployLaunchpadv5_0.ts --network local
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/deployLaunchpadv5_0.ts --network base_sepolia
 *   ENV_FILE=.env.launchpadv5_prod npx hardhat run scripts/launchpadv5/deployLaunchpadv5_0.ts --network base
 */
import { parseEther } from "ethers";
import { verifyContract } from "./utils";
const { ethers, upgrades } = require("hardhat");

/**
 * V5 Suite - Step 0: Deploy Prerequisites
 * 
 * Deploys:
 * - AgentNftV2 (optional, reuse if already deployed)
 * - AgentTaxV2 (NEW - for on-chain tax attribution)
 * 
 * V5 Suite Architecture:
 * - AgentFactoryV7 + AgentTokenV3 + BondingV5 + FRouterV3 → AgentTaxV2 (on-chain)
 * 
 * Run this script before deployLaunchpadv5_1.ts
 */
(async () => {
  try {
    console.log("\n" + "=".repeat(80));
    console.log("  V5 Suite - Step 0: Deploy Prerequisites (AgentNftV2, AgentTaxV2)");
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

    // Backend wallet addresses for SWAP_ROLE (for swapForTokenAddress / batchSwapForTokenAddress)
    const beTaxOpsWallets = process.env.BE_TAX_OPS_WALLETS;
    if (!beTaxOpsWallets) {
      throw new Error("BE_TAX_OPS_WALLETS not set in environment (comma-separated addresses)");
    }
    const beTaxOpsWalletList = beTaxOpsWallets.split(",").map((addr) => addr.trim()).filter((addr) => addr.length > 0);
    if (beTaxOpsWalletList.length === 0) {
      throw new Error("BE_TAX_OPS_WALLETS must contain at least one address");
    }

    // Backend wallet addresses for EXECUTOR_ROLE (for updateCreatorForSpecialLaunchAgents)
    const beOpsWallets = process.env.BE_OPS_WALLETS;
    if (!beOpsWallets) {
      throw new Error("BE_OPS_WALLETS not set in environment (comma-separated addresses)");
    }
    const beOpsWalletList = beOpsWallets.split(",").map((addr) => addr.trim()).filter((addr) => addr.length > 0);
    if (beOpsWalletList.length === 0) {
      throw new Error("BE_OPS_WALLETS must contain at least one address");
    }

    // AgentTaxV2 parameters (reuse same env names, just deploy V2 contract)
    const assetToken = process.env.AGENT_TAX_ASSET_TOKEN;
    if (!assetToken) {
      throw new Error("AGENT_TAX_ASSET_TOKEN not set in environment");
    }
    
    const taxToken = process.env.AGENT_TAX_TAX_TOKEN;
    if (!taxToken) {
      throw new Error("AGENT_TAX_TAX_TOKEN not set in environment");
    }
    
    const agentTaxDexRouter = process.env.AGENT_TAX_DEX_ROUTER;
    if (!agentTaxDexRouter) {
      throw new Error("AGENT_TAX_DEX_ROUTER not set in environment");
    }
    
    const treasury = process.env.AGENT_TAX_TREASURY;
    if (!treasury) {
      throw new Error("AGENT_TAX_TREASURY not set in environment");
    }
    
    const minSwapThreshold = process.env.AGENT_TAX_MIN_SWAP_THRESHOLD;
    if (!minSwapThreshold) {
      throw new Error("AGENT_TAX_MIN_SWAP_THRESHOLD not set in environment");
    }
    const maxSwapThreshold = process.env.AGENT_TAX_MAX_SWAP_THRESHOLD;
    if (!maxSwapThreshold) {
      throw new Error("AGENT_TAX_MAX_SWAP_THRESHOLD not set in environment");
    }
    const feeRate = process.env.AGENT_TAX_FEE_RATE;
    if (!feeRate) {
      throw new Error("AGENT_TAX_FEE_RATE not set in environment");
    }

    // AgentNftV2 - optional, reuse if exists
    let agentNftV2Address: string | undefined = process.env.AGENT_NFT_V2_ADDRESS;

    console.log("\nDeployment arguments loaded:", {
      contractController,
      admin,
      beTaxOpsWallets: beTaxOpsWalletList,
      beOpsWallets: beOpsWalletList,
      assetToken,
      taxToken,
      agentTaxDexRouter,
      treasury,
      minSwapThreshold,
      maxSwapThreshold,
      feeRate,
      agentNftV2Address: agentNftV2Address || "(will deploy)",
    });

    // Track deployed/reused contracts
    const deployedContracts: { [key: string]: string } = {};
    const reusedContracts: { [key: string]: string } = {};

    // ============================================
    // 1. Deploy or Reuse AgentNftV2
    // ============================================
    if (!agentNftV2Address) {
      console.log("\n--- Deploying AgentNftV2 (proxy) ---");
      const AgentNftV2 = await ethers.getContractFactory("AgentNftV2");
      const agentNftV2 = await upgrades.deployProxy(
        AgentNftV2,
        [deployerAddress],
        {
          initializer: "initialize",
          initialOwner: contractController,
          unsafeAllow: ["internal-function-storage"],
        }
      );
      await agentNftV2.waitForDeployment();
      agentNftV2Address = await agentNftV2.getAddress();
      console.log("AgentNftV2 deployed at:", agentNftV2Address);
      deployedContracts["AGENT_NFT_V2_ADDRESS"] = agentNftV2Address!;

      // Grant DEFAULT_ADMIN_ROLE to admin
      const defaultAdminRole = await agentNftV2.DEFAULT_ADMIN_ROLE();
      const tx = await agentNftV2.grantRole(defaultAdminRole, admin);
      await tx.wait();
      console.log("DEFAULT_ADMIN_ROLE of AgentNftV2 granted to admin:", admin);

      // Grant ADMIN_ROLE to admin (needed for agentVeTokenV2.setMatureAt())
      const adminRole = await agentNftV2.ADMIN_ROLE();
      const tx2 = await agentNftV2.grantRole(adminRole, admin);
      await tx2.wait();
      console.log("ADMIN_ROLE of AgentNftV2 granted to admin:", admin);

      // Grant VALIDATOR_ADMIN_ROLE to admin
      const validatorAdminRole = await agentNftV2.VALIDATOR_ADMIN_ROLE();
      const tx3 = await agentNftV2.grantRole(validatorAdminRole, admin);
      await tx3.wait();
      console.log("VALIDATOR_ADMIN_ROLE of AgentNftV2 granted to admin:", admin);

      await verifyContract(agentNftV2Address!);
    } else {
      console.log("\n--- Reusing existing AgentNftV2 ---");
      console.log("AgentNftV2 address:", agentNftV2Address);
      reusedContracts["AGENT_NFT_V2_ADDRESS"] = agentNftV2Address;
    }

    // ============================================
    // 2. Deploy AgentTaxV2 (NEW - for V5 Suite)
    // ============================================
    const existingAgentTaxV2 = process.env.AGENT_TAX_V2_CONTRACT_ADDRESS;
    let agentTaxV2Address: string;

    if (!existingAgentTaxV2) {
      console.log("\n--- Deploying AgentTaxV2 (NEW for V5 Suite) ---");
      const AgentTaxV2 = await ethers.getContractFactory("AgentTaxV2");
      // Initialize with deployer as defaultAdmin so we can grant roles
      // Admin roles will be transferred later
      const agentTaxV2 = await upgrades.deployProxy(
        AgentTaxV2,
        [
          deployerAddress,      // defaultAdmin_ (deployer first, so we can grant roles)
          assetToken,           // assetToken_
          taxToken,             // taxToken_ (VIRTUAL)
          agentTaxDexRouter,    // router_
          treasury,             // treasury_
          minSwapThreshold,     // minSwapThreshold_
          maxSwapThreshold,     // maxSwapThreshold_
          feeRate,              // feeRate_ (30% = 3000)
        ],
        {
          initializer: "initialize",
          initialOwner: contractController,
        }
      );
      await agentTaxV2.waitForDeployment();
      agentTaxV2Address = await agentTaxV2.getAddress();
      console.log("AgentTaxV2 deployed at:", agentTaxV2Address);
      deployedContracts["AGENT_TAX_V2_CONTRACT_ADDRESS"] = agentTaxV2Address;

      // Grant SWAP_ROLE to BE_TAX_OPS wallets (for swapForTokenAddress / batchSwapForTokenAddress)
      const swapRole = await agentTaxV2.SWAP_ROLE();
      for (const wallet of beTaxOpsWalletList) {
        const grantTx = await agentTaxV2.grantRole(swapRole, wallet);
        await grantTx.wait();
        console.log("SWAP_ROLE of AgentTaxV2 granted to:", wallet);
      }

      // Grant EXECUTOR_ROLE to BE_OPS wallets (for updateCreatorForSpecialLaunchAgents)
      const executorRole = await agentTaxV2.EXECUTOR_ROLE();
      for (const wallet of beOpsWalletList) {
        const grantTx = await agentTaxV2.grantRole(executorRole, wallet);
        await grantTx.wait();
        console.log("EXECUTOR_ROLE of AgentTaxV2 granted to:", wallet);
      }

      // Grant DEFAULT_ADMIN_ROLE and ADMIN_ROLE to admin
      const defaultAdminRole = await agentTaxV2.DEFAULT_ADMIN_ROLE();
      const adminRole = await agentTaxV2.ADMIN_ROLE();
      
      const grantDefaultAdminTx = await agentTaxV2.grantRole(defaultAdminRole, admin);
      await grantDefaultAdminTx.wait();
      console.log("DEFAULT_ADMIN_ROLE of AgentTaxV2 granted to admin:", admin);

      const grantAdminTx = await agentTaxV2.grantRole(adminRole, admin);
      await grantAdminTx.wait();
      console.log("ADMIN_ROLE of AgentTaxV2 granted to admin:", admin);

      // Note: REGISTER_ROLE for BondingV5 (registerToken) will be granted in _3.ts
      // Note: setBondingV5() will be called in _3.ts
      // Note: Deployer's roles will be revoked in _4.ts

      await verifyContract(agentTaxV2Address);
    } else {
      console.log("\n--- Reusing existing AgentTaxV2 ---");
      console.log("AgentTaxV2 address:", existingAgentTaxV2);
      agentTaxV2Address = existingAgentTaxV2;
      reusedContracts["AGENT_TAX_V2_CONTRACT_ADDRESS"] = existingAgentTaxV2;
    }

    // ============================================
    // 3. Print Deployment Summary
    // ============================================
    console.log("\n" + "=".repeat(80));
    console.log("  Deployment Summary");
    console.log("=".repeat(80));

    if (Object.keys(deployedContracts).length > 0) {
      console.log("\n--- Newly Deployed Contracts ---");
      for (const [name, address] of Object.entries(deployedContracts)) {
        console.log(`${name}=${address}`);
      }
    }

    if (Object.keys(reusedContracts).length > 0) {
      console.log("\n--- Reused Existing Contracts ---");
      for (const [name, address] of Object.entries(reusedContracts)) {
        console.log(`${name}=${address}`);
      }
    }

    console.log("\n--- Environment Variables for .env file ---");
    console.log("# V5 Suite Prerequisites:");
    console.log(`AGENT_NFT_V2_ADDRESS=${agentNftV2Address}`);
    console.log(`AGENT_TAX_V2_CONTRACT_ADDRESS=${agentTaxV2Address}`);
    console.log(`FFactoryV3_TAX_VAULT=${agentTaxV2Address}`);

    console.log("\n--- Roles Configured ---");
    console.log(`1. AgentTaxV2: SWAP_ROLE granted to ${beTaxOpsWalletList.length} wallet(s) for swapForTokenAddress()`);
    console.log(`2. AgentTaxV2: EXECUTOR_ROLE granted to ${beOpsWalletList.length} wallet(s) for updateCreatorForSpecialLaunchAgents()`);
    console.log("3. AgentTaxV2: DEFAULT_ADMIN_ROLE and ADMIN_ROLE granted to admin");
    console.log("4. AgentTaxV2: REGISTER_ROLE for BondingV5 (registerToken) will be granted in _3.ts");
    console.log("5. AgentTaxV2: setBondingV5() will be called in _3.ts");
    console.log("6. AgentNftV2: MINTER_ROLE will be granted to AgentFactoryV7 in _2.ts");
    console.log("7. Deployer's roles will be revoked in _4.ts");

    console.log("\n--- V5 Suite Architecture ---");
    console.log("AgentFactoryV7 + AgentTokenV3 + BondingV5 + FRouterV3 → AgentTaxV2");
    console.log("(On-chain tax attribution via depositTax())");

    console.log("\n--- Next Step ---");
    console.log("Run: npx hardhat run scripts/launchpadv5/deployLaunchpadv5_1.ts --network <network>");

    console.log("\n" + "=".repeat(80));
    console.log("  Step 0 Completed Successfully!");
    console.log("=".repeat(80));
  } catch (e) {
    console.error("❌ Deployment failed:", e);
    process.exit(1);
  }
})();
