const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  START_TIME_DELAY,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,
  TBA_SALT,
  TBA_IMPLEMENTATION,
  INITIAL_SUPPLY,
  LP_SUPPLY,
  VAULT_SUPPLY,
  TEAM_TOKEN_RESERVED_SUPPLY,
  BUY_TAX,
  SELL_TAX,
  ANTI_SNIPER_BUY_TAX_START_VALUE,
  APPLICATION_THRESHOLD,
  K,
  ASSET_RATE,
  GRAD_THRESHOLD,
  MAX_TX,
  FFactoryV2_TAX_VAULT,
  FFactoryV2_ANTI_SNIPER_TAX_VAULT,
  TAX_MANAGER_DEFAULT_ADMIN,
  TAX_MANAGER_CBBTC_TOKEN,
  TAX_MANAGER_AERODROME_ROUTER,
  TAX_MANAGER_TREASURY,
  TAX_MANAGER_MIN_SWAP_THRESHOLD,
  TAX_MANAGER_MAX_SWAP_THRESHOLD,
} = require("./const");

async function setupNewLaunchpadTest() {
  // Return object to store all setup results
  const setup = {};

  console.log("\n=== NewLaunchpad Test Setup Starting ===");
  const [owner, admin, beOpsWallet, user1, user2] = await ethers.getSigners();
  console.log("Owner address:", await owner.getAddress());
  console.log("Admin address:", await admin.getAddress());
  console.log("BE Ops Wallet address:", await beOpsWallet.getAddress());

  try {
    // 1. Deploy MockERC20 for Virtual Token
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

    // 2. Deploy FFactoryV2
    console.log("\n--- Deploying FFactoryV2 ---");
    const FFactoryV2 = await ethers.getContractFactory("FFactoryV2");
    const fFactoryV2 = await upgrades.deployProxy(
      FFactoryV2,
      [FFactoryV2_TAX_VAULT, BUY_TAX, SELL_TAX, ANTI_SNIPER_BUY_TAX_START_VALUE, FFactoryV2_ANTI_SNIPER_TAX_VAULT],
      { initializer: "initialize" }
    );
    await fFactoryV2.waitForDeployment();
    console.log("FFactoryV2 deployed at:", await fFactoryV2.getAddress());

    // 3. Deploy FRouterV2
    console.log("\n--- Deploying FRouterV2 ---");
    const FRouterV2 = await ethers.getContractFactory("FRouterV2");
    const fRouterV2 = await upgrades.deployProxy(
      FRouterV2,
      [await fFactoryV2.getAddress(), await virtualToken.getAddress()],
      { initializer: "initialize" }
    );
    await fRouterV2.waitForDeployment();
    console.log("FRouterV2 deployed at:", await fRouterV2.getAddress());

    // use TAX_MANAGER_CBBTC_TOKEN to mock a erc20 token
    const CBBTC = await ethers.getContractFactory("MockERC20");
    const cbbtc = await CBBTC.deploy(
      "CBBTC",
      "CBBTC",
      owner.address,
      ethers.parseEther("10000000000")
    );
    await cbbtc.waitForDeployment();
    console.log("CBBTC deployed at:", await cbbtc.getAddress());

    // 3.1. Deploy BondingTax
    console.log("\n--- Deploying TaxManagerForFRouterV2 ---");
    const BondingTax = await ethers.getContractFactory("BondingTax");
    const taxManagerForFRouterV2 = await upgrades.deployProxy(BondingTax,
      [
        owner.address,
        await virtualToken.getAddress(),
        await cbbtc.getAddress(),
        TAX_MANAGER_AERODROME_ROUTER,
        await fRouterV2.getAddress(),
        TAX_MANAGER_TREASURY,
        TAX_MANAGER_MIN_SWAP_THRESHOLD,
        TAX_MANAGER_MAX_SWAP_THRESHOLD,
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await taxManagerForFRouterV2.waitForDeployment();
    console.log("TaxManagerForFRouterV2 deployed to:", taxManagerForFRouterV2.target);

    // 3.2. Deploy AntiSniperTaxManager
    console.log("\n--- Deploying AntiSniperTaxManagerForFRouterV2 ---");
    const antiSniperTaxManagerForFRouterV2 = await upgrades.deployProxy(BondingTax, 
      [
        owner.address,
        await virtualToken.getAddress(),
        await cbbtc.getAddress(),
        TAX_MANAGER_AERODROME_ROUTER,
        await fRouterV2.getAddress(),
        TAX_MANAGER_TREASURY,
        TAX_MANAGER_MIN_SWAP_THRESHOLD,
        TAX_MANAGER_MAX_SWAP_THRESHOLD,
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await antiSniperTaxManagerForFRouterV2.waitForDeployment();
    console.log("AntiSniperTaxManagerForFRouterV2 deployed to:", antiSniperTaxManagerForFRouterV2.target);

    console.log("\n--- Setting TaxManager and AntiSniperTaxManager in FRouterV2 ---");
    await fRouterV2.connect(owner).grantRole(await fRouterV2.ADMIN_ROLE(), owner.address);
    await fRouterV2.connect(owner).setTaxManager(await taxManagerForFRouterV2.getAddress());
    await fRouterV2.connect(owner).setAntiSniperTaxManager(await antiSniperTaxManagerForFRouterV2.getAddress());
    console.log("TaxManager and AntiSniperTaxManager set in FRouterV2");

    // 4. Grant ADMIN_ROLE to owner and set Router in FFactoryV2
    console.log("\n--- Granting ADMIN_ROLE to owner in FFactoryV2 ---");
    await fFactoryV2.grantRole(await fFactoryV2.ADMIN_ROLE(), owner.address);
    console.log("ADMIN_ROLE granted to owner");

    console.log("\n--- Setting Router in FFactoryV2 ---");
    await fFactoryV2.setRouter(await fRouterV2.getAddress());
    console.log("Router set in FFactoryV2");

    // 5. Deploy AgentNftV2
    console.log("\n--- Deploying AgentNftV2 ---");
    const AgentNftV2 = await ethers.getContractFactory("AgentNftV2");
    const agentNftV2 = await upgrades.deployProxy(AgentNftV2, [owner.address], {
      initializer: "initialize",
      unsafeAllow: ["internal-function-storage"],
    });
    await agentNftV2.waitForDeployment();
    console.log("AgentNftV2 deployed at:", await agentNftV2.getAddress());

    // 6. Deploy MockUniswapV2Factory
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

    // 7. Deploy MockUniswapV2Router02
    console.log("\n--- Deploying MockUniswapV2Router02 ---");
    const MockUniswapV2Router02 = await ethers.getContractFactory(
      "MockUniswapV2Router02"
    );
    const mockUniswapRouter = await MockUniswapV2Router02.deploy(
      await mockUniswapFactory.getAddress(), // factory
      await virtualToken.getAddress() // WETH (using virtual token as mock)
    );
    await mockUniswapRouter.waitForDeployment();
    console.log(
      "MockUniswapV2Router02 deployed at:",
      await mockUniswapRouter.getAddress()
    );

    // 8. Deploy AgentToken implementation
    console.log("\n--- Deploying AgentTokenV2 implementation ---");
    const AgentTokenV2 = await ethers.getContractFactory("AgentTokenV2");
    const agentTokenV2 = await AgentTokenV2.deploy();
    await agentTokenV2.waitForDeployment();
    console.log("AgentTokenV2 deployed at:", await agentTokenV2.getAddress());

    // 8.5. Deploy AgentVeTokenV2 implementation
    console.log("\n--- Deploying AgentVeTokenV2 implementation ---");
    const AgentVeTokenV2 = await ethers.getContractFactory(
      "AgentVeTokenV2"
    );
    const agentVeTokenV2 = await AgentVeTokenV2.deploy();
    await agentVeTokenV2.waitForDeployment();
    console.log(
      "AgentVeTokenV2 deployed at:",
      await agentVeTokenV2.getAddress()
    );

    // 8.6. Deploy MockAgentDAO implementation
    console.log("\n--- Deploying MockAgentDAO implementation ---");
    const MockAgentDAO = await ethers.getContractFactory("MockAgentDAO");
    const mockAgentDAO = await MockAgentDAO.deploy();
    await mockAgentDAO.waitForDeployment();
    console.log("MockAgentDAO deployed at:", await mockAgentDAO.getAddress());

    // 8.7. Deploy MockERC6551Registry implementation
    console.log("\n--- Deploying MockERC6551Registry implementation ---");
    const MockERC6551Registry = await ethers.getContractFactory(
      "MockERC6551Registry"
    );
    const mockERC6551Registry = await MockERC6551Registry.deploy();
    await mockERC6551Registry.waitForDeployment();
    console.log(
      "MockERC6551Registry deployed at:",
      await mockERC6551Registry.getAddress()
    );

    // 9. Deploy AgentFactoryV6
    console.log("\n--- Deploying AgentFactoryV6 ---");
    const AgentFactoryV6 = await ethers.getContractFactory("AgentFactoryV6");
    const agentFactoryV6 = await upgrades.deployProxy(
      AgentFactoryV6,
      [
        await agentTokenV2.getAddress(), // tokenImplementation_
        await agentVeTokenV2.getAddress(), // veTokenImplementation_
        await mockAgentDAO.getAddress(), // daoImplementation_
        await mockERC6551Registry.getAddress(), // tbaRegistry_
        await virtualToken.getAddress(), // assetToken_
        await agentNftV2.getAddress(), // nft_
        APPLICATION_THRESHOLD, // applicationThreshold_
        owner.address, // vault_
        1, // nextId_
      ],
      { initializer: "initialize" }
    );
    await agentFactoryV6.waitForDeployment();
    console.log(
      "AgentFactoryV6 deployed at:",
      await agentFactoryV6.getAddress()
    );

    // Set params for AgentFactoryV6
    console.log("\n--- Setting params for AgentFactoryV6 ---");
    await agentFactoryV6.setParams(
      10 * 365 * 24 * 60 * 60, // maturityDuration (10 years)
      await mockUniswapRouter.getAddress(), // uniswapRouter
      owner.address, // defaultDelegatee
      owner.address // tokenAdmin
    );
    console.log("Params set for AgentFactoryV6");

    // Set token params for AgentFactoryV6
    console.log("\n--- Setting token params for AgentFactoryV6 ---");
    await agentFactoryV6.setTokenParams(
      INITIAL_SUPPLY, // maxSupply
      LP_SUPPLY, // lpSupply
      VAULT_SUPPLY, // vaultSupply
      INITIAL_SUPPLY, // maxTokensPerWallet
      INITIAL_SUPPLY, // maxTokensPerTxn
      0, // botProtectionDurationInSeconds
      owner.address, // vault
      BUY_TAX, // projectBuyTaxBasisPoints
      SELL_TAX, // projectSellTaxBasisPoints
      1000, // taxSwapThresholdBasisPoints
      owner.address // projectTaxRecipient
    );
    console.log("Token params set for AgentFactoryV6");

    // 10. Grant MINTER_ROLE to AgentFactoryV6
    console.log("\n--- Granting MINTER_ROLE to AgentFactoryV6 ---");
    await agentNftV2.grantRole(
      await agentNftV2.MINTER_ROLE(),
      await agentFactoryV6.getAddress()
    );
    console.log("MINTER_ROLE granted to AgentFactoryV6");

    // 11. Deploy BondingV2
    console.log("\n--- Deploying BondingV2 ---");
    const BondingV2 = await ethers.getContractFactory("BondingV2");
    const bondingV2 = await upgrades.deployProxy(
      BondingV2,
      [
        await fFactoryV2.getAddress(), // factory_
        await fRouterV2.getAddress(), // router_
        owner.address, // feeTo_
        "100000", // fee_ (100 tokens)
        INITIAL_SUPPLY, // initialSupply_
        ASSET_RATE, // assetRate_
        MAX_TX, // maxTx_
        await agentFactoryV6.getAddress(), // agentFactory_
        GRAD_THRESHOLD, // gradThreshold_
        START_TIME_DELAY, // startTimeDelay_
      ],
      { initializer: "initialize" }
    );
    await bondingV2.waitForDeployment();
    console.log("BondingV2 deployed at:", await bondingV2.getAddress());

    // 9. Set DeployParams and LaunchParams for BondingV2
    console.log("\n--- Setting DeployParams for BondingV2 ---");
    const deployParams = {
      tbaSalt: TBA_SALT,
      tbaImplementation: TBA_IMPLEMENTATION,
      daoVotingPeriod: DAO_VOTING_PERIOD,
      daoThreshold: DAO_THRESHOLD,
    };
    await bondingV2.setDeployParams(deployParams);
    console.log("DeployParams set for BondingV2");

    console.log("\n--- Setting LaunchParams for BondingV2 ---");
    const launchParams = {
      startTimeDelay: START_TIME_DELAY,
      teamTokenReservedSupply: TEAM_TOKEN_RESERVED_SUPPLY, // 550M tokens (without decimals)
      teamTokenReservedWallet: owner.address, // Use owner as the team wallet
    };
    await bondingV2.setLaunchParams(launchParams);
    console.log("LaunchParams set for BondingV2");

    // 10. Grant roles to BondingV2
    console.log("\n--- Granting roles to BondingV2 ---");

    // Grant EXECUTOR_ROLE to BondingV2 in FRouterV2
    await fRouterV2.grantRole(
      await fRouterV2.EXECUTOR_ROLE(),
      await bondingV2.getAddress()
    );
    console.log("EXECUTOR_ROLE granted to BondingV2 in FRouterV2");

    // Grant BONDING_ROLE to BondingV2 in AgentFactoryV6
    await agentFactoryV6.grantRole(
      await agentFactoryV6.BONDING_ROLE(),
      await bondingV2.getAddress()
    );
    console.log("BONDING_ROLE granted to BondingV2 in AgentFactoryV6");

    // Grant REMOVE_LIQUIDITY_ROLE to BondingV2 in AgentFactoryV6
    await agentFactoryV6.grantRole(
      await agentFactoryV6.REMOVE_LIQUIDITY_ROLE(),
      await admin.getAddress()
    );
    console.log("REMOVE_LIQUIDITY_ROLE granted to ADMIN in AgentFactoryV6");

    // Grant CREATOR_ROLE to BondingV2 in FFactoryV2
    await fFactoryV2.grantRole(
      await fFactoryV2.CREATOR_ROLE(),
      await bondingV2.getAddress()
    );
    console.log("CREATOR_ROLE granted to BondingV2 in FFactoryV2");

    // Grant EXECUTOR_ROLE to admin in FRouterV2 for testing
    await fRouterV2
      .connect(owner)
      .grantRole(await fRouterV2.EXECUTOR_ROLE(), admin.address);
    console.log("EXECUTOR_ROLE granted to admin in FRouterV2");

    // 11. Mint Virtual Tokens to test addresses
    console.log("\n--- Minting Virtual Tokens to test addresses ---");
    const mintAmount = ethers.parseEther("1000000000"); // 1B tokens per address

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

    // 12. Store all deployed contracts in setup object
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
      bondingV2,
    };

    setup.accounts = {
      owner,
      admin,
      beOpsWallet,
      user1,
      user2,
    };

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
      bondingV2: await bondingV2.getAddress(),
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
      lpSupply: LP_SUPPLY,
      vaultSupply: VAULT_SUPPLY,
      buyTax: BUY_TAX,
      sellTax: SELL_TAX,
      applicationThreshold: APPLICATION_THRESHOLD,
      k: K,
      assetRate: ASSET_RATE,
      gradThreshold: GRAD_THRESHOLD,
      maxTx: MAX_TX,
    };

    console.log("\n=== NewLaunchpad Test Setup Completed Successfully ===");
    console.log("All contracts deployed and configured:");
    console.log("- Virtual Token:", setup.addresses.virtualToken);
    console.log("- FFactoryV2:", setup.addresses.fFactoryV2);
    console.log("- FRouterV2:", setup.addresses.fRouterV2);
    console.log("- MockUniswapV2Factory:", setup.addresses.mockUniswapFactory);
    console.log("- MockUniswapV2Router02:", setup.addresses.mockUniswapRouter);
    console.log("- AgentTokenV2:", setup.addresses.agentToken);
    console.log("- AgentVeTokenV2:", setup.addresses.agentVeToken);
    console.log("- MockAgentDAO:", setup.addresses.mockAgentDAO);
    console.log("- MockERC6551Registry:", setup.addresses.mockERC6551Registry);
    console.log("- AgentNftV2:", setup.addresses.agentNftV2);
    console.log("- AgentFactoryV6:", setup.addresses.agentFactoryV6);
    console.log("- BondingV2:", setup.addresses.bondingV2);

    return setup;
  } catch (error) {
    console.error("Error during setup:", error);
    throw error;
  }
}

module.exports = {
  setupNewLaunchpadTest,
};
