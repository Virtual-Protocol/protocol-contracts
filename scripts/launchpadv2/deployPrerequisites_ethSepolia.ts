import { parseEther } from "ethers";
const { ethers, upgrades } = require("hardhat");

(async () => {
  try {
    console.log("\n=== Prerequisites Deployment Starting ===");
    console.log("This script deploys: AgentDAO, AgentNftV2, AgentTax (AGENT_TOKEN_TAX_MANAGER)");

    // Basic check for .env variables
    const deployerAddress = process.env.DEPLOYER;
    if (!deployerAddress) {
      throw new Error("DEPLOYER not set in environment");
    }
    const contractController = process.env.CONTRACT_CONTROLLER;
    if (!contractController) {
      throw new Error("CONTRACT_CONTROLLER not set in environment");
    }
    const admin = process.env.ADMIN;
    if (!admin) {
      throw new Error("ADMIN not set in environment");
    }

    // Required for AgentTax
    const assetToken = process.env.BRIDGED_TOKEN;
    if (!assetToken) {
      throw new Error("BRIDGED_TOKEN not set in environment");
    }
    const taxToken = process.env.AGENT_TAX_TOKEN;
    if (!taxToken) {
      throw new Error("AGENT_TAX_TOKEN not set in environment");
    }
    const uniswapV2Router = process.env.UNISWAP_V2_ROUTER;
    if (!uniswapV2Router) {
      throw new Error("UNISWAP_V2_ROUTER not set in environment");
    }
    const treasury = process.env.AGENT_TAX_TREASURY;
    if (!treasury) {
      throw new Error("AGENT_TAX_TREASURY not set in environment");
    }
    const minSwapThreshold = process.env.TAX_MANAGER_MIN_SWAP_THRESHOLD;
    if (!minSwapThreshold) {
      throw new Error("TAX_MANAGER_MIN_SWAP_THRESHOLD not set in environment");
    }
    const maxSwapThreshold = process.env.TAX_MANAGER_MAX_SWAP_THRESHOLD;
    if (!maxSwapThreshold) {
      throw new Error("TAX_MANAGER_MAX_SWAP_THRESHOLD not set in environment");
    }

    console.log("\nDeployment arguments loaded:", {
      deployerAddress,
      contractController,
      admin,
      assetToken,
      taxToken,
      uniswapV2Router,
      treasury,
      minSwapThreshold,
      maxSwapThreshold,
    });

    const signers = await ethers.getSigners();
    const deployer = signers[0];
    console.log("Deployer address:", await deployer.getAddress());

    // ============================================
    // 1. Deploy AgentDAO (implementation contract, not proxy)
    // ============================================
    // console.log("\n--- Deploying AgentDAO (implementation) ---");
    // const AgentDAO = await ethers.getContractFactory("AgentDAO");
    // const agentDAO = await AgentDAO.deploy();
    // await agentDAO.waitForDeployment();
    // const agentDAOAddress = await agentDAO.getAddress();
    // console.log("AgentDAO (implementation) deployed at:", agentDAOAddress);

    // ============================================
    // 2. Deploy AgentNftV2 (upgradeable proxy)
    // ============================================
    // console.log("\n--- Deploying AgentNftV2 (proxy) ---");
    // const AgentNftV2 = await ethers.getContractFactory("AgentNftV2");
    // const agentNftV2 = await upgrades.deployProxy(
    //   AgentNftV2,
    //   [admin], // initialize(address defaultAdmin)
    //   {
    //     initializer: "initialize",
    //     initialOwner: contractController,
    //     unsafeAllow: ["internal-function-storage"],
    //   }
    // );
    // await agentNftV2.waitForDeployment();
    // const agentNftV2Address = await agentNftV2.getAddress();
    // console.log("AgentNftV2 (proxy) deployed at:", agentNftV2Address);
    // Note: initialize() already grants DEFAULT_ADMIN_ROLE, VALIDATOR_ADMIN_ROLE, ADMIN_ROLE to admin
    // MINTER_ROLE will be granted to AgentFactoryV6 in the main deployment script

    // ============================================
    // 3. Deploy AgentTax (AGENT_TOKEN_TAX_MANAGER)
    // ============================================
    const agentNftV2Address = process.env.AGENT_NFT_V2;
    
    console.log("\n--- Deploying AgentTax (AGENT_TOKEN_TAX_MANAGER) ---");
    const AgentTax = await ethers.getContractFactory("AgentTax");
    const agentTax = await upgrades.deployProxy(
      AgentTax,
      [
        admin,                          // defaultAdmin_
        assetToken,                     // assetToken_ (BRIDGED_TOKEN/VIRTUAL)
        taxToken,                       // taxToken_
        uniswapV2Router,                // router_
        treasury,                       // treasury_
        parseEther(minSwapThreshold),   // minSwapThreshold_
        parseEther(maxSwapThreshold),   // maxSwapThreshold_
        agentNftV2Address,              // nft_ (AgentNftV2)
      ],
      {
        initializer: "initialize",
        initialOwner: contractController,
      }
    );
    await agentTax.waitForDeployment();
    const agentTaxAddress = await agentTax.getAddress();
    console.log("AgentTax deployed at:", agentTaxAddress);
    // Note: initialize() grants ADMIN_ROLE and DEFAULT_ADMIN_ROLE to admin
    // Admin needs to manually grant EXECUTOR_ROLE and EXECUTOR_V2_ROLE to the executor address

    // ============================================
    // 4. Print Deployment Summary
    // ============================================
    console.log("\n=== Prerequisites Deployment Summary ===");
    console.log("Copy the following addresses to your .env file:\n");
    // console.log(`AGENT_DAO=${agentDAOAddress}`);
    console.log(`AGENT_NFT_V2=${agentNftV2Address}`);
    console.log(`AGENT_TOKEN_TAX_MANAGER=${agentTaxAddress}`);

    console.log("\n--- Full Summary ---");
    // console.log("- AgentDAO (implementation):", agentDAOAddress);
    console.log("- AgentNftV2 (proxy):", agentNftV2Address);
    console.log("- AgentTax (AGENT_TOKEN_TAX_MANAGER):", agentTaxAddress);

    console.log("\n--- Manual Steps Required (by admin) ---");
    console.log("AgentNftV2: MINTER_ROLE will be granted to AgentFactoryV6 in main deployment script");
    console.log("AgentTax: Admin needs to grant EXECUTOR_ROLE and EXECUTOR_V2_ROLE to executor address");

    console.log("\nPrerequisites deployment completed successfully!");
  } catch (e) {
    console.error("Deployment failed:", e);
    throw e;
  }
})();
