/**
 * Upgrade BondingV5 transparent proxy using CONTRACT_CONTROLLER (ProxyAdmin owner).
 *
 * Usage:
 *   BONDING_V5_ADDRESS=0x... npx hardhat run scripts/launchpadv5/upgradeBondingV5.ts --network bsc_testnet
 *
 * Requires: CONTRACT_CONTROLLER_PRIVATE_KEY, CONTRACT_CONTROLLER, BONDING_V5_ADDRESS
 */
import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const proxyAddress =
      process.env.BONDING_V5_ADDRESS ||
      "0x272b5917d81b0085fb0F9DedfE883928eB226CFC";

    if (!process.env.CONTRACT_CONTROLLER_PRIVATE_KEY) {
      throw new Error("CONTRACT_CONTROLLER_PRIVATE_KEY is not set");
    }
    if (!process.env.CONTRACT_CONTROLLER) {
      throw new Error("CONTRACT_CONTROLLER is not set");
    }

    const controllerWallet = new ethers.Wallet(
      process.env.CONTRACT_CONTROLLER_PRIVATE_KEY,
      ethers.provider
    );
    console.log("Using CONTRACT_CONTROLLER:", controllerWallet.address);
    console.log("Expected CONTRACT_CONTROLLER:", process.env.CONTRACT_CONTROLLER);

    if (
      controllerWallet.address.toLowerCase() !==
      process.env.CONTRACT_CONTROLLER.toLowerCase()
    ) {
      throw new Error(
        "CONTRACT_CONTROLLER_PRIVATE_KEY does not match CONTRACT_CONTROLLER address"
      );
    }

    const currentImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    const admin = await upgrades.erc1967.getAdminAddress(proxyAddress);
    console.log("Proxy:", proxyAddress);
    console.log("Current implementation:", currentImpl);
    console.log("ProxyAdmin:", admin);

    const proxyAdmin = await ethers.getContractAt(
      ["function owner() view returns (address)"],
      admin
    );
    const owner = await proxyAdmin.owner();
    console.log("ProxyAdmin.owner:", owner);
    if (owner.toLowerCase() !== controllerWallet.address.toLowerCase()) {
      throw new Error(
        `ProxyAdmin owner ${owner} != CONTRACT_CONTROLLER ${controllerWallet.address}`
      );
    }

    const BondingV5 = await ethers.getContractFactory("BondingV5");
    const contract = BondingV5.connect(controllerWallet);

    // Proxy may have been upgraded outside this manifest (or by another machine).
    // Import the existing deployment so OZ can validate storage + perform the upgrade.
    try {
      console.log("Force-importing existing proxy into OpenZeppelin manifest...");
      await upgrades.forceImport(proxyAddress, contract, { kind: "transparent" });
      console.log("forceImport OK");
    } catch (importErr: any) {
      // Already registered is fine
      const msg = importErr?.message || String(importErr);
      if (!/already imported|already registered/i.test(msg)) {
        console.log("forceImport note:", msg);
      }
    }

    console.log("Upgrading BondingV5...");
    // Parent-initializer order warning is pre-existing on BondingV5; allow so the upgrade can proceed.
    // redeployImplementation: 'always' — forceImport can wrongly bind the *new* artifact hash to the
    // *old* impl address when local source has advanced; without this OZ may skip deploying.
    const upgraded = await upgrades.upgradeProxy(proxyAddress, contract, {
      unsafeAllow: ["incorrect-initializer-order"],
      redeployImplementation: "always",
    });
    await upgraded.waitForDeployment();

    const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log("Upgraded proxy:", await upgraded.getAddress());
    console.log("Previous implementation:", currentImpl);
    console.log("New implementation:", newImpl);
    if (newImpl.toLowerCase() === currentImpl.toLowerCase()) {
      throw new Error(
        "Implementation address unchanged after upgrade — redeploy did not take effect"
      );
    }
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
})();
