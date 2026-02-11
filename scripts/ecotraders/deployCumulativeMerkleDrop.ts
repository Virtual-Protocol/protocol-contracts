import { ethers } from "hardhat";

/**
 * Deployment script for CumulativeMerkleDrop contract
 *
 * This contract allows users to claim tokens via merkle proof and automatically
 * stake them in veVirtual as eco locks.
 *
 * Environment variables required:
 * - VIRTUAL_TOKEN_ADDRESS: Address of the VIRTUAL token contract
 * - VE_VIRTUAL_PROXY_ADDRESS: Address of the veVirtual proxy contract
 * - BE_OPS_WALLET: Address that will be the owner of the contract (for setMerkleRoot)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying CumulativeMerkleDrop with account:", deployer.address);

  // Check required environment variables
  const VIRTUAL_TOKEN_ADDRESS = process.env.VIRTUAL_TOKEN_ADDRESS;
  if (!VIRTUAL_TOKEN_ADDRESS) {
    throw new Error("VIRTUAL_TOKEN_ADDRESS not set in environment");
  }

  const VE_VIRTUAL_PROXY_ADDRESS = process.env.VE_VIRTUAL_PROXY_ADDRESS;
  if (!VE_VIRTUAL_PROXY_ADDRESS) {
    throw new Error("VE_VIRTUAL_PROXY_ADDRESS not set in environment");
  }

  const BE_OPS_WALLET = process.env.BE_OPS_WALLET;
  if (!BE_OPS_WALLET) {
    throw new Error("BE_OPS_WALLET not set in environment");
  }

  console.log("\n=== Deployment Parameters ===");
  console.log("VIRTUAL Token Address:", VIRTUAL_TOKEN_ADDRESS);
  console.log("veVirtual Proxy Address:", VE_VIRTUAL_PROXY_ADDRESS);
  console.log("BE Ops Wallet (will be owner):", BE_OPS_WALLET);
  console.log("Deployer Address:", deployer.address);
  console.log("===========================\n");

  // Deploy CumulativeMerkleDrop
  console.log("Deploying CumulativeMerkleDrop...");
  const CumulativeMerkleDropFactory = await ethers.getContractFactory(
    "CumulativeMerkleDrop"
  );

  const cumulativeMerkleDrop = await CumulativeMerkleDropFactory.deploy(
    VIRTUAL_TOKEN_ADDRESS,
    VE_VIRTUAL_PROXY_ADDRESS
  );

  await cumulativeMerkleDrop.waitForDeployment();
  const deployedAddress = await cumulativeMerkleDrop.getAddress();

  console.log("\n✅ CumulativeMerkleDrop deployed successfully!");
  console.log("Contract Address:", deployedAddress);

  // Verify initial ownership (should be deployer)
  const initialOwner = await cumulativeMerkleDrop.owner();
  console.log("Initial Owner (deployer):", initialOwner);

  // Transfer ownership to BE_OPS_WALLET
  console.log("\n=== Transferring Ownership ===");
  console.log("Transferring ownership from deployer to BE_OPS_WALLET...");

  const transferTx = await cumulativeMerkleDrop.transferOwnership(
    BE_OPS_WALLET
  );
  await transferTx.wait();

  console.log("✅ Ownership transfer transaction sent:", transferTx.hash);

  // Verify new ownership
  const newOwner = await cumulativeMerkleDrop.owner();
  console.log("New Owner:", newOwner);

  if (newOwner.toLowerCase() !== BE_OPS_WALLET.toLowerCase()) {
    throw new Error(
      "Ownership transfer failed! Owner does not match BE_OPS_WALLET"
    );
  }

  console.log("✅ Ownership successfully transferred to BE_OPS_WALLET");
  console.log("===============================\n");

  // Verify contract state
  console.log("\n=== Contract Verification ===");
  const token = await cumulativeMerkleDrop.token();
  const veVirtualContract = await cumulativeMerkleDrop.veVirtualContract();
  const merkleRoot = await cumulativeMerkleDrop.merkleRoot();

  console.log("Token Address:", token);
  console.log("veVirtual Contract:", veVirtualContract);
  console.log("Initial Merkle Root:", merkleRoot);
  console.log("=============================\n");

  // Verify addresses match
  if (token.toLowerCase() !== VIRTUAL_TOKEN_ADDRESS.toLowerCase()) {
    throw new Error("Token address mismatch!");
  }
  if (
    veVirtualContract.toLowerCase() !== VE_VIRTUAL_PROXY_ADDRESS.toLowerCase()
  ) {
    throw new Error("veVirtual address mismatch!");
  }

  console.log("✅ All addresses verified successfully!");

  console.log("\n=== Next Steps ===");
  console.log("1. Set merkle root using:");
  console.log(
    `   await cumulativeMerkleDrop.setMerkleRoot("YOUR_MERKLE_ROOT")`
  );
  console.log("2. Transfer VIRTUAL tokens to the contract for distribution");
  console.log(`   await virtualToken.transfer("${deployedAddress}", amount)`);
  console.log("3. Users can now call claimAndMaxStake() with merkle proofs");
  console.log("==================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
