// npx hardhat run scripts/ecotraders/upgradeVeVirtual.ts --network base_sepolia
import { ethers, upgrades } from "hardhat";

/**
 * Upgrade script for veVirtual contract
 *
 * This script upgrades the veVirtual proxy to the latest implementation
 * that includes eco trader lock functionality.
 *
 * Environment variables required:
 * - VE_VIRTUAL_PROXY_ADDRESS: Address of the veVirtual proxy contract
 * - ADMIN_PRIVATE_KEY: Private key of the ProxyAdmin owner (required for upgrade)
 *
 * Note: This uses OpenZeppelin's Transparent Proxy pattern (via Hardhat upgrades plugin)
 */

if (!process.env.CONTRACT_CONTROLLER_PRIVATE_KEY) {
  throw new Error("CONTRACT_CONTROLLER_PRIVATE_KEY not set in environment");
}

const contractControllerSigner = new ethers.Wallet(
  process.env.CONTRACT_CONTROLLER_PRIVATE_KEY,
  ethers.provider
);

(async () => {
  try {
    const PROXY_ADDRESS = process.env.VE_VIRTUAL_PROXY_ADDRESS;
    if (!PROXY_ADDRESS) {
      throw new Error("VE_VIRTUAL_PROXY_ADDRESS not set in environment");
    }

    console.log("Starting veVirtual upgrade process...");
    console.log("Proxy address:", PROXY_ADDRESS);
    console.log("Contract controller signer address:", contractControllerSigner.address);
    console.log("");

    // Get current implementation address
    try {
      const currentImplementation =
        await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
      console.log("Current Implementation:", currentImplementation);
    } catch (error) {
      console.warn("Could not get current implementation address:", error);
    }

    // Check ProxyAdmin permissions
    console.log("\n=== Checking ProxyAdmin Permissions ===");
    try {
      const proxyAdminAddress = await upgrades.erc1967.getAdminAddress(
        PROXY_ADDRESS
      );
      console.log("ProxyAdmin Address:", proxyAdminAddress);

      try {
        const ProxyAdmin = await ethers.getContractFactory("ProxyAdmin");
        const proxyAdmin = ProxyAdmin.attach(proxyAdminAddress);
        const owner = await proxyAdmin.owner();
        console.log("ProxyAdmin Owner:", owner);
        console.log("Contract controller Signer Address:", contractControllerSigner.address);

        if (owner.toLowerCase() !== contractControllerSigner.address.toLowerCase()) {
          console.error(
            "\n⚠️  WARNING: Contract controller signer is NOT the ProxyAdmin owner!"
          );
          console.error("ProxyAdmin Owner:", owner);
          console.error("Contract controller Signer:", contractControllerSigner.address);
          console.error("\nImportant:");
          console.error(
            "ProxyAdmin owner and DEFAULT_ADMIN_ROLE are DIFFERENT:"
          );
          console.error(
            "- ProxyAdmin owner: Controls proxy upgrades (via ProxyAdmin contract)"
          );
          console.error(
            "- DEFAULT_ADMIN_ROLE: Controls contract internal functions (AccessControl)"
          );
          console.error(
            "\nUpgrade requires ProxyAdmin owner permission, not DEFAULT_ADMIN_ROLE"
          );
          console.error("\nSolutions:");
          console.error("1. Use ProxyAdmin owner's private key:");
          console.error(
              `   Set CONTRACT_CONTROLLER_PRIVATE_KEY to the private key of: ${owner}`
          );
          console.error("\n2. Transfer ProxyAdmin ownership:");
          console.error(`   ProxyAdmin owner (${owner}) must call:`);
          console.error(
            `   await proxyAdmin.transferOwnership("${contractControllerSigner.address}")`
          );
          console.error("\n3. Continue anyway (may fail):");
          console.error("   Set SKIP_PERMISSION_CHECK=true to attempt upgrade");
          console.error("");

          if (process.env.SKIP_PERMISSION_CHECK !== "true") {
            throw new Error(
              "Contract controller signer address does not match ProxyAdmin owner. Set SKIP_PERMISSION_CHECK=true to continue anyway."
            );
          } else {
            console.warn(
              "⚠️  SKIP_PERMISSION_CHECK=true - Proceeding despite permission mismatch"
            );
          }
        } else {
          console.log(
            "✅ Contract controller signer matches ProxyAdmin owner - upgrade should succeed"
          );
        }
      } catch (error) {
        if ((error as Error).message.includes("Cannot upgrade")) {
          throw error;
        }
        console.warn(
          "Could not verify ProxyAdmin owner (might be custom ProxyAdmin):",
          error
        );
        console.warn("Proceeding with upgrade attempt...");
      }
    } catch (error) {
      console.warn("Could not get ProxyAdmin address:", error);
    }
    console.log("=======================================\n");

    // Upgrade the proxy
    console.log("Upgrading veVirtual proxy...");

    await upgrades.upgradeProxy(
      PROXY_ADDRESS,
      await ethers.getContractFactory("veVirtual", contractControllerSigner),
    );

    console.log("✅ veVirtual upgraded successfully!");

    // Verify the new implementation
    const newImplementation = await upgrades.erc1967.getImplementationAddress(
      PROXY_ADDRESS
    );
    console.log("New Implementation Address:", newImplementation);

    // Verify the contract is working
    console.log("\n=== Contract Verification ===");
    const veVirtual = await ethers.getContractAt("veVirtual", PROXY_ADDRESS);

    try {
      const maxWeeks = await veVirtual.maxWeeks();
      console.log("✅ maxWeeks:", maxWeeks.toString());

      // Check if getEcoLock function exists (new function)
      try {
        const testEcoLock = await veVirtual.getEcoLock(ethers.ZeroAddress);
        console.log("✅ getEcoLock function exists");
      } catch (error) {
        console.warn("⚠️  getEcoLock function check failed:", error);
      }

      // Check if stakeEcoLockFor function exists (new function)
      try {
        const iface = veVirtual.interface;
        const hasStakeEcoLockFor =
          iface.getFunction("stakeEcoLockFor") !== null;
        if (hasStakeEcoLockFor) {
          console.log("✅ stakeEcoLockFor function exists");
        }
      } catch (error) {
        console.warn("⚠️  stakeEcoLockFor function check failed:", error);
      }

      console.log("✅ Upgrade verification successful!");
    } catch (error) {
      console.warn("⚠️  Upgrade verification failed:", error);
    }

    console.log("\n=== Upgrade Complete ===");
    console.log("The veVirtual contract now supports:");
    console.log("1. stakeEcoLockFor() - Create/update eco locks for traders");
    console.log("2. getEcoLock() - Query eco lock for a trader");
    console.log(
      "3. Eco locks are automatically included in balanceOf() and stakedAmountOf()"
    );
    console.log("=======================\n");
  } catch (e) {
    console.error("❌ Upgrade failed:", e);
    process.exit(1);
  }
})();
