import { parseEther } from "ethers";
const { ethers, upgrades } = require("hardhat");

(async () => {
  try {
    console.log("\n=== NewLaunchpad Deployment Starting ===");

    // Basic check for .env variables
    const deployerAddress = process.env.DEPLOYER;
    if (!deployerAddress) {
      throw new Error("DEPLOYER not set in environment");
    }
    const beOpsWallet = process.env.BE_OPS_WALLET;
    if (!beOpsWallet) {
      throw new Error("BE_OPS_WALLET not set in environment");
    }
    const contractController = process.env.CONTRACT_CONTROLLER;
    if (!contractController) {
      throw new Error("CONTRACT_CONTROLLER not set in environment");
    }
    const admin = process.env.ADMIN;
    if (!admin) {
      throw new Error("ADMIN not set in environment");
    }

    // Load arguments directly from environment variables
    const virtualToken = process.env.BRIDGED_TOKEN;
    if (!virtualToken) {
      throw new Error("BRIDGED_TOKEN not set in environment");
    }
    const buyTax = process.env.BUY_TAX;
    if (!buyTax) {
      throw new Error("BUY_TAX not set in environment");
    }
    const sellTax = process.env.SELL_TAX;
    if (!sellTax) {
      throw new Error("SELL_TAX not set in environment");
    }
    const antiSniperBuyTaxStartValue =
      process.env.ANTI_SNIPER_BUY_TAX_START_VALUE;
    if (!antiSniperBuyTaxStartValue) {
      throw new Error("ANTI_SNIPER_BUY_TAX_START_VALUE not set in environment");
    }
    const creationFeeToAddress =
      process.env.LAUNCHPAD_V2_CREATION_FEE_TO_ADDRESS;
    if (!creationFeeToAddress) {
      throw new Error("LAUNCHPAD_V2_FEE_ADDRESS not set in environment");
    }
    const feeAmount = process.env.LAUNCHPAD_V2_FEE_AMOUNT;
    if (!feeAmount) {
      throw new Error("LAUNCHPAD_V2_FEE_AMOUNT not set in environment");
    }
    const initialSupply = process.env.INITIAL_SUPPLY;
    if (!initialSupply) {
      throw new Error("INITIAL_SUPPLY not set in environment");
    }
    const assetRate = process.env.ASSET_RATE;
    if (!assetRate) {
      throw new Error("ASSET_RATE not set in environment");
    }
    const maxTx = process.env.MAX_TX;
    if (!maxTx) {
      throw new Error("MAX_TX not set in environment");
    }
    const gradThreshold = process.env.GRAD_THRESHOLD;
    if (!gradThreshold) {
      throw new Error("GRAD_THRESHOLD not set in environment");
    }
    const startTimeDelay = process.env.LAUNCHPAD_V2_START_TIME_DELAY;
    if (!startTimeDelay) {
      throw new Error("LAUNCHPAD_V2_START_TIME_DELAY not set in environment");
    }
    const tbaSalt = process.env.TBA_SALT;
    if (!tbaSalt) {
      throw new Error("TBA_SALT not set in environment");
    }
    const tbaRegistry = process.env.TBA_REGISTRY;
    if (!tbaRegistry) {
      throw new Error("TBA_REGISTRY not set in environment");
    }
    const tbaImplementation = process.env.TBA_IMPLEMENTATION;
    if (!tbaImplementation) {
      throw new Error("TBA_IMPLEMENTATION not set in environment");
    }
    const daoVotingPeriod = process.env.DAO_VOTING_PERIOD;
    if (!daoVotingPeriod) {
      throw new Error("DAO_VOTING_PERIOD not set in environment");
    }
    const daoThreshold = process.env.DAO_THRESHOLD;
    if (!daoThreshold) {
      throw new Error("DAO_THRESHOLD not set in environment");
    }
    const teamTokenReservedSupply = process.env.TEAM_TOKEN_RESERVED_SUPPLY;
    if (!teamTokenReservedSupply) {
      throw new Error("TEAM_TOKEN_RESERVED_SUPPLY not set in environment");
    }
    const teamTokenReservedWallet = process.env.TEAM_TOKEN_RESERVED_WALLET;
    if (!teamTokenReservedWallet) {
      throw new Error("TEAM_TOKEN_RESERVED_WALLET not set in environment");
    }
    const uniswapV2Factory = process.env.UNISWAP_V2_FACTORY;
    if (!uniswapV2Factory) {
      throw new Error("UNISWAP_V2_FACTORY not set in environment");
    }
    const uniswapV2Router = process.env.UNISWAP_V2_ROUTER;
    if (!uniswapV2Router) {
      throw new Error("UNISWAP_V2_ROUTER not set in environment");
    }
    const agentNftV2 = process.env.AGENT_NFT_V2;
    if (!agentNftV2) {
      throw new Error("AGENT_NFT_V2 not set in environment");
    }
    const taxVault = process.env.FFactoryV2_TAX_VAULT;
    if (!taxVault) {
      throw new Error("FFactoryV2_TAX_VAULT not set in environment");
    }
    const fRouterV2TaxManager = process.env.FRouterV2_TAX_MANAGER;
    if (!fRouterV2TaxManager) {
      throw new Error("FRouterV2_TAX_MANAGER not set in environment");
    }
    const agentDAO = process.env.AGENT_DAO;
    if (!agentDAO) {
      throw new Error("AGENT_DAO not set in environment");
    }
    const agentFactoryV6Vault = process.env.AGENT_FACTORY_V6_VAULT;
    if (!agentFactoryV6Vault) {
      throw new Error("AGENT_FACTORY_V6_VAULT not set in environment");
    }
    const agentFactoryV6MaturityDuration =
      process.env.AGENT_FACTORY_V6_Maturity_Duration;
    if (!agentFactoryV6MaturityDuration) {
      throw new Error(
        "AGENT_FACTORY_V6_Maturity_Duration not set in environment"
      );
    }
    const agentFactoryV6NextId = process.env.AGENT_FACTORY_V6_NEXT_ID;
    if (!agentFactoryV6NextId) {
      throw new Error("AGENT_FACTORY_V6_NEXT_ID not set in environment");
    }
    const antiSniperTaxVaultAddress = process.env.ANTI_SNIPER_TAX_VAULT;
    if (!antiSniperTaxVaultAddress) {
      throw new Error("ANTI_SNIPER_TAX_VAULT not set in environment");
    }
    const taxSwapThresholdBasisPoints =
      process.env.TAX_SWAP_THRESHOLD_BASIS_POINTS;
    if (!taxSwapThresholdBasisPoints) {
      throw new Error("TAX_SWAP_THRESHOLD_BASIS_POINTS not set in environment");
    }

    console.log("Deployment arguments loaded:", {
      virtualToken,
      buyTax,
      sellTax,
      antiSniperBuyTaxStartValue,
      feeAddress: creationFeeToAddress,
      feeAmount,
      initialSupply,
      assetRate,
      maxTx,
      gradThreshold,
      startTimeDelay,
      tbaSalt,
      tbaRegistry,
      tbaImplementation,
      daoVotingPeriod,
      daoThreshold,
      teamTokenReservedSupply,
      uniswapV2Factory,
      uniswapV2Router,
      agentNftV2,
      taxVault,
      agentDAO,
      agentFactoryV6Vault,
      agentFactoryV6MaturityDuration,
      agentFactoryV6NextId,
      antiSniperTaxVaultAddress,
      taxSwapThresholdBasisPoints,
    });

    // 1. Deploy FFactoryV2, must happen before FRouterV2,
    // because FRouterV2 cannot setFactory later
    console.log("\n--- Deploying FFactoryV2 ---");
    const FFactoryV2 = await ethers.getContractFactory("FFactoryV2");
    const fFactoryV2 = await upgrades.deployProxy(
      FFactoryV2,
      [
        taxVault, // taxVault
        buyTax, // buyTax
        sellTax, // sellTax
        antiSniperBuyTaxStartValue, // antiSniperBuyTaxStartValue
        antiSniperTaxVaultAddress, // antiSniperTaxVault
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await fFactoryV2.waitForDeployment();
    const fFactoryV2Address = await fFactoryV2.getAddress();
    console.log("FFactoryV2 deployed at:", fFactoryV2Address);

    // 2. Deploy FRouterV2
    console.log("\n--- Deploying FRouterV2 ---");
    const FRouterV2 = await ethers.getContractFactory("FRouterV2");
    const fRouterV2 = await upgrades.deployProxy(
      FRouterV2,
      [
        fFactoryV2Address, // factory
        virtualToken, // virtualToken (assetToken)
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await fRouterV2.waitForDeployment();
    const fRouterV2Address = await fRouterV2.getAddress();
    console.log("FRouterV2 deployed at:", fRouterV2Address);

    // 3. Grant ADMIN_ROLE of FFactoryV2 to deployer temporarily, for setRouter and setTaxParams
    console.log(
      "\n--- Granting ADMIN_ROLE of FFactoryV2 to deployer temporarily ---"
    );
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const tx0 = await fFactoryV2.grantRole(
      await fFactoryV2.ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx0.wait();
    console.log("ADMIN_ROLE of FFactoryV2 granted to deployer temporarily");

    // 4.0 Grant ADMIN_ROLE of FFactoryV2 to ADMIN, for setRouter and setTaxParams
    console.log("\n--- Granting ADMIN_ROLE to ADMIN ---");
    const tx0_5 = await fFactoryV2.grantRole(
      await fFactoryV2.ADMIN_ROLE(),
      process.env.ADMIN
    );
    await tx0_5.wait();
    console.log("ADMIN_ROLE granted to ADMIN");

    // 4.1 set fRouterV2Address in FFactoryV2
    console.log("\n--- Setting fRouterV2Address in FFactoryV2 ---");
    const tx1 = await fFactoryV2.setRouter(fRouterV2Address);
    await tx1.wait();
    console.log("fRouterV2Address set in FFactoryV2");

    // 7. Grant ADMIN_ROLE of fRouterV2 to deployer temporarily, for setTaxManager and setAntiSniperTaxManager
    console.log(
      "\n--- Granting ADMIN_ROLE of fRouterV2 to deployer temporarily ---"
    );
    const tx3_1 = await fRouterV2.grantRole(
      await fRouterV2.ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx3_1.wait();
    console.log("ADMIN_ROLE of fRouterV2 granted to deployer temporarily");

    // 8. Set taxManager for FRouterV2
    console.log("\n--- Setting TaxManager for FRouterV2 ---");
    const tx4_1 = await fRouterV2.setTaxManager(fRouterV2TaxManager);
    await tx4_1.wait();
    console.log("TaxManager set for FRouterV2: ", fRouterV2TaxManager);

    // 9. Set antiSniperTaxManager for FRouterV2
    console.log("\n--- Setting AntiSniperTaxManager for FRouterV2 ---");
    const tx5_1 = await fRouterV2.setAntiSniperTaxManager(
      antiSniperTaxVaultAddress
    );
    await tx5_1.wait();
    console.log("AntiSniperTaxManager set for FRouterV2");

    // 10. Deploy AgentTokenV2 implementation
    console.log("\n--- Deploying AgentTokenV2 implementation ---");
    const AgentTokenV2 = await ethers.getContractFactory("AgentTokenV2");
    const agentTokenV2 = await AgentTokenV2.deploy();
    await agentTokenV2.waitForDeployment();
    const agentTokenV2Address = await agentTokenV2.getAddress();
    console.log(
      "AgentTokenV2 implementation deployed at:",
      agentTokenV2Address
    );

    // 11. Deploy AgentVeTokenV2 implementation
    console.log("\n--- Deploying AgentVeTokenV2 implementation ---");
    const AgentVeTokenV2 = await ethers.getContractFactory("AgentVeTokenV2");
    const agentVeTokenV2 = await AgentVeTokenV2.deploy();
    await agentVeTokenV2.waitForDeployment();
    const agentVeTokenV2Address = await agentVeTokenV2.getAddress();
    console.log(
      "AgentVeTokenV2 implementation deployed at:",
      agentVeTokenV2Address
    );

    // 12. Deploy AgentFactoryV6
    console.log("\n--- Deploying AgentFactoryV6 ---");
    const AgentFactoryV6 = await ethers.getContractFactory("AgentFactoryV6");
    const agentFactoryV6 = await upgrades.deployProxy(
      AgentFactoryV6,
      [
        agentTokenV2Address, // tokenImplementation_
        agentVeTokenV2Address, // veTokenImplementation_
        agentDAO, // daoImplementation_
        tbaRegistry, // tbaRegistry_
        virtualToken, // assetToken_ (virtualToken)
        agentNftV2, // nft_ (AgentNftV2)
        agentFactoryV6Vault, // vault_, who will hold all the NFTs
        agentFactoryV6NextId, // nextId_
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await agentFactoryV6.waitForDeployment();
    const agentFactoryV6Address = await agentFactoryV6.getAddress();
    console.log("AgentFactoryV6 deployed at:", agentFactoryV6Address);

    // 14. Grant DEFAULT_ADMIN_ROLE to deployer temporarily for AgentFactoryV6, for setParams()
    console.log(
      "\n--- Granting DEFAULT_ADMIN_ROLE to deployer temporarily for AgentFactoryV6 ---"
    );
    const tx7_1 = await agentFactoryV6.grantRole(
      await agentFactoryV6.DEFAULT_ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx7_1.wait();
    console.log("DEFAULT_ADMIN_ROLE granted to deployer");

    // 15. setParams() for AgentFactoryV6
    console.log("\n--- Setting params for AgentFactoryV6 ---");
    const tx8_1 = await agentFactoryV6.setParams(
      agentFactoryV6MaturityDuration, // maturityDuration
      uniswapV2Router, // uniswapRouter
      process.env.ADMIN, // defaultDelegatee,
      process.env.ADMIN // tokenAdmin,
    );
    await tx8_1.wait();
    console.log("setParams() called successfully for AgentFactoryV6");

    // 18. Deploy BondingV2
    console.log("\n--- Deploying BondingV2 ---");
    const BondingV2 = await ethers.getContractFactory("BondingV2");
    const bondingV2 = await upgrades.deployProxy(
      BondingV2,
      [
        fFactoryV2Address, // factory_
        fRouterV2Address, // router_
        creationFeeToAddress, // feeTo_ (fee address)
        feeAmount, // fee_ (fee amount)
        initialSupply, // initialSupply_
        assetRate, // assetRate_
        maxTx, // maxTx_
        agentFactoryV6Address, // agentFactory_
        gradThreshold, // gradThreshold_
        startTimeDelay, // startTimeDelay_
      ],
      {
        initializer: "initialize",
        initialOwner: process.env.CONTRACT_CONTROLLER,
      }
    );
    await bondingV2.waitForDeployment();
    const bondingV2Address = await bondingV2.getAddress();
    console.log("BondingV2 deployed at:", bondingV2Address);

    // 17. Set token params for AgentFactoryV6
    console.log("\n--- Setting token params for AgentFactoryV6 ---");
    const tx3 = await agentFactoryV6.setTokenParams(
      initialSupply, // maxSupply (initialSupply)
      "0", // lpSupply
      initialSupply, // vaultSupply (initialSupply)
      initialSupply, // maxTokensPerWallet (initialSupply)
      initialSupply, // maxTokensPerTxn (initialSupply)
      0, // botProtectionDurationInSeconds
      bondingV2Address, // vault
      buyTax, // projectBuyTaxBasisPoints (buyTax)
      sellTax, // projectSellTaxBasisPoints (sellTax)
      taxSwapThresholdBasisPoints, // taxSwapThresholdBasisPoints, todo: configurable VP demon
      creationFeeToAddress // projectTaxRecipient (fee address)
    );
    await tx3.wait();
    console.log("Token params set for AgentFactoryV6");

    // 19. Set DeployParams and LaunchParams for BondingV2 (deployer is owner initially)
    console.log("\n--- Setting DeployParams for BondingV2 ---");
    const deployParams = {
      tbaSalt: tbaSalt, // tbaSalt
      tbaImplementation: tbaImplementation, // tbaImplementation
      daoVotingPeriod: daoVotingPeriod, // daoVotingPeriod
      daoThreshold: daoThreshold, // daoThreshold
    };
    const tx4 = await bondingV2.setDeployParams(deployParams);
    await tx4.wait();
    console.log("DeployParams set for BondingV2");

    // 20. Set LaunchParams for BondingV2
    console.log("\n--- Setting LaunchParams for BondingV2 ---");
    const launchParams = {
      startTimeDelay: startTimeDelay, // startTimeDelay
      teamTokenReservedSupply: teamTokenReservedSupply, // teamTokenReservedSupply
      teamTokenReservedWallet: teamTokenReservedWallet, // teamTokenReservedWallet
    };
    const tx5 = await bondingV2.setLaunchParams(launchParams);
    await tx5.wait();
    console.log("LaunchParams set for BondingV2");

    // 22. Grant necessary roles and Transfer ownership
    console.log("\n--- Granting necessary roles, Transfer ownership ---");

    // 22.1 Grant DEFAULT_ADMIN_ROLE of FFactoryV2 to admin
    console.log("\n--- Granting DEFAULT_ADMIN_ROLE of FFactoryV2 to ADMIN ---");
    const tx6 = await fFactoryV2.grantRole(
      await fFactoryV2.DEFAULT_ADMIN_ROLE(),
      process.env.ADMIN
    );
    await tx6.wait();
    console.log(
      "Granted DEFAULT_ADMIN_ROLE of FFactoryV2 to ADMIN:",
      process.env.ADMIN
    );

    // 22.2 Grant CREATOR_ROLE of FFactoryV2 to BondingV2, for createPair()
    const tx10 = await fFactoryV2.grantRole(
      await fFactoryV2.CREATOR_ROLE(),
      bondingV2Address
    );
    await tx10.wait();
    console.log(
      "Granted CREATOR_ROLE of FFactoryV2 to BondingV2:",
      bondingV2Address
    );

    // 22.3 Grant DEFAULT_ADMIN_ROLE of FRouterV2 to ADMIN
    const tx6_5 = await fRouterV2.grantRole(
      await fRouterV2.DEFAULT_ADMIN_ROLE(),
      process.env.ADMIN
    );
    await tx6_5.wait();
    console.log(
      "Granted DEFAULT_ADMIN_ROLE of FRouterV2 to ADMIN:",
      process.env.ADMIN
    );

    // 22.4 Grant EXECUTOR_ROLE of FRouterV2 to BondingV2, for buy(), sell(), addInitialLiquidity()
    console.log("\n--- Granting EXECUTOR_ROLE of FRouterV2 to BondingV2 ---");
    const tx7 = await fRouterV2.grantRole(
      await fRouterV2.EXECUTOR_ROLE(),
      bondingV2Address
    );
    await tx7.wait();
    console.log(
      "Granted EXECUTOR_ROLE of FRouterV2 to BondingV2:",
      bondingV2Address
    );

    // 22.5 Grant EXECUTOR_ROLE of FRouterV2 to BE_OPS_WALLET, for resetTime()
    const tx8 = await fRouterV2.grantRole(
      await fRouterV2.EXECUTOR_ROLE(),
      process.env.BE_OPS_WALLET
    );
    await tx8.wait();
    console.log(
      "Granted EXECUTOR_ROLE of FRouterV2 to BE_OPS_WALLET:",
      process.env.BE_OPS_WALLET
    );

    // 22.6 Grant DEFAULT_ADMIN_ROLE of AgentFactoryV6 to ADMIN
    console.log("\n--- Granting DEFAULT_ADMIN_ROLE of AgentFactoryV6 to ADMIN ---");
    const tx8_2 = await agentFactoryV6.grantRole(
      await agentFactoryV6.DEFAULT_ADMIN_ROLE(),
      process.env.ADMIN
    );
    await tx8_2.wait();
    console.log(
      "Granted DEFAULT_ADMIN_ROLE of AgentFactoryV6 to ADMIN:",
      process.env.ADMIN
    );

    // 22.7 Grant BONDING_ROLE of AgentFactoryV6 to BondingV2,
    // for createNewAgentTokenAndApplication(), updateApplicationThresholdWithApplicationId()
    // for executeBondingCurveApplicationSalt(),
    // for addBlacklistAddress(), removeBlacklistAddress()
    const tx9 = await agentFactoryV6.grantRole(
      await agentFactoryV6.BONDING_ROLE(),
      bondingV2Address
    );
    await tx9.wait();
    console.log(
      "Granted BONDING_ROLE of AgentFactoryV6 to BondingV2:",
      bondingV2Address
    );

    // 22.8 Grant REMOVE_LIQUIDITY_ROLE of AgentFactoryV6 to BondingV2, for removeLiquidity()
    const tx9_1 = await agentFactoryV6.grantRole(
      await agentFactoryV6.REMOVE_LIQUIDITY_ROLE(),
      admin
    );
    await tx9_1.wait();
    console.log(
      "Granted REMOVE_LIQUIDITY_ROLE of AgentFactoryV6 to ADMIN:",
      admin
    );

    // 22.9 Transfer ownership of BondingV2 to CONTRACT_CONTROLLER
    console.log(
      "\n--- Transferring BondingV2 ownership to CONTRACT_CONTROLLER ---"
    );
    const tx3_5 = await bondingV2.transferOwnership(
      process.env.CONTRACT_CONTROLLER
    );
    await tx3_5.wait();
    console.log("BondingV2 ownership transferred to CONTRACT_CONTROLLER");

    // 23. Revoke deployer roles (security best practice)
    console.log("\n--- Revoking deployer roles ---");

    // 23.1 Revoke deployer roles from FFactoryV2
    const tx13 = await fFactoryV2.revokeRole(
      await fFactoryV2.ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx13.wait();
    console.log(
      "Revoked ADMIN_ROLE of FFactoryV2 from Deployer:",
      await deployer.getAddress()
    );

    // 23.2 Revoke deployer roles from FRouterV2
    const tx14 = await fRouterV2.revokeRole(
      await fRouterV2.ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx14.wait();
    console.log(
      "Revoked ADMIN_ROLE of FRouterV2 from Deployer:",
      await deployer.getAddress()
    );

    // 23.3 Revoke deployer roles from AgentFactoryV6
    const tx15 = await agentFactoryV6.revokeRole(
      await agentFactoryV6.DEFAULT_ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx15.wait();
    console.log(
      "Revoked DEFAULT_ADMIN_ROLE of AgentFactoryV6 from Deployer:",
      await deployer.getAddress()
    );

    // AccessControlUpgradeable (FFactoryV2, FRouterV2):
    // Automatically grants DEFAULT_ADMIN_ROLE to the deployer during deployment

    // AccessControl (AgentFactoryV6):
    // Does NOT automatically grant DEFAULT_ADMIN_ROLE to anyone

    // 23.4 Revoke default admin role of ffactoryv2 from deployer
    console.log("\n--- Revoking DEFAULT_ADMIN_ROLE of FFactoryV2 from Deployer ---");
    const tx16 = await fFactoryV2.revokeRole(
      await fFactoryV2.DEFAULT_ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx16.wait();
    console.log("Revoked DEFAULT_ADMIN_ROLE of FFactoryV2 from Deployer:", await deployer.getAddress());

    // 23.5 Revoke default admin role of frouterv2 from deployer
    console.log("\n--- Revoking DEFAULT_ADMIN_ROLE of FRouterV2 from Deployer ---");
    const tx17 = await fRouterV2.revokeRole(
      await fRouterV2.DEFAULT_ADMIN_ROLE(),
      await deployer.getAddress()
    );
    await tx17.wait();
    console.log("Revoked DEFAULT_ADMIN_ROLE of FRouterV2 from Deployer:", await deployer.getAddress());

    // finally, need admin_private_key to do this
    // 24. Grant MINTER_ROLE of agentNftV2 to agentFactoryV6
    console.log(
      "\n--- Granting MINTER_ROLE of agentNftV2 to agentFactoryV6 ---"
    );
    const agentNftV2Contract = await ethers.getContractAt(
      "AgentNftV2",
      agentNftV2,
      process.env.deployer
    );
    const tx6_1 = await agentNftV2Contract.grantRole(
      await agentNftV2Contract.MINTER_ROLE(),
      agentFactoryV6Address
    );
    await tx6_1.wait();
    console.log("MINTER_ROLE of agentNftV2 granted to agentFactoryV6");

    // 24. Print deployment summary
    console.log("\n=== NewLaunchpad Deployment Summary ===");
    console.log("All contracts deployed and configured:");
    console.log("- AgentTokenV2 (implementation):", agentTokenV2Address);
    console.log("- AgentVeTokenV2 (implementation):", agentVeTokenV2Address);
    console.log("- AgentDAO (implementation):", agentDAO);
    console.log("- FFactoryV2:", fFactoryV2Address);
    console.log("- FRouterV2:", fRouterV2Address);
    console.log("- AgentFactoryV6:", agentFactoryV6Address);
    console.log("- BondingV2:", bondingV2Address);

    console.log("\nDeployment and role setup completed successfully!");
  } catch (e) {
    console.error("Deployment failed:", e);
    throw e;
  }
})();
