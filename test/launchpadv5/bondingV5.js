const { expect } = require("chai");
const { ethers, upgrades, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const {
  expectTokenBalanceEqual,
  expectApproximatelyEqual,
  increaseTimeByMinutes,
  increaseTimeAndMine,
  increaseTimeByDays,
} = require("../launchpadv2/util.js");

const {
  ERR_INVALID_TOKEN_STATUS,
  ERR_INVALID_INPUT,
  ERR_SLIPPAGE_TOO_HIGH,
  ERR_ZERO_ADDRESSES,
  ERR_AMOUNT_MUST_BE_GREATER_THAN_ZERO,
  START_TIME_DELAY,
  INITIAL_SUPPLY,
  ERR_INVALID_START_TIME,
  TBA_SALT,
  TBA_IMPLEMENTATION,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,
  BUY_TAX,
  SELL_TAX,
  ANTI_SNIPER_BUY_TAX_START_VALUE,
  FFactoryV2_TAX_VAULT,
  FFactoryV2_ANTI_SNIPER_TAX_VAULT,
} = require("../launchpadv2/const.js");

// BondingV5 launch mode constants (only 3 modes now)
const LAUNCH_MODE_NORMAL = 0;
const LAUNCH_MODE_X_LAUNCH = 1;
const LAUNCH_MODE_ACP_SKILL = 2;

// Reserve supply parameters (in bips, 1 bip = 0.01%, e.g., 500 = 5.00%)
const MAX_AIRDROP_BIPS = 500;
const MAX_TOTAL_RESERVED_BIPS = 5500; // At least 45% must remain in bonding curve
const ACF_RESERVED_BIPS = 5000; // ACF operations reserve 50%

// Anti-sniper tax type constants
const ANTI_SNIPER_NONE = 0;
const ANTI_SNIPER_60S = 1;
const ANTI_SNIPER_98M = 2;

// Fee structure
const NORMAL_LAUNCH_FEE = ethers.parseEther("100"); // Fee for scheduled/marketing launches
const ACF_FEE = ethers.parseEther("10"); // Extra fee when needAcf = true (10 on base, 150 on eth)

// Bonding curve params
const FAKE_INITIAL_VIRTUAL_LIQ = ethers.parseEther("6300");
const TARGET_REAL_VIRTUAL = ethers.parseEther("42000");

/**
 * Setup function for BondingV5 tests
 * Deploys all necessary contracts following the same order as deployment scripts:
 * - Step 1: FFactoryV2 and FRouterV2 (like deployLaunchpadv5_1.ts)
 * - Step 2: AgentFactoryV6 and dependencies (like deployLaunchpadv5_2.ts)
 * - Step 3: BondingConfig and BondingV5, then grant roles (like deployLaunchpadv5_3.ts)
 */
async function setupBondingV5Test() {
  const setup = {};

  console.log("\n=== BondingV5 Test Setup Starting ===");
  const [owner, admin, beOpsWallet, user1, user2] = await ethers.getSigners();
  console.log("Owner address:", await owner.getAddress());
  console.log("Admin address:", await admin.getAddress());
  console.log("BE Ops Wallet address:", await beOpsWallet.getAddress());

  try {
    // ============================================
    // Step 0: Deploy Virtual Token (test prerequisite)
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
    console.log("MockERC20 Virtual Token deployed at:", await virtualToken.getAddress());

    // ============================================
    // Step 1: Deploy FFactoryV2 and FRouterV2 (like deployLaunchpadv5_1.ts)
    // ============================================
    console.log("\n=== Step 1: Deploying FFactoryV2 and FRouterV2 ===");

    // 1.1 Deploy FFactoryV2
    console.log("\n--- Deploying FFactoryV2 ---");
    const FFactoryV2 = await ethers.getContractFactory("FFactoryV2");
    const fFactoryV2 = await upgrades.deployProxy(
      FFactoryV2,
      [FFactoryV2_TAX_VAULT, BUY_TAX, SELL_TAX, ANTI_SNIPER_BUY_TAX_START_VALUE, FFactoryV2_ANTI_SNIPER_TAX_VAULT],
      { initializer: "initialize" }
    );
    await fFactoryV2.waitForDeployment();
    console.log("FFactoryV2 deployed at:", await fFactoryV2.getAddress());

    // 1.2 Deploy FRouterV2
    console.log("\n--- Deploying FRouterV2 ---");
    const FRouterV2 = await ethers.getContractFactory("FRouterV2");
    const fRouterV2 = await upgrades.deployProxy(
      FRouterV2,
      [await fFactoryV2.getAddress(), await virtualToken.getAddress()],
      { initializer: "initialize" }
    );
    await fRouterV2.waitForDeployment();
    console.log("FRouterV2 deployed at:", await fRouterV2.getAddress());

    // 1.3 Configure FFactoryV2
    console.log("\n--- Configuring FFactoryV2 ---");
    await fFactoryV2.grantRole(await fFactoryV2.ADMIN_ROLE(), owner.address);
    console.log("ADMIN_ROLE granted to owner (deployer) in FFactoryV2");
    
    await fFactoryV2.setRouter(await fRouterV2.getAddress());
    console.log("Router set in FFactoryV2");

    await fFactoryV2.grantRole(await fFactoryV2.ADMIN_ROLE(), admin.address);
    console.log("ADMIN_ROLE granted to admin in FFactoryV2");

    await fFactoryV2.grantRole(await fFactoryV2.DEFAULT_ADMIN_ROLE(), admin.address);
    console.log("DEFAULT_ADMIN_ROLE granted to admin in FFactoryV2");

    // 1.4 Configure FRouterV2
    console.log("\n--- Configuring FRouterV2 ---");
    await fRouterV2.grantRole(await fRouterV2.ADMIN_ROLE(), admin.address);
    console.log("ADMIN_ROLE granted to admin in FRouterV2");

    await fRouterV2.grantRole(await fRouterV2.DEFAULT_ADMIN_ROLE(), admin.address);
    console.log("DEFAULT_ADMIN_ROLE granted to admin in FRouterV2");

    await fRouterV2.grantRole(await fRouterV2.EXECUTOR_ROLE(), beOpsWallet.address);
    console.log("EXECUTOR_ROLE granted to BE_OPS_WALLET in FRouterV2");

    // ============================================
    // Step 2: Deploy AgentFactoryV6 and dependencies (like deployLaunchpadv5_2.ts)
    // ============================================
    console.log("\n=== Step 2: Deploying AgentFactoryV6 and dependencies ===");

    // 2.1 Deploy AgentTokenV2 implementation
    console.log("\n--- Deploying AgentTokenV2 implementation ---");
    const AgentTokenV2 = await ethers.getContractFactory("AgentTokenV2");
    const agentTokenV2 = await AgentTokenV2.deploy();
    await agentTokenV2.waitForDeployment();
    console.log("AgentTokenV2 implementation deployed at:", await agentTokenV2.getAddress());

    // 2.2 Deploy AgentVeTokenV2 implementation
    console.log("\n--- Deploying AgentVeTokenV2 implementation ---");
    const AgentVeTokenV2 = await ethers.getContractFactory("AgentVeTokenV2");
    const agentVeTokenV2 = await AgentVeTokenV2.deploy();
    await agentVeTokenV2.waitForDeployment();
    console.log("AgentVeTokenV2 implementation deployed at:", await agentVeTokenV2.getAddress());

    // 2.3 Deploy MockAgentDAO implementation
    console.log("\n--- Deploying MockAgentDAO implementation ---");
    const MockAgentDAO = await ethers.getContractFactory("MockAgentDAO");
    const mockAgentDAO = await MockAgentDAO.deploy();
    await mockAgentDAO.waitForDeployment();
    console.log("MockAgentDAO implementation deployed at:", await mockAgentDAO.getAddress());

    // 2.4 Deploy MockERC6551Registry
    console.log("\n--- Deploying MockERC6551Registry ---");
    const MockERC6551Registry = await ethers.getContractFactory("MockERC6551Registry");
    const mockERC6551Registry = await MockERC6551Registry.deploy();
    await mockERC6551Registry.waitForDeployment();
    console.log("MockERC6551Registry deployed at:", await mockERC6551Registry.getAddress());

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
    const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    const mockUniswapFactory = await MockUniswapV2Factory.deploy();
    await mockUniswapFactory.waitForDeployment();
    console.log("MockUniswapV2Factory deployed at:", await mockUniswapFactory.getAddress());

    console.log("\n--- Deploying MockUniswapV2Router02 ---");
    const MockUniswapV2Router02 = await ethers.getContractFactory("MockUniswapV2Router02");
    const mockUniswapRouter = await MockUniswapV2Router02.deploy(
      await mockUniswapFactory.getAddress(),
      await virtualToken.getAddress()
    );
    await mockUniswapRouter.waitForDeployment();
    console.log("MockUniswapV2Router02 deployed at:", await mockUniswapRouter.getAddress());

    // 2.7 Deploy AgentFactoryV6
    console.log("\n--- Deploying AgentFactoryV6 ---");
    const AgentFactoryV6 = await ethers.getContractFactory("AgentFactoryV6");
    const agentFactoryV6 = await upgrades.deployProxy(
      AgentFactoryV6,
      [
        await agentTokenV2.getAddress(),
        await agentVeTokenV2.getAddress(),
        await mockAgentDAO.getAddress(),
        await mockERC6551Registry.getAddress(),
        await virtualToken.getAddress(),
        await agentNftV2.getAddress(),
        owner.address,  // vault
        1,              // nextId
      ],
      { initializer: "initialize" }
    );
    await agentFactoryV6.waitForDeployment();
    console.log("AgentFactoryV6 deployed at:", await agentFactoryV6.getAddress());

    // 2.8 Configure AgentFactoryV6
    console.log("\n--- Configuring AgentFactoryV6 ---");
    await agentFactoryV6.setParams(
      10 * 365 * 24 * 60 * 60,  // maturityDuration (10 years)
      await mockUniswapRouter.getAddress(),
      owner.address,  // defaultDelegatee
      owner.address   // tokenAdmin
    );
    console.log("setParams() called for AgentFactoryV6");

    await agentFactoryV6.setTokenParams(BUY_TAX, SELL_TAX, 1000, owner.address);
    console.log("setTokenParams() called for AgentFactoryV6");

    await agentFactoryV6.grantRole(await agentFactoryV6.DEFAULT_ADMIN_ROLE(), admin.address);
    console.log("DEFAULT_ADMIN_ROLE granted to admin in AgentFactoryV6");

    await agentFactoryV6.grantRole(await agentFactoryV6.REMOVE_LIQUIDITY_ROLE(), admin.address);
    console.log("REMOVE_LIQUIDITY_ROLE granted to admin in AgentFactoryV6");

    // 2.9 Configure AgentNftV2 roles
    console.log("\n--- Configuring AgentNftV2 roles ---");
    await agentNftV2.grantRole(await agentNftV2.MINTER_ROLE(), await agentFactoryV6.getAddress());
    console.log("MINTER_ROLE granted to AgentFactoryV6 in AgentNftV2");

    await agentNftV2.grantRole(await agentNftV2.DEFAULT_ADMIN_ROLE(), admin.address);
    console.log("DEFAULT_ADMIN_ROLE granted to admin in AgentNftV2");

    // ============================================
    // Step 3: Deploy BondingConfig and BondingV5 (like deployLaunchpadv5_3.ts)
    // ============================================
    console.log("\n=== Step 3: Deploying BondingConfig and BondingV5 ===");

    // 3.1 Deploy BondingConfig
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
        owner.address,              // feeTo
        beOpsWallet.address,        // teamTokenReservedWallet
        reserveSupplyParams,        // reserveSupplyParams
        scheduledLaunchParams,
        deployParams,
        bondingCurveParams,
      ],
      { initializer: "initialize" }
    );
    await bondingConfig.waitForDeployment();
    console.log("BondingConfig deployed at:", await bondingConfig.getAddress());

    // 3.2 Deploy BondingV5
    console.log("\n--- Deploying BondingV5 ---");
    const BondingV5 = await ethers.getContractFactory("BondingV5");
    const bondingV5 = await upgrades.deployProxy(
      BondingV5,
      [
        await fFactoryV2.getAddress(),
        await fRouterV2.getAddress(),
        await agentFactoryV6.getAddress(),
        await bondingConfig.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await bondingV5.waitForDeployment();
    console.log("BondingV5 deployed at:", await bondingV5.getAddress());

    // 3.3 Grant roles and configure contracts (using owner as deployer has all roles in tests)
    console.log("\n--- Granting roles to BondingV5 ---");

    // Grant CREATOR_ROLE of FFactoryV2 to BondingV5
    await fFactoryV2.grantRole(await fFactoryV2.CREATOR_ROLE(), await bondingV5.getAddress());
    console.log("CREATOR_ROLE granted to BondingV5 in FFactoryV2");

    // Set BondingV5 and BondingConfig in FRouterV2 (CRITICAL - was missing before)
    await fRouterV2.grantRole(await fRouterV2.ADMIN_ROLE(), owner.address);
    await fRouterV2.setBondingV5(await bondingV5.getAddress(), await bondingConfig.getAddress());
    console.log("setBondingV5() called in FRouterV2");

    // Grant EXECUTOR_ROLE of FRouterV2 to BondingV5
    await fRouterV2.grantRole(await fRouterV2.EXECUTOR_ROLE(), await bondingV5.getAddress());
    console.log("EXECUTOR_ROLE granted to BondingV5 in FRouterV2");

    // Grant BONDING_ROLE of AgentFactoryV6 to BondingV5
    await agentFactoryV6.grantRole(await agentFactoryV6.BONDING_ROLE(), await bondingV5.getAddress());
    console.log("BONDING_ROLE granted to BondingV5 in AgentFactoryV6");

    // Additional role for admin to call FRouterV2 directly in tests
    await fRouterV2.grantRole(await fRouterV2.EXECUTOR_ROLE(), admin.address);
    console.log("EXECUTOR_ROLE granted to admin in FRouterV2");

    // ============================================
    // Step 4: Mint Virtual Tokens to test addresses
    // ============================================
    console.log("\n--- Minting Virtual Tokens to test addresses ---");
    const mintAmount = ethers.parseEther("1000000000");

    const testAddresses = [owner.address, admin.address, beOpsWallet.address, user1.address, user2.address];

    for (const address of testAddresses) {
      await virtualToken.mint(address, mintAmount);
      const balance = await virtualToken.balanceOf(address);
      console.log(`Minted ${ethers.formatEther(balance)} VT to ${address}`);
    }

    // ============================================
    // Store all deployed contracts in setup object
    // ============================================
    setup.contracts = {
      virtualToken,
      fFactoryV2,
      fRouterV2,
      mockUniswapFactory,
      mockUniswapRouter,
      agentToken: agentTokenV2,
      agentVeToken: agentVeTokenV2,
      mockAgentDAO,
      mockERC6551Registry,
      agentNftV2,
      agentFactoryV6,
      bondingConfig,
      bondingV5,
    };

    setup.accounts = { owner, admin, beOpsWallet, user1, user2 };

    setup.addresses = {
      virtualToken: await virtualToken.getAddress(),
      fFactoryV2: await fFactoryV2.getAddress(),
      fRouterV2: await fRouterV2.getAddress(),
      mockUniswapFactory: await mockUniswapFactory.getAddress(),
      mockUniswapRouter: await mockUniswapRouter.getAddress(),
      agentToken: await agentTokenV2.getAddress(),
      agentVeToken: await agentVeTokenV2.getAddress(),
      mockAgentDAO: await mockAgentDAO.getAddress(),
      mockERC6551Registry: await mockERC6551Registry.getAddress(),
      agentNftV2: await agentNftV2.getAddress(),
      agentFactoryV6: await agentFactoryV6.getAddress(),
      bondingConfig: await bondingConfig.getAddress(),
      bondingV5: await bondingV5.getAddress(),
      taxVault: await fFactoryV2.taxVault(),
      antiSniperTaxVault: await fFactoryV2.antiSniperTaxVault(),
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

    console.log("\n=== BondingV5 Test Setup Completed Successfully ===");
    console.log("All contracts deployed and configured:");
    console.log("- Virtual Token:", setup.addresses.virtualToken);
    console.log("- FFactoryV2:", setup.addresses.fFactoryV2);
    console.log("- FRouterV2:", setup.addresses.fRouterV2);
    console.log("- AgentFactoryV6:", setup.addresses.agentFactoryV6);
    console.log("- BondingConfig:", setup.addresses.bondingConfig);
    console.log("- BondingV5:", setup.addresses.bondingV5);

    return setup;
  } catch (error) {
    console.error("Error during setup:", error);
    throw error;
  }
}

describe("BondingV5", function () {
  let setup;
  let contracts, accounts, addresses, params;

  before(async function () {
    setup = await loadFixture(setupBondingV5Test);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;
    params = setup.params;
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial parameters", async function () {
      const { owner } = accounts;
      const { bondingV5, bondingConfig } = contracts;

      expect(await bondingV5.owner()).to.equal(owner.address);
      expect(await bondingV5.agentFactory()).to.equal(addresses.agentFactoryV6);
      expect(await bondingV5.bondingConfig()).to.equal(addresses.bondingConfig);
      
      // Check bondingConfig params
      expect(await bondingConfig.initialSupply()).to.equal(params.initialSupply);
      expect(await bondingConfig.feeTo()).to.equal(owner.address);
    });

    it("Should have correct roles granted", async function () {
      const { bondingV5, fRouterV2, agentFactoryV6, fFactoryV2 } = contracts;

      expect(
        await fRouterV2.hasRole(await fRouterV2.EXECUTOR_ROLE(), addresses.bondingV5)
      ).to.be.true;

      expect(
        await agentFactoryV6.hasRole(await agentFactoryV6.BONDING_ROLE(), addresses.bondingV5)
      ).to.be.true;

      expect(
        await fFactoryV2.hasRole(await fFactoryV2.CREATOR_ROLE(), addresses.bondingV5)
      ).to.be.true;
    });

    it("Should have correct bonding curve params configured", async function () {
      const { bondingConfig } = contracts;

      const bcParams = await bondingConfig.bondingCurveParams();
      expect(bcParams.fakeInitialVirtualLiq).to.equal(FAKE_INITIAL_VIRTUAL_LIQ);
      expect(bcParams.targetRealVirtual).to.equal(TARGET_REAL_VIRTUAL);
    });
  });

  // ============================================
  // LAUNCH_MODE_NORMAL Tests
  // ============================================
  describe("LAUNCH_MODE_NORMAL - preLaunch", function () {
    it("Should create a new token and application successfully", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const tokenName = "Test Token Normal";
      const tokenTicker = "TESTN";
      const cores = [0, 1, 2];
      const description = "Test token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,     // launchMode_
          0,                      // airdropBips_
          false,                  // needAcf_
          ANTI_SNIPER_60S,        // antiSniperTaxType_
          false                   // isProject60days_
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;
      const pairAddress = parsedEvent.args.pair;

      expect(tokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(pairAddress).to.not.equal(ethers.ZeroAddress);

      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
      expect(tokenInfo.trading).to.be.true;
      expect(tokenInfo.tradingOnUniswap).to.be.false;

      // Verify tokenLaunchParams is stored correctly
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(0);
      expect(launchParams.needAcf).to.be.false;
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_60S);
      expect(launchParams.isProject60days).to.be.false;
    });

    it("Should fail with insufficient purchase amount", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      const purchaseAmount = ethers.parseEther("50"); // Less than fee
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Test Token",
          "TEST",
          [0, 1, 2],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, ERR_INVALID_INPUT);
    });

    it("Should fail with empty cores array", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Test Token",
          "TEST",
          [], // Empty cores
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, ERR_INVALID_INPUT);
    });

    it("Should create token with isProject60days flag", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Project60days Token",
          "P60",
          [0, 1, 2],
          "Project60days test token",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          true  // isProject60days_ = true
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isProject60days returns true
      const isProject60days = await bondingV5.isProject60days(tokenAddress);
      expect(isProject60days).to.be.true;
    });
  });

  describe("LAUNCH_MODE_NORMAL - launch", function () {
    let tokenAddress;
    let pairAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Test Launch Token",
          "TLT",
          [0, 1, 2],
          "Test token description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;
      pairAddress = parsedEvent.args.pair;
    });

    it("Should launch token successfully", async function () {
      const { bondingV5 } = contracts;

      await time.increase(START_TIME_DELAY + 1);

      const tx = await bondingV5.launch(tokenAddress);
      const receipt = await tx.wait();

      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV5.interface.parseLog(event);
      expect(parsedEvent.args.token).to.equal(tokenAddress);
      expect(parsedEvent.args.pair).to.equal(pairAddress);
    });

    it("Should fail to launch if start time has not passed", async function () {
      const { bondingV5 } = contracts;

      await expect(bondingV5.launch(tokenAddress)).to.be.revertedWithCustomError(
        bondingV5,
        "InvalidInput"
      );
    });
  });

  describe("LAUNCH_MODE_NORMAL - buy", function () {
    let tokenAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Test Buy Token",
          "TBT",
          [0, 1, 2],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;

      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);
    });

    it("Should allow buying tokens and bypass anti-sniper tax after 99 minutes", async function () {
      const { user2 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      await increaseTimeByMinutes(99);

      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);

      const tx = await bondingV5.connect(user2).buy(
        buyAmount,
        tokenAddress,
        0,
        (await time.latest()) + 300
      );

      expect(tx).to.not.be.undefined;

      const actualTokenContract = await ethers.getContractAt("AgentTokenV2", tokenAddress);
      const user2AgentTokenBalance = await actualTokenContract.balanceOf(user2.address);
      expect(user2AgentTokenBalance).to.be.greaterThan(0);
    });
  });

  describe("LAUNCH_MODE_NORMAL - sell", function () {
    let tokenAddress;

    beforeEach(async function () {
      const { user1, user2 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Test Sell Token",
          "TST",
          [0, 1, 2],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;

      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);

      // Buy tokens first
      await increaseTimeByMinutes(99);
      const buyAmount = ethers.parseEther("1000");
      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);
      await bondingV5.connect(user2).buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);
    });

    it("Should allow selling tokens", async function () {
      const { user2 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const actualTokenContract = await ethers.getContractAt("AgentTokenV2", tokenAddress);
      const user2AgentTokenBalance = await actualTokenContract.balanceOf(user2.address);

      const sellAmount = user2AgentTokenBalance / 2n;
      await actualTokenContract.connect(user2).approve(addresses.fRouterV2, sellAmount);

      const virtualBalanceBefore = await virtualToken.balanceOf(user2.address);

      const tx = await bondingV5.connect(user2).sell(
        sellAmount,
        tokenAddress,
        0,
        (await time.latest()) + 300
      );

      expect(tx).to.not.be.undefined;

      const virtualBalanceAfter = await virtualToken.balanceOf(user2.address);
      expect(virtualBalanceAfter).to.be.greaterThan(virtualBalanceBefore);
    });
  });

  // ============================================
  // LAUNCH_MODE_X_LAUNCH (Special Mode) Tests
  // ============================================
  describe("LAUNCH_MODE_X_LAUNCH (Special Mode)", function () {
    before(async function () {
      const { bondingConfig } = contracts;
      const { owner, user1 } = accounts;

      // Authorize user1 as XLauncher for X_LAUNCH mode
      await bondingConfig.connect(owner).setXLauncher(user1.address, true);
      console.log("user1 authorized as XLauncher for LAUNCH_MODE_X_LAUNCH");
    });

    it("Should create a token with isProjectXLaunch returning true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      // Special modes require immediate launch (startTime within 24h)
      const startTime = (await time.latest()) + 100;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "ProjectXLaunch Token",
          "PXL",
          [0, 1, 2],
          "ProjectXLaunch test token",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_X_LAUNCH,
          0,                      // airdropBips must be 0 for special modes
          false,                  // needAcf must be false for special modes
          ANTI_SNIPER_NONE,       // antiSniperTaxType must be NONE for special modes
          false                   // isProject60days must be false for special modes
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isProjectXLaunch returns true
      const isProjectXLaunch = await bondingV5.isProjectXLaunch(tokenAddress);
      expect(isProjectXLaunch).to.be.true;

      // Verify tokenLaunchParams
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_X_LAUNCH);
    });

    it("Should revert if non-authorized launcher tries to launch X_LAUNCH mode", async function () {
      const { user2 } = accounts;
      const { bondingV5, virtualToken, bondingConfig } = contracts;
      const { owner } = accounts;

      // Ensure user2 is NOT authorized
      await bondingConfig.connect(owner).setXLauncher(user2.address, false);

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken.connect(user2).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user2).preLaunch(
          "Unauthorized X_LAUNCH",
          "UXL",
          [0, 1, 2],
          "Test unauthorized",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_X_LAUNCH,
          0,
          false,
          ANTI_SNIPER_NONE,
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, "UnauthorizedLauncher");
    });

    it("Should revert if X_LAUNCH mode uses invalid params", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      // Should revert with non-zero airdropBips (special modes require 0)
      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid X Launch",
          "INV",
          [0, 1, 2],
          "Test invalid",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_X_LAUNCH,
          500,                    // airdropBips = 500 (5.00%, within maxAirdropBips but special modes require 0)
          false,
          ANTI_SNIPER_NONE,
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });
  });

  // ============================================
  // LAUNCH_MODE_ACP_SKILL (Special Mode) Tests
  // ============================================
  describe("LAUNCH_MODE_ACP_SKILL (Special Mode)", function () {
    before(async function () {
      const { bondingConfig } = contracts;
      const { owner, user1 } = accounts;

      // Authorize user1 as AcpSkillLauncher for ACP_SKILL mode
      await bondingConfig.connect(owner).setAcpSkillLauncher(user1.address, true);
      console.log("user1 authorized as AcpSkillLauncher for LAUNCH_MODE_ACP_SKILL");
    });

    it("Should create a token with isAcpSkillLaunch returning true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "AcpSkillLaunch Token",
          "ACPS",
          [0, 1, 2],
          "AcpSkillLaunch test token",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_ACP_SKILL,
          0,
          false,
          ANTI_SNIPER_NONE,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isAcpSkillLaunch returns true
      const isAcpSkillLaunch = await bondingV5.isAcpSkillLaunch(tokenAddress);
      expect(isAcpSkillLaunch).to.be.true;

      // Verify tokenLaunchParams
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_ACP_SKILL);
    });

    it("Should revert if non-authorized launcher tries to launch ACP_SKILL mode", async function () {
      const { user2 } = accounts;
      const { bondingV5, virtualToken, bondingConfig } = contracts;
      const { owner } = accounts;

      // Ensure user2 is NOT authorized
      await bondingConfig.connect(owner).setAcpSkillLauncher(user2.address, false);

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken.connect(user2).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user2).preLaunch(
          "Unauthorized ACP_SKILL",
          "UACP",
          [0, 1, 2],
          "Test unauthorized",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_ACP_SKILL,
          0,
          false,
          ANTI_SNIPER_NONE,
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, "UnauthorizedLauncher");
    });
  });

  // ============================================
  // BondingConfig Admin Tests
  // ============================================
  describe("BondingConfig Admin Functions", function () {
    it("Should allow owner to update scheduled launch params", async function () {
      const { owner } = accounts;
      const { bondingConfig } = contracts;

      const newParams = {
        startTimeDelay: START_TIME_DELAY * 2,
        normalLaunchFee: ethers.parseEther("200"),
        acfFee: ethers.parseEther("50"),
      };

      await bondingConfig.connect(owner).setScheduledLaunchParams(newParams);

      const params = await bondingConfig.scheduledLaunchParams();
      expect(params.normalLaunchFee).to.equal(newParams.normalLaunchFee);
      expect(params.acfFee).to.equal(newParams.acfFee);

      // Reset to original
      await bondingConfig.connect(owner).setScheduledLaunchParams({
        startTimeDelay: START_TIME_DELAY,
        normalLaunchFee: NORMAL_LAUNCH_FEE,
        acfFee: ACF_FEE,
      });
    });

    it("Should allow owner to update bonding curve params", async function () {
      const { owner } = accounts;
      const { bondingConfig } = contracts;

      const newParams = {
        fakeInitialVirtualLiq: ethers.parseEther("7000"),
        targetRealVirtual: ethers.parseEther("50000"),
      };

      await bondingConfig.connect(owner).setBondingCurveParams(newParams);

      const params = await bondingConfig.bondingCurveParams();
      expect(params.fakeInitialVirtualLiq).to.equal(newParams.fakeInitialVirtualLiq);
      expect(params.targetRealVirtual).to.equal(newParams.targetRealVirtual);

      // Reset to original
      await bondingConfig.connect(owner).setBondingCurveParams({
        fakeInitialVirtualLiq: FAKE_INITIAL_VIRTUAL_LIQ,
        targetRealVirtual: TARGET_REAL_VIRTUAL,
      });
    });

    it("Should revert if non-owner tries to update params", async function () {
      const { user1 } = accounts;
      const { bondingConfig } = contracts;

      const newParams = {
        startTimeDelay: START_TIME_DELAY * 2,
        normalLaunchFee: ethers.parseEther("200"),
        acfFee: ethers.parseEther("50"),
      };

      await expect(
        bondingConfig.connect(user1).setScheduledLaunchParams(newParams)
      ).to.be.revertedWithCustomError(bondingConfig, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to set and revoke XLauncher", async function () {
      const { owner, user2 } = accounts;
      const { bondingConfig } = contracts;

      // Initially user2 should not be authorized
      expect(await bondingConfig.isXLauncher(user2.address)).to.be.false;

      // Authorize user2
      await bondingConfig.connect(owner).setXLauncher(user2.address, true);
      expect(await bondingConfig.isXLauncher(user2.address)).to.be.true;

      // Revoke authorization
      await bondingConfig.connect(owner).setXLauncher(user2.address, false);
      expect(await bondingConfig.isXLauncher(user2.address)).to.be.false;
    });

    it("Should allow owner to set and revoke AcpSkillLauncher", async function () {
      const { owner, user2 } = accounts;
      const { bondingConfig } = contracts;

      // Initially user2 should not be authorized
      expect(await bondingConfig.isAcpSkillLauncher(user2.address)).to.be.false;

      // Authorize user2
      await bondingConfig.connect(owner).setAcpSkillLauncher(user2.address, true);
      expect(await bondingConfig.isAcpSkillLauncher(user2.address)).to.be.true;

      // Revoke authorization
      await bondingConfig.connect(owner).setAcpSkillLauncher(user2.address, false);
      expect(await bondingConfig.isAcpSkillLauncher(user2.address)).to.be.false;
    });
  });

  // ============================================
  // Anti-Sniper Tax Type Tests
  // ============================================
  describe("Anti-Sniper Tax Types", function () {
    it("Should validate anti-sniper tax types correctly", async function () {
      const { bondingConfig } = contracts;

      expect(await bondingConfig.isValidAntiSniperType(ANTI_SNIPER_NONE)).to.be.true;
      expect(await bondingConfig.isValidAntiSniperType(ANTI_SNIPER_60S)).to.be.true;
      expect(await bondingConfig.isValidAntiSniperType(ANTI_SNIPER_98M)).to.be.true;
      expect(await bondingConfig.isValidAntiSniperType(3)).to.be.false;
    });

    it("Should return correct durations for anti-sniper types", async function () {
      const { bondingConfig } = contracts;

      expect(await bondingConfig.getAntiSniperDuration(ANTI_SNIPER_NONE)).to.equal(0);
      expect(await bondingConfig.getAntiSniperDuration(ANTI_SNIPER_60S)).to.equal(60);
      expect(await bondingConfig.getAntiSniperDuration(ANTI_SNIPER_98M)).to.equal(98 * 60);
    });

    it("Should revert preLaunch with invalid anti-sniper type", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid Anti Sniper",
          "IAS",
          [0, 1, 2],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          5,  // Invalid anti-sniper type
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidAntiSniperType");
    });
  });

  // ============================================
  // Comprehensive Permutation Tests for New Configurable Options
  // ============================================
  describe("Configurable Options Permutations", function () {
    
    describe("airdropBips Variations", function () {
      it("Should create token with 0% airdrop", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "Zero Airdrop Token", "ZAT", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.airdropBips).to.equal(0);
      });

      it("Should create token with max airdrop (5%)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "Max Airdrop Token", "T5", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 500, false, ANTI_SNIPER_60S, false  // MAX_AIRDROP_BIPS = 500 (5.00%)
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.airdropBips).to.equal(500);
      });

      it("Should create token with 3% airdrop", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "3% Airdrop Token", "T3", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 300, false, ANTI_SNIPER_60S, false  // 300 = 3.00%
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.airdropBips).to.equal(300);
      });

      it("Should revert with airdropBips exceeding MAX_AIRDROP_BIPS (6% > 5%)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken, bondingConfig } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;

        await expect(
          bondingV5.connect(user1).preLaunch(
            "Exceed Airdrop", "EXC", [0, 1], "Description",
            "https://example.com/image.png", ["", "", "", ""],
            purchaseAmount, startTime,
            LAUNCH_MODE_NORMAL, 600, false, ANTI_SNIPER_60S, false  // 600 (6.00%) > MAX_AIRDROP_BIPS (500 = 5.00%)
          )
        ).to.be.revertedWithCustomError(bondingConfig, "AirdropBipsExceedsMax");
      });
    });

    describe("needAcf Variations", function () {
      it("Should create token with needAcf = true and charge fee", async function () {
        const { user1, owner } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

        // Immediate launch with needAcf = true should charge fee
        const startTime = (await time.latest()) + 100;
        const tx = await bondingV5.connect(user1).preLaunch(
          "ACF Token", "ACF", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, true, ANTI_SNIPER_60S, false  // needAcf = true
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.needAcf).to.be.true;

        // Fee should be charged
        const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
        expect(feeToBalanceAfter).to.be.greaterThan(feeToBalanceBefore);
      });

      it("Should create token with needAcf = false and not charge fee for immediate launch", async function () {
        const { user1, owner } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

        // Immediate launch without ACF should not charge fee
        const startTime = (await time.latest()) + 100;
        const tx = await bondingV5.connect(user1).preLaunch(
          "No ACF Token", "NACF", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false  // needAcf = false
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.needAcf).to.be.false;

        // Fee should NOT be charged for immediate launch without ACF
        const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
        expect(feeToBalanceAfter).to.equal(feeToBalanceBefore);
      });

      it("Should revert if needAcf = true and airdropBips causes total to exceed limit", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken, bondingConfig } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;

        // needAcf = true adds 5000 (50%) reserve, so total = 500 + 5000 = 5500 >= MAX_TOTAL_RESERVED_BIPS (5500)
        await expect(
          bondingV5.connect(user1).preLaunch(
            "ACF Exceed", "ACFE", [0, 1], "Description",
            "https://example.com/image.png", ["", "", "", ""],
            purchaseAmount, startTime,
            LAUNCH_MODE_NORMAL, 500, true, ANTI_SNIPER_60S, false  // 500 (5.00%) + 5000 (50%) = 5500 (55%)
          )
        ).to.be.revertedWithCustomError(bondingConfig, "InvalidReserveBips");
      });

      it("Should allow needAcf = true with airdropBips = 400 (total 54%)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        
        // needAcf = true adds 5000 (50%) reserve, so total = 400 + 5000 = 5400 < 5500 OK
        const tx = await bondingV5.connect(user1).preLaunch(
          "ACF With Airdrop", "ACFA", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 400, true, ANTI_SNIPER_60S, false  // 400 (4.00%) + 5000 (50%) = 5400 (54%)
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        expect(event).to.not.be.undefined;
      });
    });

    describe("Anti-Sniper Tax Type Variations", function () {
      it("Should create token with ANTI_SNIPER_NONE (0s duration)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "No Anti-Sniper", "NOAS", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_NONE, false
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        expect(await bondingV5.tokenAntiSniperType(tokenAddress)).to.equal(ANTI_SNIPER_NONE);
      });

      it("Should create token with ANTI_SNIPER_60S (60s duration)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "60s Anti-Sniper", "AS60", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        expect(await bondingV5.tokenAntiSniperType(tokenAddress)).to.equal(ANTI_SNIPER_60S);
      });

      it("Should create token with ANTI_SNIPER_98M (98 minutes duration)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "98m Anti-Sniper", "AS98", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_98M, false
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        expect(await bondingV5.tokenAntiSniperType(tokenAddress)).to.equal(ANTI_SNIPER_98M);
      });
    });

    describe("isProject60days Variations", function () {
      it("Should create token with isProject60days = true", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "Project 60days", "P60D", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, true  // isProject60days = true
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        expect(await bondingV5.isProject60days(tokenAddress)).to.be.true;
      });

      it("Should create token with isProject60days = false", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "Regular Project", "REG", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false  // isProject60days = false
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        
        expect(await bondingV5.isProject60days(tokenAddress)).to.be.false;
      });
    });

    describe("Scheduled vs Immediate Launch", function () {
      it("Should charge fee for scheduled launch (startTime >= now + 24h)", async function () {
        const { user1, owner } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

        // Scheduled launch (startTime > now + 24h)
        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "Scheduled Token", "SCHD", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false
        );

        const receipt = await tx.wait();
        expect(receipt).to.not.be.undefined;

        // Fee should be charged for scheduled launch
        const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
        expect(feeToBalanceAfter).to.be.greaterThan(feeToBalanceBefore);
      });

      it("Should NOT charge fee for immediate launch without ACF", async function () {
        const { user1, owner } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

        const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

        // Immediate launch (startTime < now + 24h)
        const startTime = (await time.latest()) + 100;
        const tx = await bondingV5.connect(user1).preLaunch(
          "Immediate Token", "IMMD", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false
        );

        const receipt = await tx.wait();
        expect(receipt).to.not.be.undefined;

        // Fee should NOT be charged for immediate launch without ACF
        const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
        expect(feeToBalanceAfter).to.equal(feeToBalanceBefore);
      });
    });
  });

  // ============================================
  // Special Mode Strict Validation Tests (X_LAUNCH and ACP_SKILL)
  // ============================================
  describe("Special Mode Strict Validation (X_LAUNCH and ACP_SKILL)", function () {
    before(async function () {
      const { bondingConfig } = contracts;
      const { owner, user1 } = accounts;

      await bondingConfig.connect(owner).setXLauncher(user1.address, true);
      await bondingConfig.connect(owner).setAcpSkillLauncher(user1.address, true);
    });

    it("Should revert X_LAUNCH with non-zero airdropBips", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid X_LAUNCH", "INV", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_X_LAUNCH, 5, false, ANTI_SNIPER_NONE, false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert X_LAUNCH with needAcf = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid X_LAUNCH ACF", "INVA", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_X_LAUNCH, 0, true, ANTI_SNIPER_NONE, false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert X_LAUNCH with non-NONE anti-sniper type", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid X_LAUNCH AS", "INAS", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_X_LAUNCH, 0, false, ANTI_SNIPER_60S, false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert X_LAUNCH with isProject60days = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid X_LAUNCH 60D", "IN60", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_X_LAUNCH, 0, false, ANTI_SNIPER_NONE, true
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert X_LAUNCH with scheduled launch (not immediate)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      // Scheduled launch (startTime >= now + 24h)
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Scheduled X_LAUNCH", "SCHP", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_X_LAUNCH, 0, false, ANTI_SNIPER_NONE, false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with non-zero airdropBips", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid ACP_SKILL", "IACP", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_ACP_SKILL, 5, false, ANTI_SNIPER_NONE, false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with needAcf = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid ACP_SKILL ACF", "IACF", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_ACP_SKILL, 0, true, ANTI_SNIPER_NONE, false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with non-NONE anti-sniper type", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid ACP_SKILL AS", "IAAS", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_ACP_SKILL, 0, false, ANTI_SNIPER_98M, false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with isProject60days = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid ACP_SKILL 60D", "IA60", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_ACP_SKILL, 0, false, ANTI_SNIPER_NONE, true
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with scheduled launch (not immediate)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      // Scheduled launch (startTime >= now + 24h)
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Scheduled ACP_SKILL", "SACP", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_ACP_SKILL, 0, false, ANTI_SNIPER_NONE, false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });
  });

  // ============================================
  // Event Data Verification Tests
  // ============================================
  describe("Event Data Verification", function () {
    it("Should emit PreLaunched event with correct LaunchParams struct", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Event Test Token", "EVT", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 500, false, ANTI_SNIPER_98M, true  // 500 = 5.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      
      const parsedEvent = bondingV5.interface.parseLog(event);
      
      // Verify LaunchParams in event
      const launchParams = parsedEvent.args.launchParams;
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(500);
      expect(launchParams.needAcf).to.equal(false);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_98M);
      expect(launchParams.isProject60days).to.equal(true);
    });

    it("Should emit Launched event with correct LaunchParams struct", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      let tx = await bondingV5.connect(user1).preLaunch(
        "Launch Event Token", "LET", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 500, false, ANTI_SNIPER_60S, false  // 500 = 5.00%
      );

      let receipt = await tx.wait();
      let event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Wait and launch
      await time.increase(START_TIME_DELAY + 1);
      tx = await bondingV5.launch(tokenAddress);
      receipt = await tx.wait();

      event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "Launched"; }
        catch (e) { return false; }
      });
      
      const parsedEvent = bondingV5.interface.parseLog(event);
      
      // Verify LaunchParams in Launched event
      const launchParams = parsedEvent.args.launchParams;
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(500);
      expect(launchParams.needAcf).to.equal(false);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_60S);
      expect(launchParams.isProject60days).to.equal(false);
    });
  });

  // ============================================
  // Token Graduation Threshold Tests
  // ============================================
  describe("Token Graduation Threshold Calculation", function () {
    it("Should calculate different gradThreshold for different airdropBips", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      // Token 1: 0% airdrop
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);
      let startTime = (await time.latest()) + START_TIME_DELAY + 1;
      let tx = await bondingV5.connect(user1).preLaunch(
        "0% Airdrop Grad", "G0", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false
      );
      let receipt = await tx.wait();
      let event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const token1 = bondingV5.interface.parseLog(event).args.token;
      const gradThreshold1 = await bondingV5.tokenGradThreshold(token1);

      // Token 2: 5% airdrop (MAX_AIRDROP_BIPS = 500)
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);
      startTime = (await time.latest()) + START_TIME_DELAY + 1;
      tx = await bondingV5.connect(user1).preLaunch(
        "5% Airdrop Grad", "G5", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 500, false, ANTI_SNIPER_60S, false  // 500 = 5.00%
      );
      receipt = await tx.wait();
      event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const token2 = bondingV5.interface.parseLog(event).args.token;
      const gradThreshold2 = await bondingV5.tokenGradThreshold(token2);

      // Different airdrop should result in different graduation thresholds
      expect(gradThreshold1).to.not.equal(gradThreshold2);
      // Higher airdrop means less bonding curve supply, so lower gradThreshold
      expect(gradThreshold2).to.be.lessThan(gradThreshold1);
    });

    it("Should calculate gradThreshold with needAcf = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      // Token with ACF (adds 50% reserve) and 0% airdrop
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "ACF Token Grad", "GACF", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 0, true, ANTI_SNIPER_60S, false
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;
      
      const gradThreshold = await bondingV5.tokenGradThreshold(tokenAddress);
      expect(gradThreshold).to.be.greaterThan(0);
    });
  });

  // ============================================
  // Edge Cases and Boundary Tests
  // ============================================
  describe("Edge Cases and Boundary Tests", function () {
    it("Should revert with invalid launch mode (mode = 3)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid Mode", "INV", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          3,  // Invalid launch mode
          0, false, ANTI_SNIPER_60S, false
        )
      ).to.be.revertedWithCustomError(bondingV5, "LaunchModeNotEnabled");
    });

    it("Should allow exact boundary of MAX_TOTAL_RESERVED_BIPS (needAcf + 4% = 54%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      
      // needAcf (5000 = 50%) + 400 (4%) = 5400 (54%) should work (just under 5500 = 55% limit)
      const tx = await bondingV5.connect(user1).preLaunch(
        "Boundary Test", "BNDY", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 400, true, ANTI_SNIPER_60S, false  // 400 = 4.00%
      );

      const receipt = await tx.wait();
      expect(receipt).to.not.be.undefined;
    });

    it("Should revert at exact MAX_TOTAL_RESERVED_BIPS (needAcf + 5% = 55%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken, bondingConfig } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // needAcf (5000 = 50%) + 500 (5%) = 5500 (55%) should fail (at limit)
      await expect(
        bondingV5.connect(user1).preLaunch(
          "Over Limit", "OVER", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 500, true, ANTI_SNIPER_60S, false  // 500 = 5.00%
        )
      ).to.be.revertedWithCustomError(bondingConfig, "InvalidReserveBips");
    });

    it("Should allow needAcf = true with 0% airdrop (total 50%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      
      const tx = await bondingV5.connect(user1).preLaunch(
        "ACF Only", "ACFO", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 0, true, ANTI_SNIPER_60S, false
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;
      
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.needAcf).to.be.true;
      expect(launchParams.airdropBips).to.equal(0);
    });

    it("Should allow exactly 4% airdrop + ACF (total 54%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      
      // 400 (4%) + 5000 (50% ACF) = 5400 (54%) < 5500 (55%) limit
      const tx = await bondingV5.connect(user1).preLaunch(
        "Max ACF Combo", "MXAC", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 400, true, ANTI_SNIPER_60S, false  // 400 = 4.00%
      );

      const receipt = await tx.wait();
      expect(receipt).to.not.be.undefined;
    });

    it("Should revert 5% airdrop + ACF (total 55%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken, bondingConfig } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // 500 (5%) + 5000 (50% ACF) = 5500 (55%) >= 5500 (55%) limit
      await expect(
        bondingV5.connect(user1).preLaunch(
          "Over ACF Combo", "OVAC", [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, 500, true, ANTI_SNIPER_60S, false  // 500 = 5.00%
        )
      ).to.be.revertedWithCustomError(bondingConfig, "InvalidReserveBips");
    });
  });

  // ============================================
  // Full Parameter Combination Tests
  // ============================================
  describe("Full Parameter Combination Tests", function () {
    it("Should create token with all parameters at default values", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Default Params", "DFLT", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_NONE, false
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;
      
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(0);
      expect(launchParams.needAcf).to.equal(false);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_NONE);
      expect(launchParams.isProject60days).to.equal(false);
    });

    it("Should create token with maximum allowed parameters", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Max Params", "MAXP", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 500, false, ANTI_SNIPER_98M, true  // MAX_AIRDROP_BIPS = 500 (5.00%)
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;
      
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.airdropBips).to.equal(500);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_98M);
      expect(launchParams.isProject60days).to.equal(true);
    });

    it("Should handle multiple tokens with different parameter combinations", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      const tokens = [];

      // Test matrix of parameter combinations (airdrop values <= MAX_AIRDROP_BIPS = 500)
      const testCases = [
        { airdrop: 0, needAcf: false, antiSniper: ANTI_SNIPER_NONE, is60days: false },
        { airdrop: 300, needAcf: false, antiSniper: ANTI_SNIPER_60S, is60days: true },  // 300 = 3.00%
        { airdrop: 500, needAcf: false, antiSniper: ANTI_SNIPER_98M, is60days: false }, // 500 = 5.00%
        { airdrop: 0, needAcf: true, antiSniper: ANTI_SNIPER_60S, is60days: false },
        { airdrop: 400, needAcf: true, antiSniper: ANTI_SNIPER_98M, is60days: true },   // 400 = 4.00%
      ];

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);
        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        
        const tx = await bondingV5.connect(user1).preLaunch(
          `Combo Token ${i}`, `CMB${i}`, [0, 1], "Description",
          "https://example.com/image.png", ["", "", "", ""],
          purchaseAmount, startTime,
          LAUNCH_MODE_NORMAL, tc.airdrop, tc.needAcf, tc.antiSniper, tc.is60days
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
          catch (e) { return false; }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        tokens.push(tokenAddress);

        // Verify stored parameters
        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.airdropBips).to.equal(tc.airdrop);
        expect(launchParams.needAcf).to.equal(tc.needAcf);
        expect(launchParams.antiSniperTaxType).to.equal(tc.antiSniper);
        expect(launchParams.isProject60days).to.equal(tc.is60days);
      }

      // Verify all tokens were created with unique addresses
      expect(new Set(tokens).size).to.equal(testCases.length);
    });
  });

  // ============================================
  // Regression Tests
  // ============================================
  describe("Regression Tests", function () {
    it("Should maintain token info after preLaunch", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Regression Token", "REGT", [0, 1, 2], "A regression test token",
        "https://example.com/image.png", ["url1", "url2", "url3", "url4"],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 500, false, ANTI_SNIPER_60S, true  // 500 = 5.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Verify token info from BondingV5
      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
      expect(tokenInfo.description).to.equal("A regression test token");
      expect(tokenInfo.image).to.equal("https://example.com/image.png");
      expect(tokenInfo.trading).to.be.true;  // Bonding curve trading is active after preLaunch
      expect(tokenInfo.launchExecuted).to.be.false;  // Launch() not yet called
    });

    it("Should correctly transition from preLaunch to launch", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Transition Token", "TRAN", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Check state after preLaunch (before launch() call)
      let tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.trading).to.be.true;  // Bonding curve trading active
      expect(tokenInfo.launchExecuted).to.be.false;  // launch() not yet called

      // Wait and call launch()
      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);

      // Check state after launch()
      tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.trading).to.be.true;  // Still trading on bonding curve
      expect(tokenInfo.launchExecuted).to.be.true;  // Launch executed
    });

    it("Should preserve launch params after launch", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Preserve Token", "PRSV", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 500, false, ANTI_SNIPER_98M, true  // 500 = 5.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Wait and launch
      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);

      // Verify launch params are still correct after launch
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.airdropBips).to.equal(500);
      expect(launchParams.needAcf).to.equal(false);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_98M);
      expect(launchParams.isProject60days).to.equal(true);
    });
  });

  // ============================================
  // cancelLaunch Tests
  // ============================================
  describe("cancelLaunch", function () {
    let tokenAddress;
    let pairAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Cancel Test Token",
          "CTT",
          [0, 1, 2],
          "Test token for cancel",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;
      pairAddress = parsedEvent.args.pair;
    });

    it("Should allow creator to cancel launch before launch() is called", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const balanceBefore = await virtualToken.balanceOf(user1.address);

      const tx = await bondingV5.connect(user1).cancelLaunch(tokenAddress);
      const receipt = await tx.wait();

      // Verify CancelledLaunch event
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "CancelledLaunch";
        } catch (e) {
          return false;
        }
      });
      expect(event).to.not.be.undefined;

      // Verify initialPurchase is returned to creator
      const balanceAfter = await virtualToken.balanceOf(user1.address);
      expect(balanceAfter).to.be.greaterThan(balanceBefore);

      // Verify token status is updated
      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.launchExecuted).to.be.true;
      expect(tokenInfo.initialPurchase).to.equal(0);
    });

    it("Should revert if non-creator tries to cancel", async function () {
      const { user2 } = accounts;
      const { bondingV5 } = contracts;

      await expect(
        bondingV5.connect(user2).cancelLaunch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidInput");
    });

    it("Should revert if trying to cancel after launch() is called", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      // Wait and launch first
      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);

      // Then try to cancel
      await expect(
        bondingV5.connect(user1).cancelLaunch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidTokenStatus");
    });

    it("Should revert if trying to cancel twice", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      // First cancel
      await bondingV5.connect(user1).cancelLaunch(tokenAddress);

      // Second cancel should fail
      await expect(
        bondingV5.connect(user1).cancelLaunch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidTokenStatus");
    });

    it("Should revert when cancelling non-existent token", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      await expect(
        bondingV5.connect(user1).cancelLaunch(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidInput");
    });
  });

  // ============================================
  // BondingV5 Admin Functions Tests
  // ============================================
  describe("BondingV5 Admin Functions", function () {
    it("Should allow owner to update BondingConfig", async function () {
      const { owner } = accounts;
      const { bondingV5, bondingConfig } = contracts;

      // Deploy a new BondingConfig for testing
      const BondingConfig = await ethers.getContractFactory("BondingConfig");
      const newBondingConfig = await upgrades.deployProxy(
        BondingConfig,
        [
          INITIAL_SUPPLY,
          owner.address,
          owner.address,
          { maxAirdropBips: MAX_AIRDROP_BIPS, maxTotalReservedBips: MAX_TOTAL_RESERVED_BIPS, acfReservedBips: ACF_RESERVED_BIPS },
          { startTimeDelay: START_TIME_DELAY, normalLaunchFee: NORMAL_LAUNCH_FEE, acfFee: ACF_FEE },
          { tbaSalt: TBA_SALT, tbaImplementation: TBA_IMPLEMENTATION, daoVotingPeriod: DAO_VOTING_PERIOD, daoThreshold: DAO_THRESHOLD },
          { fakeInitialVirtualLiq: FAKE_INITIAL_VIRTUAL_LIQ, targetRealVirtual: TARGET_REAL_VIRTUAL },
        ],
        { initializer: "initialize" }
      );
      await newBondingConfig.waitForDeployment();

      // Update BondingConfig
      await bondingV5.connect(owner).setBondingConfig(await newBondingConfig.getAddress());

      // Verify the update
      expect(await bondingV5.bondingConfig()).to.equal(await newBondingConfig.getAddress());

      // Reset to original
      await bondingV5.connect(owner).setBondingConfig(await bondingConfig.getAddress());
    });

    it("Should revert if non-owner tries to update BondingConfig", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      await expect(
        bondingV5.connect(user1).setBondingConfig(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(bondingV5, "OwnableUnauthorizedAccount");
    });
  });

  // ============================================
  // View Functions Tests
  // ============================================
  describe("View Functions", function () {
    let tokenAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "View Test Token",
          "VTT",
          [0, 1, 2],
          "Test token for view functions",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          300,  // 300 = 3.00%
          true,
          ANTI_SNIPER_98M,
          true
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      tokenAddress = bondingV5.interface.parseLog(event).args.token;
    });

    it("Should return correct isProject60days value", async function () {
      const { bondingV5 } = contracts;
      expect(await bondingV5.isProject60days(tokenAddress)).to.be.true;
    });

    it("Should return correct isProjectXLaunch value (false for NORMAL mode)", async function () {
      const { bondingV5 } = contracts;
      expect(await bondingV5.isProjectXLaunch(tokenAddress)).to.be.false;
    });

    it("Should return correct isAcpSkillLaunch value (false for NORMAL mode)", async function () {
      const { bondingV5 } = contracts;
      expect(await bondingV5.isAcpSkillLaunch(tokenAddress)).to.be.false;
    });

    it("Should return correct tokenAntiSniperType value", async function () {
      const { bondingV5 } = contracts;
      expect(await bondingV5.tokenAntiSniperType(tokenAddress)).to.equal(ANTI_SNIPER_98M);
    });

    it("Should revert tokenAntiSniperType for non-BondingV5 token", async function () {
      const { bondingV5 } = contracts;

      // Use a random address that doesn't exist as a token
      const randomAddress = ethers.Wallet.createRandom().address;
      
      await expect(
        bondingV5.tokenAntiSniperType(randomAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidTokenStatus");
    });

    it("Should return correct tokenGradThreshold value", async function () {
      const { bondingV5 } = contracts;
      const gradThreshold = await bondingV5.tokenGradThreshold(tokenAddress);
      expect(gradThreshold).to.be.greaterThan(0);
    });

    it("Should return correct tokenInfo values", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      
      expect(tokenInfo.creator).to.equal(user1.address);
      expect(tokenInfo.token).to.equal(tokenAddress);
      expect(tokenInfo.pair).to.not.equal(ethers.ZeroAddress);
      expect(tokenInfo.trading).to.be.true;
      expect(tokenInfo.tradingOnUniswap).to.be.false;
      expect(tokenInfo.launchExecuted).to.be.false;
    });

    it("Should return correct tokenLaunchParams values", async function () {
      const { bondingV5 } = contracts;

      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(300);  // 300 = 3.00%
      expect(launchParams.needAcf).to.be.true;
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_98M);
      expect(launchParams.isProject60days).to.be.true;
    });
  });

  // ============================================
  // BondingConfig Additional Tests
  // ============================================
  describe("BondingConfig Additional Functions", function () {
    it("Should correctly calculate bonding curve supply for various scenarios", async function () {
      const { bondingConfig } = contracts;

      const initialSupply = BigInt(INITIAL_SUPPLY);

      // 0% airdrop, no ACF: 100% bonding curve
      const supply100 = await bondingConfig.calculateBondingCurveSupply(0, false);
      expect(supply100).to.equal(initialSupply);

      // 5% airdrop (500), no ACF: 95% bonding curve (9500/10000)
      const supply95 = await bondingConfig.calculateBondingCurveSupply(500, false);
      expect(supply95).to.equal((initialSupply * 9500n) / 10000n);

      // 0% airdrop, with ACF (5000 = 50%): 50% bonding curve (5000/10000)
      const supply50 = await bondingConfig.calculateBondingCurveSupply(0, true);
      expect(supply50).to.equal((initialSupply * 5000n) / 10000n);

      // 4% airdrop (400), with ACF (5000): 46% bonding curve (4600/10000)
      const supply46 = await bondingConfig.calculateBondingCurveSupply(400, true);
      expect(supply46).to.equal((initialSupply * 4600n) / 10000n);
    });

    it("Should correctly identify special modes", async function () {
      const { bondingConfig } = contracts;

      expect(await bondingConfig.isSpecialMode(LAUNCH_MODE_NORMAL)).to.be.false;
      expect(await bondingConfig.isSpecialMode(LAUNCH_MODE_X_LAUNCH)).to.be.true;
      expect(await bondingConfig.isSpecialMode(LAUNCH_MODE_ACP_SKILL)).to.be.true;
    });

    it("Should return correct fakeInitialVirtualLiq", async function () {
      const { bondingConfig } = contracts;
      expect(await bondingConfig.getFakeInitialVirtualLiq()).to.equal(FAKE_INITIAL_VIRTUAL_LIQ);
    });

    it("Should return correct targetRealVirtual", async function () {
      const { bondingConfig } = contracts;
      expect(await bondingConfig.getTargetRealVirtual()).to.equal(TARGET_REAL_VIRTUAL);
    });

    it("Should correctly calculate launch fee for different scenarios", async function () {
      const { bondingConfig } = contracts;

      // Immediate launch, no ACF: 0
      expect(await bondingConfig.calculateLaunchFee(false, false)).to.equal(0);

      // Immediate launch, with ACF: acfFee
      expect(await bondingConfig.calculateLaunchFee(false, true)).to.equal(ACF_FEE);

      // Scheduled launch, no ACF: normalLaunchFee
      expect(await bondingConfig.calculateLaunchFee(true, false)).to.equal(NORMAL_LAUNCH_FEE);

      // Scheduled launch, with ACF: normalLaunchFee + acfFee
      expect(await bondingConfig.calculateLaunchFee(true, true)).to.equal(NORMAL_LAUNCH_FEE + ACF_FEE);
    });

    it("Should allow owner to set deploy params", async function () {
      const { owner } = accounts;
      const { bondingConfig } = contracts;

      const newDeployParams = {
        tbaSalt: ethers.keccak256(ethers.toUtf8Bytes("new_salt")),
        tbaImplementation: ethers.Wallet.createRandom().address,
        daoVotingPeriod: 7200,
        daoThreshold: ethers.parseEther("200"),
      };

      await bondingConfig.connect(owner).setDeployParams(newDeployParams);

      const deployParams = await bondingConfig.deployParams();
      expect(deployParams.tbaSalt).to.equal(newDeployParams.tbaSalt);
      expect(deployParams.tbaImplementation).to.equal(newDeployParams.tbaImplementation);
      expect(deployParams.daoVotingPeriod).to.equal(newDeployParams.daoVotingPeriod);
      expect(deployParams.daoThreshold).to.equal(newDeployParams.daoThreshold);

      // Reset to original
      await bondingConfig.connect(owner).setDeployParams({
        tbaSalt: TBA_SALT,
        tbaImplementation: TBA_IMPLEMENTATION,
        daoVotingPeriod: DAO_VOTING_PERIOD,
        daoThreshold: DAO_THRESHOLD,
      });
    });

    it("Should allow owner to set common params", async function () {
      const { owner } = accounts;
      const { bondingConfig } = contracts;

      const newSupply = ethers.parseUnits("2000000000", 0); // 2B base units
      const newFeeTo = ethers.Wallet.createRandom().address;

      await bondingConfig.connect(owner).setCommonParams(newSupply, newFeeTo);

      expect(await bondingConfig.initialSupply()).to.equal(newSupply);
      expect(await bondingConfig.feeTo()).to.equal(newFeeTo);

      // Reset to original
      await bondingConfig.connect(owner).setCommonParams(INITIAL_SUPPLY, owner.address);
    });

    it("Should allow owner to set team token reserved wallet", async function () {
      const { owner, user2 } = accounts;
      const { bondingConfig } = contracts;

      const originalWallet = await bondingConfig.teamTokenReservedWallet();

      await bondingConfig.connect(owner).setTeamTokenReservedWallet(user2.address);
      expect(await bondingConfig.teamTokenReservedWallet()).to.equal(user2.address);

      // Reset to original
      await bondingConfig.connect(owner).setTeamTokenReservedWallet(originalWallet);
    });
  });

  // ============================================
  // Fee Collection Tests
  // ============================================
  describe("Fee Collection", function () {
    it("Should collect correct fee for scheduled launch with ACF", async function () {
      const { user1, owner } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

      // Scheduled launch with ACF
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      await bondingV5.connect(user1).preLaunch(
        "Fee Test Token", "FTT", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 0, true, ANTI_SNIPER_60S, false
      );

      const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
      const feeCollected = feeToBalanceAfter - feeToBalanceBefore;

      // Expected fee: normalLaunchFee + acfFee
      expect(feeCollected).to.equal(NORMAL_LAUNCH_FEE + ACF_FEE);
    });

    it("Should not collect fee for immediate launch without ACF", async function () {
      const { user1, owner } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

      // Immediate launch without ACF
      const startTime = (await time.latest()) + 100;
      await bondingV5.connect(user1).preLaunch(
        "No Fee Token", "NFT", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false
      );

      const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
      const feeCollected = feeToBalanceAfter - feeToBalanceBefore;

      expect(feeCollected).to.equal(0);
    });
  });

  // ============================================
  // Token Reserved Transfer Tests
  // ============================================
  describe("Token Reserved Transfer", function () {
    it("Should transfer reserved tokens to teamTokenReservedWallet", async function () {
      const { user1, beOpsWallet } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      const reservedWalletBalanceBefore = await ethers.provider.getBalance(beOpsWallet.address);

      // Create token with 5% airdrop (500 = 5.00%, should transfer 5% to reserved wallet)
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Reserved Test Token", "RTT", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 500, false, ANTI_SNIPER_60S, false  // 500 = 5.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Check that reserved tokens were transferred to teamTokenReservedWallet
      const actualTokenContract = await ethers.getContractAt("AgentTokenV2", tokenAddress);
      const reservedWalletTokenBalance = await actualTokenContract.balanceOf(beOpsWallet.address);
      
      // 5% of 1B = 50M tokens (with 18 decimals)
      const expectedReserved = ethers.parseEther("50000000");
      expect(reservedWalletTokenBalance).to.equal(expectedReserved);
    });

    it("Should transfer 50% + airdrop tokens when needAcf is true", async function () {
      const { user1, beOpsWallet } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);

      // Create token with 4% airdrop (400) and needAcf = true (5400 = 54% total reserved)
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "ACF Reserved Test", "ART", [0, 1], "Description",
        "https://example.com/image.png", ["", "", "", ""],
        purchaseAmount, startTime,
        LAUNCH_MODE_NORMAL, 400, true, ANTI_SNIPER_60S, false  // 400 = 4.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; }
        catch (e) { return false; }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Check reserved tokens (54% = 4% airdrop + 50% ACF)
      const actualTokenContract = await ethers.getContractAt("AgentTokenV2", tokenAddress);
      const reservedWalletTokenBalance = await actualTokenContract.balanceOf(beOpsWallet.address);
      
      // 54% of 1B = 540M tokens (with 18 decimals)
      const expectedReserved = ethers.parseEther("540000000");
      expect(reservedWalletTokenBalance).to.equal(expectedReserved);
    });
  });
});
