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
  FFactoryV2_TAX_VAULT,
  FFactoryV2_ANTI_SNIPER_TAX_VAULT,
  ASSET_RATE,
  GRAD_THRESHOLD,
  MAX_TX,
} = require("../launchpadv2/const.js");

const MAX_AIRDROP_BIPS = 500;
const MAX_TOTAL_RESERVED_BIPS = 5500;
const ACF_RESERVED_BIPS = 5000;

const NORMAL_LAUNCH_FEE = ethers.parseEther("100");
const ACF_FEE = ethers.parseEther("10");

const FAKE_INITIAL_VIRTUAL_LIQ = ethers.parseEther("6300");
const TARGET_REAL_VIRTUAL = ethers.parseEther("42000");

const BONDING_V4_FEE = 10;

/**
 * @param {object} [options]
 * @param {boolean} [options.useFeeOnTransferFactoryRouter] Mint VIRTUAL onto `MockUniswapV2Router02` so `swapExactTokensForTokensSupportingFeeOnTransferTokens` can pay out quote (AgentFactory `_uniswapRouter` is always that mock).
 * @param {boolean} [options.useAgentTaxAsProjectTaxRecipient] Set **AgentFactoryV6** (BondingV4) `projectTaxRecipient` to AgentTaxV2. BondingV5 uses **AgentFactoryV7** with `projectTaxRecipient = AgentTaxV2` by default.
 * @param {boolean} [options.includeBondingV4] Deploy **BondingV4** + wire FRouterV2 / AgentFactoryV6 for V2-vs-V3 comparison tests. Default `true`. Set `false` for BondingV5-only suites (e.g. `taxAccountingAdapter.e2e.js`).
 */
async function setupV2V3TaxComparisonTest(options = {}) {
  const setup = {};

  const includeBondingV4 = options.includeBondingV4 !== false;

  console.log(
    `\n=== launchpadv5 tax fixture (${includeBondingV4 ? "BondingV4 + BondingV5" : "BondingV5 only"}) ===`
  );
  const [owner, admin, beOpsWallet, user1, user2] = await ethers.getSigners();

  const VirtualToken = await ethers.getContractFactory("MockERC20");
  const virtualToken = await VirtualToken.deploy(
    "Virtual Token",
    "VT",
    owner.address,
    ethers.parseEther("10000000000")
  );
  await virtualToken.waitForDeployment();

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

  const FFactoryV3 = await ethers.getContractFactory("FFactoryV3");
  const fFactoryV3 = await upgrades.deployProxy(
    FFactoryV3,
    [
      FFactoryV2_TAX_VAULT,
      BUY_TAX,
      SELL_TAX,
      ANTI_SNIPER_BUY_TAX_START_VALUE,
      FFactoryV2_ANTI_SNIPER_TAX_VAULT,
    ],
    { initializer: "initialize" }
  );
  await fFactoryV3.waitForDeployment();

  const FRouterV2 = await ethers.getContractFactory("FRouterV2");
  const fRouterV2 = await upgrades.deployProxy(
    FRouterV2,
    [await fFactoryV2.getAddress(), await virtualToken.getAddress()],
    { initializer: "initialize" }
  );
  await fRouterV2.waitForDeployment();

  const FRouterV3 = await ethers.getContractFactory("FRouterV3");
  const fRouterV3 = await upgrades.deployProxy(
    FRouterV3,
    [await fFactoryV3.getAddress(), await virtualToken.getAddress()],
    { initializer: "initialize" }
  );
  await fRouterV3.waitForDeployment();

  await fFactoryV2.grantRole(await fFactoryV2.ADMIN_ROLE(), owner.address);
  await fFactoryV2.setRouter(await fRouterV2.getAddress());

  await fFactoryV3.grantRole(await fFactoryV3.ADMIN_ROLE(), owner.address);
  await fFactoryV3.setRouter(await fRouterV3.getAddress());

  const AgentTokenV2Impl = await ethers.getContractFactory("AgentTokenV2");
  const agentTokenV2Impl = await AgentTokenV2Impl.deploy();
  await agentTokenV2Impl.waitForDeployment();

  const AgentTokenV3Impl = await ethers.getContractFactory("AgentTokenV3");
  const agentTokenV3Impl = await AgentTokenV3Impl.deploy();
  await agentTokenV3Impl.waitForDeployment();

  const AgentVeTokenV2 = await ethers.getContractFactory("AgentVeTokenV2");
  const agentVeTokenV2 = await AgentVeTokenV2.deploy();
  await agentVeTokenV2.waitForDeployment();

  const MockAgentDAO = await ethers.getContractFactory("MockAgentDAO");
  const mockAgentDAO = await MockAgentDAO.deploy();
  await mockAgentDAO.waitForDeployment();

  const MockERC6551Registry = await ethers.getContractFactory("MockERC6551Registry");
  const mockERC6551Registry = await MockERC6551Registry.deploy();
  await mockERC6551Registry.waitForDeployment();

  const AgentNftV2 = await ethers.getContractFactory("AgentNftV2");
  const agentNftV2 = await upgrades.deployProxy(AgentNftV2, [owner.address], {
    initializer: "initialize",
    unsafeAllow: ["internal-function-storage"],
  });
  await agentNftV2.waitForDeployment();

  const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
  const mockUniswapFactory = await MockUniswapV2Factory.deploy();
  await mockUniswapFactory.waitForDeployment();

  const MockUniswapV2Router02 = await ethers.getContractFactory("MockUniswapV2Router02");
  const mockUniswapRouter = await MockUniswapV2Router02.deploy(
    await mockUniswapFactory.getAddress(),
    await virtualToken.getAddress()
  );
  await mockUniswapRouter.waitForDeployment();

  const factoryAgentUniswapRouterAddr = await mockUniswapRouter.getAddress();
  if (options.useFeeOnTransferFactoryRouter) {
    await virtualToken.mint(
      factoryAgentUniswapRouterAddr,
      ethers.parseEther("1000000000")
    );
  }

  const AgentFactoryV6 = await ethers.getContractFactory("AgentFactoryV6");
  const agentFactoryV6 = await upgrades.deployProxy(
    AgentFactoryV6,
    [
      await agentTokenV2Impl.getAddress(),
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

  const AssetToken = await ethers.getContractFactory("MockERC20");
  const assetToken = await AssetToken.deploy(
    "Mock USDC",
    "USDC",
    owner.address,
    ethers.parseEther("10000000000")
  );
  await assetToken.waitForDeployment();

  const AgentTaxV2 = await ethers.getContractFactory("AgentTaxV2");
  const agentTax = await upgrades.deployProxy(
    AgentTaxV2,
    [
      owner.address,
      await assetToken.getAddress(),
      await virtualToken.getAddress(),
      await mockUniswapRouter.getAddress(),
      owner.address,
      ethers.parseEther("100"),
      ethers.parseEther("10000"),
      3000,
    ],
    { initializer: "initialize" }
  );
  await agentTax.waitForDeployment();

  const projectTaxRecipient = options.useAgentTaxAsProjectTaxRecipient
    ? await agentTax.getAddress()
    : owner.address;

  await agentFactoryV6.setParams(
    10 * 365 * 24 * 60 * 60,
    factoryAgentUniswapRouterAddr,
    owner.address,
    owner.address
  );
  await agentFactoryV6.setTokenParams(BUY_TAX, SELL_TAX, 1000, projectTaxRecipient);

  await agentNftV2.grantRole(await agentNftV2.MINTER_ROLE(), await agentFactoryV6.getAddress());

  const AgentFactoryV7 = await ethers.getContractFactory("AgentFactoryV7");
  const agentFactoryV7 = await upgrades.deployProxy(
    AgentFactoryV7,
    [
      await agentTokenV3Impl.getAddress(),
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
  await agentFactoryV7.waitForDeployment();

  await agentFactoryV7.setParams(
    10 * 365 * 24 * 60 * 60,
    factoryAgentUniswapRouterAddr,
    owner.address,
    owner.address
  );
  await agentFactoryV7.setTokenParams(BUY_TAX, SELL_TAX, 1000, await agentTax.getAddress());

  await agentNftV2.grantRole(await agentNftV2.MINTER_ROLE(), await agentFactoryV7.getAddress());

  await fFactoryV2.setTaxParams(
    await agentTax.getAddress(),
    BUY_TAX,
    SELL_TAX,
    ANTI_SNIPER_BUY_TAX_START_VALUE,
    FFactoryV2_ANTI_SNIPER_TAX_VAULT
  );

  await fFactoryV3.setTaxParams(
    await agentTax.getAddress(),
    BUY_TAX,
    SELL_TAX,
    ANTI_SNIPER_BUY_TAX_START_VALUE,
    FFactoryV2_ANTI_SNIPER_TAX_VAULT
  );

  const BondingConfig = await ethers.getContractFactory("BondingConfig");
  const bondingConfig = await upgrades.deployProxy(
    BondingConfig,
    [
      INITIAL_SUPPLY,
      owner.address,
      beOpsWallet.address,
      {
        maxAirdropBips: MAX_AIRDROP_BIPS,
        maxTotalReservedBips: MAX_TOTAL_RESERVED_BIPS,
        acfReservedBips: ACF_RESERVED_BIPS,
      },
      {
        startTimeDelay: START_TIME_DELAY,
        normalLaunchFee: NORMAL_LAUNCH_FEE,
        acfFee: ACF_FEE,
      },
      {
        tbaSalt: TBA_SALT,
        tbaImplementation: TBA_IMPLEMENTATION,
        daoVotingPeriod: DAO_VOTING_PERIOD,
        daoThreshold: DAO_THRESHOLD,
      },
      {
        fakeInitialVirtualLiq: FAKE_INITIAL_VIRTUAL_LIQ,
        targetRealVirtual: TARGET_REAL_VIRTUAL,
      },
    ],
    { initializer: "initialize" }
  );
  await bondingConfig.waitForDeployment();

  let bondingV4;
  if (includeBondingV4) {
    console.log("\n--- Deploying BondingV4 (V2 curve; for V2/V3 comparison tests) ---");
    const BondingV4 = await ethers.getContractFactory("BondingV4");
    bondingV4 = await upgrades.deployProxy(
      BondingV4,
      [
        await fFactoryV2.getAddress(),
        await fRouterV2.getAddress(),
        beOpsWallet.address,
        BONDING_V4_FEE,
        INITIAL_SUPPLY,
        ASSET_RATE,
        MAX_TX,
        await agentFactoryV6.getAddress(), // BondingV4 → AgentFactoryV6 + AgentTokenV2
        GRAD_THRESHOLD,
        START_TIME_DELAY,
      ],
      { initializer: "initialize" }
    );
    await bondingV4.waitForDeployment();
  }

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

  if (includeBondingV4) {
    await bondingV4.setDeployParams({
      tbaSalt: TBA_SALT,
      tbaImplementation: TBA_IMPLEMENTATION,
      daoVotingPeriod: DAO_VOTING_PERIOD,
      daoThreshold: DAO_THRESHOLD,
    });
    await bondingV4.setLaunchParams({
      startTimeDelay: START_TIME_DELAY,
      teamTokenReservedSupply: 550000000,
      teamTokenReservedWallet: beOpsWallet.address,
    });

    await fFactoryV2.grantRole(await fFactoryV2.CREATOR_ROLE(), await bondingV4.getAddress());
    await fRouterV2.grantRole(await fRouterV2.ADMIN_ROLE(), owner.address);
    await fRouterV2.setBondingV4(await bondingV4.getAddress());
    await fRouterV2.grantRole(await fRouterV2.EXECUTOR_ROLE(), await bondingV4.getAddress());
    await agentFactoryV6.grantRole(await agentFactoryV6.BONDING_ROLE(), await bondingV4.getAddress());
  }

  await fFactoryV3.grantRole(await fFactoryV3.CREATOR_ROLE(), await bondingV5.getAddress());
  await fRouterV3.grantRole(await fRouterV3.ADMIN_ROLE(), owner.address);
  await fRouterV3.setBondingV5(await bondingV5.getAddress(), await bondingConfig.getAddress());
  await fRouterV3.grantRole(await fRouterV3.EXECUTOR_ROLE(), await bondingV5.getAddress());
  await agentFactoryV7.grantRole(await agentFactoryV7.BONDING_ROLE(), await bondingV5.getAddress());

  const REGISTER_ROLE = await agentTax.REGISTER_ROLE();
  await agentTax.grantRole(REGISTER_ROLE, await bondingV5.getAddress());

  await agentTax.setBondingV5(await bondingV5.getAddress());

  const mintAmount = ethers.parseEther("1000000000");
  for (const address of [
    owner.address,
    admin.address,
    beOpsWallet.address,
    user1.address,
    user2.address,
  ]) {
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
    agentFactoryV7,
    agentNftV2,
    bondingConfig,
    ...(includeBondingV4 ? { bondingV4 } : {}),
    bondingV5,
    agentTokenV2Impl,
    agentTokenV3Impl,
    mockUniswapRouter,
  };

  setup.accounts = { owner, admin, beOpsWallet, user1, user2 };

  console.log("\n=== Setup Completed ===");
  return setup;
}

module.exports = { setupV2V3TaxComparisonTest };
