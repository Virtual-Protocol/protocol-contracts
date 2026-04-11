/**
 * Verify an already-deployed contract on Monad using the same flow as verifyContract (Sourcify + MonadScan).
 * `npx hardhat verify` alone cannot use the Monad Sourcify URL without breaking other chains in hardhat.config.
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev_monad_testnet \\
 *     VERIFY_ADDRESS=0x... \\
 *     npx hardhat run scripts/launchpadv5/verifyMonadSourcify.ts --network monad_testnet
 *
 * Optional:
 *   VERIFY_CONTRACT=contracts/path/Contract.sol:ContractName
 *   VERIFY_CONSTRUCTOR_ARGS_JSON='["arg1","0x...",18]'   (JSON array, empty [] if no args)
 */
import { verifyContract } from "./utils";

const hre = require("hardhat");

function parseConstructorArgs(): unknown[] {
  const raw = process.env.VERIFY_CONSTRUCTOR_ARGS_JSON?.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("VERIFY_CONSTRUCTOR_ARGS_JSON must be a JSON array");
  }
  return parsed;
}

(async () => {
  const net = hre.network.name;
  if (net !== "monad_testnet" && net !== "monad_mainnet") {
    throw new Error(
      `Use --network monad_testnet or monad_mainnet (current: ${net})`
    );
  }
  const address = process.env.VERIFY_ADDRESS?.trim();
  if (!address) {
    throw new Error("Set VERIFY_ADDRESS=0x...");
  }
  const contract = process.env.VERIFY_CONTRACT?.trim() || undefined;
  const constructorArguments = parseConstructorArgs();

  await verifyContract(address, constructorArguments as any[], {
    ...(contract ? { contract } : {}),
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
