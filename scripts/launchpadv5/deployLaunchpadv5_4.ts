const { ethers } = require("hardhat");

// Environment variables are loaded via hardhat.config.js
// Make sure hardhat.config.js has: require("dotenv").config({ path: ".env.launchpadv5_dev" });

/**
 * Revoke deployer roles from all contracts
 * Run this script LAST after all deployments are complete
 *
 * Deployment order:
 * 1. deployPrerequisites_1.ts - FFactoryV2, FRouterV2
 * 2. deployPrerequisites_2.ts - AgentFactoryV6
 * 3. deployLaunchpadv5.ts - BondingConfig, BondingV5
 * 4. deployRevokeRoles.ts - Revoke deployer roles (this script)
 */
(async () => {
  try {
    console.log("\n=== Revoking Deployer Roles ===");
    console.log(
      "This script revokes all temporary deployer roles for security."
    );

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    console.log("Deployer address:", deployerAddress);

    // ============================================
    // Load contract addresses
    // ============================================
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
    const agentNftV2Address = process.env.AGENT_NFT_V2_ADDRESS;
    if (!agentNftV2Address) {
      throw new Error("AGENT_NFT_V2_ADDRESS not set in environment");
    }

    console.log("\nContract addresses:", {
      fFactoryV2Address: fFactoryV2Address,
      fRouterV2Address: fRouterV2Address,
      agentFactoryV6Address: agentFactoryV6Address,
      agentNftV2Address: agentNftV2Address,
    });

    // ============================================
    // Get contract instances
    // ============================================
    const fFactoryV2 = await ethers.getContractAt("FFactoryV2", fFactoryV2Address);
    const fRouterV2 = await ethers.getContractAt("FRouterV2", fRouterV2Address);
    const agentFactoryV6 = await ethers.getContractAt("AgentFactoryV6", agentFactoryV6Address);

    // ============================================
    // Revoke FFactoryV2 deployer roles
    // ============================================
    console.log("\n--- Revoking deployer roles from FFactoryV2 ---");

    const fFactoryAdminRole = await fFactoryV2.ADMIN_ROLE();
    const fFactoryDefaultAdminRole = await fFactoryV2.DEFAULT_ADMIN_ROLE();

    if (await fFactoryV2.hasRole(fFactoryAdminRole, deployerAddress)) {
      await (await fFactoryV2.revokeRole(fFactoryAdminRole, deployerAddress)).wait();
      console.log("✅ ADMIN_ROLE of FFactoryV2 revoked from deployer:", deployerAddress);
    } else {
      console.log("⏭️  Deployer has no ADMIN_ROLE on FFactoryV2 (skip)");
    }

    if (await fFactoryV2.hasRole(fFactoryDefaultAdminRole, deployerAddress)) {
      await (await fFactoryV2.revokeRole(fFactoryDefaultAdminRole, deployerAddress)).wait();
      console.log("✅ DEFAULT_ADMIN_ROLE of FFactoryV2 revoked from deployer:", deployerAddress);
    } else {
      console.log("⏭️  Deployer has no DEFAULT_ADMIN_ROLE on FFactoryV2 (skip)");
    }

    // ============================================
    // Revoke FRouterV2 deployer roles
    // ============================================
    console.log("\n--- Revoking deployer roles from FRouterV2 ---");

    const fRouterAdminRole = await fRouterV2.ADMIN_ROLE();
    const fRouterDefaultAdminRole = await fRouterV2.DEFAULT_ADMIN_ROLE();

    if (await fRouterV2.hasRole(fRouterAdminRole, deployerAddress)) {
      await (await fRouterV2.revokeRole(fRouterAdminRole, deployerAddress)).wait();
      console.log("✅ ADMIN_ROLE of FRouterV2 revoked from deployer:", deployerAddress);
    } else {
      console.log("⏭️  Deployer has no ADMIN_ROLE on FRouterV2 (skip)");
    }

    if (await fRouterV2.hasRole(fRouterDefaultAdminRole, deployerAddress)) {
      await (await fRouterV2.revokeRole(fRouterDefaultAdminRole, deployerAddress)).wait();
      console.log("✅ DEFAULT_ADMIN_ROLE of FRouterV2 revoked from deployer:", deployerAddress);
    } else {
      console.log("⏭️  Deployer has no DEFAULT_ADMIN_ROLE on FRouterV2 (skip)");
    }

    // ============================================
    // Revoke AgentFactoryV6 deployer roles
    // ============================================
    console.log("\n--- Revoking deployer roles from AgentFactoryV6 ---");

    const agentFactoryDefaultAdminRole = await agentFactoryV6.DEFAULT_ADMIN_ROLE();

    if (await agentFactoryV6.hasRole(agentFactoryDefaultAdminRole, deployerAddress)) {
      await (await agentFactoryV6.revokeRole(agentFactoryDefaultAdminRole, deployerAddress)).wait();
      console.log("✅ DEFAULT_ADMIN_ROLE of AgentFactoryV6 revoked from deployer:", deployerAddress);
    } else {
      console.log("⏭️  Deployer has no DEFAULT_ADMIN_ROLE on AgentFactoryV6 (skip)");
    }

    // ============================================
    // Revoke AgentNftV2 deployer roles
    // ============================================
    console.log("\n--- Revoking deployer roles from AgentNftV2 ---");
    const agentNftV2 = await ethers.getContractAt("AgentNftV2", agentNftV2Address);

    const agentNftDefaultAdminRole = await agentNftV2.DEFAULT_ADMIN_ROLE();
    if (await agentNftV2.hasRole(agentNftDefaultAdminRole, deployerAddress)) {
      await (await agentNftV2.revokeRole(agentNftDefaultAdminRole, deployerAddress)).wait();
      console.log("✅ DEFAULT_ADMIN_ROLE of AgentNftV2 revoked from deployer:", deployerAddress);
    } else {
      console.log("⏭️  Deployer has no DEFAULT_ADMIN_ROLE on AgentNftV2 (skip)");
    }

    const agentNftAdminRole = await agentNftV2.ADMIN_ROLE();
    if (await agentNftV2.hasRole(agentNftAdminRole, deployerAddress)) {
      await (await agentNftV2.revokeRole(agentNftAdminRole, deployerAddress)).wait();
      console.log("✅ ADMIN_ROLE of AgentNftV2 revoked from deployer:", deployerAddress);
    } else {
      console.log("⏭️  Deployer has no ADMIN_ROLE on AgentNftV2 (skip)");
    }

    const agentNftValidatorAdminRole = await agentNftV2.VALIDATOR_ADMIN_ROLE();
    if (await agentNftV2.hasRole(agentNftValidatorAdminRole, deployerAddress)) {
      await (await agentNftV2.revokeRole(agentNftValidatorAdminRole, deployerAddress)).wait();
      console.log("✅ VALIDATOR_ADMIN_ROLE of AgentNftV2 revoked from deployer:", deployerAddress);
    } else {
      console.log("⏭️  Deployer has no VALIDATOR_ADMIN_ROLE on AgentNftV2 (skip)");
    }

    // ============================================
    // Summary
    // ============================================
    console.log("\n=== Role Revocation Complete ===");
    console.log("All deployer roles have been revoked.");
    console.log("\nDeployer should no longer have admin access to:");
    console.log(`- FFactoryV2: ${fFactoryV2Address}`);
    console.log(`- FRouterV2: ${fRouterV2Address}`);
    console.log(`- AgentFactoryV6: ${agentFactoryV6Address}`);
    if (agentNftV2Address) {
      console.log(`- AgentNftV2: ${agentNftV2Address}`);
    }

    console.log("\n✅ Security hardening complete!");

    console.log("\n--- Deployment Order ---");
    console.log("0. ✅ deployLaunchpadv5_0.ts (AgentNftV2, AgentTax) - DONE");
    console.log("1. ✅ deployLaunchpadv5_1.ts (FFactoryV2, FRouterV2) - DONE");
    console.log("2. ✅ deployLaunchpadv5_2.ts (AgentFactoryV6) - DONE");
    console.log("3. ✅ deployLaunchpadv5_3.ts (BondingConfig, BondingV5) - DONE");
    console.log("4. ✅ deployLaunchpadv5_4.ts (Revoke deployer roles) - DONE");

    console.log("\n" + "=".repeat(60));

    console.log("\n=== NewLaunchpadV5 Deployment Summary ===\n");
    console.log("All contracts deployed and configured:");
    console.log(`- FFactoryV2: ${process.env.FFactoryV2_ADDRESS}`);
    console.log(`- FRouterV2: ${process.env.FRouterV2_ADDRESS}`);
    console.log(`- AgentFactoryV6: ${process.env.AGENT_FACTORY_V6_ADDRESS}`);
    console.log(`- BondingConfig: ${process.env.BONDING_CONFIG_ADDRESS}`);
    console.log(`- BondingV5: ${process.env.BONDING_V5_ADDRESS}`);
    console.log(`- Virtual Token: ${process.env.VIRTUAL_TOKEN_ADDRESS}`);
    console.log(`- AgentTokenV2: ${process.env.AGENT_TOKEN_V2_IMPLEMENTATION}`);
    console.log(
      `- AgentVeTokenV2: ${process.env.AGENT_VE_TOKEN_V2_IMPLEMENTATION}`
    );
    console.log(`- AgentDAOImpl: ${process.env.AGENT_DAO_IMPLEMENTATION}`);
    console.log(`- AgentNftV2: ${process.env.AGENT_NFT_V2_ADDRESS}`);
    console.log(`- AgentTaxManager: ${process.env.AGENT_TOKEN_TAX_MANAGER}`);
  } catch (e) {
    console.error("Role revocation failed:", e);
    throw e;
  }
})();
