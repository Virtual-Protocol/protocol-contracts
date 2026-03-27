/**
 * V5 Suite - Step 4: Revoke Deployer Roles
 * 
 * Usage:
 *   ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/deployLaunchpadv5_4.ts --network local
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/deployLaunchpadv5_4.ts --network base_sepolia
 *   ENV_FILE=.env.launchpadv5_prod npx hardhat run scripts/launchpadv5/deployLaunchpadv5_4.ts --network base
 */
const { ethers } = require("hardhat");

/**
 * V5 Suite - Step 4: Revoke Deployer Roles
 *
 * Revokes all temporary deployer roles from V5 Suite contracts:
 * - FFactoryV3
 * - FRouterV3
 * - AgentFactoryV7
 * - AgentNftV2
 * - AgentTaxV2
 *
 * Run this script LAST after all deployments are complete
 *
 * Deployment order:
 * 0. deployLaunchpadv5_0.ts - AgentNftV2, AgentTaxV2
 * 1. deployLaunchpadv5_1.ts - FFactoryV3, FRouterV3
 * 2. deployLaunchpadv5_2.ts - AgentFactoryV7, AgentTokenV3
 * 3. deployLaunchpadv5_3.ts - BondingConfig, BondingV5
 * 4. deployLaunchpadv5_4.ts - Revoke deployer roles (this script)
 */
(async () => {
  try {
    console.log("\n" + "=".repeat(80));
    console.log("  V5 Suite - Step 4: Revoke Deployer Roles");
    console.log("=".repeat(80));
    console.log(
      "This script revokes all temporary deployer roles for security."
    );

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    console.log("Deployer address:", deployerAddress);

    // ============================================
    // Load contract addresses
    // ============================================
    const fFactoryV3Address = process.env.FFactoryV3_ADDRESS;
    if (!fFactoryV3Address) {
      throw new Error("FFactoryV3_ADDRESS not set in environment");
    }
    const fRouterV3Address = process.env.FRouterV3_ADDRESS;
    if (!fRouterV3Address) {
      throw new Error("FRouterV3_ADDRESS not set in environment");
    }
    const agentFactoryV7Address = process.env.AGENT_FACTORY_V7_ADDRESS;
    if (!agentFactoryV7Address) {
      throw new Error("AGENT_FACTORY_V7_ADDRESS not set in environment");
    }
    const agentNftV2Address = process.env.AGENT_NFT_V2_ADDRESS;
    if (!agentNftV2Address) {
      throw new Error("AGENT_NFT_V2_ADDRESS not set in environment");
    }
    const agentTaxV2Address = process.env.AGENT_TAX_V2_CONTRACT_ADDRESS;
    if (!agentTaxV2Address) {
      throw new Error("AGENT_TAX_V2_CONTRACT_ADDRESS not set in environment");
    }

    console.log("\nContract addresses:", {
      fFactoryV3Address,
      fRouterV3Address,
      agentFactoryV7Address,
      agentNftV2Address,
      agentTaxV2Address,
    });

    // ============================================
    // Get contract instances
    // ============================================
    const fFactoryV3 = await ethers.getContractAt(
      "FFactoryV3",
      fFactoryV3Address
    );
    const fRouterV3 = await ethers.getContractAt("FRouterV3", fRouterV3Address);
    const agentFactoryV7 = await ethers.getContractAt(
      "AgentFactoryV7",
      agentFactoryV7Address
    );
    const agentNftV2 = await ethers.getContractAt(
      "AgentNftV2",
      agentNftV2Address
    );
    const agentTaxV2 = await ethers.getContractAt(
      "AgentTaxV2",
      agentTaxV2Address
    );

    // ============================================
    // Revoke FFactoryV3 deployer roles
    // ============================================
    console.log("\n--- Revoking deployer roles from FFactoryV3 ---");

    const fFactoryAdminRole = await fFactoryV3.ADMIN_ROLE();
    const fFactoryDefaultAdminRole = await fFactoryV3.DEFAULT_ADMIN_ROLE();

    if (await fFactoryV3.hasRole(fFactoryAdminRole, deployerAddress)) {
      await (
        await fFactoryV3.revokeRole(fFactoryAdminRole, deployerAddress)
      ).wait();
      console.log(
        "✅ ADMIN_ROLE of FFactoryV3 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log("⏭️  Deployer has no ADMIN_ROLE on FFactoryV3 (skip)");
    }

    if (await fFactoryV3.hasRole(fFactoryDefaultAdminRole, deployerAddress)) {
      await (
        await fFactoryV3.revokeRole(fFactoryDefaultAdminRole, deployerAddress)
      ).wait();
      console.log(
        "✅ DEFAULT_ADMIN_ROLE of FFactoryV3 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log(
        "⏭️  Deployer has no DEFAULT_ADMIN_ROLE on FFactoryV3 (skip)"
      );
    }

    // ============================================
    // Revoke FRouterV3 deployer roles
    // ============================================
    console.log("\n--- Revoking deployer roles from FRouterV3 ---");

    const fRouterAdminRole = await fRouterV3.ADMIN_ROLE();
    const fRouterDefaultAdminRole = await fRouterV3.DEFAULT_ADMIN_ROLE();

    if (await fRouterV3.hasRole(fRouterAdminRole, deployerAddress)) {
      await (
        await fRouterV3.revokeRole(fRouterAdminRole, deployerAddress)
      ).wait();
      console.log(
        "✅ ADMIN_ROLE of FRouterV3 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log("⏭️  Deployer has no ADMIN_ROLE on FRouterV3 (skip)");
    }

    if (await fRouterV3.hasRole(fRouterDefaultAdminRole, deployerAddress)) {
      await (
        await fRouterV3.revokeRole(fRouterDefaultAdminRole, deployerAddress)
      ).wait();
      console.log(
        "✅ DEFAULT_ADMIN_ROLE of FRouterV3 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log("⏭️  Deployer has no DEFAULT_ADMIN_ROLE on FRouterV3 (skip)");
    }

    // ============================================
    // Revoke AgentFactoryV7 deployer roles
    // ============================================
    console.log("\n--- Revoking deployer roles from AgentFactoryV7 ---");

    const agentFactoryDefaultAdminRole =
      await agentFactoryV7.DEFAULT_ADMIN_ROLE();

    if (
      await agentFactoryV7.hasRole(
        agentFactoryDefaultAdminRole,
        deployerAddress
      )
    ) {
      await (
        await agentFactoryV7.revokeRole(
          agentFactoryDefaultAdminRole,
          deployerAddress
        )
      ).wait();
      console.log(
        "✅ DEFAULT_ADMIN_ROLE of AgentFactoryV7 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log(
        "⏭️  Deployer has no DEFAULT_ADMIN_ROLE on AgentFactoryV7 (skip)"
      );
    }

    // ============================================
    // Revoke AgentNftV2 deployer roles
    // ============================================
    console.log("\n--- Revoking deployer roles from AgentNftV2 ---");

    const agentNftAdminRole = await agentNftV2.ADMIN_ROLE();
    if (await agentNftV2.hasRole(agentNftAdminRole, deployerAddress)) {
      await (
        await agentNftV2.revokeRole(agentNftAdminRole, deployerAddress)
      ).wait();
      console.log(
        "✅ ADMIN_ROLE of AgentNftV2 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log("⏭️  Deployer has no ADMIN_ROLE on AgentNftV2 (skip)");
    }

    const agentNftDefaultAdminRole = await agentNftV2.DEFAULT_ADMIN_ROLE();
    if (await agentNftV2.hasRole(agentNftDefaultAdminRole, deployerAddress)) {
      await (
        await agentNftV2.revokeRole(agentNftDefaultAdminRole, deployerAddress)
      ).wait();
      console.log(
        "✅ DEFAULT_ADMIN_ROLE of AgentNftV2 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log(
        "⏭️  Deployer has no DEFAULT_ADMIN_ROLE on AgentNftV2 (skip)"
      );
    }

    const agentNftValidatorAdminRole = await agentNftV2.VALIDATOR_ADMIN_ROLE();
    if (await agentNftV2.hasRole(agentNftValidatorAdminRole, deployerAddress)) {
      await (
        await agentNftV2.revokeRole(agentNftValidatorAdminRole, deployerAddress)
      ).wait();
      console.log(
        "✅ VALIDATOR_ADMIN_ROLE of AgentNftV2 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log(
        "⏭️  Deployer has no VALIDATOR_ADMIN_ROLE on AgentNftV2 (skip)"
      );
    }

    // ============================================
    // Revoke AgentTaxV2 deployer roles
    // ============================================
    console.log("\n--- Revoking deployer roles from AgentTaxV2 ---");

    const agentTaxV2AdminRole = await agentTaxV2.ADMIN_ROLE();
    if (await agentTaxV2.hasRole(agentTaxV2AdminRole, deployerAddress)) {
      await (
        await agentTaxV2.revokeRole(agentTaxV2AdminRole, deployerAddress)
      ).wait();
      console.log(
        "✅ ADMIN_ROLE of AgentTaxV2 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log("⏭️  Deployer has no ADMIN_ROLE on AgentTaxV2 (skip)");
    }

    const agentTaxV2DefaultAdminRole = await agentTaxV2.DEFAULT_ADMIN_ROLE();
    if (await agentTaxV2.hasRole(agentTaxV2DefaultAdminRole, deployerAddress)) {
      await (
        await agentTaxV2.revokeRole(agentTaxV2DefaultAdminRole, deployerAddress)
      ).wait();
      console.log(
        "✅ DEFAULT_ADMIN_ROLE of AgentTaxV2 revoked from deployer:",
        deployerAddress
      );
    } else {
      console.log(
        "⏭️  Deployer has no DEFAULT_ADMIN_ROLE on AgentTaxV2 (skip)"
      );
    }

    // ============================================
    // Summary
    // ============================================
    console.log("\n" + "=".repeat(80));
    console.log("  Role Revocation Complete");
    console.log("=".repeat(80));
    console.log(
      "All deployer roles have been revoked from V5 Suite contracts."
    );

    console.log("\nDeployer should no longer have admin access to:");
    console.log(`- FFactoryV3: ${fFactoryV3Address}`);
    console.log(`- FRouterV3: ${fRouterV3Address}`);
    console.log(`- AgentFactoryV7: ${agentFactoryV7Address}`);
    console.log(`- AgentNftV2: ${agentNftV2Address}`);
    console.log(`- AgentTaxV2: ${agentTaxV2Address}`);

    console.log("\n✅ Security hardening complete!");

    console.log("\n--- Deployment Order ---");
    console.log("0. ✅ deployLaunchpadv5_0.ts (AgentNftV2, AgentTaxV2) - DONE");
    console.log("1. ✅ deployLaunchpadv5_1.ts (FFactoryV3, FRouterV3) - DONE");
    console.log(
      "2. ✅ deployLaunchpadv5_2.ts (AgentFactoryV7, AgentTokenV3) - DONE"
    );
    console.log(
      "3. ✅ deployLaunchpadv5_3.ts (BondingConfig, BondingV5) - DONE"
    );
    console.log("4. ✅ deployLaunchpadv5_4.ts (Revoke deployer roles) - DONE");

    console.log("\n" + "=".repeat(60));

    console.log("\n=== V5 Suite Deployment Summary ===\n");
    console.log("All contracts deployed and configured:");
    console.log(`- FFactoryV3: ${process.env.FFactoryV3_ADDRESS}`);
    console.log(`- FRouterV3: ${process.env.FRouterV3_ADDRESS}`);
    console.log(`- AgentFactoryV7: ${process.env.AGENT_FACTORY_V7_ADDRESS}`);
    console.log(
      `- AgentTokenV3 Impl: ${process.env.AGENT_TOKEN_V3_IMPLEMENTATION}`
    );
    console.log(
      `- AgentVeTokenV2 Impl: ${process.env.AGENT_VE_TOKEN_V2_IMPLEMENTATION}`
    );
    console.log(`- AgentDAO Impl: ${process.env.AGENT_DAO_IMPLEMENTATION}`);
    console.log(`- AgentNftV2: ${process.env.AGENT_NFT_V2_ADDRESS}`);
    console.log(`- AgentTaxV2: ${process.env.AGENT_TAX_V2_ADDRESS}`);
    console.log(`- BondingConfig: ${process.env.BONDING_CONFIG_ADDRESS}`);
    console.log(`- BondingV5: ${process.env.BONDING_V5_ADDRESS}`);
    console.log(`- Virtual Token: ${process.env.VIRTUAL_TOKEN_ADDRESS}`);

    console.log("\n--- V5 Suite Architecture ---");
    console.log(
      "┌─────────────────────────────────────────────────────────────┐"
    );
    console.log(
      "│                     V5 Suite (NEW)                          │"
    );
    console.log(
      "├─────────────────────────────────────────────────────────────┤"
    );
    console.log(
      "│ BondingV5 → FFactoryV3 → FRouterV3 → AgentTaxV2.depositTax()│"
    );
    console.log(
      "│ BondingV5.launch() → AgentFactoryV7 → AgentTokenV3          │"
    );
    console.log(
      "│ AgentTokenV3._swapTax() → AgentTaxV2.depositTax()           │"
    );
    console.log(
      "│ Backend → AgentTaxV2.swapForTokenAddress() → Distribute     │"
    );
    console.log(
      "└─────────────────────────────────────────────────────────────┘"
    );
    console.log("");
    console.log("Key Benefits:");
    console.log(
      "- On-chain tax attribution (no tax-listener needed for V5 tokens)"
    );
    console.log(
      "- Clean separation from V4 Suite (no projectTaxRecipient conflicts)"
    );
    console.log(
      "- Backend triggers swaps at optimal times (no unlucky user pays swap)"
    );

    console.log("\n" + "=".repeat(80));
    console.log("  V5 Suite Deployment Complete!");
    console.log("=".repeat(80));
  } catch (e) {
    console.error("❌ Role revocation failed:", e);
    process.exit(1);
  }
})();
