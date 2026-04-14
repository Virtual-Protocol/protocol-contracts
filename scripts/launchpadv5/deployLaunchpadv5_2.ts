/**
 * V5 Suite - Step 2: Deploy AgentFactoryV7, TaxAccountingAdapter proxy, and AgentTokenV4 impl
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/deployLaunchpadv5_2.ts --network local
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/deployLaunchpadv5_2.ts --network base_sepolia
 *   ENV_FILE=.env.launchpadv5_prod npx hardhat run scripts/launchpadv5/deployLaunchpadv5_2.ts --network base
 *
 * If TAX_ACCOUNTING_ADAPTER_ADDRESS is set, that proxy is reused (no new deploy).
 */
import { parseEther } from "ethers";
import { verifyContract, upsertLaunchpadEnvFile } from "./utils";
const { ethers, upgrades } = require("hardhat");

/**
 * V5 Suite - Step 2: Deploy AgentFactoryV7 and AgentTokenV4
 *
 * Deploys:
 * - TaxAccountingAdapter proxy (NEW unless TAX_ACCOUNTING_ADAPTER_ADDRESS already set)
 * - AgentTokenV4 implementation (NEW - TaxAccountingAdapter + AgentTaxV2 attribution)
 * - AgentVeTokenV2 implementation (REUSE - same as V4 suite)
 * - AgentDAO implementation (REUSE - same as V4 suite)
 * - AgentFactoryV7 (NEW - separate from AgentFactoryV6 for clean V5 suite)
 *
 * Prerequisites:
 * - AgentNftV2, AgentTaxV2 (from deployLaunchpadv5_0.ts)
 * - FFactoryV3, FRouterV3 (from deployLaunchpadv5_1.ts)
 *
 * V5 Suite Architecture:
 * - AgentFactoryV7 uses AgentTokenV4 implementation
 * - AgentTokenV4._swapTax() uses TaxAccountingAdapter then AgentTaxV2.depositTax()
 * - projectTaxRecipient = AgentTaxV2 (not the legacy AgentTax)
 */
(async () => {
  try {
    console.log("\n" + "=".repeat(80));
    console.log("  V5 Suite - Step 2: Deploy AgentFactoryV7 & AgentTokenV4");
    console.log("=".repeat(80));
    console.log(
      "Prerequisites: AgentNftV2, AgentTaxV2, FFactoryV3, FRouterV3 must already be deployed"
    );

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

    // FFactoryV3 and FRouterV3 addresses (from deployLaunchpadv5_1.ts)
    const fFactoryV3Address = process.env.FFactoryV3_ADDRESS;
    if (!fFactoryV3Address) {
      throw new Error(
        "FFactoryV3_ADDRESS not set - run deployLaunchpadv5_1.ts first"
      );
    }
    const fRouterV3Address = process.env.FRouterV3_ADDRESS;
    if (!fRouterV3Address) {
      throw new Error(
        "FRouterV3_ADDRESS not set - run deployLaunchpadv5_1.ts first"
      );
    }

    // AgentFactoryV7 tax params (Sentient phase)
    const sentientBuyTax = process.env.SENTIENT_BUY_TAX;
    if (!sentientBuyTax) {
      throw new Error("SENTIENT_BUY_TAX not set in environment");
    }
    const sentientSellTax = process.env.SENTIENT_SELL_TAX;
    if (!sentientSellTax) {
      throw new Error("SENTIENT_SELL_TAX not set in environment");
    }

    // AgentTaxV2 address (projectTaxRecipient for V5 suite)
    const agentTaxV2Address = process.env.AGENT_TAX_V2_CONTRACT_ADDRESS;
    if (!agentTaxV2Address) {
      throw new Error(
        "AGENT_TAX_V2_CONTRACT_ADDRESS not set - run deployLaunchpadv5_0.ts first"
      );
    }

    // REQUIRED: AgentNftV2 must be deployed first (in deployLaunchpadv5_0.ts)
    const agentNftV2Address = process.env.AGENT_NFT_V2_ADDRESS;
    if (!agentNftV2Address) {
      throw new Error(
        "AGENT_NFT_V2_ADDRESS not set - run deployLaunchpadv5_0.ts first"
      );
    }

    // Required external contract addresses
    const tbaRegistry = process.env.TBA_REGISTRY;
    if (!tbaRegistry) {
      throw new Error("TBA_REGISTRY not set in environment");
    }
    const uniswapV2RouterAddress = process.env.UNISWAP_V2_ROUTER;
    if (!uniswapV2RouterAddress) {
      throw new Error("UNISWAP_V2_ROUTER not set in environment");
    }

    // AgentFactoryV7 config parameters
    const agentFactoryV7Vault = process.env.AGENT_FACTORY_V7_VAULT;
    if (!agentFactoryV7Vault) {
      throw new Error("AGENT_FACTORY_V7_VAULT not set in environment");
    }
    const agentFactoryV7NextId = process.env.AGENT_FACTORY_V7_NEXT_ID;
    if (!agentFactoryV7NextId) {
      throw new Error("AGENT_FACTORY_V7_NEXT_ID not set in environment");
    }
    const agentFactoryV7MaturityDuration =
      process.env.AGENT_FACTORY_V7_MATURITY_DURATION;
    if (!agentFactoryV7MaturityDuration) {
      throw new Error(
        "AGENT_FACTORY_V7_MATURITY_DURATION not set in environment"
      );
    }
    // AgentTokenV4: min tax before autoswap = totalSupply * N / 1e6. N=100 matches old AgentToken 1 bps of supply; N=10 is 10× lower.
    const taxSwapThresholdBasisPoints =
      process.env.AGENT_FACTORY_V7_TAX_SWAP_THRESHOLD_BASIS_POINTS;
    if (!taxSwapThresholdBasisPoints) {
      throw new Error(
        "AGENT_FACTORY_V7_TAX_SWAP_THRESHOLD_BASIS_POINTS not set in environment"
      );
    }

    // Implementation addresses (optional - will deploy if not provided)
    const agentTokenV4Impl =
    process.env.AGENT_TOKEN_V4_IMPLEMENTATION;
    const agentVeTokenV2Impl = process.env.AGENT_VE_TOKEN_V2_IMPLEMENTATION;
    const agentDAOImpl = process.env.AGENT_DAO_IMPLEMENTATION;
    const taxAccountingAdapter = process.env.TAX_ACCOUNTING_ADAPTER_ADDRESS;

    console.log("\nDeployment arguments loaded:", {
      contractController,
      admin,
      virtualTokenAddress,
      fFactoryV3Address,
      fRouterV3Address,
      sentientBuyTax,
      sentientSellTax,
      agentTaxV2Address,
      taxAccountingAdapter: taxAccountingAdapter || "(will deploy)",
      agentTokenV4Impl: agentTokenV4Impl || "(will deploy)",
      agentVeTokenV2Impl: agentVeTokenV2Impl || "(will deploy)",
      agentDAOImpl: agentDAOImpl || "(will deploy)",
      tbaRegistry,
      agentNftV2Address,
      uniswapV2RouterAddress,
      agentFactoryV7Vault,
      agentFactoryV7NextId,
      agentFactoryV7MaturityDuration,
      taxSwapThresholdBasisPoints,
    });

    // Track deployed/reused contracts
    const deployedContracts: { [key: string]: string } = {};
    const reusedContracts: { [key: string]: string } = {};

    // ============================================
    // 1. Deploy or reuse TaxAccountingAdapter (transparent proxy)
    // ============================================
    let taxAccountingAdapterAddress: string;
    if (!taxAccountingAdapter) {
      console.log(
        "\n--- Deploying TaxAccountingAdapter (transparent proxy) ---"
      );
      const TaxAccountingAdapterFactory = await ethers.getContractFactory(
        "TaxAccountingAdapter"
      );
      const taxAdapterProxy = await upgrades.deployProxy(
        TaxAccountingAdapterFactory,
        [contractController, agentTaxV2Address],
        {
          initializer: "initialize",
          initialOwner: contractController,
        }
      );
      await taxAdapterProxy.waitForDeployment();
      taxAccountingAdapterAddress = await taxAdapterProxy.getAddress();
      deployedContracts.TaxAccountingAdapter = taxAccountingAdapterAddress;

      await verifyContract(taxAccountingAdapterAddress);
      upsertLaunchpadEnvFile(
        process.env.ENV_FILE?.trim(),
        "TAX_ACCOUNTING_ADAPTER_ADDRESS",
        taxAccountingAdapterAddress
      );
      console.log(
        "\n--- TaxAccountingAdapter deployed at:",
        taxAccountingAdapterAddress,
        "---"
      );
      console.log("\n--- Paste into .env ---");
      console.log(`TAX_ACCOUNTING_ADAPTER_ADDRESS=${taxAccountingAdapterAddress}`);
    } else {
      taxAccountingAdapterAddress = taxAccountingAdapter;
      reusedContracts.TaxAccountingAdapter = taxAccountingAdapterAddress;
      console.log(
        "\n--- Reusing TaxAccountingAdapter:",
        taxAccountingAdapterAddress,
        "---"
      );
    }

    // ============================================
    // 2. Deploy AgentTokenV4 implementation (NEW)
    // ============================================
    let agentTokenV4ImplAddress: string;
    if (!agentTokenV4Impl) {
      console.log(
        "\n--- Deploying AgentTokenV4 implementation (NEW for V5 Suite) ---"
      );
      const AgentTokenV4 = await ethers.getContractFactory("AgentTokenV4");
      const agentTokenV4 = await AgentTokenV4.deploy();
      await agentTokenV4.waitForDeployment();
      agentTokenV4ImplAddress = await agentTokenV4.getAddress();
      deployedContracts.AgentTokenV4Impl = agentTokenV4ImplAddress;
      console.log(
        "AgentTokenV4 implementation deployed at:",
        agentTokenV4ImplAddress
      );

      await verifyContract(agentTokenV4ImplAddress);
    } else {
      agentTokenV4ImplAddress = agentTokenV4Impl;
      reusedContracts.AgentTokenV4Impl = agentTokenV4ImplAddress;
      console.log(
        "\n--- Reusing AgentTokenV4 implementation:",
        agentTokenV4ImplAddress,
        "---"
      );
    }

    // ============================================
    // 3. Deploy or Reuse AgentVeTokenV2 implementation (REUSE)
    // ============================================
    let agentVeTokenV2ImplAddress: string;
    if (!agentVeTokenV2Impl) {
      console.log(
        "\n--- Deploying AgentVeTokenV2 implementation (shared with V4 suite) ---"
      );
      const AgentVeTokenV2 = await ethers.getContractFactory("AgentVeTokenV2");
      const agentVeTokenV2 = await AgentVeTokenV2.deploy();
      await agentVeTokenV2.waitForDeployment();
      agentVeTokenV2ImplAddress = await agentVeTokenV2.getAddress();
      deployedContracts.AgentVeTokenV2Impl = agentVeTokenV2ImplAddress;
      console.log(
        "AgentVeTokenV2 implementation deployed at:",
        agentVeTokenV2ImplAddress
      );

      await verifyContract(agentVeTokenV2ImplAddress);
    } else {
      agentVeTokenV2ImplAddress = agentVeTokenV2Impl;
      reusedContracts.AgentVeTokenV2Impl = agentVeTokenV2ImplAddress;
      console.log(
        "\n--- Reusing AgentVeTokenV2 implementation:",
        agentVeTokenV2ImplAddress,
        "---"
      );
    }

    // ============================================
    // 4. Deploy or Reuse AgentDAO implementation (REUSE)
    // ============================================
    let agentDAOImplAddress: string;
    if (!agentDAOImpl) {
      console.log(
        "\n--- Deploying AgentDAO implementation (shared with V4 suite) ---"
      );
      const AgentDAO = await ethers.getContractFactory("AgentDAO");
      const agentDAO = await AgentDAO.deploy();
      await agentDAO.waitForDeployment();
      agentDAOImplAddress = await agentDAO.getAddress();
      deployedContracts.AgentDAOImpl = agentDAOImplAddress;
      console.log("AgentDAO implementation deployed at:", agentDAOImplAddress);

      await verifyContract(agentDAOImplAddress);
    } else {
      agentDAOImplAddress = agentDAOImpl;
      reusedContracts.AgentDAOImpl = agentDAOImplAddress;
      console.log(
        "\n--- Reusing AgentDAO implementation:",
        agentDAOImplAddress,
        "---"
      );
    }

    // ============================================
    // 5. Log external contracts being used
    // ============================================
    console.log("\n--- Using External Contracts ---");
    console.log("TBA Registry:", tbaRegistry);
    console.log("AgentNftV2:", agentNftV2Address);
    console.log("UniswapV2Router:", uniswapV2RouterAddress);

    // ============================================
    // 6. Deploy AgentFactoryV7 (NEW for V5 Suite)
    // ============================================
    // Check if AgentFactoryV7 already exists
    const agentFactoryV7Address = process.env.AGENT_FACTORY_V7_ADDRESS;
    if (agentFactoryV7Address) {
      console.log(
        "\n=== AgentFactoryV7 already exists, skipping deployment ==="
      );
      console.log("AGENT_FACTORY_V7_ADDRESS:", agentFactoryV7Address);
      console.log("\nNo changes made. Proceed to next deployment step:");
      console.log(
        "Run: npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network <network>"
      );
    } else {
      console.log("\n--- Deploying AgentFactoryV7 ---");
      const AgentFactoryV7 = await ethers.getContractFactory("AgentFactoryV7");
      const agentFactoryV7 = await upgrades.deployProxy(
        AgentFactoryV7,
        [
          agentTokenV4ImplAddress, // tokenImplementation_ (AgentTokenV4)
          agentVeTokenV2ImplAddress, // veTokenImplementation_ (reuse)
          agentDAOImplAddress, // daoImplementation_ (reuse)
          tbaRegistry, // tbaRegistry_
          virtualTokenAddress, // assetToken_
          agentNftV2Address, // nft_ (deployed in _0.ts)
          agentFactoryV7Vault, // vault_
          agentFactoryV7NextId, // nextId_
        ],
        {
          initializer: "initialize",
          initialOwner: contractController,
        }
      );
      await agentFactoryV7.waitForDeployment();
      const agentFactoryV7Address = await agentFactoryV7.getAddress();
      deployedContracts.AgentFactoryV7 = agentFactoryV7Address;
      console.log("AgentFactoryV7 deployed at:", agentFactoryV7Address);

      await verifyContract(agentFactoryV7Address);

      // ============================================
      // 7. Configure AgentFactoryV7
      // ============================================
      console.log("\n--- Configuring AgentFactoryV7 ---");

      // Set params
      const txSetParams = await agentFactoryV7.setParams(
        agentFactoryV7MaturityDuration,
        uniswapV2RouterAddress,
        admin, // defaultDelegatee
        admin // tokenAdmin
      );
      await txSetParams.wait();
      console.log("AgentFactoryV7.setParams() called:", {
        maturityDuration: agentFactoryV7MaturityDuration,
        uniswapRouter: uniswapV2RouterAddress,
        defaultDelegatee: admin,
        tokenAdmin: admin,
      });

      // Set token params (projectTaxRecipient = AgentTaxV2)
      const txSetTokenParams = await agentFactoryV7.setTokenParams(
        sentientBuyTax,
        sentientSellTax,
        taxSwapThresholdBasisPoints,
        agentTaxV2Address // projectTaxRecipient = AgentTaxV2 (NOT legacy AgentTax!)
      );
      await txSetTokenParams.wait();
      console.log("AgentFactoryV7.setTokenParams() called:", {
        buyTax: sentientBuyTax,
        sellTax: sentientSellTax,
        taxSwapThreshold: taxSwapThresholdBasisPoints,
        projectTaxRecipient: agentTaxV2Address,
      });

      const txSetTaxAdapter = await agentFactoryV7.setTaxAccountingAdapter(
        taxAccountingAdapterAddress
      );
      await txSetTaxAdapter.wait();
      console.log("AgentFactoryV7.setTaxAccountingAdapter() called:", {
        taxAccountingAdapter: taxAccountingAdapterAddress,
      });

      // Grant DEFAULT_ADMIN_ROLE to admin
      const agentFactoryV7DefaultAdminRole =
        await agentFactoryV7.DEFAULT_ADMIN_ROLE();
      const txGrantAdminToAdmin = await agentFactoryV7.grantRole(
        agentFactoryV7DefaultAdminRole,
        admin
      );
      await txGrantAdminToAdmin.wait();
      console.log(
        "DEFAULT_ADMIN_ROLE of AgentFactoryV7 granted to admin:",
        admin
      );

      // Grant REMOVE_LIQUIDITY_ROLE to admin
      const agentFactoryV7RemoveLiqRole =
        await agentFactoryV7.REMOVE_LIQUIDITY_ROLE();
      const txGrantRemoveLiq = await agentFactoryV7.grantRole(
        agentFactoryV7RemoveLiqRole,
        admin
      );
      await txGrantRemoveLiq.wait();
      console.log(
        "REMOVE_LIQUIDITY_ROLE of AgentFactoryV7 granted to admin:",
        admin
      );

      // Grant REMOVE_LIQUIDITY_ROLE to FRouterV3
      const txGrantRemoveLiqToFRouterV3 = await agentFactoryV7.grantRole(
        agentFactoryV7RemoveLiqRole,
        fRouterV3Address
      );
      await txGrantRemoveLiqToFRouterV3.wait();
      console.log(
        "REMOVE_LIQUIDITY_ROLE of AgentFactoryV7 granted to FRouterV3:",
        fRouterV3Address
      );

      // Grant WITHDRAW_ROLE to admin
      const agentFactoryV7WithdrawRole = await agentFactoryV7.WITHDRAW_ROLE();
      const txGrantWithdraw = await agentFactoryV7.grantRole(
        agentFactoryV7WithdrawRole,
        admin
      );
      await txGrantWithdraw.wait();
      console.log("WITHDRAW_ROLE of AgentFactoryV7 granted to admin:", admin);
    }

    // ============================================
    // 8. Grant MINTER_ROLE on AgentNftV2 to AgentFactoryV7
    // ============================================
    console.log("\n--- Configuring AgentNftV2 roles ---");

    const agentNftV2Read = await ethers.getContractAt(
      "AgentNftV2",
      agentNftV2Address,
      ethers.provider
    );
    const minterRole = await agentNftV2Read.MINTER_ROLE();
    const minterRoleAdmin = await agentNftV2Read.getRoleAdmin(minterRole);
    const deployerCanGrant = await agentNftV2Read.hasRole(
      minterRoleAdmin,
      deployerAddress
    );

    let agentNftV2ForGrant;
    if (deployerCanGrant) {
      agentNftV2ForGrant = await ethers.getContractAt(
        "AgentNftV2",
        agentNftV2Address,
        deployer
      );
      console.log(
        "Deployer has the role admin for MINTER_ROLE; granting with deployer"
      );
    } else {
      const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY?.trim();
      if (!adminPrivateKey) {
        throw new Error(
          `AgentNftV2: deployer ${deployerAddress} cannot grant MINTER_ROLE (lacks role admin ${minterRoleAdmin} for MINTER_ROLE), and ADMIN_PRIVATE_KEY is not set. ` +
            `Grant that admin role to the deployer, or set ADMIN_PRIVATE_KEY for an account that has it.`
        );
      }
      const adminSigner = new ethers.Wallet(adminPrivateKey, ethers.provider);
      const adminAddress = await adminSigner.getAddress();
      const adminCanGrant = await agentNftV2Read.hasRole(
        minterRoleAdmin,
        adminAddress
      );
      if (!adminCanGrant) {
        throw new Error(
          `AgentNftV2: ADMIN wallet ${adminAddress} cannot grant MINTER_ROLE (lacks role admin ${minterRoleAdmin}).`
        );
      }
      agentNftV2ForGrant = await ethers.getContractAt(
        "AgentNftV2",
        agentNftV2Address,
        adminSigner
      );
      console.log(
        "Using ADMIN_PRIVATE_KEY wallet for AgentNftV2 MINTER_ROLE grant:",
        adminAddress
      );
    }

    const txMint = await agentNftV2ForGrant.grantRole(
      minterRole,
      agentFactoryV7Address
    );
    await txMint.wait();
    console.log(
      "MINTER_ROLE of AgentNftV2 granted to AgentFactoryV7:",
      agentFactoryV7Address
    );

    // ============================================
    // 9. Print Deployment Summary
    // ============================================
    console.log("\n" + "=".repeat(80));
    console.log("  Deployment Summary");
    console.log("=".repeat(80));

    console.log("\n--- Newly Deployed Contracts ---");
    for (const [name, address] of Object.entries(deployedContracts)) {
      console.log(`${name}: ${address}`);
    }

    if (Object.keys(reusedContracts).length > 0) {
      console.log("\n--- Reused Contracts ---");
      for (const [name, address] of Object.entries(reusedContracts)) {
        console.log(`${name}: ${address}`);
      }
    }

    console.log("\n--- Prerequisites (already deployed) ---");
    console.log(`- FFactoryV3: ${fFactoryV3Address}`);
    console.log(`- FRouterV3: ${fRouterV3Address}`);
    console.log(`- AgentNftV2: ${agentNftV2Address}`);
    console.log(`- AgentTaxV2: ${agentTaxV2Address}`);

    console.log("\n--- Environment Variables for .env file ---");
    console.log(`AGENT_FACTORY_V7_ADDRESS=${agentFactoryV7Address}`);
    if (deployedContracts.AgentTokenV4Impl) {
      console.log(`AGENT_TOKEN_V4_IMPLEMENTATION=${agentTokenV4ImplAddress}`);
    }
    if (deployedContracts.AgentVeTokenV2Impl) {
      console.log(
        `AGENT_VE_TOKEN_V2_IMPLEMENTATION=${agentVeTokenV2ImplAddress}`
      );
    }
    if (deployedContracts.AgentDAOImpl) {
      console.log(`AGENT_DAO_IMPLEMENTATION=${agentDAOImplAddress}`);
    }
    if (deployedContracts.TaxAccountingAdapter) {
      console.log(
        `TAX_ACCOUNTING_ADAPTER_ADDRESS=${deployedContracts.TaxAccountingAdapter}`
      );
    }

    console.log("\n--- V5 Suite Configuration ---");
    console.log("AgentFactoryV7 uses AgentTokenV4 implementation");
    console.log(
      "AgentTokenV4._swapTax() uses TaxAccountingAdapter + AgentTaxV2.depositTax()"
    );
    console.log(`projectTaxRecipient = ${agentTaxV2Address} (AgentTaxV2)`);

    console.log("\n--- Deployment Order ---");
    console.log("0. ✅ deployLaunchpadv5_0.ts (AgentNftV2, AgentTaxV2) - DONE");
    console.log("1. ✅ deployLaunchpadv5_1.ts (FFactoryV3, FRouterV3) - DONE");
    console.log(
      "2. ✅ deployLaunchpadv5_2.ts (AgentFactoryV7, AgentTokenV4) - DONE"
    );
    console.log("3. ⏳ deployLaunchpadv5_3.ts (BondingConfig, BondingV5)");
    console.log("4. ⏳ deployLaunchpadv5_4.ts (Revoke deployer roles)");

    console.log("\n--- Next Step ---");
    console.log("1. Add AGENT_FACTORY_V7_ADDRESS to your .env file");
    console.log(
      "2. Run: npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network <network>"
    );

    console.log("\n" + "=".repeat(80));
    console.log("  Step 2 Completed Successfully!");
    console.log("=".repeat(80));
  } catch (e) {
    console.error("❌ Deployment failed:", e);
    process.exit(1);
  }
})();
