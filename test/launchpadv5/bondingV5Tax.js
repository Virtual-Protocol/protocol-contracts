const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

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
  FFactoryV2_TAX_VAULT,
  FFactoryV2_ANTI_SNIPER_TAX_VAULT,
  ASSET_RATE,
  GRAD_THRESHOLD,
  MAX_TX,
} = require("../launchpadv2/const.js");

// BondingV4 launch mode constants
const LAUNCH_MODE_NORMAL_V4 = 0;

// BondingV5 launch mode constants
const LAUNCH_MODE_NORMAL = 0;

// Anti-sniper tax type constants
const ANTI_SNIPER_NONE = 0;
const ANTI_SNIPER_60S = 1;

// Reserve supply parameters
const MAX_AIRDROP_BIPS = 500;
const MAX_TOTAL_RESERVED_BIPS = 5500;
const ACF_RESERVED_BIPS = 5000;

// Fee structure
const NORMAL_LAUNCH_FEE = ethers.parseEther("100");
const ACF_FEE = ethers.parseEther("10");

// Bonding curve params
const FAKE_INITIAL_VIRTUAL_LIQ = ethers.parseEther("6300");
const TARGET_REAL_VIRTUAL = ethers.parseEther("42000");

// BondingV4 specific params
const BONDING_V4_FEE = 10; // 1% fee (fee_ * 1 ether / 1000)

/**
 * Setup function for V2 vs V3 Tax Attribution comparison tests
 * 
 * Router Architecture (important for understanding):
 * - BondingV4 stores its own FRouterV2 reference at initialization
 * - BondingV5 stores its own FRouterV3 reference at initialization
 * - Each FPairV2 stores its router at creation time
 * - Changing FFactoryV2.router only affects NEW pairs, not existing ones
 * - Therefore, V2 and V3 tokens can coexist without router switching
 * 
 * Flow:
 * 1. Deploy all contracts with AgentFactoryV6 using AgentTokenV2 implementation
 * 2. Deploy BondingV4 (uses FRouterV2) and BondingV5 (uses FRouterV3)
 * 3. Use BondingV4 to create a V2 token (pair gets FRouterV2)
 * 4. Update AgentFactoryV6 to use AgentTokenV3 implementation
 * 5. Use BondingV5 to create a V3 token (pair gets FRouterV3)
 */
async function setupV2V3TaxComparisonTest() {
  const setup = {};

  console.log("\n=== V2 vs V3 Tax Comparison Test Setup ===");
  const [owner, admin, beOpsWallet, user1, user2] = await ethers.getSigners();

  // Deploy Virtual Token
  const VirtualToken = await ethers.getContractFactory("MockERC20");
  const virtualToken = await VirtualToken.deploy(
    "Virtual Token",
    "VT",
    owner.address,
    ethers.parseEther("10000000000")
  );
  await virtualToken.waitForDeployment();

  // Deploy FFactoryV2 (for BondingV4/V2 tokens)
  const FFactoryV2 = await ethers.getContractFactory("FFactoryV2");
  const fFactoryV2 = await upgrades.deployProxy(
    FFactoryV2,
    [
      FFactoryV2_TAX_VAULT,
      BUY_TAX,
      SELL_TAX,
      ANTI_SNIPER_BUY_TAX_START_VALUE,
      FFactoryV2_ANTI_SNIPER_TAX_VAULT,
    ],
    { initializer: "initialize" }
  );
  await fFactoryV2.waitForDeployment();

  // Deploy FFactoryV3 (for BondingV5/V3 tokens - separate from FFactoryV2)
  // This ensures frontend can determine the correct router based on factory
  const FFactoryV3 = await ethers.getContractFactory("FFactoryV3");
  const fFactoryV3 = await upgrades.deployProxy(
    FFactoryV3,
    [
      FFactoryV2_TAX_VAULT, // Same taxVault (AgentTax) for V3 tokens
      BUY_TAX,
      SELL_TAX,
      ANTI_SNIPER_BUY_TAX_START_VALUE,
      FFactoryV2_ANTI_SNIPER_TAX_VAULT,
    ],
    { initializer: "initialize" }
  );
  await fFactoryV3.waitForDeployment();

  // Deploy FRouterV2 (for BondingV4/V2 tokens)
  const FRouterV2 = await ethers.getContractFactory("FRouterV2");
  const fRouterV2 = await upgrades.deployProxy(
    FRouterV2,
    [await fFactoryV2.getAddress(), await virtualToken.getAddress()],
    { initializer: "initialize" }
  );
  await fRouterV2.waitForDeployment();

  // Deploy FRouterV3 (for BondingV5/V3 tokens - uses FFactoryV3)
  const FRouterV3 = await ethers.getContractFactory("FRouterV3");
  const fRouterV3 = await upgrades.deployProxy(
    FRouterV3,
    [await fFactoryV3.getAddress(), await virtualToken.getAddress()],
    { initializer: "initialize" }
  );
  await fRouterV3.waitForDeployment();

  // Configure FFactoryV2 with FRouterV2
  await fFactoryV2.grantRole(await fFactoryV2.ADMIN_ROLE(), owner.address);
  await fFactoryV2.setRouter(await fRouterV2.getAddress());

  // Configure FFactoryV3 with FRouterV3
  await fFactoryV3.grantRole(await fFactoryV3.ADMIN_ROLE(), owner.address);
  await fFactoryV3.setRouter(await fRouterV3.getAddress());

  // Deploy AgentTokenV2 implementation (initial)
  const AgentTokenV2Impl = await ethers.getContractFactory("AgentTokenV2");
  const agentTokenV2Impl = await AgentTokenV2Impl.deploy();
  await agentTokenV2Impl.waitForDeployment();

  // Deploy AgentTokenV3 implementation (for later upgrade)
  const AgentTokenV3Impl = await ethers.getContractFactory("AgentTokenV3");
  const agentTokenV3Impl = await AgentTokenV3Impl.deploy();
  await agentTokenV3Impl.waitForDeployment();

  // Deploy AgentVeTokenV2 implementation
  const AgentVeTokenV2 = await ethers.getContractFactory("AgentVeTokenV2");
  const agentVeTokenV2 = await AgentVeTokenV2.deploy();
  await agentVeTokenV2.waitForDeployment();

  // Deploy MockAgentDAO implementation
  const MockAgentDAO = await ethers.getContractFactory("MockAgentDAO");
  const mockAgentDAO = await MockAgentDAO.deploy();
  await mockAgentDAO.waitForDeployment();

  // Deploy MockERC6551Registry
  const MockERC6551Registry = await ethers.getContractFactory("MockERC6551Registry");
  const mockERC6551Registry = await MockERC6551Registry.deploy();
  await mockERC6551Registry.waitForDeployment();

  // Deploy AgentNftV2
  const AgentNftV2 = await ethers.getContractFactory("AgentNftV2");
  const agentNftV2 = await upgrades.deployProxy(AgentNftV2, [owner.address], {
    initializer: "initialize",
    unsafeAllow: ["internal-function-storage"],
  });
  await agentNftV2.waitForDeployment();

  // Deploy MockUniswapV2Factory and Router
  const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
  const mockUniswapFactory = await MockUniswapV2Factory.deploy();
  await mockUniswapFactory.waitForDeployment();

  const MockUniswapV2Router02 = await ethers.getContractFactory("MockUniswapV2Router02");
  const mockUniswapRouter = await MockUniswapV2Router02.deploy(
    await mockUniswapFactory.getAddress(),
    await virtualToken.getAddress()
  );
  await mockUniswapRouter.waitForDeployment();

  // Deploy AgentFactoryV6 with AgentTokenV2 implementation initially
  const AgentFactoryV6 = await ethers.getContractFactory("AgentFactoryV6");
  const agentFactoryV6 = await upgrades.deployProxy(
    AgentFactoryV6,
    [
      await agentTokenV2Impl.getAddress(), // Start with V2 implementation
      await agentVeTokenV2.getAddress(),
      await mockAgentDAO.getAddress(),
      await mockERC6551Registry.getAddress(),
      await virtualToken.getAddress(),
      await agentNftV2.getAddress(),
      owner.address,
      1,
    ],
    { initializer: "initialize" }
  );
  await agentFactoryV6.waitForDeployment();

  // Configure AgentFactoryV6
  await agentFactoryV6.setParams(
    10 * 365 * 24 * 60 * 60,
    await mockUniswapRouter.getAddress(),
    owner.address,
    owner.address
  );
  await agentFactoryV6.setTokenParams(BUY_TAX, SELL_TAX, 1000, owner.address);

  // Configure AgentNftV2 roles
  await agentNftV2.grantRole(await agentNftV2.MINTER_ROLE(), await agentFactoryV6.getAddress());

  // Deploy Asset Token (USDC) for AgentTaxV2
  const AssetToken = await ethers.getContractFactory("MockERC20");
  const assetToken = await AssetToken.deploy(
    "Mock USDC",
    "USDC",
    owner.address,
    ethers.parseEther("10000000000")
  );
  await assetToken.waitForDeployment();

  // Deploy AgentTaxV2 (simplified V3-only contract)
  // This replaces AgentTax for V3 tokens - much cleaner, no legacy V2 code
  const AgentTaxV2 = await ethers.getContractFactory("AgentTaxV2");
  const agentTax = await upgrades.deployProxy(
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
  await agentTax.waitForDeployment();

  // Configure FFactoryV2 to use AgentTaxV2 as taxVault
  // Note: In production, FFactoryV2 would use old AgentTax for V2 tokens
  // Here we use AgentTaxV2 for simplicity since we're testing V3 flow
  await fFactoryV2.setTaxParams(
    await agentTax.getAddress(),
    BUY_TAX,
    SELL_TAX,
    ANTI_SNIPER_BUY_TAX_START_VALUE,
    FFactoryV2_ANTI_SNIPER_TAX_VAULT
  );

  // Configure FFactoryV3 to use AgentTaxV2 as taxVault
  await fFactoryV3.setTaxParams(
    await agentTax.getAddress(),
    BUY_TAX,
    SELL_TAX,
    ANTI_SNIPER_BUY_TAX_START_VALUE,
    FFactoryV2_ANTI_SNIPER_TAX_VAULT
  );

  // Deploy BondingConfig (shared by BondingV4 and BondingV5)
  const BondingConfig = await ethers.getContractFactory("BondingConfig");
  const bondingConfig = await upgrades.deployProxy(
    BondingConfig,
    [
      INITIAL_SUPPLY,
      owner.address,
      beOpsWallet.address,
      { maxAirdropBips: MAX_AIRDROP_BIPS, maxTotalReservedBips: MAX_TOTAL_RESERVED_BIPS, acfReservedBips: ACF_RESERVED_BIPS },
      { startTimeDelay: START_TIME_DELAY, normalLaunchFee: NORMAL_LAUNCH_FEE, acfFee: ACF_FEE },
      { tbaSalt: TBA_SALT, tbaImplementation: TBA_IMPLEMENTATION, daoVotingPeriod: DAO_VOTING_PERIOD, daoThreshold: DAO_THRESHOLD },
      { fakeInitialVirtualLiq: FAKE_INITIAL_VIRTUAL_LIQ, targetRealVirtual: TARGET_REAL_VIRTUAL },
    ],
    { initializer: "initialize" }
  );
  await bondingConfig.waitForDeployment();

  // Deploy BondingV4 (for V2 tokens)
  // BondingV4.initialize(factory_, router_, feeTo_, fee_, initialSupply_, assetRate_, maxTx_, agentFactory_, gradThreshold_, startTimeDelay_)
  console.log("\n--- Deploying BondingV4 ---");
  const BondingV4 = await ethers.getContractFactory("BondingV4");
  const bondingV4 = await upgrades.deployProxy(
    BondingV4,
    [
      await fFactoryV2.getAddress(),    // factory_
      await fRouterV2.getAddress(),     // router_
      beOpsWallet.address,              // feeTo_
      BONDING_V4_FEE,                   // fee_
      INITIAL_SUPPLY,                   // initialSupply_
      ASSET_RATE,                       // assetRate_
      MAX_TX,                           // maxTx_
      await agentFactoryV6.getAddress(), // agentFactory_
      GRAD_THRESHOLD,                   // gradThreshold_
      START_TIME_DELAY,                 // startTimeDelay_
    ],
    { initializer: "initialize" }
  );
  await bondingV4.waitForDeployment();

  // Deploy BondingV5 (for V3 tokens) - uses FFactoryV3 and FRouterV3
  console.log("\n--- Deploying BondingV5 ---");
  const BondingV5 = await ethers.getContractFactory("BondingV5");
  const bondingV5 = await upgrades.deployProxy(
    BondingV5,
    [
      await fFactoryV3.getAddress(),  // FFactoryV3 for V3 tokens
      await fRouterV3.getAddress(),
      await agentFactoryV6.getAddress(),
      await bondingConfig.getAddress(),
    ],
    { initializer: "initialize" }
  );
  await bondingV5.waitForDeployment();

  // Set BondingV4 params (required for preLaunch)
  await bondingV4.setDeployParams({
    tbaSalt: TBA_SALT,
    tbaImplementation: TBA_IMPLEMENTATION,
    daoVotingPeriod: DAO_VOTING_PERIOD,
    daoThreshold: DAO_THRESHOLD,
  });
  await bondingV4.setLaunchParams({
    startTimeDelay: START_TIME_DELAY,
    teamTokenReservedSupply: 550000000, // 550M tokens
    teamTokenReservedWallet: beOpsWallet.address,
  });

  // Grant roles for BondingV4
  await fFactoryV2.grantRole(await fFactoryV2.CREATOR_ROLE(), await bondingV4.getAddress());
  await fRouterV2.grantRole(await fRouterV2.ADMIN_ROLE(), owner.address);
  await fRouterV2.setBondingV4(await bondingV4.getAddress());
  await fRouterV2.grantRole(await fRouterV2.EXECUTOR_ROLE(), await bondingV4.getAddress());
  await agentFactoryV6.grantRole(await agentFactoryV6.BONDING_ROLE(), await bondingV4.getAddress());

  // Grant roles for BondingV5 (uses FFactoryV3)
  await fFactoryV3.grantRole(await fFactoryV3.CREATOR_ROLE(), await bondingV5.getAddress());
  await fRouterV3.grantRole(await fRouterV3.ADMIN_ROLE(), owner.address);
  await fRouterV3.setBondingV5(await bondingV5.getAddress(), await bondingConfig.getAddress());
  await fRouterV3.grantRole(await fRouterV3.EXECUTOR_ROLE(), await bondingV5.getAddress());
  await agentFactoryV6.grantRole(await agentFactoryV6.BONDING_ROLE(), await bondingV5.getAddress());

  // Grant EXECUTOR_ROLE to BondingV5 in AgentTaxV2 (for registerToken)
  const EXECUTOR_ROLE = await agentTax.EXECUTOR_ROLE();
  await agentTax.grantRole(EXECUTOR_ROLE, await bondingV5.getAddress());

  // Mint Virtual Tokens to test addresses
  const mintAmount = ethers.parseEther("1000000000");
  for (const address of [owner.address, admin.address, beOpsWallet.address, user1.address, user2.address]) {
    await virtualToken.mint(address, mintAmount);
  }

  setup.contracts = {
    virtualToken,
    fFactoryV2,
    fFactoryV3,
    fRouterV2,
    fRouterV3,
    agentTax,
    agentFactoryV6,
    agentNftV2,
    bondingConfig,
    bondingV4,
    bondingV5,
    agentTokenV2Impl,
    agentTokenV3Impl,
  };

  setup.accounts = { owner, admin, beOpsWallet, user1, user2 };

  console.log("\n=== Setup Completed ===");
  return setup;
}

describe("V2 vs V3 Tax Attribution Comparison", function () {
  let setup;
  let contracts, accounts;
  let v2TokenAddress, v2PairAddress;
  let v3TokenAddress, v3PairAddress;

  before(async function () {
    setup = await loadFixture(setupV2V3TaxComparisonTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
  });

  describe("Phase 1: Create V2 Token via BondingV4", function () {
    it("Should create V2 token with AgentTokenV2 implementation", async function () {
      const { bondingV4, virtualToken, fFactoryV2, fRouterV2, agentFactoryV6 } = contracts;
      const { user1 } = accounts;

      // Verify AgentFactoryV6 is using V2 implementation
      const currentImpl = await agentFactoryV6.tokenImplementation();
      expect(currentImpl).to.equal(await contracts.agentTokenV2Impl.getAddress());

      // Approve tokens
      await virtualToken.connect(user1).approve(await bondingV4.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user1).approve(await fRouterV2.getAddress(), ethers.MaxUint256);

      const tokenName = "V2 Test Token";
      const tokenTicker = "V2TEST";
      const cores = [0, 1, 2];
      const description = "V2 Token for tax comparison";
      const image = "https://example.com/v2.png";
      const urls = ["https://twitter.com/v2", "https://t.me/v2", "https://youtube.com/v2", "https://example.com/v2"];
      const purchaseAmount = ethers.parseEther("1000");
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // PreLaunch V2 token
      const tx = await bondingV4.connect(user1).preLaunch(
        tokenName, tokenTicker, cores, description, image, urls,
        purchaseAmount, startTime, LAUNCH_MODE_NORMAL_V4
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV4.interface.parseLog(log)?.name === "PreLaunched"; } catch (e) { return false; }
      });
      v2TokenAddress = bondingV4.interface.parseLog(event).args.token;
      v2PairAddress = await fFactoryV2.getPair(v2TokenAddress, await virtualToken.getAddress());

      expect(v2TokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(v2PairAddress).to.not.equal(ethers.ZeroAddress);

      // Wait and launch
      await time.increaseTo(startTime + 1);
      await bondingV4.launch(v2TokenAddress);

      console.log("V2 Token created:", v2TokenAddress);
      console.log("V2 Pair:", v2PairAddress);
    });
  });

  describe("Phase 2: Upgrade to V3 and Create V3 Token via BondingV5", function () {
    it("Should upgrade AgentFactoryV6 to use AgentTokenV3 implementation", async function () {
      const { agentFactoryV6, agentTokenV3Impl } = contracts;
      const { owner } = accounts;

      // Get current implementations
      const currentVeToken = await agentFactoryV6.veTokenImplementation();
      const currentDao = await agentFactoryV6.daoImplementation();

      // Update token implementation to V3 (keep veToken and dao unchanged)
      await agentFactoryV6.connect(owner).setImplementations(
        await agentTokenV3Impl.getAddress(),
        currentVeToken,
        currentDao
      );

      const newImpl = await agentFactoryV6.tokenImplementation();
      expect(newImpl).to.equal(await agentTokenV3Impl.getAddress());
    });

    it("Should create V3 token with AgentTokenV3 implementation", async function () {
      const { bondingV5, virtualToken, fFactoryV3, fRouterV3, agentTax } = contracts;
      const { user2 } = accounts;

      // No need to switch router - BondingV5 uses FFactoryV3 which is already configured with FRouterV3
      // This is cleaner than reusing FFactoryV2 because:
      // 1. Frontend can determine router by factory (BondingV5 -> FFactoryV3 -> FRouterV3)
      // 2. No risk of BondingV4 tokens accidentally getting FRouterV3

      // Approve tokens
      await virtualToken.connect(user2).approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user2).approve(await fRouterV3.getAddress(), ethers.MaxUint256);

      const tokenName = "V3 Test Token";
      const tokenTicker = "V3TEST";
      const cores = [0, 1, 2];
      const description = "V3 Token for tax comparison";
      const image = "https://example.com/v3.png";
      const urls = ["https://twitter.com/v3", "https://t.me/v3", "https://youtube.com/v3", "https://example.com/v3"];
      const purchaseAmount = ethers.parseEther("1000");
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // PreLaunch V3 token
      const tx = await bondingV5.connect(user2).preLaunch(
        tokenName, tokenTicker, cores, description, image, urls,
        purchaseAmount, startTime, LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; } catch (e) { return false; }
      });
      v3TokenAddress = bondingV5.interface.parseLog(event).args.token;
      v3PairAddress = await fFactoryV3.getPair(v3TokenAddress, await virtualToken.getAddress());

      expect(v3TokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(v3PairAddress).to.not.equal(ethers.ZeroAddress);

      // Wait and launch - this should register the token in AgentTax
      await time.increaseTo(startTime + 1);
      const launchTx = await bondingV5.launch(v3TokenAddress);
      const launchReceipt = await launchTx.wait();

      // Verify TokenRegistered event was emitted
      const tokenRegisteredEvent = launchReceipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TokenRegistered"; } catch (e) { return false; }
      });
      expect(tokenRegisteredEvent).to.not.be.undefined;

      // Verify creator info is recorded in AgentTax
      const recipient = await agentTax.tokenRecipients(v3TokenAddress);
      expect(recipient.creator).to.equal(user2.address);

      console.log("V3 Token created:", v3TokenAddress);
      console.log("V3 Pair:", v3PairAddress);
    });
  });

  describe("Phase 3: V2 Token Tax Flow (tax-listener simulation)", function () {
    it("V2 BUY: Tax should be sent directly to taxVault (tax-listener would process)", async function () {
      const { bondingV4, virtualToken, fRouterV2, agentTax } = contracts;
      const { user1 } = accounts;

      // BondingV4 uses its stored FRouterV2 reference - no need to switch FFactoryV2.router
      await virtualToken.connect(user1).approve(await bondingV4.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user1).approve(await fRouterV2.getAddress(), ethers.MaxUint256);

      const buyAmount = ethers.parseEther("500");
      const agentTaxAddress = await agentTax.getAddress();

      const tx = await bondingV4.connect(user1).buy(buyAmount, v2TokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      // Find Transfer events to AgentTax (taxVault)
      const transfersToTax = receipt.logs.filter((log) => {
        try {
          const parsed = virtualToken.interface.parseLog(log);
          return parsed?.name === "Transfer" && parsed.args.to === agentTaxAddress;
        } catch (e) { return false; }
      });

      expect(transfersToTax.length).to.be.gt(0);

      // For V2 BUY: tax comes from buyer directly
      // Tax-listener would find this via fallback (Swap event matching)
      let foundBuyerTransfer = false;
      for (const log of transfersToTax) {
        const parsed = virtualToken.interface.parseLog(log);
        console.log("V2 BUY tax transfer from:", parsed.args.from, "amount:", ethers.formatEther(parsed.args.value));
        
        // Assert: tax transfer comes from buyer (user1)
        if (parsed.args.from.toLowerCase() === user1.address.toLowerCase()) {
          foundBuyerTransfer = true;
          console.log("  -> Tax from buyer (user1) - tax-listener uses fallback to find agent");
        }
      }
      expect(foundBuyerTransfer).to.be.true;

      // V2 should NOT have TaxDeposited event (no depositTax called)
      const taxDepositedEvent = receipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TaxDeposited"; } catch (e) { return false; }
      });
      expect(taxDepositedEvent).to.be.undefined;

      // V2 should NOT have tokenTaxAmounts recorded
      const v2TaxAmounts = await agentTax.tokenTaxAmounts(v2TokenAddress);
      expect(v2TaxAmounts.amountCollected).to.equal(0n);
    });

    it("V2 SELL: Tax should be sent from preTokenPair to taxVault", async function () {
      const { bondingV4, virtualToken, fRouterV2, agentTax } = contracts;
      const { user1 } = accounts;

      // Get some V2 tokens first by buying
      await virtualToken.connect(user1).approve(await bondingV4.getAddress(), ethers.MaxUint256);
      await bondingV4.connect(user1).buy(ethers.parseEther("1000"), v2TokenAddress, 0, (await time.latest()) + 300);

      // Get token contract and approve for sell
      const v2Token = await ethers.getContractAt("AgentTokenV2", v2TokenAddress);
      const tokenBalance = await v2Token.balanceOf(user1.address);
      await v2Token.connect(user1).approve(await bondingV4.getAddress(), tokenBalance);
      await v2Token.connect(user1).approve(await fRouterV2.getAddress(), tokenBalance);

      const agentTaxAddress = await agentTax.getAddress();
      const sellAmount = tokenBalance / 2n;

      const tx = await bondingV4.connect(user1).sell(sellAmount, v2TokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      // Find Transfer events to AgentTax
      const transfersToTax = receipt.logs.filter((log) => {
        try {
          const parsed = virtualToken.interface.parseLog(log);
          return parsed?.name === "Transfer" && parsed.args.to === agentTaxAddress;
        } catch (e) { return false; }
      });

      expect(transfersToTax.length).to.be.gt(0);

      // For V2 SELL: tax comes from preTokenPair
      // Tax-listener would process this (log.from matches preTokenPair)
      let foundPairTransfer = false;
      for (const log of transfersToTax) {
        const parsed = virtualToken.interface.parseLog(log);
        console.log("V2 SELL tax transfer from:", parsed.args.from, "amount:", ethers.formatEther(parsed.args.value));
        
        // Assert: tax transfer comes from preTokenPair
        if (parsed.args.from.toLowerCase() === v2PairAddress.toLowerCase()) {
          foundPairTransfer = true;
          console.log("  -> Tax from preTokenPair - tax-listener would process directly");
        }
      }
      expect(foundPairTransfer).to.be.true;

      // V2 should NOT have TaxDeposited event
      const taxDepositedEvent = receipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TaxDeposited"; } catch (e) { return false; }
      });
      expect(taxDepositedEvent).to.be.undefined;
    });
  });

  describe("Phase 4: V3 Token Tax Flow (on-chain attribution)", function () {
    // BondingV5 uses its stored FRouterV3 reference - no need to switch FFactoryV2.router

    it("V3 BUY: Should emit TaxDeposited and record in tokenTaxAmounts", async function () {
      const { bondingV5, virtualToken, fRouterV3, agentTax } = contracts;
      const { user1 } = accounts;

      await virtualToken.connect(user1).approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user1).approve(await fRouterV3.getAddress(), ethers.MaxUint256);

      const buyAmount = ethers.parseEther("500");
      const expectedTax = (buyAmount * BigInt(BUY_TAX)) / 100n;

      const taxBefore = await agentTax.tokenTaxAmounts(v3TokenAddress);

      const tx = await bondingV5.connect(user1).buy(buyAmount, v3TokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      // V3 SHOULD have TaxDeposited event
      const taxDepositedEvent = receipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TaxDeposited"; } catch (e) { return false; }
      });

      expect(taxDepositedEvent).to.not.be.undefined;
      const parsedEvent = agentTax.interface.parseLog(taxDepositedEvent);
      expect(parsedEvent.args.tokenAddress).to.equal(v3TokenAddress);
      expect(parsedEvent.args.amount).to.equal(expectedTax);

      // V3 SHOULD have tokenTaxAmounts updated
      const taxAfter = await agentTax.tokenTaxAmounts(v3TokenAddress);
      expect(taxAfter.amountCollected).to.equal(taxBefore.amountCollected + expectedTax);

      console.log("V3 BUY: TaxDeposited event amount:", ethers.formatEther(parsedEvent.args.amount));
      console.log("V3 BUY: tokenTaxAmounts.amountCollected:", ethers.formatEther(taxAfter.amountCollected));
    });

    it("V3 SELL: Should emit TaxDeposited and record in tokenTaxAmounts", async function () {
      const { bondingV5, virtualToken, fRouterV3, agentTax } = contracts;
      const { user1 } = accounts;

      // Get some V3 tokens first
      await virtualToken.connect(user1).approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user1).approve(await fRouterV3.getAddress(), ethers.MaxUint256);
      await bondingV5.connect(user1).buy(ethers.parseEther("1000"), v3TokenAddress, 0, (await time.latest()) + 300);

      // Get token contract and approve for sell
      const v3Token = await ethers.getContractAt("AgentTokenV2", v3TokenAddress);
      const tokenBalance = await v3Token.balanceOf(user1.address);
      await v3Token.connect(user1).approve(await bondingV5.getAddress(), tokenBalance);
      await v3Token.connect(user1).approve(await fRouterV3.getAddress(), tokenBalance);

      const taxBefore = await agentTax.tokenTaxAmounts(v3TokenAddress);
      const sellAmount = tokenBalance / 2n;

      const tx = await bondingV5.connect(user1).sell(sellAmount, v3TokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      // V3 SHOULD have TaxDeposited event
      const taxDepositedEvent = receipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TaxDeposited"; } catch (e) { return false; }
      });

      expect(taxDepositedEvent).to.not.be.undefined;
      const parsedEvent = agentTax.interface.parseLog(taxDepositedEvent);
      expect(parsedEvent.args.tokenAddress).to.equal(v3TokenAddress);
      expect(parsedEvent.args.amount).to.be.gt(0);

      // V3 SHOULD have tokenTaxAmounts updated
      const taxAfter = await agentTax.tokenTaxAmounts(v3TokenAddress);
      expect(taxAfter.amountCollected).to.be.gt(taxBefore.amountCollected);

      console.log("V3 SELL: TaxDeposited event amount:", ethers.formatEther(parsedEvent.args.amount));
      console.log("V3 SELL: tokenTaxAmounts.amountCollected:", ethers.formatEther(taxAfter.amountCollected));
    });

    it("V3: Tax transfers should NOT be processable by tax-listener (from FRouterV3)", async function () {
      const { bondingV5, virtualToken, fRouterV3, agentTax } = contracts;
      const { user2 } = accounts;

      await virtualToken.connect(user2).approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user2).approve(await fRouterV3.getAddress(), ethers.MaxUint256);

      const tx = await bondingV5.connect(user2).buy(ethers.parseEther("100"), v3TokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      const agentTaxAddress = await agentTax.getAddress();
      const fRouterV3Address = await fRouterV3.getAddress();

      // Find Transfer events to AgentTax
      const transfersToTax = receipt.logs.filter((log) => {
        try {
          const parsed = virtualToken.interface.parseLog(log);
          return parsed?.name === "Transfer" && parsed.args.to === agentTaxAddress;
        } catch (e) { return false; }
      });

      // For V3: transfers to AgentTax come from FRouterV3 (via depositTax)
      // Tax-listener checks: lpSource, uniV2PoolAddr, preTokenPair - FRouterV3 is none of these
      for (const log of transfersToTax) {
        const parsed = virtualToken.interface.parseLog(log);
        const fromAddress = parsed.args.from;

        // Tax-listener would check if fromAddress matches known LP addresses
        const wouldTaxListenerProcess = 
          fromAddress.toLowerCase() === v3PairAddress.toLowerCase(); // preTokenPair

        // FRouterV3 is NOT preTokenPair, so tax-listener would NOT process directly
        // (though fallback might find Swap event - that's why tax-listener needs to skip BondingV5 tokens)
        if (fromAddress.toLowerCase() === fRouterV3Address.toLowerCase()) {
          expect(wouldTaxListenerProcess).to.be.false;
          console.log("V3: Tax transfer from FRouterV3 - tax-listener would NOT process by log.from");
        }
      }
    });
  });

  describe("Phase 5: Summary Comparison", function () {
    it("Should show V2 vs V3 tax attribution differences", async function () {
      const { agentTax } = contracts;

      const v2TaxAmounts = await agentTax.tokenTaxAmounts(v2TokenAddress);
      const v3TaxAmounts = await agentTax.tokenTaxAmounts(v3TokenAddress);

      console.log("\n=== V2 vs V3 Tax Attribution Summary ===");
      console.log("V2 Token:", v2TokenAddress);
      console.log("  - tokenTaxAmounts.amountCollected:", ethers.formatEther(v2TaxAmounts.amountCollected), "VIRTUAL");
      console.log("  - Tax tracking: OFF-CHAIN (tax-listener required)");

      console.log("\nV3 Token:", v3TokenAddress);
      console.log("  - tokenTaxAmounts.amountCollected:", ethers.formatEther(v3TaxAmounts.amountCollected), "VIRTUAL");
      console.log("  - Tax tracking: ON-CHAIN (no tax-listener needed)");

      // V2 should have 0 on-chain tax recorded
      expect(v2TaxAmounts.amountCollected).to.equal(0n);
      // V3 should have tax recorded on-chain
      expect(v3TaxAmounts.amountCollected).to.be.gt(0n);

      // V3 should also have creator recorded
      const v3Recipient = await agentTax.tokenRecipients(v3TokenAddress);
      expect(v3Recipient.creator).to.not.equal(ethers.ZeroAddress);
      console.log("  - Creator:", v3Recipient.creator);
    });
  });
});
