const { ethers } = require("hardhat");

async function main() {
  try {
    console.log("\n=== Multicall3 Deployment Starting ===");

    // Check for required environment variables
    const contractController = process.env.CONTRACT_CONTROLLER;
    if (!contractController) {
      throw new Error("CONTRACT_CONTROLLER not set in environment");
    }

    // Get deployer
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log(
      "Account balance:",
      ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
      "ETH"
    );
    console.log("Target owner (CONTRACT_CONTROLLER):", contractController);

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
    const adminAddress = process.env.ADMIN;
    if (
      adminAddress &&
      adminAddress.toLowerCase() !== deployer.address.toLowerCase() &&
      adminAddress.toLowerCase() !== contractController.toLowerCase()
    ) {
      console.log("\n--- Granting Admin Role ---");
      console.log("⚠️  Note: Granting admin BEFORE ownership transfer");
      const tx = await multicall3.grantAdmin(adminAddress);
      await tx.wait();
      console.log("✅ Admin role granted to:", adminAddress);
      console.log("✅ Is admin:", await multicall3.isAdmin(adminAddress));
    } else if (adminAddress) {
      console.log(
        "\n⚠️  ADMIN is the same as deployer or CONTRACT_CONTROLLER, no admin grant needed"
      );
    }

    // Transfer ownership to CONTRACT_CONTROLLER if different from deployer
    if (contractController.toLowerCase() !== deployer.address.toLowerCase()) {
      console.log("\n--- Transferring Ownership ---");
      const transferTx = await multicall3.transferOwnership(contractController);
      await transferTx.wait();
      console.log("✅ Ownership transferred to:", contractController);
      console.log("✅ Current owner:", await multicall3.owner());
    } else {
      console.log(
        "\n⚠️  CONTRACT_CONTROLLER is the same as deployer, no transfer needed"
      );
    }

    // Display deployment summary
    console.log("\n=== Deployment Summary ===");
    console.log("Multicall3:", multicall3Address);
    console.log("Owner:", contractController);
    if (
      adminAddress &&
      adminAddress.toLowerCase() !== deployer.address.toLowerCase() &&
      adminAddress.toLowerCase() !== contractController.toLowerCase()
    ) {
      console.log("Admin:", adminAddress);
    }

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
