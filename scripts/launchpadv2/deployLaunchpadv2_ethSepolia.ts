/**
 * Deploy BondingV2 and grant necessary roles
 *
 * This script reuses contracts already deployed by launchpadv5 scripts:
 * - FFactoryV2, FRouterV2, AgentFactoryV6 (from deployLaunchpadv5_1.ts, deployLaunchpadv5_2.ts)
 *
 * Usage:
 *   npx hardhat run scripts/launchpadv2/deployLaunchpadv2_ethSepolia.ts --network eth_sepolia
 *
 * Required env vars:
 *   - FFactoryV2_ADDRESS, FRouterV2_ADDRESS, AGENT_FACTORY_V6_ADDRESS (existing contracts)
 *   - ADMIN_PRIVATE_KEY (for granting roles on existing contracts)
 *   - CONTRACT_CONTROLLER (for BondingV2 ownership)
 *   - BondingV2 init params: LAUNCHPAD_V2_CREATION_FEE_TO_ADDRESS, LAUNCHPAD_V2_FEE_AMOUNT,
 *     INITIAL_SUPPLY, ASSET_RATE, MAX_TX, GRAD_THRESHOLD, LAUNCHPAD_V2_START_TIME_DELAY
 *   - BondingV2 deploy params: TBA_SALT, TBA_IMPLEMENTATION, DAO_VOTING_PERIOD, DAO_THRESHOLD
 *   - BondingV2 launch params: TEAM_TOKEN_RESERVED_SUPPLY, TEAM_TOKEN_RESERVED_WALLET
 */

const { ethers, upgrades } = require("hardhat");

(async () => {
  try {
    console.log(
      "\n=== BondingV2 Deployment (Reusing LaunchpadV5 Contracts) ==="
    );

    // ============================================
    // 1. Load existing contract addresses
    // ============================================
    const fFactoryV2Address = process.env.FFactoryV2_ADDRESS;
    if (!fFactoryV2Address) throw new Error("FFactoryV2_ADDRESS not set");

    const fRouterV2Address = process.env.FRouterV2_ADDRESS;
    if (!fRouterV2Address) throw new Error("FRouterV2_ADDRESS not set");

    const agentFactoryV6Address = process.env.AGENT_FACTORY_V6_ADDRESS;
    if (!agentFactoryV6Address)
      throw new Error("AGENT_FACTORY_V6_ADDRESS not set");

    const contractController = process.env.CONTRACT_CONTROLLER;
    if (!contractController) throw new Error("CONTRACT_CONTROLLER not set");

    const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY;
    if (!adminPrivateKey)
      throw new Error(
        "ADMIN_PRIVATE_KEY not set (needed for granting roles on existing contracts)"
      );

    // BondingV2 initialize params
    const creationFeeToAddress =
      process.env.LAUNCHPAD_V2_CREATION_FEE_TO_ADDRESS;
    if (!creationFeeToAddress)
      throw new Error("LAUNCHPAD_V2_CREATION_FEE_TO_ADDRESS not set");

    const feeAmount = process.env.LAUNCHPAD_V2_FEE_AMOUNT;
    if (!feeAmount) throw new Error("LAUNCHPAD_V2_FEE_AMOUNT not set");
    const initialSupply = process.env.INITIAL_SUPPLY;
    if (!initialSupply) throw new Error("INITIAL_SUPPLY not set");
    const assetRate = process.env.ASSET_RATE;
    if (!assetRate) throw new Error("ASSET_RATE not set");
    const maxTx = process.env.MAX_TX;
    if (!maxTx) throw new Error("MAX_TX not set");
    const gradThreshold = process.env.GRAD_THRESHOLD;
    if (!gradThreshold) throw new Error("GRAD_THRESHOLD not set");

    const startTimeDelay = process.env.LAUNCHPAD_V2_START_TIME_DELAY;
    if (!startTimeDelay)
      throw new Error("LAUNCHPAD_V2_START_TIME_DELAY not set");

    // BondingV2 deploy params
    const tbaSalt = process.env.TBA_SALT;
    if (!tbaSalt) throw new Error("TBA_SALT not set");

    const tbaImplementation = process.env.TBA_IMPLEMENTATION;
    if (!tbaImplementation) throw new Error("TBA_IMPLEMENTATION not set");

    const daoVotingPeriod = process.env.DAO_VOTING_PERIOD;
    if (!daoVotingPeriod) throw new Error("DAO_VOTING_PERIOD not set");
    const daoThreshold = process.env.DAO_THRESHOLD;
    if (!daoThreshold) throw new Error("DAO_THRESHOLD not set");

    // BondingV2 launch params
    const teamTokenReservedSupply = process.env.TEAM_TOKEN_RESERVED_SUPPLY;
    if (!teamTokenReservedSupply)
      throw new Error("TEAM_TOKEN_RESERVED_SUPPLY not set");
    const teamTokenReservedWallet = process.env.TEAM_TOKEN_RESERVED_WALLET;
    if (!teamTokenReservedWallet)
      throw new Error("TEAM_TOKEN_RESERVED_WALLET not set");

    console.log("\n--- Configuration ---");
    console.log("Reusing existing contracts:");
    console.log("  FFactoryV2:", fFactoryV2Address);
    console.log("  FRouterV2:", fRouterV2Address);
    console.log("  AgentFactoryV6:", agentFactoryV6Address);
    console.log("\nBondingV2 params:");
    console.log("  creationFeeToAddress:", creationFeeToAddress);
    console.log("  feeAmount:", feeAmount);
    console.log("  initialSupply:", initialSupply);
    console.log("  assetRate:", assetRate);
    console.log("  maxTx:", maxTx);
    console.log("  gradThreshold:", gradThreshold);
    console.log("  startTimeDelay:", startTimeDelay);
    console.log("  tbaSalt:", tbaSalt);
    console.log("  tbaImplementation:", tbaImplementation);
    console.log("  daoVotingPeriod:", daoVotingPeriod);
    console.log("  daoThreshold:", daoThreshold);
    console.log("  teamTokenReservedSupply:", teamTokenReservedSupply);
    console.log("  teamTokenReservedWallet:", teamTokenReservedWallet);

    // ============================================
    // 2. Setup signers
    // ============================================
    const [deployer] = await ethers.getSigners();
    console.log("\nDeployer:", await deployer.getAddress());

    const adminSigner = new ethers.Wallet(adminPrivateKey, ethers.provider);
    console.log("Admin signer:", await adminSigner.getAddress());

    // ============================================
    // 3. Get existing contract instances (with admin signer for role grants)
    // ============================================
    const FFactoryV2 = await ethers.getContractFactory("FFactoryV2");
    const fFactoryV2 =
      FFactoryV2.attach(fFactoryV2Address).connect(adminSigner);

    const FRouterV2 = await ethers.getContractFactory("FRouterV2");
    const fRouterV2 = FRouterV2.attach(fRouterV2Address).connect(adminSigner);

    const AgentFactoryV6 = await ethers.getContractFactory("AgentFactoryV6");
    const agentFactoryV6 = AgentFactoryV6.attach(agentFactoryV6Address).connect(
      adminSigner
    );

    // ============================================
    // 4. Deploy BondingV2
    // ============================================
    console.log("\n--- Deploying BondingV2 ---");
    const BondingV2 = await ethers.getContractFactory("BondingV2");
    const bondingV2 = await upgrades.deployProxy(
      BondingV2,
      [
        fFactoryV2Address, // factory_
        fRouterV2Address, // router_
        creationFeeToAddress, // feeTo_
        feeAmount, // fee_
        initialSupply, // initialSupply_
        assetRate, // assetRate_
        maxTx, // maxTx_
        agentFactoryV6Address, // agentFactory_
        gradThreshold, // gradThreshold_
        startTimeDelay, // startTimeDelay_
      ],
      {
        initializer: "initialize",
        initialOwner: contractController,
      }
    );
    await bondingV2.waitForDeployment();
    const bondingV2Address = await bondingV2.getAddress();
    console.log("BondingV2 deployed at:", bondingV2Address);

    // ============================================
    // 5. Set DeployParams for BondingV2
    // ============================================
    console.log("\n--- Setting DeployParams for BondingV2 ---");
    const deployParams = {
      tbaSalt: tbaSalt,
      tbaImplementation: tbaImplementation,
      daoVotingPeriod: daoVotingPeriod,
      daoThreshold: daoThreshold,
    };
    await (await bondingV2.setDeployParams(deployParams)).wait();
    console.log("DeployParams set");

    // ============================================
    // 6. Set LaunchParams for BondingV2
    // ============================================
    console.log("\n--- Setting LaunchParams for BondingV2 ---");
    const launchParams = {
      startTimeDelay: startTimeDelay,
      teamTokenReservedSupply: teamTokenReservedSupply,
      teamTokenReservedWallet: teamTokenReservedWallet,
    };
    await (await bondingV2.setLaunchParams(launchParams)).wait();
    console.log("LaunchParams set");

    // ============================================
    // 7. Grant roles (using adminSigner)
    // ============================================
    console.log("\n--- Granting roles (using admin signer) ---");

    // Grant CREATOR_ROLE of FFactoryV2 to BondingV2
    await (
      await fFactoryV2.grantRole(
        await fFactoryV2.CREATOR_ROLE(),
        bondingV2Address
      )
    ).wait();
    console.log(
      "CREATOR_ROLE of FFactoryV2 granted to BondingV2:",
      bondingV2Address
    );

    // Grant EXECUTOR_ROLE of FRouterV2 to BondingV2
    await (
      await fRouterV2.grantRole(
        await fRouterV2.EXECUTOR_ROLE(),
        bondingV2Address
      )
    ).wait();
    console.log(
      "EXECUTOR_ROLE of FRouterV2 granted to BondingV2:",
      bondingV2Address
    );

    // Grant BONDING_ROLE of AgentFactoryV6 to BondingV2
    await (
      await agentFactoryV6.grantRole(
        await agentFactoryV6.BONDING_ROLE(),
        bondingV2Address
      )
    ).wait();
    console.log(
      "BONDING_ROLE of AgentFactoryV6 granted to BondingV2:",
      bondingV2Address
    );

    // ============================================
    // 8. Transfer ownership of BondingV2
    // ============================================
    console.log("\n--- Transferring BondingV2 ownership ---");
    await (await bondingV2.transferOwnership(contractController)).wait();
    console.log(
      "BondingV2 ownership transferred to CONTRACT_CONTROLLER:",
      contractController
    );

    // ============================================
    // 9. Summary
    // ============================================
    console.log("\n=== Deployment Summary ===");
    console.log("BondingV2:", bondingV2Address);
    console.log("\nReused contracts:");
    console.log("  FFactoryV2:", fFactoryV2Address);
    console.log("  FRouterV2:", fRouterV2Address);
    console.log("  AgentFactoryV6:", agentFactoryV6Address);
    console.log("\nRoles granted:");
    console.log("  CREATOR_ROLE of FFactoryV2 -> BondingV2");
    console.log("  EXECUTOR_ROLE of FRouterV2 -> BondingV2");
    console.log("  BONDING_ROLE of AgentFactoryV6 -> BondingV2");
    console.log("\n✅ Deployment completed successfully!");
  } catch (e) {
    console.error("Deployment failed:", e);
    throw e;
  }
})();
