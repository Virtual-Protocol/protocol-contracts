/**
 * Grant BE_OPS_ROLE on FRouterV3 to BE_OPS_WALLET.
 *
 * The caller must hold DEFAULT_ADMIN_ROLE on FRouterV3.
 * After deployLaunchpadv5_4.ts revokes the deployer's roles, only the ADMIN
 * wallet retains DEFAULT_ADMIN_ROLE — so this script uses ADMIN_PRIVATE_KEY.
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev_robinhood_testnet npx hardhat run scripts/launchpadv5/grantFRouterV3BeOpsRole.ts --network robinhood_testnet
 *   ENV_FILE=.env.launchpadv5_dev_abstract_testnet   npx hardhat run scripts/launchpadv5/grantFRouterV3BeOpsRole.ts --network abstract_testnet
 */

const { ethers } = require("hardhat");

async function main() {
  const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY;
  if (!adminPrivateKey) throw new Error("ADMIN_PRIVATE_KEY not set in environment");

  const fRouterV3Address = process.env.FRouterV3_ADDRESS;
  if (!fRouterV3Address) throw new Error("FRouterV3_ADDRESS not set in environment");

  const beOpsWallet = process.env.BE_OPS_WALLET;
  if (!beOpsWallet) throw new Error("BE_OPS_WALLET not set in environment");

  // Use ADMIN_PRIVATE_KEY — the ADMIN wallet holds DEFAULT_ADMIN_ROLE after deployer roles are revoked
  const pk = adminPrivateKey.startsWith("0x") ? adminPrivateKey : `0x${adminPrivateKey}`;
  const adminSigner = new ethers.Wallet(pk, ethers.provider);
  console.log("Caller (ADMIN):", adminSigner.address);
  console.log("FRouterV3:", fRouterV3Address);
  console.log("BE_OPS_WALLET:", beOpsWallet);

  const fRouterV3 = (await ethers.getContractAt("FRouterV3", fRouterV3Address)).connect(adminSigner);
  const beOpsRole = await fRouterV3.BE_OPS_ROLE();
  console.log("BE_OPS_ROLE:", beOpsRole);

  const alreadyGranted = await fRouterV3.hasRole(beOpsRole, beOpsWallet);
  if (alreadyGranted) {
    console.log("✅ BE_OPS_ROLE already granted to BE_OPS_WALLET — nothing to do.");
    return;
  }

  console.log("\nGranting BE_OPS_ROLE...");
  const tx = await fRouterV3.grantRole(beOpsRole, beOpsWallet);
  console.log("tx:", tx.hash);
  await tx.wait();

  const confirmed = await fRouterV3.hasRole(beOpsRole, beOpsWallet);
  if (!confirmed) throw new Error("hasRole returned false after grantRole — unexpected");

  console.log("✅ BE_OPS_ROLE granted to BE_OPS_WALLET:", beOpsWallet);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌", err);
    process.exit(1);
  });
