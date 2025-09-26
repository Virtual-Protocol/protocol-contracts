import { parseEther } from "ethers";
import { ethers, upgrades } from "hardhat";

/**
 * Local deployment test script
 * This script tests the deployment logic locally before deploying to Sepolia
 */

// Mock environment variables for local testing
const mockEnv = {
  DEPLOYER: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  NEW_LAUNCHPAD_BE_OPS_WALLET: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  CONTRACT_CONTROLLER: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  ADMIN: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  VIRTUAL_TOKEN: "", // Will be deployed
  AGENT_NFT_V2: "", // Will be deployed
  UNISWAP_V2_FACTORY: "", // Will be deployed
  UNISWAP_V2_ROUTER: "", // Will be deployed
  NEW_LAUNCHPAD_FEE_ADDRESS: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  NEW_LAUNCHPAD_FEE_AMOUNT: "100000000000000000000",
  BUY_TAX: "1",
  SELL_TAX: "1",
  ANTI_SNIPER_BUY_TAX_START_VALUE: "99",
  INITIAL_SUPPLY: "1000000000",
  ASSET_RATE: "5000",
  MAX_TX: "100",
  GRAD_THRESHOLD: "29439252000000000000000000",
  START_TIME_DELAY: "86400",
  TBA_SALT:
    "0xa7647ac9429fdce477ebd9a95510385b756c757c26149e740abbab0ad1be2f16",
  TBA_IMPLEMENTATION: "0x55266d75D1a14E4572138116aF39863Ed6596E7F",
  DAO_VOTING_PERIOD: "259200",
  DAO_THRESHOLD: "0",
  TEAM_TOKEN_RESERVED_SUPPLY: "550000000",
  APPLICATION_THRESHOLD: "100000000000000000000",
};

// Override process.env for testing
Object.assign(process.env, mockEnv);

(async () => {
  try {
    console.log("\n=== Local NewLaunchpad Deployment Test Starting ===");
    console.log("Network:", (await ethers.provider.getNetwork()).name);

    const [deployer, beOpsWallet, contractController, admin, user1] =
      await ethers.getSigners();
    console.log("Deployer:", await deployer.getAddress());
    console.log("BE Ops:", await beOpsWallet.getAddress());
    console.log("Contract Controller:", await contractController.getAddress());
    console.log("Admin:", await admin.getAddress());

    // Step 1: Deploy prerequisite contracts first
    console.log("\n--- Step 1: Deploying Prerequisites ---");

    // Deploy Virtual Token (MockERC20)
    console.log("Deploying Virtual Token...");
    const VirtualToken = await ethers.getContractFactory("MockERC20");
    const virtualToken = await VirtualToken.connect(deployer).deploy(
      "Virtual Token",
      "VT",
      await deployer.getAddress(),
      ethers.parseEther("10000000000")
    );
    await virtualToken.waitForDeployment();
    const virtualTokenAddress = await virtualToken.getAddress();
    console.log("Virtual Token deployed at:", virtualTokenAddress);

    // Deploy AgentNftV2
    console.log("Deploying AgentNftV2...");
    const AgentNftV2 = await ethers.getContractFactory("AgentNftV2");
    const agentNftV2 = await upgrades.deployProxy(
      AgentNftV2,
      [await contractController.getAddress()],
      {
        initializer: "initialize",
        unsafeAllow: ["internal-function-storage"],
        initialOwner: await contractController.getAddress(),
      }
    );
    await agentNftV2.waitForDeployment();
    const agentNftV2Address = await agentNftV2.getAddress();
    console.log("AgentNftV2 deployed at:", agentNftV2Address);

    // Deploy MockUniswapV2Factory
    console.log("Deploying MockUniswapV2Factory...");
    const MockUniswapV2Factory = await ethers.getContractFactory(
      "MockUniswapV2Factory"
    );
    const mockUniswapFactory = await MockUniswapV2Factory.connect(
      deployer
    ).deploy();
    await mockUniswapFactory.waitForDeployment();
    const mockUniswapFactoryAddress = await mockUniswapFactory.getAddress();
    console.log("MockUniswapV2Factory deployed at:", mockUniswapFactoryAddress);

    // Deploy MockUniswapV2Router02
    console.log("Deploying MockUniswapV2Router02...");
    const MockUniswapV2Router02 = await ethers.getContractFactory(
      "MockUniswapV2Router02"
    );
    const mockUniswapRouter = await MockUniswapV2Router02.connect(
      deployer
    ).deploy(mockUniswapFactoryAddress, virtualTokenAddress);
    await mockUniswapRouter.waitForDeployment();
    const mockUniswapRouterAddress = await mockUniswapRouter.getAddress();
    console.log("MockUniswapV2Router02 deployed at:", mockUniswapRouterAddress);

    // Update mock environment with deployed addresses
    process.env.VIRTUAL_TOKEN = virtualTokenAddress;
    process.env.AGENT_NFT_V2 = agentNftV2Address;
    process.env.UNISWAP_V2_FACTORY = mockUniswapFactoryAddress;
    process.env.UNISWAP_V2_ROUTER = mockUniswapRouterAddress;

    // Step 2: Create arguments array (simulate loading from file)
    console.log("\n--- Step 2: Loading Arguments ---");
    const args = [
      virtualTokenAddress, // args[0] - VIRTUAL_TOKEN
      "1", // args[1] - BUY_TAX
      "1", // args[2] - SELL_TAX
      "99", // args[3] - ANTI_SNIPER_BUY_TAX_START_VALUE
      await contractController.getAddress(), // args[4] - NEW_LAUNCHPAD_FEE_ADDRESS
      "100000000000000000000", // args[5] - NEW_LAUNCHPAD_FEE_AMOUNT
      "1000000000", // args[6] - INITIAL_SUPPLY
      "5000", // args[7] - ASSET_RATE
      "100", // args[8] - MAX_TX
      "29439252000000000000000000", // args[9] - GRAD_THRESHOLD
      "86400", // args[10] - START_TIME_DELAY
      "0xa7647ac9429fdce477ebd9a95510385b756c757c26149e740abbab0ad1be2f16", // args[11] - TBA_SALT
      "0x55266d75D1a14E4572138116aF39863Ed6596E7F", // args[12] - TBA_IMPLEMENTATION
      "259200", // args[13] - DAO_VOTING_PERIOD
      "0", // args[14] - DAO_THRESHOLD
      "550000000", // args[15] - TEAM_TOKEN_RESERVED_SUPPLY
      "100000000000000000000", // args[16] - APPLICATION_THRESHOLD
      mockUniswapFactoryAddress, // args[17] - UNISWAP_V2_FACTORY
      mockUniswapRouterAddress, // args[18] - UNISWAP_V2_ROUTER
      agentNftV2Address, // args[19] - AGENT_NFT_V2
    ];

    console.log("Arguments loaded successfully");

    // Step 3: Test main deployment logic (same as deployNewLaunchPad.ts)
    console.log("\n--- Step 3: Testing Main Deployment Logic ---");

    // 1. Deploy FFactoryV2
    console.log("\n--- Deploying FFactoryV2 ---");
    const FFactoryV2 = await ethers.getContractFactory("FFactoryV2");
    const fFactoryV2 = await upgrades.deployProxy(
      FFactoryV2,
      [
        await contractController.getAddress(), // initialOwner
        args[1], // buyTax
        args[2], // sellTax
        args[3], // antiSniperBuyTaxStartValue
      ],
      {
        initializer: "initialize",
        initialOwner: await contractController.getAddress(),
      }
    );
    await fFactoryV2.waitForDeployment();
    const fFactoryV2Address = await fFactoryV2.getAddress();
    console.log("✅ FFactoryV2 deployed at:", fFactoryV2Address);

    // 2. Deploy FRouterV2
    console.log("\n--- Deploying FRouterV2 ---");
    const FRouterV2 = await ethers.getContractFactory("FRouterV2");
    const fRouterV2 = await upgrades.deployProxy(
      FRouterV2,
      [
        fFactoryV2Address, // factory
        args[0], // virtualToken (assetToken)
      ],
      {
        initializer: "initialize",
        initialOwner: await contractController.getAddress(),
      }
    );
    await fRouterV2.waitForDeployment();
    const fRouterV2Address = await fRouterV2.getAddress();
    console.log("✅ FRouterV2 deployed at:", fRouterV2Address);

    // 3. Grant ADMIN_ROLE first, then set Router in FFactoryV2
    console.log("\n--- Granting ADMIN_ROLE to contractController ---");
    const tx0 = await fFactoryV2
      .connect(deployer)
      .grantRole(
        await fFactoryV2.ADMIN_ROLE(),
        await contractController.getAddress()
      );
    await tx0.wait();
    console.log("✅ ADMIN_ROLE granted to contractController");

    console.log("\n--- Setting Router in FFactoryV2 ---");
    const tx1 = await fFactoryV2
      .connect(contractController)
      .setRouter(fRouterV2Address);
    await tx1.wait();
    console.log("✅ Router set in FFactoryV2");

    // 4. Deploy AgentToken implementation
    console.log("\n--- Deploying AgentToken implementation ---");
    const AgentToken = await ethers.getContractFactory("AgentToken");
    const agentToken = await AgentToken.connect(deployer).deploy();
    await agentToken.waitForDeployment();
    const agentTokenAddress = await agentToken.getAddress();
    console.log("✅ AgentToken implementation deployed at:", agentTokenAddress);

    // 5. Deploy AgentVeToken implementation
    console.log("\n--- Deploying AgentVeToken implementation ---");
    const AgentVeToken = await ethers.getContractFactory("AgentVeToken");
    const agentVeToken = await AgentVeToken.connect(deployer).deploy();
    await agentVeToken.waitForDeployment();
    const agentVeTokenAddress = await agentVeToken.getAddress();
    console.log(
      "✅ AgentVeToken implementation deployed at:",
      agentVeTokenAddress
    );

    // 6. Deploy AgentDAO implementation
    console.log("\n--- Deploying AgentDAO implementation ---");
    const AgentDAO = await ethers.getContractFactory("AgentDAO");
    const agentDAO = await AgentDAO.connect(deployer).deploy();
    await agentDAO.waitForDeployment();
    const agentDAOAddress = await agentDAO.getAddress();
    console.log("✅ AgentDAO implementation deployed at:", agentDAOAddress);

    // 7. Deploy ERC6551Registry implementation
    console.log("\n--- Deploying ERC6551Registry implementation ---");
    const ERC6551Registry = await ethers.getContractFactory("ERC6551Registry");
    const erc6551Registry = await ERC6551Registry.connect(deployer).deploy();
    await erc6551Registry.waitForDeployment();
    const erc6551RegistryAddress = await erc6551Registry.getAddress();
    console.log(
      "✅ ERC6551Registry implementation deployed at:",
      erc6551RegistryAddress
    );

    // 8. Deploy AgentFactoryV6
    console.log("\n--- Deploying AgentFactoryV6 ---");
    const AgentFactoryV6 = await ethers.getContractFactory("AgentFactoryV6");
    const agentFactoryV6 = await upgrades.deployProxy(
      AgentFactoryV6,
      [
        agentTokenAddress, // tokenImplementation_
        agentVeTokenAddress, // veTokenImplementation_
        agentDAOAddress, // daoImplementation_
        erc6551RegistryAddress, // tbaRegistry_
        args[0], // assetToken_ (virtualToken)
        args[19], // nft_ (AgentNftV2)
        args[16], // applicationThreshold_
        args[4], // vault_ (fee address)
        1, // nextId_
      ],
      {
        initializer: "initialize",
        initialOwner: await contractController.getAddress(),
      }
    );
    await agentFactoryV6.waitForDeployment();
    const agentFactoryV6Address = await agentFactoryV6.getAddress();
    console.log("✅ AgentFactoryV6 deployed at:", agentFactoryV6Address);

    // 9. Grant DEFAULT_ADMIN_ROLE to contractController for AgentFactoryV6
    console.log(
      "\n--- Granting DEFAULT_ADMIN_ROLE to contractController for AgentFactoryV6 ---"
    );
    const tx1_5 = await agentFactoryV6
      .connect(deployer)
      .grantRole(
        await agentFactoryV6.DEFAULT_ADMIN_ROLE(),
        await contractController.getAddress()
      );
    await tx1_5.wait();
    console.log("✅ DEFAULT_ADMIN_ROLE granted to contractController");

    // 10. Set params for AgentFactoryV6
    console.log("\n--- Setting params for AgentFactoryV6 ---");
    const tx2 = await agentFactoryV6.connect(contractController).setParams(
      10 * 365 * 24 * 60 * 60, // maturityDuration (10 years)
      args[18], // uniswapRouter
      await contractController.getAddress(), // defaultDelegatee
      await contractController.getAddress() // tokenAdmin
    );
    await tx2.wait();
    console.log("✅ Params set for AgentFactoryV6");

    // 10. Set token params for AgentFactoryV6
    console.log("\n--- Setting token params for AgentFactoryV6 ---");
    const tx3 = await agentFactoryV6.connect(contractController).setTokenParams(
      args[6], // maxSupply (initialSupply)
      "0", // lpSupply
      args[6], // vaultSupply (initialSupply)
      args[6], // maxTokensPerWallet (initialSupply)
      args[6], // maxTokensPerTxn (initialSupply)
      0, // botProtectionDurationInSeconds
      args[4], // vault (fee address)
      args[1], // projectBuyTaxBasisPoints (buyTax)
      args[2], // projectSellTaxBasisPoints (sellTax)
      1000, // taxSwapThresholdBasisPoints
      args[4] // projectTaxRecipient (fee address)
    );
    await tx3.wait();
    console.log("✅ Token params set for AgentFactoryV6");

    // 11. Deploy BondingV2
    console.log("\n--- Deploying BondingV2 ---");
    const BondingV2 = await ethers.getContractFactory("BondingV2");
    const bondingV2 = await upgrades.deployProxy(
      BondingV2,
      [
        fFactoryV2Address, // factory_
        fRouterV2Address, // router_
        args[4], // feeTo_ (fee address)
        args[5], // fee_ (fee amount)
        args[6], // initialSupply_
        args[7], // assetRate_
        args[8], // maxTx_
        agentFactoryV6Address, // agentFactory_
        args[9], // gradThreshold_
        args[10], // startTimeDelay_
      ],
      {
        initializer: "initialize",
        initialOwner: await contractController.getAddress(),
      }
    );
    await bondingV2.waitForDeployment();
    const bondingV2Address = await bondingV2.getAddress();
    console.log("✅ BondingV2 deployed at:", bondingV2Address);

    // 12. Transfer ownership of BondingV2 to contractController
    console.log(
      "\n--- Transferring BondingV2 ownership to contractController ---"
    );
    const tx3_5 = await bondingV2
      .connect(deployer)
      .transferOwnership(await contractController.getAddress());
    await tx3_5.wait();
    console.log("✅ BondingV2 ownership transferred to contractController");

    // 13-14. Set params for BondingV2
    console.log("\n--- Setting params for BondingV2 ---");
    const deployParams = {
      tbaSalt: args[11],
      tbaImplementation: args[12],
      daoVotingPeriod: args[13],
      daoThreshold: args[14],
    };
    const tx4 = await bondingV2
      .connect(contractController)
      .setDeployParams(deployParams);
    await tx4.wait();

    const launchParams = {
      startTimeDelay: args[10],
      teamTokenReservedSupply: args[15],
      teamTokenReservedWallet: args[4],
    };
    const tx5 = await bondingV2
      .connect(contractController)
      .setLaunchParams(launchParams);
    await tx5.wait();
    console.log("✅ BondingV2 params set");

    // Test role assignments (abbreviated for testing)
    console.log("\n--- Testing Role Assignments ---");

    // Grant MINTER_ROLE to AgentFactoryV6 in AgentNftV2
    const tx6 = await agentNftV2
      .connect(contractController)
      .grantRole(await agentNftV2.MINTER_ROLE(), agentFactoryV6Address);
    await tx6.wait();
    console.log("✅ MINTER_ROLE granted to AgentFactoryV6");

    // Grant DEFAULT_ADMIN_ROLE to contractController for FRouterV2
    const tx6_5 = await fRouterV2
      .connect(deployer)
      .grantRole(
        await fRouterV2.DEFAULT_ADMIN_ROLE(),
        await contractController.getAddress()
      );
    await tx6_5.wait();
    console.log(
      "✅ DEFAULT_ADMIN_ROLE granted to contractController for FRouterV2"
    );

    // Grant EXECUTOR_ROLE to BondingV2 in FRouterV2
    const tx7 = await fRouterV2
      .connect(contractController)
      .grantRole(await fRouterV2.EXECUTOR_ROLE(), bondingV2Address);
    await tx7.wait();
    console.log("✅ EXECUTOR_ROLE granted to BondingV2");

    // Print deployment summary
    console.log("\n=== 🎉 Local Deployment Test Successful! ===");
    console.log("All contracts deployed and configured:");
    console.log("- Virtual Token:", virtualTokenAddress);
    console.log("- AgentNftV2:", agentNftV2Address);
    console.log("- MockUniswapV2Factory:", mockUniswapFactoryAddress);
    console.log("- MockUniswapV2Router02:", mockUniswapRouterAddress);
    console.log("- FFactoryV2:", fFactoryV2Address);
    console.log("- FRouterV2:", fRouterV2Address);
    console.log("- AgentToken (implementation):", agentTokenAddress);
    console.log("- AgentVeToken (implementation):", agentVeTokenAddress);
    console.log("- AgentDAO (implementation):", agentDAOAddress);
    console.log("- ERC6551Registry (implementation):", erc6551RegistryAddress);
    console.log("- AgentFactoryV6:", agentFactoryV6Address);
    console.log("- BondingV2:", bondingV2Address);

    console.log("\n✅ Deployment script is ready for Sepolia!");
  } catch (e) {
    console.error("❌ Local deployment test failed:", e);
    throw e;
  }
})();
