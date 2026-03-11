import { parseEther } from "ethers";
import { verifyContract } from "./utils";
const { ethers, upgrades } = require("hardhat");

// Environment variables are loaded via hardhat.config.js
// Make sure hardhat.config.js has: require("dotenv").config({ path: ".env.launchpadv5_dev" });

/**
 * Deploy AgentFactoryV6 and dependencies
 * Prerequisites: FFactoryV2 and FRouterV2 must already be deployed (run deployPrerequisites_1.ts first)
 */
(async () => {
  try {
    console.log("\n=== AgentFactoryV6 Deployment Starting ===");
    console.log(
      "Prerequisites: FFactoryV2 and FRouterV2 must already be deployed"
    );

    // Check if AgentFactoryV6 already exists
    const existingAgentFactoryV6 = process.env.AGENT_FACTORY_V6_ADDRESS;
    if (existingAgentFactoryV6) {
      console.log("\n=== AgentFactoryV6 already exists, skipping deployment ===");
      console.log("AGENT_FACTORY_V6_ADDRESS:", existingAgentFactoryV6);
      console.log("\nNo changes made. Proceed to next deployment step:");
      console.log("Run: npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network <network>");
      return;
    }

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

    // FFactoryV2 and FRouterV2 addresses (from deployPrerequisites_1.ts)
    const fFactoryV2Address = process.env.FFactoryV2_ADDRESS;
    if (!fFactoryV2Address) {
      throw new Error(
        "FFactoryV2_ADDRESS not set - run deployPrerequisites_1.ts first"
      );
    }
    const fRouterV2Address = process.env.FRouterV2_ADDRESS;
    if (!fRouterV2Address) {
      throw new Error(
        "FRouterV2_ADDRESS not set - run deployPrerequisites_1.ts first"
      );
    }

    // AgentFactoryV6 tax params (Sentient phase - different from FFactoryV2 Prototype phase)
    const sentientBuyTax = process.env.SENTIENT_BUY_TAX;
    if (!sentientBuyTax) {
      throw new Error("SENTIENT_BUY_TAX not set in environment");
    }
    const sentientSellTax = process.env.SENTIENT_SELL_TAX;
    if (!sentientSellTax) {
      throw new Error("SENTIENT_SELL_TAX not set in environment");
    }
    const agentTaxContractAddress = process.env.AGENT_TAX_CONTRACT_ADDRESS;
    if (!agentTaxContractAddress) {
      throw new Error("AGENT_TAX_CONTRACT_ADDRESS not set in environment");
    }

    // REQUIRED: AgentNftV2 must be deployed first (in deployLaunchpadv5_0.ts)
    const agentNftV2Address = process.env.AGENT_NFT_V2_ADDRESS;
    if (!agentNftV2Address) {
      throw new Error("AGENT_NFT_V2_ADDRESS not set - run deployLaunchpadv5_0.ts first");
    }

    // AgentFactoryV6 parameters (optional - will deploy if not provided)
    const agentTokenV2Impl = process.env.AGENT_TOKEN_V2_IMPLEMENTATION;
    const agentVeTokenV2Impl = process.env.AGENT_VE_TOKEN_V2_IMPLEMENTATION;
    const agentDAOImpl = process.env.AGENT_DAO_IMPLEMENTATION;

    // Required external contract addresses
    const tbaRegistry = process.env.TBA_REGISTRY;
    if (!tbaRegistry) {
      throw new Error("TBA_REGISTRY not set in environment");
    }
    const uniswapV2RouterAddress = process.env.UNISWAP_V2_ROUTER;
    if (!uniswapV2RouterAddress) {
      throw new Error("UNISWAP_V2_ROUTER not set in environment");
    }

    // AgentFactoryV6 config parameters
    const agentFactoryV6Vault = process.env.AGENT_FACTORY_V6_VAULT;
    if (!agentFactoryV6Vault) {
      throw new Error("AGENT_FACTORY_V6_VAULT not set in environment");
    }
    const agentFactoryV6NextId = process.env.AGENT_FACTORY_V6_NEXT_ID;
    if (!agentFactoryV6NextId) {
      throw new Error("AGENT_FACTORY_V6_NEXT_ID not set in environment");
    }
    const agentFactoryV6MaturityDuration =
      process.env.AGENT_FACTORY_V6_MATURITY_DURATION;
    if (!agentFactoryV6MaturityDuration) {
      throw new Error(
        "AGENT_FACTORY_V6_MATURITY_DURATION not set in environment"
      );
    }
    const taxSwapThresholdBasisPoints =
      process.env.AGENT_FACTORY_V6_TAX_SWAP_THRESHOLD_BASIS_POINTS;
    if (!taxSwapThresholdBasisPoints) {
      throw new Error(
        "AGENT_FACTORY_V6_TAX_SWAP_THRESHOLD_BASIS_POINTS not set in environment"
      );
    }

    console.log("\nDeployment arguments loaded:", {
      contractController,
      admin,
      virtualTokenAddress,
      fFactoryV2Address,
      fRouterV2Address,
      sentientBuyTax,
      sentientSellTax,
      agentTaxContractAddress,
      agentTokenV2Impl: agentTokenV2Impl || "(will deploy)",
      agentVeTokenV2Impl: agentVeTokenV2Impl || "(will deploy)",
      agentDAOImpl: agentDAOImpl || "(will deploy)",
      tbaRegistry,
      agentNftV2Address,
      uniswapV2RouterAddress,
      agentFactoryV6Vault,
      agentFactoryV6NextId,
      agentFactoryV6MaturityDuration,
      taxSwapThresholdBasisPoints,
    });

    // Track deployed contracts
    const deployedContracts: { [key: string]: string } = {};

    // ============================================
    // 1. Deploy AgentTokenV2 implementation
    // ============================================
    let agentTokenV2ImplAddress: string;
    if (!agentTokenV2Impl) {
      console.log("\n--- Deploying AgentTokenV2 implementation ---");
      const AgentTokenV2 = await ethers.getContractFactory("AgentTokenV2");
      const agentTokenV2 = await AgentTokenV2.deploy();
      await agentTokenV2.waitForDeployment();
      agentTokenV2ImplAddress = await agentTokenV2.getAddress();
      deployedContracts.AgentTokenV2Impl = agentTokenV2ImplAddress;
      console.log(
        "AgentTokenV2 implementation deployed at:",
        agentTokenV2ImplAddress
      );

      // Verify AgentTokenV2 implementation
      await verifyContract(agentTokenV2ImplAddress);
    } else {
      agentTokenV2ImplAddress = agentTokenV2Impl;
      console.log(
        "\n--- Reusing AgentTokenV2 implementation:",
        agentTokenV2ImplAddress,
        "---"
      );
    }

    // ============================================
    // 2. Deploy AgentVeTokenV2 implementation
    // ============================================
    let agentVeTokenV2ImplAddress: string;
    if (!agentVeTokenV2Impl) {
      console.log("\n--- Deploying AgentVeTokenV2 implementation ---");
      const AgentVeTokenV2 = await ethers.getContractFactory("AgentVeTokenV2");
      const agentVeTokenV2 = await AgentVeTokenV2.deploy();
      await agentVeTokenV2.waitForDeployment();
      agentVeTokenV2ImplAddress = await agentVeTokenV2.getAddress();
      deployedContracts.AgentVeTokenV2Impl = agentVeTokenV2ImplAddress;
      console.log(
        "AgentVeTokenV2 implementation deployed at:",
        agentVeTokenV2ImplAddress
      );

      // Verify AgentVeTokenV2 implementation
      await verifyContract(agentVeTokenV2ImplAddress);
    } else {
      agentVeTokenV2ImplAddress = agentVeTokenV2Impl;
      console.log(
        "\n--- Reusing AgentVeTokenV2 implementation:",
        agentVeTokenV2ImplAddress,
        "---"
      );
    }

    // ============================================
    // 3. Deploy AgentDAO implementation (if not provided)
    // ============================================
    let agentDAOImplAddress: string;
    if (!agentDAOImpl) {
      console.log("\n--- Deploying AgentDAO implementation ---");
      const AgentDAO = await ethers.getContractFactory("AgentDAO");
      const agentDAO = await AgentDAO.deploy();
      await agentDAO.waitForDeployment();
      agentDAOImplAddress = await agentDAO.getAddress();
      deployedContracts.AgentDAOImpl = agentDAOImplAddress;
      console.log("AgentDAO implementation deployed at:", agentDAOImplAddress);

      // Verify AgentDAO implementation
      await verifyContract(agentDAOImplAddress);
    } else {
      agentDAOImplAddress = agentDAOImpl;
      console.log(
        "\n--- Reusing AgentDAO implementation:",
        agentDAOImplAddress,
        "---"
      );
    }

    // ============================================
    // 4. Use provided TBA Registry (canonical ERC-6551 Registry)
    // ============================================
    console.log("--- Using TBA Registry:", tbaRegistry, "---");

    // ============================================
    // 5. Use provided AgentNftV2 (deployed in deployLaunchpadv5_0.ts)
    // ============================================
    console.log("--- Using AgentNftV2:", agentNftV2Address, "---");

    // ============================================
    // 6. Use provided UniswapV2Router
    // ============================================
    console.log("--- Using UniswapV2Router:", uniswapV2RouterAddress, "---");

    // ============================================
    // 7. Deploy AgentFactoryV6
    // ============================================
    console.log("\n--- Deploying AgentFactoryV6 ---");
    const AgentFactoryV6 = await ethers.getContractFactory("AgentFactoryV6");
    const agentFactoryV6 = await upgrades.deployProxy(
      AgentFactoryV6,
      [
        agentTokenV2ImplAddress, // tokenImplementation_
        agentVeTokenV2ImplAddress, // veTokenImplementation_
        agentDAOImplAddress, // daoImplementation_
        tbaRegistry, // tbaRegistry_
        virtualTokenAddress, // assetToken_
        agentNftV2Address, // nft_ (deployed in deployLaunchpadv5_0.ts)
        agentFactoryV6Vault, // vault_
        agentFactoryV6NextId, // nextId_
      ],
      {
        initializer: "initialize",
        initialOwner: contractController,
      }
    );
    await agentFactoryV6.waitForDeployment();
    const agentFactoryV6Address = await agentFactoryV6.getAddress();
    deployedContracts.AgentFactoryV6 = agentFactoryV6Address;
    console.log("AgentFactoryV6 deployed at:", agentFactoryV6Address);

    // Verify AgentFactoryV6 proxy
    await verifyContract(agentFactoryV6Address);

    // ============================================
    // 8. Configure AgentFactoryV6
    // ============================================
    console.log("\n--- Configuring AgentFactoryV6 ---");

    // Grant DEFAULT_ADMIN_ROLE to deployer temporarily (needed for setParams/setTokenParams)
    const txGrantAdmin = await agentFactoryV6.grantRole(
      await agentFactoryV6.DEFAULT_ADMIN_ROLE(),
      deployerAddress
    );
    await txGrantAdmin.wait();
    console.log("DEFAULT_ADMIN_ROLE of AgentFactoryV6 granted to deployer (temporary)");

    // Set params
    const txSetParams = await agentFactoryV6.setParams(
      agentFactoryV6MaturityDuration,
      uniswapV2RouterAddress,
      admin, // defaultDelegatee
      admin // tokenAdmin
    );
    await txSetParams.wait();
    console.log("AgentFactoryV6.setParams() called:", {
      maturityDuration: agentFactoryV6MaturityDuration,
      uniswapRouter: uniswapV2RouterAddress,
      defaultDelegatee: admin,
      tokenAdmin: admin,
    });

    // Set token params (Sentient phase tax configuration)
    const txSetTokenParams = await agentFactoryV6.setTokenParams(
      sentientBuyTax,
      sentientSellTax,
      taxSwapThresholdBasisPoints,
      agentTaxContractAddress
    );
    await txSetTokenParams.wait();
    console.log("AgentFactoryV6.setTokenParams() called:", {
      buyTax: sentientBuyTax,
      sellTax: sentientSellTax,
      taxSwapThreshold: taxSwapThresholdBasisPoints,
      taxRecipient: agentTaxContractAddress,
    });

    // Grant DEFAULT_ADMIN_ROLE of AgentFactoryV6 to admin
    const agentFactoryV6DefaultAdminRole = await agentFactoryV6.DEFAULT_ADMIN_ROLE();
    const txGrantAdminToAdmin = await agentFactoryV6.grantRole(
      agentFactoryV6DefaultAdminRole,
      admin
    );
    await txGrantAdminToAdmin.wait();
    console.log("DEFAULT_ADMIN_ROLE of AgentFactoryV6 granted to admin:", admin);

    // Grant REMOVE_LIQUIDITY_ROLE of AgentFactoryV6 to admin
    const agentFactoryV6RemoveLiqRole = await agentFactoryV6.REMOVE_LIQUIDITY_ROLE();
    const txGrantRemoveLiq = await agentFactoryV6.grantRole(agentFactoryV6RemoveLiqRole, admin);
    await txGrantRemoveLiq.wait();
    console.log("REMOVE_LIQUIDITY_ROLE of AgentFactoryV6 granted to admin:", admin);

    // Grant WITHDRAW_ROLE of AgentFactoryV6 to admin
    const agentFactoryV6WithdrawRole = await agentFactoryV6.WITHDRAW_ROLE();
    const txGrantWithdraw = await agentFactoryV6.grantRole(agentFactoryV6WithdrawRole, admin);
    await txGrantWithdraw.wait();
    console.log("WITHDRAW_ROLE of AgentFactoryV6 granted to admin:", admin);

    // ============================================
    // 9. Grant MINTER_ROLE on AgentNftV2 to AgentFactoryV6
    // ============================================
    // AgentNftV2 was deployed in deployLaunchpadv5_0.ts with deployer having DEFAULT_ADMIN_ROLE
    console.log("\n--- Configuring AgentNftV2 roles ---");
    const agentNftV2Contract = await ethers.getContractAt(
      "AgentNftV2",
      agentNftV2Address
    );

    // Grant MINTER_ROLE to AgentFactoryV6
    const minterRole = await agentNftV2Contract.MINTER_ROLE();
    const tx = await agentNftV2Contract.grantRole(minterRole, agentFactoryV6Address);
    await tx.wait();
    console.log("MINTER_ROLE of AgentNftV2 granted to AgentFactoryV6:", agentFactoryV6Address);

    // ============================================
    // 10. Print Deployment Summary
    // ============================================
    console.log("\n=== AgentFactoryV6 Deployment Summary ===");
    console.log("Copy the following to your .env file:\n");
    console.log(`AGENT_FACTORY_V6_ADDRESS=${agentFactoryV6Address}`);
    if (deployedContracts.AgentTokenV2Impl) {
      console.log(`AGENT_TOKEN_V2_IMPLEMENTATION=${agentTokenV2ImplAddress}`);
    }
    if (deployedContracts.AgentVeTokenV2Impl) {
      console.log(
        `AGENT_VE_TOKEN_V2_IMPLEMENTATION=${agentVeTokenV2ImplAddress}`
      );
    }
    if (deployedContracts.AgentDAOImpl) {
      console.log(`AGENT_DAO_IMPLEMENTATION=${agentDAOImplAddress}`);
    }

    console.log("\n--- Prerequisites (already deployed) ---");
    console.log(`- FFactoryV2: ${fFactoryV2Address}`);
    console.log(`- FRouterV2: ${fRouterV2Address}`);
    console.log(`- AgentNftV2: ${agentNftV2Address}`);

    console.log("\n--- Newly Deployed Contracts ---");
    for (const [name, address] of Object.entries(deployedContracts)) {
      console.log(`- ${name}: ${address}`);
    }

    console.log("\n--- Deployment Order ---");
    console.log("0. ✅ deployLaunchpadv5_0.ts (AgentTax, AgentNftV2) - DONE");
    console.log("1. ✅ deployLaunchpadv5_1.ts (FFactoryV2, FRouterV2) - DONE");
    console.log("2. ✅ deployLaunchpadv5_2.ts (AgentFactoryV6) - DONE");
    console.log("3. ⏳ deployLaunchpadv5_3.ts (BondingConfig, BondingV5)");
    console.log("4. ⏳ deployLaunchpadv5_4.ts (Revoke deployer roles)");

    console.log("\n--- Next Step ---");
    console.log("1. Add AGENT_FACTORY_V6_ADDRESS to your .env file");
    console.log(
      "2. Run: npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network <network>"
    );

    console.log("\nDeployment completed successfully!");
  } catch (e) {
    console.error("Deployment failed:", e);
    throw e;
  }
})();
