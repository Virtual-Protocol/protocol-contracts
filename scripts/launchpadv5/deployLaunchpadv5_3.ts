import { parseEther } from "ethers";
import { verifyContract } from "./utils";
const { ethers, upgrades } = require("hardhat");

// Environment variables are loaded via hardhat.config.js
// Make sure hardhat.config.js has: require("dotenv").config({ path: ".env.launchpadv5_dev" });

(async () => {
  try {
    console.log("\n=== LaunchpadV5 Deployment Starting ===");
    console.log("This script deploys: BondingConfig, BondingV5");
    console.log("Prerequisites (FFactoryV2, FRouterV2, AgentFactoryV6) must already exist.");

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

    // Prerequisite contract addresses (required)
    const fFactoryV2Address = process.env.FFactoryV2_ADDRESS;
    if (!fFactoryV2Address) {
      throw new Error("FFactoryV2_ADDRESS not set - run deployPrerequisitesV5.ts first");
    }
    const fRouterV2Address = process.env.FRouterV2_ADDRESS;
    if (!fRouterV2Address) {
      throw new Error("FRouterV2_ADDRESS not set - run deployPrerequisitesV5.ts first");
    }
    const agentFactoryV6Address = process.env.AGENT_FACTORY_V6_ADDRESS;
    if (!agentFactoryV6Address) {
      throw new Error("AGENT_FACTORY_V6_ADDRESS not set - run deployPrerequisitesV5.ts first");
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
    const agentTaxAddress = process.env.AGENT_TAX_CONTRACT_ADDRESS;
    if (!agentTaxAddress) {
      throw new Error("AGENT_TAX_CONTRACT_ADDRESS not set in environment");
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

    console.log("\nDeployment arguments loaded:", {
      contractController,
      fFactoryV2Address,
      fRouterV2Address,
      agentFactoryV6Address,
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

    // Verify BondingConfig proxy
    await verifyContract(bondingConfigAddress);

    // Set X Launchers (authorized addresses for LAUNCH_MODE_X_LAUNCH)
    const xLauncherAddresses = process.env.X_LAUNCHER_ADDRESSES;
    if (xLauncherAddresses) {
      const addresses = xLauncherAddresses.split(",").map((addr) => addr.trim()).filter((addr) => addr);
      console.log("\n--- Setting X Launchers in BondingConfig ---");
      for (const addr of addresses) {
        const tx = await bondingConfig.setXLauncher(addr, true);
        await tx.wait();
        console.log("BondingConfig.setXLauncher(true):", addr);
      }
    }

    // Set ACP Skill Launchers (authorized addresses for LAUNCH_MODE_ACP_SKILL)
    const acpSkillLauncherAddresses = process.env.ACP_SKILL_LAUNCHER_ADDRESSES;
    if (acpSkillLauncherAddresses) {
      const addresses = acpSkillLauncherAddresses.split(",").map((addr) => addr.trim()).filter((addr) => addr);
      console.log("\n--- Setting ACP Skill Launchers in BondingConfig ---");
      for (const addr of addresses) {
        const tx = await bondingConfig.setAcpSkillLauncher(addr, true);
        await tx.wait();
        console.log("BondingConfig.setAcpSkillLauncher(true):", addr);
      }
    }

    // ============================================
    // 2. Deploy BondingV5
    // ============================================
    console.log("\n--- Deploying BondingV5 ---");
    const BondingV5 = await ethers.getContractFactory("BondingV5");
    const bondingV5 = await upgrades.deployProxy(
      BondingV5,
      [
        fFactoryV2Address,
        fRouterV2Address,
        agentFactoryV6Address,
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

    // Verify BondingV5 proxy
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
    // Deployer still has admin roles from previous scripts (_0, _1, _2)
    // Roles will be revoked in _4.ts
    console.log("\n--- Granting roles and configuring contracts ---");
    
    var fFactoryV2 = await ethers.getContractAt("FFactoryV2", fFactoryV2Address);
    var fRouterV2 = await ethers.getContractAt("FRouterV2", fRouterV2Address);
    var agentFactoryV6 = await ethers.getContractAt("AgentFactoryV6", agentFactoryV6Address);
    var agentTax = await ethers.getContractAt("AgentTax", agentTaxAddress);
    const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY;
    if (adminPrivateKey) { // If ADMIN_PRIVATE_KEY is set, use it to grant roles, easier for testnet
      const adminSigner = new ethers.Wallet(
        adminPrivateKey,
        ethers.provider
      );
      fFactoryV2 = await ethers.getContractAt("FFactoryV2", fFactoryV2Address, adminSigner);
      fRouterV2 = await ethers.getContractAt("FRouterV2", fRouterV2Address, adminSigner);
      agentFactoryV6 = await ethers.getContractAt("AgentFactoryV6", agentFactoryV6Address, adminSigner);
      agentTax = await ethers.getContractAt("AgentTax", agentTaxAddress, adminSigner);
    }

    // Grant CREATOR_ROLE of FFactoryV2 to BondingV5
    const creatorRole = await fFactoryV2.CREATOR_ROLE();
    await (await fFactoryV2.grantRole(creatorRole, bondingV5Address)).wait();
    console.log("✅ CREATOR_ROLE of FFactoryV2 granted to BondingV5:", bondingV5Address);

    // Set BondingV5 and BondingConfig in FRouterV2
    await (await fRouterV2.setBondingV5(bondingV5Address, bondingConfigAddress)).wait();
    console.log("✅ FRouterV2.setBondingV5() called:", { bondingV5: bondingV5Address, bondingConfig: bondingConfigAddress });

    // Grant EXECUTOR_ROLE of FRouterV2 to BondingV5
    const executorRole = await fRouterV2.EXECUTOR_ROLE();
    await (await fRouterV2.grantRole(executorRole, bondingV5Address)).wait();
    console.log("✅ EXECUTOR_ROLE of FRouterV2 granted to BondingV5:", bondingV5Address);

    // Grant BONDING_ROLE of AgentFactoryV6 to BondingV5
    const bondingRole = await agentFactoryV6.BONDING_ROLE();
    await (await agentFactoryV6.grantRole(bondingRole, bondingV5Address)).wait();
    console.log("✅ BONDING_ROLE of AgentFactoryV6 granted to BondingV5:", bondingV5Address);

    // Set BondingV5 in AgentTax
    await (await agentTax.setBondingV5(bondingV5Address)).wait();
    console.log("✅ AgentTax.setBondingV5() called:", bondingV5Address);

    console.log("\n✅ All role grants and configurations completed!");

    // ============================================
    // 5. Print Deployment Summary
    // ============================================
    console.log("\n=== LaunchpadV5 Deployment Summary ===");
    
    console.log("\nPrerequisite contracts (reused):");
    console.log(`- FFactoryV2: ${fFactoryV2Address}`);
    console.log(`- FRouterV2: ${fRouterV2Address}`);
    console.log(`- AgentFactoryV6: ${agentFactoryV6Address}`);

    console.log("\nNewly deployed contracts:");
    console.log(`- BondingConfig: ${bondingConfigAddress}`);
    console.log(`- BondingV5: ${bondingV5Address}`);

    console.log("\nConfiguration:");
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

    console.log("\nFee Structure:");
    console.log("- Immediate launch, no ACF: 0 VIRTUAL");
    console.log(`- Immediate launch, with ACF: ${acfFee} VIRTUAL`);
    console.log(`- Scheduled launch, no ACF: ${normalLaunchFee} VIRTUAL`);
    console.log(`- Scheduled launch, with ACF: ${normalLaunchFee} + ${acfFee} = ${Number(normalLaunchFee) + Number(acfFee)} VIRTUAL`);

    console.log("\nLaunch Modes:");
    console.log("- LAUNCH_MODE_NORMAL (0): Open to everyone");
    console.log("- LAUNCH_MODE_X_LAUNCH (1): Requires isXLauncher authorization");
    console.log("- LAUNCH_MODE_ACP_SKILL (2): Requires isAcpSkillLauncher authorization");

    console.log("\n--- Deployment Order ---");
    console.log("0. ✅ deployLaunchpadv5_0.ts (AgentNftV2, AgentTax) - DONE");
    console.log("1. ✅ deployLaunchpadv5_1.ts (FFactoryV2, FRouterV2) - DONE");
    console.log("2. ✅ deployLaunchpadv5_2.ts (AgentFactoryV6) - DONE");
    console.log("3. ✅ deployLaunchpadv5_3.ts (BondingConfig, BondingV5) - DONE");
    console.log("4. ⏳ deployLaunchpadv5_4.ts (Revoke deployer roles)");

    console.log("\n" + "=".repeat(60));

    console.log("\n--- Next Step ---");
    console.log("1. Run: npx hardhat run scripts/launchpadv5/deployLaunchpadv5_4.ts --network <network>");

    console.log("\nDeployment completed successfully!");
  } catch (e) {
    console.error("Deployment failed:", e);
    throw e;
  }
})();
