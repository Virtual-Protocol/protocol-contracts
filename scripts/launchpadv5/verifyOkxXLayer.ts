/**
 * Verify one already-deployed contract on OKX X Layer via OKLink (same path as utils.verifyContract on xlayer_*).
 * Use this for ad-hoc verification; batch env-driven verification stays in verifyLaunchpadv5FromEnv.ts.
 *
 * OKLink plugin URL is set in hardhat.config.js customChains (`verify-source-code-plugin/XLAYER_TESTNET` / `XLAYER`).
 * utils.verifyContract temporarily sets per-network etherscan.apiKey so Hardhat does not force api.etherscan.io/v2.
 *
 * Docs (OKLink): https://www.oklink.com/docs/zh/#explorer-api-tools-contract-verification-verify-source-code
 * Plugin: https://github.com/okx/hardhat-explorer-verify — uses `hardhat.config.js` → `okxweb3explorer`.
 *
 * Usage A — same as verifyMonadSourcify.ts (runs utils.verifyContract → okverify internally):
 *   ENV_FILE=.env.launchpadv5_dev_xlayer_testnet \\
 *     VERIFY_ADDRESS=0x... \\
 *     npx hardhat run scripts/launchpadv5/verifyOkxXLayer.ts --network xlayer_testnet
 *
 * Usage B — CLI directly (constructor args as trailing positionals when needed):
 *   npx hardhat okverify --network xlayer_testnet 0x...
 *   npx hardhat okverify --network xlayer_testnet --contract contracts/Foo.sol:Foo --proxy 0x...
 *
 * Optional:
 *   VERIFY_CONTRACT=contracts/path/Contract.sol:ContractName
 *   VERIFY_CONSTRUCTOR_ARGS_JSON='["arg1","0x...",18]'   (JSON array, empty [] if none)
 *   OKLINK_API_KEY=...   (optional; falls back to ETHERSCAN_API_KEY then placeholder — see utils.ts)
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
  if (net !== "xlayer_testnet" && net !== "xlayer_mainnet") {
    throw new Error(
      `Use --network xlayer_testnet or xlayer_mainnet (current: ${net})`
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
