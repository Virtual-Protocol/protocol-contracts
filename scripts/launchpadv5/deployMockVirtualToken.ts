/**
 * Deploy MockERC20Decimals as a stand-in for VIRTUAL on a testnet (18 decimals by default),
 * minting the full supply to the deployer (or MINT_TO) in the constructor — same pattern as
 * deployUniswapV2TestnetLiquidity.ts mock mUSDC deploy.
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev_abstract_testnet npx hardhat run scripts/launchpadv5/deployMockVirtualToken.ts --network abstract_testnet
 *
 * Optional env:
 *   MOCK_VIRTUAL_NAME              default "Mock VIRTUAL"
 *   MOCK_VIRTUAL_SYMBOL            default "mVIRTUAL"
 *   MOCK_VIRTUAL_DECIMALS          default "18"
 *   MOCK_VIRTUAL_INITIAL_SUPPLY    human amount (default "1000000000" = 1B tokens)
 *   MINT_TO                        recipient of initial supply (default: deployer address)
 *
 * When ENV_FILE is set, writes VIRTUAL_TOKEN_ADDRESS and AGENT_TAX_TAX_TOKEN (same as VIRTUAL on testnets).
 */
import { parseUnits } from "ethers";
import {
  verifyContract,
  upsertLaunchpadEnvFile,
} from "./utils";

const hre = require("hardhat");
const { ethers } = hre;

export async function deployMockVirtualTokenSuite(): Promise<{ address: string }> {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  const name = (process.env.MOCK_VIRTUAL_NAME || "Mock VIRTUAL").trim();
  const symbol = (process.env.MOCK_VIRTUAL_SYMBOL || "mVIRTUAL").trim();
  const decimals = Number((process.env.MOCK_VIRTUAL_DECIMALS || "18").trim());
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(
      `MOCK_VIRTUAL_DECIMALS must be 0..18, got: ${process.env.MOCK_VIRTUAL_DECIMALS}`
    );
  }

  const supplyHuman = (
    process.env.MOCK_VIRTUAL_INITIAL_SUPPLY || "1000000000"
  ).trim();
  const initialBalance = parseUnits(supplyHuman, decimals);

  let recipient = (process.env.MINT_TO || deployerAddress).trim();
  if (!ethers.isAddress(recipient)) {
    throw new Error(`MINT_TO is not a valid address: "${recipient}"`);
  }

  console.log("\n=== Deploy MockERC20Decimals (VIRTUAL stand-in) ===");
  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployerAddress);
  console.log("Token:", name, `(${symbol})`, `decimals=${decimals}`);
  console.log("Initial supply (human):", supplyHuman);
  console.log("Recipient:", recipient);

  const Mock = await ethers.getContractFactory("MockERC20Decimals");
  const token = await Mock.deploy(
    name,
    symbol,
    decimals,
    recipient,
    initialBalance
  );
  await token.waitForDeployment();
  const addr = await token.getAddress();

  const bal = await token.balanceOf(recipient);
  console.log("Deployed:", addr);
  console.log("Recipient balance:", bal.toString());

  await verifyContract(addr, [name, symbol, decimals, recipient, initialBalance], {
    contract: "contracts/launchpadv2/MockERC20Decimals.sol:MockERC20Decimals",
  });

  const envFile = process.env.ENV_FILE?.trim();
  upsertLaunchpadEnvFile(envFile, "VIRTUAL_TOKEN_ADDRESS", addr);
  upsertLaunchpadEnvFile(envFile, "AGENT_TAX_TAX_TOKEN", addr);

  console.log("\n--- Paste into .env ---");
  console.log(`VIRTUAL_TOKEN_ADDRESS=${addr}`);
  console.log(`AGENT_TAX_TAX_TOKEN=${addr}`);

  return { address: addr };
}

/** Only auto-run when this file is the Hardhat `run` target (not when imported dynamically). */
const isHardhatRunThisScript = process.argv.some(
  (x) =>
    typeof x === "string" &&
    x.replace(/\\/g, "/").endsWith("deployMockVirtualToken.ts")
);
if (isHardhatRunThisScript) {
  (async () => {
    try {
      await deployMockVirtualTokenSuite();
    } catch (e: any) {
      console.error(e);
      process.exit(1);
    }
  })();
}
