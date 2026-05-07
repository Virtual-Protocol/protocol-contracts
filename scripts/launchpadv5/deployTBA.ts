/**
 * Deploy TBA Registry + TBA Implementation for chains where they are not yet deployed
 * (e.g. X Layer mainnet / testnet).
 *
 * Deploys:
 *   - ERC6551Registry  (canonical ERC-6551 registry)
 *   - AccountV3Upgradable (Tokenbound TBA implementation)
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev_xlayer_testnet \
 *     npx hardhat run scripts/launchpadv5/deployTBA.ts --network xlayer_testnet
 *
 *   ENV_FILE=.env.launchpadv5_prod_xlayer \
 *     npx hardhat run scripts/launchpadv5/deployTBA.ts --network xlayer_mainnet
 *
 * Required env vars:
 *   (none — all have sensible defaults or are optional)
 *
 * Optional env vars:
 *   ENTRY_POINT            ERC-4337 EntryPoint address
 *                          Default: 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789 (v0.6 canonical)
 *   MULTICALL_FORWARDER    MulticallForwarder address; use address(0) if not deployed on chain
 *                          Default: 0x0000000000000000000000000000000000000000
 *   ACCOUNT_GUARDIAN       AccountGuardian address; use address(0) if not deployed on chain
 *                          (note: address(0) disables UUPS upgrades — suitable for initial deploy)
 *                          Default: 0x0000000000000000000000000000000000000000
 *   TBA_REGISTRY_ADDRESS   Skip registry deployment and use this existing address instead
 *
 * After running, copy the printed env vars into your network's .env file:
 *   TBA_REGISTRY=<address>
 *   TBA_IMPLEMENTATION=<address>
 */

import { verifyContract } from "./utils";

const { ethers } = require("hardhat");

// ERC-4337 EntryPoint v0.6 — deployed at the same address on most EVM chains
const DEFAULT_ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

(async () => {
  try {
    console.log("\n" + "=".repeat(80));
    console.log("  TBA Deployment: ERC6551Registry + AccountV3Upgradable");
    console.log("=".repeat(80));

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const network = (await ethers.provider.getNetwork()).name;

    console.log("Deployer address:", deployerAddress);
    console.log(
      "Deployer balance:",
      ethers.formatEther(await ethers.provider.getBalance(deployerAddress)),
      "ETH"
    );

    // ── Constructor arguments ──────────────────────────────────────────────
    const entryPoint = process.env.ENTRY_POINT ?? DEFAULT_ENTRY_POINT;
    const multicallForwarder = process.env.MULTICALL_FORWARDER ?? ZERO_ADDRESS;
    const accountGuardian = process.env.ACCOUNT_GUARDIAN ?? ZERO_ADDRESS;
    const existingRegistry = process.env.TBA_REGISTRY_ADDRESS;

    console.log("\nConfiguration:");
    console.log("  ENTRY_POINT         :", entryPoint);
    console.log("  MULTICALL_FORWARDER :", multicallForwarder);
    console.log("  ACCOUNT_GUARDIAN    :", accountGuardian);
    if (existingRegistry) {
      console.log("  TBA_REGISTRY_ADDRESS:", existingRegistry, "(skipping registry deploy)");
    }
    if (multicallForwarder === ZERO_ADDRESS) {
      console.log(
        "  ⚠️  MULTICALL_FORWARDER is zero — ERC-2771 meta-tx will be disabled"
      );
    }
    if (accountGuardian === ZERO_ADDRESS) {
      console.log(
        "  ⚠️  ACCOUNT_GUARDIAN is zero — UUPS upgrades will be disabled"
      );
    }

    const deployedContracts: Record<string, string> = {};

    // ── 1. Deploy ERC6551Registry ──────────────────────────────────────────
    let registryAddress: string;

    if (existingRegistry) {
      registryAddress = existingRegistry;
      console.log("\n--- Reusing existing ERC6551Registry ---");
      console.log("ERC6551Registry address:", registryAddress);
    } else {
      console.log("\n--- Deploying ERC6551Registry ---");
      const ERC6551Registry = await ethers.getContractFactory(
        "contracts/tba/ERC6551Registry.sol:ERC6551Registry"
      );
      const registry = await ERC6551Registry.deploy();
      await registry.waitForDeployment();
      registryAddress = await registry.getAddress();
      console.log("✅ ERC6551Registry deployed at:", registryAddress);
      deployedContracts["TBA_REGISTRY"] = registryAddress;

      await verifyContract(registryAddress, [], {
        contract: "contracts/tba/ERC6551Registry.sol:ERC6551Registry",
      });
    }

    // ── 2. Deploy AccountV3Upgradable ──────────────────────────────────────
    console.log("\n--- Deploying AccountV3Upgradable ---");
    console.log("Constructor args:");
    console.log("  entryPoint_        :", entryPoint);
    console.log("  multicallForwarder :", multicallForwarder);
    console.log("  erc6551Registry    :", registryAddress);
    console.log("  guardian           :", accountGuardian);

    const AccountV3Upgradable = await ethers.getContractFactory(
      "contracts/tba/AccountV3Upgradable.sol:AccountV3Upgradable"
    );
    const implementation = await AccountV3Upgradable.deploy(
      entryPoint,
      multicallForwarder,
      registryAddress,
      accountGuardian
    );
    await implementation.waitForDeployment();
    const implementationAddress = await implementation.getAddress();
    console.log("✅ AccountV3Upgradable deployed at:", implementationAddress);
    deployedContracts["TBA_IMPLEMENTATION"] = implementationAddress;

    await verifyContract(
      implementationAddress,
      [entryPoint, multicallForwarder, registryAddress, accountGuardian],
      { contract: "contracts/tba/AccountV3Upgradable.sol:AccountV3Upgradable" }
    );

    // ── 3. Summary ─────────────────────────────────────────────────────────
    console.log("\n" + "=".repeat(80));
    console.log("  Deployment Summary");
    console.log("=".repeat(80));

    console.log("\n--- Newly Deployed Contracts ---");
    for (const [name, address] of Object.entries(deployedContracts)) {
      console.log(`${name}=${address}`);
    }

    console.log("\n--- Add these to your .env file ---");
    console.log(`TBA_REGISTRY=${registryAddress}`);
    console.log(`TBA_IMPLEMENTATION=${implementationAddress}`);

    console.log("\n--- Next Steps ---");
    console.log(
      "1. Copy TBA_REGISTRY and TBA_IMPLEMENTATION into your network .env file"
    );
    console.log(
      "2. Run deployLaunchpadv5_2.ts (uses TBA_REGISTRY) and deployLaunchpadv5_3.ts (uses TBA_IMPLEMENTATION)"
    );
    if (accountGuardian === ZERO_ADDRESS) {
      console.log(
        "3. ⚠️  To enable UUPS upgrades later, redeploy with ACCOUNT_GUARDIAN set to a deployed AccountGuardian"
      );
    }

    console.log("\n" + "=".repeat(80));
    console.log("  TBA Deployment Completed Successfully!");
    console.log("=".repeat(80));
  } catch (e) {
    console.error("❌ Deployment failed:", e);
    process.exit(1);
  }
})();
