/**
 * Shared V5 suite fixture: full BondingV5 / FRouterV3 / AgentFactoryV7 stack (matches deploy scripts).
 */
const { ethers, upgrades } = require("hardhat");

const {
  START_TIME_DELAY,
  INITIAL_SUPPLY,
  TBA_SALT,
  TBA_IMPLEMENTATION,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,
  BUY_TAX,
  SELL_TAX,
  ANTI_SNIPER_BUY_TAX_START_VALUE,
  FFactoryV2_ANTI_SNIPER_TAX_VAULT,
} = require("../launchpadv2/const.js");

const MAX_AIRDROP_BIPS = 500;
const MAX_TOTAL_RESERVED_BIPS = 5500;
const ACF_RESERVED_BIPS = 5000;
const NORMAL_LAUNCH_FEE = ethers.parseEther("100");
const ACF_FEE = ethers.parseEther("10");
const FAKE_INITIAL_VIRTUAL_LIQ = ethers.parseEther("6300");
const TARGET_REAL_VIRTUAL = ethers.parseEther("42000");

async function setupBondingV5Test() {
  const setup = {};

  console.log("\n=== BondingV5 Test Setup Starting (V5 Suite) ===");
  const [owner, admin, beOpsWallet, user1, user2] = await ethers.getSigners();
  console.log("Owner address:", await owner.getAddress());
  console.log("Admin address:", await admin.getAddress());
  console.log("BE Ops Wallet address:", await beOpsWallet.getAddress());

  try {
    // ============================================
    // Step 0: Deploy Virtual Token and Asset Token (test prerequisites)
    // ============================================
    console.log("\n--- Deploying MockERC20 for Virtual Token ---");
    const VirtualToken = await ethers.getContractFactory("MockERC20");
    const virtualToken = await VirtualToken.deploy(
      "Virtual Token",
      "VT",
      owner.address,
      ethers.parseEther("10000000000")
    );
    await virtualToken.waitForDeployment();
    console.log(
      "MockERC20 Virtual Token deployed at:",
      await virtualToken.getAddress()
    );

    console.log("\n--- Deploying MockERC20 for Asset Token (USDC) ---");
    const AssetToken = await ethers.getContractFactory("MockERC20");
    const assetToken = await AssetToken.deploy(
      "Mock USDC",
      "USDC",
      owner.address,
      ethers.parseEther("10000000000")
    );
    await assetToken.waitForDeployment();
    console.log(
      "MockERC20 Asset Token deployed at:",
      await assetToken.getAddress()
    );

    // ============================================
    // Step 1: Deploy FFactoryV3 and FRouterV3 (V5 Suite)
    // ============================================
    console.log("\n=== Step 1: Deploying FFactoryV3 and FRouterV3 (V5 Suite) ===");

    // 1.1 Deploy FFactoryV3 (taxVault will be set to AgentTaxV2 later)
    console.log("\n--- Deploying FFactoryV3 ---");
    const FFactoryV3 = await ethers.getContractFactory("FFactoryV3");
    const fFactoryV3 = await upgrades.deployProxy(
      FFactoryV3,
      [
        owner.address, // temporary taxVault, will be updated to AgentTaxV2
        BUY_TAX,
        SELL_TAX,
        ANTI_SNIPER_BUY_TAX_START_VALUE,
        FFactoryV2_ANTI_SNIPER_TAX_VAULT,
      ],
      { initializer: "initialize" }
    );
    await fFactoryV3.waitForDeployment();
    console.log("FFactoryV3 deployed at:", await fFactoryV3.getAddress());

    // 1.2 Deploy FRouterV3
    console.log("\n--- Deploying FRouterV3 ---");
    const FRouterV3 = await ethers.getContractFactory("FRouterV3");
    const fRouterV3 = await upgrades.deployProxy(
      FRouterV3,
      [await fFactoryV3.getAddress(), await virtualToken.getAddress()],
      { initializer: "initialize" }
    );
    await fRouterV3.waitForDeployment();
    console.log("FRouterV3 deployed at:", await fRouterV3.getAddress());

    // 1.3 Configure FFactoryV3
    console.log("\n--- Configuring FFactoryV3 ---");
    await fFactoryV3.grantRole(await fFactoryV3.ADMIN_ROLE(), owner.address);
    console.log("ADMIN_ROLE granted to owner (deployer) in FFactoryV3");

    await fFactoryV3.setRouter(await fRouterV3.getAddress());
    console.log("Router set in FFactoryV3");

    await fFactoryV3.grantRole(await fFactoryV3.ADMIN_ROLE(), admin.address);
    console.log("ADMIN_ROLE granted to admin in FFactoryV3");

    await fFactoryV3.grantRole(
      await fFactoryV3.DEFAULT_ADMIN_ROLE(),
      admin.address
    );
    console.log("DEFAULT_ADMIN_ROLE granted to admin in FFactoryV3");

    // 1.4 Configure FRouterV3
    console.log("\n--- Configuring FRouterV3 ---");
    await fRouterV3.grantRole(await fRouterV3.ADMIN_ROLE(), admin.address);
    console.log("ADMIN_ROLE granted to admin in FRouterV3");

    await fRouterV3.grantRole(
      await fRouterV3.DEFAULT_ADMIN_ROLE(),
      admin.address
    );
    console.log("DEFAULT_ADMIN_ROLE granted to admin in FRouterV3");

    await fRouterV3.grantRole(
      await fRouterV3.EXECUTOR_ROLE(),
      beOpsWallet.address
    );
    console.log("EXECUTOR_ROLE granted to BE_OPS_WALLET in FRouterV3");

    // ============================================
    // Step 2: Deploy AgentFactoryV7 and dependencies (V5 Suite)
    // ============================================
    console.log("\n=== Step 2: Deploying AgentFactoryV7 and dependencies (V5 Suite) ===");

    // 2.1 Deploy AgentTokenV3 implementation (V5 Suite uses AgentTokenV3)
    console.log("\n--- Deploying AgentTokenV3 implementation ---");
    const AgentTokenV3 = await ethers.getContractFactory("AgentTokenV3");
    const agentTokenV3 = await AgentTokenV3.deploy();
    await agentTokenV3.waitForDeployment();
    console.log(
      "AgentTokenV3 implementation deployed at:",
      await agentTokenV3.getAddress()
    );

    // 2.2 Deploy AgentVeTokenV2 implementation
    console.log("\n--- Deploying AgentVeTokenV2 implementation ---");
    const AgentVeTokenV2 = await ethers.getContractFactory("AgentVeTokenV2");
    const agentVeTokenV2 = await AgentVeTokenV2.deploy();
    await agentVeTokenV2.waitForDeployment();
    console.log(
      "AgentVeTokenV2 implementation deployed at:",
      await agentVeTokenV2.getAddress()
    );

    // 2.3 Deploy MockAgentDAO implementation
    console.log("\n--- Deploying MockAgentDAO implementation ---");
    const MockAgentDAO = await ethers.getContractFactory("MockAgentDAO");
    const mockAgentDAO = await MockAgentDAO.deploy();
    await mockAgentDAO.waitForDeployment();
    console.log(
      "MockAgentDAO implementation deployed at:",
      await mockAgentDAO.getAddress()
    );

    // 2.4 Deploy MockERC6551Registry
    console.log("\n--- Deploying MockERC6551Registry ---");
    const MockERC6551Registry = await ethers.getContractFactory(
      "MockERC6551Registry"
    );
    const mockERC6551Registry = await MockERC6551Registry.deploy();
    await mockERC6551Registry.waitForDeployment();
    console.log(
      "MockERC6551Registry deployed at:",
      await mockERC6551Registry.getAddress()
    );

    // 2.5 Deploy AgentNftV2
    console.log("\n--- Deploying AgentNftV2 ---");
    const AgentNftV2 = await ethers.getContractFactory("AgentNftV2");
    const agentNftV2 = await upgrades.deployProxy(AgentNftV2, [owner.address], {
      initializer: "initialize",
      unsafeAllow: ["internal-function-storage"],
    });
    await agentNftV2.waitForDeployment();
    console.log("AgentNftV2 deployed at:", await agentNftV2.getAddress());

    // 2.6 Deploy MockUniswapV2Factory and Router
    console.log("\n--- Deploying MockUniswapV2Factory ---");
    const MockUniswapV2Factory = await ethers.getContractFactory(
      "MockUniswapV2Factory"
    );
    const mockUniswapFactory = await MockUniswapV2Factory.deploy();
    await mockUniswapFactory.waitForDeployment();
    console.log(
      "MockUniswapV2Factory deployed at:",
      await mockUniswapFactory.getAddress()
    );

    console.log("\n--- Deploying MockUniswapV2Router02 ---");
    const MockUniswapV2Router02 = await ethers.getContractFactory(
      "MockUniswapV2Router02"
    );
    const mockUniswapRouter = await MockUniswapV2Router02.deploy(
      await mockUniswapFactory.getAddress(),
      await virtualToken.getAddress()
    );
    await mockUniswapRouter.waitForDeployment();
    console.log(
      "MockUniswapV2Router02 deployed at:",
      await mockUniswapRouter.getAddress()
    );

    // 2.7 Deploy AgentFactoryV7 (V5 Suite uses AgentFactoryV7)
    console.log("\n--- Deploying AgentFactoryV7 ---");
    const AgentFactoryV7 = await ethers.getContractFactory("AgentFactoryV7");
    const agentFactoryV7 = await upgrades.deployProxy(
      AgentFactoryV7,
      [
        await agentTokenV3.getAddress(),
        await agentVeTokenV2.getAddress(),
        await mockAgentDAO.getAddress(),
        await mockERC6551Registry.getAddress(),
        await virtualToken.getAddress(),
        await agentNftV2.getAddress(),
        owner.address, // vault
        1, // nextId
      ],
      { initializer: "initialize" }
    );
    await agentFactoryV7.waitForDeployment();
    console.log(
      "AgentFactoryV7 deployed at:",
      await agentFactoryV7.getAddress()
    );

    // 2.8 Configure AgentFactoryV7
    console.log("\n--- Configuring AgentFactoryV7 ---");
    await agentFactoryV7.setParams(
      10 * 365 * 24 * 60 * 60, // maturityDuration (10 years)
      await mockUniswapRouter.getAddress(),
      owner.address, // defaultDelegatee
      owner.address // tokenAdmin
    );
    console.log("setParams() called for AgentFactoryV7");

    await agentFactoryV7.setTokenParams(BUY_TAX, SELL_TAX, 1000, owner.address);
    console.log("setTokenParams() called for AgentFactoryV7");

    await agentFactoryV7.grantRole(
      await agentFactoryV7.DEFAULT_ADMIN_ROLE(),
      admin.address
    );
    console.log("DEFAULT_ADMIN_ROLE granted to admin in AgentFactoryV7");

    await agentFactoryV7.grantRole(
      await agentFactoryV7.REMOVE_LIQUIDITY_ROLE(),
      admin.address
    );
    console.log("REMOVE_LIQUIDITY_ROLE granted to admin in AgentFactoryV7");

    // 2.9 Configure AgentNftV2 roles
    console.log("\n--- Configuring AgentNftV2 roles ---");
    await agentNftV2.grantRole(
      await agentNftV2.MINTER_ROLE(),
      await agentFactoryV7.getAddress()
    );
    console.log("MINTER_ROLE granted to AgentFactoryV7 in AgentNftV2");

    await agentNftV2.grantRole(
      await agentNftV2.DEFAULT_ADMIN_ROLE(),
      admin.address
    );
    console.log("DEFAULT_ADMIN_ROLE granted to admin in AgentNftV2");

    // ============================================
    // Step 3: Deploy AgentTaxV2 for on-chain tax attribution (V5 Suite)
    // ============================================
    console.log("\n=== Step 3: Deploying AgentTaxV2 (V5 Suite) ===");

    const AgentTaxV2 = await ethers.getContractFactory("AgentTaxV2");
    const agentTaxV2 = await upgrades.deployProxy(
      AgentTaxV2,
      [
        owner.address,                            // defaultAdmin
        await assetToken.getAddress(),            // assetToken (USDC)
        await virtualToken.getAddress(),          // taxToken (VIRTUAL)
        await mockUniswapRouter.getAddress(),     // router
        owner.address,                            // treasury
        ethers.parseEther("100"),                 // minSwapThreshold
        ethers.parseEther("10000"),               // maxSwapThreshold
        3000,                                     // feeRate (30%)
      ],
      { initializer: "initialize" }
    );
    await agentTaxV2.waitForDeployment();
    console.log("AgentTaxV2 deployed at:", await agentTaxV2.getAddress());

    // Update FFactoryV3 taxVault to AgentTaxV2
    await fFactoryV3.setTaxParams(
      await agentTaxV2.getAddress(),
      BUY_TAX,
      SELL_TAX,
      ANTI_SNIPER_BUY_TAX_START_VALUE,
      FFactoryV2_ANTI_SNIPER_TAX_VAULT
    );
    console.log("FFactoryV3 taxVault updated to AgentTaxV2");

    // ============================================
    // Step 4: Deploy BondingConfig and BondingV5 (V5 Suite)
    // ============================================
    console.log("\n=== Step 4: Deploying BondingConfig and BondingV5 ===");

    // 4.1 Deploy BondingConfig
    console.log("\n--- Deploying BondingConfig ---");
    const BondingConfig = await ethers.getContractFactory("BondingConfig");

    const reserveSupplyParams = {
      maxAirdropBips: MAX_AIRDROP_BIPS,
      maxTotalReservedBips: MAX_TOTAL_RESERVED_BIPS,
      acfReservedBips: ACF_RESERVED_BIPS,
    };

    const scheduledLaunchParams = {
      startTimeDelay: START_TIME_DELAY,
      normalLaunchFee: NORMAL_LAUNCH_FEE,
      acfFee: ACF_FEE,
    };

    const deployParams = {
      tbaSalt: TBA_SALT,
      tbaImplementation: TBA_IMPLEMENTATION,
      daoVotingPeriod: DAO_VOTING_PERIOD,
      daoThreshold: DAO_THRESHOLD,
    };

    const bondingCurveParams = {
      fakeInitialVirtualLiq: FAKE_INITIAL_VIRTUAL_LIQ,
      targetRealVirtual: TARGET_REAL_VIRTUAL,
    };

    const bondingConfig = await upgrades.deployProxy(
      BondingConfig,
      [
        INITIAL_SUPPLY,
        owner.address, // feeTo
        beOpsWallet.address, // teamTokenReservedWallet
        reserveSupplyParams, // reserveSupplyParams
        scheduledLaunchParams,
        deployParams,
        bondingCurveParams,
      ],
      { initializer: "initialize" }
    );
    await bondingConfig.waitForDeployment();
    console.log("BondingConfig deployed at:", await bondingConfig.getAddress());

    // Backend allowlist: Project60days launch() + X/ACP preLaunch (tests use owner as default launcher)
    await bondingConfig.setPrivilegedLauncher(owner.address, true);
    console.log("setPrivilegedLauncher(true) for owner (test default backend)");

    // 4.2 Deploy BondingV5
    console.log("\n--- Deploying BondingV5 ---");
    const BondingV5 = await ethers.getContractFactory("BondingV5");
    const bondingV5 = await upgrades.deployProxy(
      BondingV5,
      [
        await fFactoryV3.getAddress(),
        await fRouterV3.getAddress(),
        await agentFactoryV7.getAddress(),
        await bondingConfig.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await bondingV5.waitForDeployment();
    console.log("BondingV5 deployed at:", await bondingV5.getAddress());

    // 4.3 Grant roles and configure contracts
    console.log("\n--- Granting roles to BondingV5 ---");

    // Grant CREATOR_ROLE of FFactoryV3 to BondingV5
    await fFactoryV3.grantRole(
      await fFactoryV3.CREATOR_ROLE(),
      await bondingV5.getAddress()
    );
    console.log("CREATOR_ROLE granted to BondingV5 in FFactoryV3");

    // Set BondingV5 and BondingConfig in FRouterV3
    await fRouterV3.grantRole(await fRouterV3.ADMIN_ROLE(), owner.address);
    await fRouterV3.setBondingV5(
      await bondingV5.getAddress(),
      await bondingConfig.getAddress()
    );
    console.log("setBondingV5() called in FRouterV3");

    // Grant EXECUTOR_ROLE of FRouterV3 to BondingV5
    await fRouterV3.grantRole(
      await fRouterV3.EXECUTOR_ROLE(),
      await bondingV5.getAddress()
    );
    console.log("EXECUTOR_ROLE granted to BondingV5 in FRouterV3");

    // Grant BONDING_ROLE of AgentFactoryV7 to BondingV5
    await agentFactoryV7.grantRole(
      await agentFactoryV7.BONDING_ROLE(),
      await bondingV5.getAddress()
    );
    console.log("BONDING_ROLE granted to BondingV5 in AgentFactoryV7");

    // Grant REGISTER_ROLE of AgentTaxV2 to BondingV5 (for token registration)
    await agentTaxV2.grantRole(
      await agentTaxV2.REGISTER_ROLE(),
      await bondingV5.getAddress()
    );
    console.log("REGISTER_ROLE granted to BondingV5 in AgentTaxV2");

    // Set BondingV5 in AgentTaxV2 (for special launch agent updates)
    await agentTaxV2.setBondingV5(await bondingV5.getAddress());
    console.log("setBondingV5() called in AgentTaxV2");

    // Grant SWAP_ROLE to beOpsWallet in AgentTaxV2
    await agentTaxV2.grantRole(
      await agentTaxV2.SWAP_ROLE(),
      beOpsWallet.address
    );
    console.log("SWAP_ROLE granted to beOpsWallet in AgentTaxV2");

    // Grant EXECUTOR_ROLE to beOpsWallet in AgentTaxV2
    await agentTaxV2.grantRole(
      await agentTaxV2.EXECUTOR_ROLE(),
      beOpsWallet.address
    );
    console.log("EXECUTOR_ROLE granted to beOpsWallet in AgentTaxV2");

    // Additional role for admin to call FRouterV3 directly in tests
    await fRouterV3.grantRole(await fRouterV3.EXECUTOR_ROLE(), admin.address);
    console.log("EXECUTOR_ROLE granted to admin in FRouterV3");

    await agentFactoryV7.grantRole(
      await agentFactoryV7.REMOVE_LIQUIDITY_ROLE(),
      await fRouterV3.getAddress()
    );
    console.log("REMOVE_LIQUIDITY_ROLE granted to FRouterV3 in AgentFactoryV7 (drainUniV2Pool)");

    // ============================================
    // Step 5: Mint Virtual Tokens to test addresses
    // ============================================
    console.log("\n--- Minting Virtual Tokens to test addresses ---");
    const mintAmount = ethers.parseEther("1000000000");

    const testAddresses = [
      owner.address,
      admin.address,
      beOpsWallet.address,
      user1.address,
      user2.address,
    ];

    for (const address of testAddresses) {
      await virtualToken.mint(address, mintAmount);
      const balance = await virtualToken.balanceOf(address);
      console.log(`Minted ${ethers.formatEther(balance)} VT to ${address}`);
    }

    // ============================================
    // Store all deployed contracts in setup object (V5 Suite)
    // ============================================
    setup.contracts = {
      virtualToken,
      assetToken,
      fFactoryV3,
      fRouterV3,
      mockUniswapFactory,
      mockUniswapRouter,
      agentToken: agentTokenV3,
      agentVeToken: agentVeTokenV2,
      mockAgentDAO,
      mockERC6551Registry,
      agentNftV2,
      agentFactoryV7,
      agentTaxV2,
      bondingConfig,
      bondingV5,
    };

    setup.accounts = { owner, admin, beOpsWallet, user1, user2 };

    setup.addresses = {
      virtualToken: await virtualToken.getAddress(),
      assetToken: await assetToken.getAddress(),
      fFactoryV3: await fFactoryV3.getAddress(),
      fRouterV3: await fRouterV3.getAddress(),
      mockUniswapFactory: await mockUniswapFactory.getAddress(),
      mockUniswapRouter: await mockUniswapRouter.getAddress(),
      agentToken: await agentTokenV3.getAddress(),
      agentVeToken: await agentVeTokenV2.getAddress(),
      mockAgentDAO: await mockAgentDAO.getAddress(),
      mockERC6551Registry: await mockERC6551Registry.getAddress(),
      agentNftV2: await agentNftV2.getAddress(),
      agentFactoryV7: await agentFactoryV7.getAddress(),
      agentTaxV2: await agentTaxV2.getAddress(),
      bondingConfig: await bondingConfig.getAddress(),
      bondingV5: await bondingV5.getAddress(),
      taxVault: await fFactoryV3.taxVault(),
      antiSniperTaxVault: await fFactoryV3.antiSniperTaxVault(),
    };

    setup.params = {
      startTimeDelay: START_TIME_DELAY,
      daoVotingPeriod: DAO_VOTING_PERIOD,
      daoThreshold: DAO_THRESHOLD,
      tbaSalt: TBA_SALT,
      tbaImplementation: TBA_IMPLEMENTATION,
      initialSupply: INITIAL_SUPPLY,
      buyTax: BUY_TAX,
      sellTax: SELL_TAX,
      fakeInitialVirtualLiq: FAKE_INITIAL_VIRTUAL_LIQ,
      targetRealVirtual: TARGET_REAL_VIRTUAL,
    };

    console.log("\n=== BondingV5 Test Setup Completed Successfully (V5 Suite) ===");
    console.log("All contracts deployed and configured:");
    console.log("- Virtual Token:", setup.addresses.virtualToken);
    console.log("- Asset Token (USDC):", setup.addresses.assetToken);
    console.log("- FFactoryV3:", setup.addresses.fFactoryV3);
    console.log("- FRouterV3:", setup.addresses.fRouterV3);
    console.log("- AgentFactoryV7:", setup.addresses.agentFactoryV7);
    console.log("- AgentTaxV2:", setup.addresses.agentTaxV2);
    console.log("- BondingConfig:", setup.addresses.bondingConfig);
    console.log("- BondingV5:", setup.addresses.bondingV5);

    return setup;
  } catch (error) {
    console.error("Error during setup:", error);
    throw error;
  }
}

module.exports = { setupBondingV5Test };
