// npx hardhat run scripts/launchpadv5/deployLaunchpadv5_0.ts --network eth_sepolia
import { parseEther } from "ethers";
import { verifyContract } from "./utils";
const { ethers, upgrades } = require("hardhat");

/**
 * Deploy prerequisites for FFactoryV2:
 * - AgentNftV2 (optional, if not already deployed)
 * - AgentTax (AGENT_TOKEN_TAX_MANAGER / FFactoryV2_TAX_VAULT)
 * 
 * Run this script before deployLaunchpadv5_1.ts
 */
(async () => {
  try {
    console.log("\n" + "=".repeat(80));
    console.log("  Launchpad V5 - Step 0: Deploy Prerequisites (AgentTax)");
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

    // Backend wallet addresses for EXECUTOR_V2_ROLE (comma-separated)
    const beTaxOpsWallets = process.env.BE_TAX_OPS_WALLETS;
    if (!beTaxOpsWallets) {
      throw new Error("BE_TAX_OPS_WALLETS not set in environment (comma-separated addresses)");
    }
    const beTaxOpsWalletList = beTaxOpsWallets.split(",").map((addr) => addr.trim()).filter((addr) => addr.length > 0);
    if (beTaxOpsWalletList.length === 0) {
      throw new Error("BE_TAX_OPS_WALLETS must contain at least one address");
    }

    // Backend wallet addresses for EXECUTOR_ROLE (comma-separated), calling handleAgentTaxes()
    const beHandleAgentTaxesWallets = process.env.BE_HANDLE_AGENT_TAXES_WALLETS;
    if (!beHandleAgentTaxesWallets) {
      throw new Error("BE_HANDLE_AGENT_TAXES_WALLETS not set in environment (comma-separated addresses)");
    }
    const beHandleAgentTaxesWalletList = beHandleAgentTaxesWallets.split(",").map((addr) => addr.trim()).filter((addr) => addr.length > 0);
    if (beHandleAgentTaxesWalletList.length === 0) {
      throw new Error("BE_HANDLE_AGENT_TAXES_WALLETS must contain at least one address");
    }

    // AgentTax parameters
    const assetToken = process.env.AGENT_TAX_ASSET_TOKEN;
    if (!assetToken) {
      throw new Error("AGENT_TAX_ASSET_TOKEN not set in environment (used as assetToken for AgentTax)");
    }
    
    // Tax token - typically the same as asset token, or a separate tax token
    const taxToken = process.env.AGENT_TAX_TAX_TOKEN;
    if (!taxToken) {
      throw new Error("AGENT_TAX_TAX_TOKEN not set in environment (used as taxToken for AgentTax)");
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

    // AgentNftV2 - required for AgentTax
    let agentNftV2Address: string | undefined = process.env.AGENT_NFT_V2_ADDRESS;

    console.log("\nDeployment arguments loaded:", {
      contractController,
      admin,
      beTaxOpsWallets: beTaxOpsWalletList,
      assetToken,
      taxToken,
      agentTaxDexRouter,
      treasury,
      minSwapThreshold,
      maxSwapThreshold,
      agentNftV2Address: agentNftV2Address || "(will deploy)",
    });

    // Track deployed/reused contracts
    const deployedContracts: { [key: string]: string } = {};
    const reusedContracts: { [key: string]: string } = {};

    // ============================================
    // 1. Deploy AgentNftV2 (if not provided)
    // ============================================
    if (!agentNftV2Address) {
      console.log("\n--- Deploying AgentNftV2 (proxy) ---");
      const AgentNftV2 = await ethers.getContractFactory("AgentNftV2");
      // Initialize with deployer first so we can grant MINTER_ROLE later in _2.ts
      const agentNftV2 = await upgrades.deployProxy(
        AgentNftV2,
        [deployerAddress], // initialize with deployer as defaultAdmin
        {
          initializer: "initialize",
          initialOwner: contractController,
          unsafeAllow: ["internal-function-storage"],
        }
      );
      await agentNftV2.waitForDeployment();
      agentNftV2Address = await agentNftV2.getAddress();
      console.log("AgentNftV2 (proxy) deployed at:", agentNftV2Address);
      deployedContracts["AGENT_NFT_V2_ADDRESS"] = agentNftV2Address!;

      // Grant DEFAULT_ADMIN_ROLE to admin as well
      const defaultAdminRole = await agentNftV2.DEFAULT_ADMIN_ROLE();
      const tx = await agentNftV2.grantRole(defaultAdminRole, admin);
      await tx.wait();
      console.log("DEFAULT_ADMIN_ROLE granted to admin:", admin);

      // Verify AgentNftV2 proxy
      await verifyContract(agentNftV2Address!);
    } else {
      console.log("\n--- Using existing AgentNftV2 ---");
      console.log("AgentNftV2 address:", agentNftV2Address);
      reusedContracts["AGENT_NFT_V2_ADDRESS"] = agentNftV2Address;
    }

    // ============================================
    // 2. Deploy AgentTax (AGENT_TOKEN_TAX_MANAGER)
    // ============================================
    const existingAgentTax = process.env.AGENT_TOKEN_TAX_MANAGER;
    let agentTaxAddress: string;

    if (!existingAgentTax) {
      console.log("\n--- Deploying AgentTax (AGENT_TOKEN_TAX_MANAGER) ---");
      const AgentTax = await ethers.getContractFactory("AgentTax");
      const agentTax = await upgrades.deployProxy(
        AgentTax,
        [
          admin,                          // defaultAdmin_
          assetToken,                     // assetToken_
          taxToken,                       // taxToken_ (VIRTUAL_TOKEN)
          agentTaxDexRouter,                // router_
          treasury,                       // treasury_
          minSwapThreshold,   // minSwapThreshold_
          maxSwapThreshold,   // maxSwapThreshold_
          agentNftV2Address,              // nft_ (AgentNftV2)
        ],
        {
          initializer: "initialize",
          initialOwner: contractController,
        }
      );
      await agentTax.waitForDeployment();
      agentTaxAddress = await agentTax.getAddress();
      console.log("AgentTax deployed at:", agentTaxAddress);
      deployedContracts["AGENT_TOKEN_TAX_MANAGER"] = agentTaxAddress;

      // Grant EXECUTOR_V2_ROLE to all BE_TAX_OPS_WALLETS
      const executorV2Role = await agentTax.EXECUTOR_V2_ROLE();
      for (const wallet of beTaxOpsWalletList) {
        const grantTx = await agentTax.grantRole(executorV2Role, wallet);
        await grantTx.wait();
        console.log("EXECUTOR_V2_ROLE granted to:", wallet);
      }

      // Grant EXECUTOR_ROLE to all BE_HANDLE_AGENT_TAXES_WALLETS
      const executorRole = await agentTax.EXECUTOR_ROLE();
      for (const wallet of beHandleAgentTaxesWalletList) {
        const grantTx = await agentTax.grantRole(executorRole, wallet);
        await grantTx.wait();
        console.log("EXECUTOR_ROLE granted to:", wallet);
      }

      // Verify AgentTax proxy
      await verifyContract(agentTaxAddress);
    } else {
      console.log("\n--- Using existing AgentTax ---");
      console.log("AgentTax address:", existingAgentTax);
      agentTaxAddress = existingAgentTax;
      reusedContracts["AGENT_TOKEN_TAX_MANAGER"] = existingAgentTax;
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
    console.log("# Prerequisites for FFactoryV2:");
    console.log(`AGENT_NFT_V2_ADDRESS=${agentNftV2Address}`);
    console.log(`AGENT_TOKEN_TAX_MANAGER=${agentTaxAddress}`);
    console.log(`FFactoryV2_TAX_VAULT=${agentTaxAddress}`);

    console.log("\n--- Manual Steps Required (by admin) ---");
    console.log("1. AgentNftV2: MINTER_ROLE will be granted to AgentFactoryV6 in deployLaunchpadv5_2.ts");
    console.log(`2. AgentTax: EXECUTOR_V2_ROLE has been granted to ${beTaxOpsWalletList.length} wallet(s)`);
    console.log("3. AgentTax: Admin may need to grant EXECUTOR_ROLE to executor address for handleAgentTaxes()");

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
