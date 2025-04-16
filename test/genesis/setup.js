const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const fgenesis = require("../../scripts/arguments/fgenesis");

async function setupTest() {
  // Return object to store all setup results
  const setup = {};

  const params = {
    virtualToken: process.env.BRIDGED_TOKEN || null,
    reserve: process.env.GENESIS_RESERVE_AMOUNT || "42425000000000000000000", // 1000 tokens
    maxContribution:
      process.env.GENESIS_MAX_CONTRIBUTION_VIRTUAL_AMOUNT ||
      "566000000000000000000", // 100 tokens
    feeAddr: process.env.GENESIS_CREATION_FEE_ADDRESS || null,
    feeAmt: process.env.GENESIS_CREATION_FEE_AMOUNT || "100000000000000000000", // 10 tokens
    duration: process.env.GENESIS_DURATION || "86400",
    tbaSalt: process.env.GENESIS_TBA_SALT || ethers.id("GENESIS_SALT"),
    tbaImpl:
      process.env.TBA_IMPLEMENTATION ||
      "0x0000000000000000000000000000000000000001",
    votePeriod: process.env.GENESIS_VOTING_PERIOD || "900",
    threshold: process.env.GENESIS_DAO_THRESHOLD || "0",
    agentFactory: process.env.FACTORY_V3 || null,
    agentTokenTotalSupply: process.env.GENESIS_TOTAL_SUPPLY || "1000000000",
    agentTokenLpSupply: process.env.GENESIS_LP_SUPPLY || "125000000",
  };

  console.log("\n=== Test Setup Starting ===");
  const [owner, admin, beOpsWallet, user1, user2] = await ethers.getSigners();
  console.log("Owner address:", await owner.getAddress());
  console.log("Admin address:", await admin.getAddress());
  console.log("BE Ops Wallet address:", await beOpsWallet.getAddress());

  try {
    console.log("\n--- Deploying MockERC20 for Virtual Token ---");
    const VirtualToken = await ethers.getContractFactory("MockERC20");
    virtualToken = await VirtualToken.deploy(
      "Virtual Token",
      "VT",
      owner.address,
      ethers.parseEther("1000000")
    );
    await virtualToken.waitForDeployment();
    console.log(
      "MockERC20 Virtual Token deployed at: ",
      await virtualToken.getAddress()
    );

    console.log("\n--- Deploying MockERC20 for Agent Token ---");
    const AgentToken = await ethers.getContractFactory("MockERC20");
    agentToken = await AgentToken.deploy(
      "Agent Token",
      "AT",
      owner.address,
      ethers.parseEther("10000000000000000000000000") // mint 10000000000000000000000000 to owner
    );
    await agentToken.waitForDeployment();
    console.log(
      "MockERC20 Agent Token deployed at: ",
      await agentToken.getAddress()
    );
    console.log(
      "Agent Token owner balance: ",
      await agentToken.balanceOf(owner.address)
    );

    // Mock IAgentFactory
    console.log("\n--- Deploying MockAgentFactoryV3 ---");
    const MockAgentFactoryV3 = await ethers.getContractFactory(
      "MockAgentFactoryV3"
    );

    const initializeParams = [
      ethers.ZeroAddress, // tokenImplementation_
      ethers.ZeroAddress, // veTokenImplementation_
      ethers.ZeroAddress, // daoImplementation_
      ethers.ZeroAddress, // tbaRegistry_
      ethers.ZeroAddress, // assetToken_
      ethers.ZeroAddress, // nft_
      0, // applicationThreshold_
      owner.address, // vault_
      0, // nextId_
    ];

    mockAgentFactory = await upgrades.deployProxy(
      MockAgentFactoryV3,
      initializeParams,
      {
        initializer: "initialize",
      }
    );
    await mockAgentFactory.waitForDeployment();
    console.log(
      "AgentFactoryV3 deployed and initialized at:",
      await mockAgentFactory.getAddress()
    );

    mockAgentFactory.setMockAgentToken(agentToken.getAddress());
    mockAgentFactory.setMockId(1);

    // verify the role is set correctly
    const hasRole = await mockAgentFactory.hasRole(
      await mockAgentFactory.DEFAULT_ADMIN_ROLE(),
      owner.address
    );
    console.log("Owner has DEFAULT_ADMIN_ROLE for mockAgentFactory:", hasRole);

    // Update parameters
    console.log("\n--- Updating Parameters ---");
    params.virtualToken = await virtualToken.getAddress();
    params.agentFactory = await mockAgentFactory.getAddress();
    console.log("Updated params:", params);

    // Deploy GenesisLib
    const GenesisLib = await ethers.getContractFactory("GenesisLib");
    const genesisLib = await GenesisLib.deploy();
    await genesisLib.waitForDeployment();

    // Deploy FGenesis
    console.log("\n--- Deploying FGenesis ---");
    const FGenesis = await ethers.getContractFactory("FGenesis");
    console.log("FGenesis proxy contract created");

    // Deploy proxy with initialize
    console.log("Deploying FGenesis proxy with initialize...");
    fGenesis = await upgrades.deployProxy(FGenesis, [params], {
      initializer: "initialize",
      // unsafeAllow: ["constructor", "delegatecall"],
      // kind: "transparent",
      initialOwner: owner.address,
    });
    await fGenesis.waitForDeployment();
    console.log("FGenesis proxy deployed at:", await fGenesis.getAddress());

    // Get roles
    console.log("\n--- Setting up Roles ---");
    DEFAULT_ADMIN_ROLE = await fGenesis.DEFAULT_ADMIN_ROLE();
    ADMIN_ROLE = await fGenesis.ADMIN_ROLE();
    OPERATION_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATION_ROLE"));
    FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
    console.log("DEFAULT_ADMIN_ROLE:", DEFAULT_ADMIN_ROLE);
    console.log("ADMIN_ROLE:", ADMIN_ROLE);
    console.log("OPERATION_ROLE:", OPERATION_ROLE);
    console.log("FACTORY_ROLE:", FACTORY_ROLE);

    // Setup roles
    const grantDefaultAdminTx = await fGenesis.grantRole(
      DEFAULT_ADMIN_ROLE,
      admin.address
    );
    await grantDefaultAdminTx.wait();
    console.log(
      "Granted fGenesis Proxy DEFAULT_ADMIN_ROLE to admin address: ",
      admin.address
    );

    const grantAdminTx = await fGenesis.grantRole(ADMIN_ROLE, admin.address);
    await grantAdminTx.wait();
    console.log(
      "Granted fGenesis Proxy ADMIN_ROLE to admin address: ",
      admin.address
    );

    const grantBeOpsTx = await fGenesis.grantRole(
      OPERATION_ROLE,
      beOpsWallet.address
    );
    await grantBeOpsTx.wait();
    console.log(
      "Granted OPERATION_ROLE to beOpsWallet address: ",
      beOpsWallet.address
    );

    // Deploy Genesis
    console.log("\n--- Creating Genesis Instance ---");
    const currentTime = await time.latest();
    const genesisParams = {
      startTime: currentTime + 3600,
      endTime: currentTime + 86400,
      genesisName: "Test Genesis",
      genesisTicker: "TEST",
      genesisCores: [1, 2, 3],
      genesisDesc: "Test Description",
      genesisImg: "test.img",
      genesisUrls: ["url1", "url2", "url3", "url4"],
    };
    await virtualToken.transfer(beOpsWallet.address, ethers.parseEther("100"));
    await virtualToken
      .connect(beOpsWallet)
      .approve(await fGenesis.getAddress(), params.feeAmt);

    console.log("\n=== Checking Genesis Creation Parameters ===");
    console.log("Genesis Parameters:");
    console.log("- startTime:", genesisParams.startTime);
    console.log("- endTime:", genesisParams.endTime);
    console.log("- genesisName:", genesisParams.genesisName);
    console.log("- genesisTicker:", genesisParams.genesisTicker);
    console.log("- genesisCores:", genesisParams.genesisCores);
    console.log("- genesisDesc:", genesisParams.genesisDesc);
    console.log("- genesisImg:", genesisParams.genesisImg);
    console.log("- genesisUrls:", genesisParams.genesisUrls);

    console.log("\n=== FGenesis Proxy Parameters ===");
    const fgenesisParams = await fGenesis.params();
    console.log({
      virtualToken: fgenesisParams.virtualToken,
      reserve: fgenesisParams.reserve,
      maxContribution: fgenesisParams.maxContribution,
      feeAddr: fgenesisParams.feeAddr,
      feeAmt: fgenesisParams.feeAmt,
      duration: fgenesisParams.duration,
      tbaSalt: fgenesisParams.tbaSalt,
      tbaImpl: fgenesisParams.tbaImpl,
      votePeriod: fgenesisParams.votePeriod,
      threshold: fgenesisParams.threshold,
      agentFactory: fgenesisParams.agentFactory,
    });

    console.log("\n=== FGenesis Implementation Contract Info ===");
    const implementationAddress =
      await upgrades.erc1967.getImplementationAddress(
        await fGenesis.getAddress()
      );
    console.log("Implementation Address:", implementationAddress);
    const implementationContract = await ethers.getContractAt(
      "FGenesis",
      implementationAddress
    );
    const implementationParams = await implementationContract.params();
    console.log("Implementation Contract Parameters:", implementationParams);

    console.log("\nBeOpsWallet Status:");
    console.log("- Address:", beOpsWallet.address);
    console.log(
      "- Virtual Token Balance:",
      (await virtualToken.balanceOf(beOpsWallet.address)).toString()
    );
    console.log(
      "- Virtual Token Allowance:",
      (
        await virtualToken.allowance(
          beOpsWallet.address,
          await fGenesis.getAddress()
        )
      ).toString()
    );

    console.log("\nContract Addresses:");
    console.log("- FGenesis Address:", await fGenesis.getAddress());
    console.log("- Virtual Token Address:", await virtualToken.getAddress());

    console.log("\n=== Pre-Creation Checks ===");

    // 1. check beOpsWallet has OPERATION_ROLE
    let hasOperationRole = await fGenesis.hasRole(OPERATION_ROLE, beOpsWallet.address);
    console.log("beOpsWallet has OPERATION_ROLE:", hasOperationRole);
    expect(hasOperationRole).to.be.true;

    // 2. check beOpsWallet allowance to fGenesis proxy
    const allowance = await virtualToken.allowance(
      beOpsWallet.address,
      await fGenesis.getAddress()
    );
    const requiredFeeAmount = (await fGenesis.params()).feeAmt;
    console.log("Token allowance:", allowance.toString());
    console.log("Required fee amount:", requiredFeeAmount.toString());
    expect(allowance).to.be.gte(requiredFeeAmount);

    // 3. check beOpsWallet token balance
    const balance = await virtualToken.balanceOf(beOpsWallet.address);
    console.log("beOpsWallet token balance:", balance.toString());
    expect(balance).to.be.gte(requiredFeeAmount);

    console.log(
      "\n=== Granting MockAgentFactory DEFAULT_ADMIN_ROLE to fGenesis Proxy before creating Genesis ==="
    );

    // and then execute grantRole
    const connectedMockAgentFactory = mockAgentFactory.connect(owner);
    await connectedMockAgentFactory.grantRole(
      await mockAgentFactory.DEFAULT_ADMIN_ROLE(),
      await fGenesis.getAddress()
    );

    console.log("\n=== Creating Genesis ===");
    const tx = await fGenesis.connect(beOpsWallet).createGenesis(genesisParams);
    console.log("Genesis creation transaction sent");

    const receipt = await tx.wait();
    console.log("Genesis creation transaction confirmed");

    // get Genesis address
    const genesisAddress = await fGenesis.genesisContracts(1);
    console.log("\n=== Genesis Contract Info ===");
    console.log("Genesis contract deployed at: ", genesisAddress);

    // create Genesis contract instance
    genesis = await ethers.getContractAt("Genesis", genesisAddress);
    console.log("Genesis contract instance created");

    // get and print Genesis parameters
    const genesisInfo = await genesis.getGenesisInfo();
    console.log("\nGenesis genesisInfo: ", genesisInfo);

    // check beOpsWallet's permission
    hasAdminRole = await fGenesis.hasRole(ADMIN_ROLE, beOpsWallet.address);
    console.log("beOpsWallet has ADMIN_ROLE on FGenesis:", hasAdminRole);

    // check Genesis contract's FACTORY_ROLE
    const hasFactoryRole = await genesis.hasRole(
      FACTORY_ROLE,
      await fGenesis.getAddress()
    );
    console.log("FGenesis has FACTORY_ROLE on Genesis:", hasFactoryRole);

    // check Virtual Token balance
    const genesisVirtualBalance = await virtualToken.balanceOf(genesisAddress);
    console.log(
      "Genesis Virtual Token Balance:",
      genesisVirtualBalance.toString()
    );

    // check AgentFactory's permission setting
    const agentFactoryBondingRole = await mockAgentFactory.BONDING_ROLE();
    const hasAgentFactoryRole = await mockAgentFactory.hasRole(
      agentFactoryBondingRole,
      genesisAddress
    );
    console.log(
      "Genesis has BONDING_ROLE on AgentFactory:",
      hasAgentFactoryRole
    );

    console.log("=== Test Setup Completed ===\n");
  } catch (error) {
    console.error("\n=== Setup Error ===");
    console.error("Error message:", error.message);
    console.error("Error details:", error);
    throw error;
  }

  setup.virtualToken = virtualToken;
  setup.agentToken = agentToken;
  setup.fGenesis = fGenesis;
  setup.genesis = genesis;
  setup.owner = owner;
  setup.admin = admin;
  setup.beOpsWallet = beOpsWallet;
  setup.user1 = user1;
  setup.user2 = user2;
  setup.DEFAULT_ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
  setup.ADMIN_ROLE = ADMIN_ROLE;
  setup.OPERATION_ROLE = OPERATION_ROLE;
  setup.FACTORY_ROLE = FACTORY_ROLE;
  setup.params = params;
  setup.agentFactory = mockAgentFactory;

  return setup;
}

module.exports = {
  setupTest,
};
