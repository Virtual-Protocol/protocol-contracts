const { ethers } = require("hardhat");

async function main() {
  try {
    console.log("\n=== Multicall3 Deployment Starting ===");

    // Check for required environment variables
    const adminAddress = process.env.ADMIN;
    if (!adminAddress) {
      throw new Error("ADMIN not set in environment");
    }
    const beOpsWallet = process.env.BE_OPS_WALLET;
    if (!beOpsWallet) {
      throw new Error("BE_OPS_WALLET not set in environment");
    }

    const sniperWallet = process.env.SNIPER_WALLET;
    if (!sniperWallet) {
      throw new Error("SNIPER_WALLET not set in environment");
    }

    // Get deployer
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log(
      "Account balance:",
      ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
      "ETH"
    );
    console.log("Target owner (ADMIN):", adminAddress);

    // Deploy Multicall3
    console.log("\n--- Deploying Multicall3 ---");
    const Multicall3 = await ethers.getContractFactory("Multicall3");
    const multicall3 = await Multicall3.deploy();
    await multicall3.waitForDeployment();
    const multicall3Address = await multicall3.getAddress();

    console.log("✅ Multicall3 deployed to:", multicall3Address);
    console.log("✅ Initial owner:", await multicall3.owner());

    // Optional: Grant admin role if ADMIN is set in environment
    // Note: This must be done BEFORE ownership transfer
    console.log("\n--- Granting Admin Role to BE Ops Wallet ---");
    console.log("⚠️  Note: Granting admin BEFORE ownership transfer");
    const tx = await multicall3.grantAdmin(beOpsWallet);
    await tx.wait();
    console.log("✅ Admin role granted to:", beOpsWallet);
    console.log("✅ beOpsWallet Is admin:", await multicall3.isAdmin(beOpsWallet));

    const tx2 = await multicall3.grantAdmin(sniperWallet);
    await tx2.wait();
    console.log("✅ Admin role granted to:", sniperWallet);
    console.log("✅ beOpsWallet Is admin:", await multicall3.isAdmin(sniperWallet));

    // Transfer ownership to CONTRACT_CONTROLLER if different from deployer
    if (adminAddress && adminAddress.toLowerCase() !== deployer.address.toLowerCase()) {
      console.log("\n--- Transferring Ownership ---");
      const transferTx = await multicall3.transferOwnership(adminAddress);
      await transferTx.wait();
      console.log("✅ Ownership transferred to:", adminAddress);
      console.log("✅ New current owner:", await multicall3.owner());
    }

    // Display deployment summary
    console.log("\n=== Deployment Summary ===");
    console.log("Multicall3:", multicall3Address);
    console.log("Owner:", adminAddress);
    console.log("Admin:", adminAddress);

    // Display verification commands
    console.log("\n=== Verification Commands ===");
    console.log(
      `npx hardhat verify --network ${
        process.env.HARDHAT_NETWORK || "hardhat"
      } ${multicall3Address}`
    );

    console.log("\n=== Deployment Complete ===");

    return {
      multicall3: multicall3Address,
    };
  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    throw error;
  }
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
