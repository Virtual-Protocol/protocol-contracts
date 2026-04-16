/**
 * Smoke-test AgentToken `burn(uint256)` (e.g. AgentTokenV4): burn a fixed amount,
 * then assert totalSupply and caller balance each decrease by that amount.
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev_arbitrum_sepolia npx hardhat run scripts/launchpadv5/testAgentTokenBurn.ts --network arbitrum_sepolia
 *
 * Configuration: edit CONFIG below (token address + human-readable burn amount).
 * If AGENT_TOKEN_ADDRESS is empty, falls back to process.env.AGENT_TOKEN_ADDRESS.
 */
import { formatUnits, parseUnits } from "ethers";
const hre = require("hardhat");
const { ethers } = hre;

// ============================================
// Hardcode — edit here
// ============================================
const CONFIG = {
  /** Set to "" to use AGENT_TOKEN_ADDRESS from env */
  AGENT_TOKEN_ADDRESS: "0x41398E39188B425e6742e51dc11958C8CAb3D7eF" as string,
  /** Human amount, e.g. "1" = 1 token in token decimals */
  BURN_AMOUNT: "1",
};

const ERC20_BURN_ABI = [
  "function burn(uint256 value) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
] as const;

function resolveTokenAddress(): string {
  const fromConfig = (CONFIG.AGENT_TOKEN_ADDRESS || "").trim();
  if (fromConfig) return ethers.getAddress(fromConfig);
  const fromEnv = (process.env.AGENT_TOKEN_ADDRESS || "").trim();
  if (!fromEnv) {
    throw new Error(
      "Set CONFIG.AGENT_TOKEN_ADDRESS or AGENT_TOKEN_ADDRESS in the env file."
    );
  }
  return ethers.getAddress(fromEnv);
}

(async () => {
  try {
    const [signer] = await ethers.getSigners();
    const deployer = await signer.getAddress();
    const tokenAddr = resolveTokenAddress();

    const token = new ethers.Contract(tokenAddr, ERC20_BURN_ABI, signer);
    const decimals = Number(await token.decimals());
    const symbol = await token.symbol().catch(() => "?");

    const burnWei = parseUnits(CONFIG.BURN_AMOUNT, decimals);

    console.log("\n=== testAgentTokenBurn ===");
    console.log("Network:", hre.network.name);
    console.log("Signer:", deployer);
    console.log("Token:", tokenAddr, `(${symbol}, decimals=${decimals})`);
    console.log("Burn amount:", CONFIG.BURN_AMOUNT, "→", burnWei.toString(), "wei");

    const supplyBefore = BigInt(await token.totalSupply());
    const balBefore = BigInt(await token.balanceOf(deployer));

    if (balBefore < burnWei) {
      throw new Error(
        `Insufficient balance: have ${formatUnits(balBefore, decimals)}, need ${CONFIG.BURN_AMOUNT}`
      );
    }

    const tx = await token.burn(burnWei);
    console.log("burn tx:", tx.hash);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("burn tx failed or no receipt");
    }

    const supplyAfter = BigInt(await token.totalSupply());
    const balAfter = BigInt(await token.balanceOf(deployer));

    const supplyDelta = supplyBefore - supplyAfter;
    const balDelta = balBefore - balAfter;

    console.log("\n--- Before ---");
    console.log("totalSupply:", supplyBefore.toString(), `(${formatUnits(supplyBefore, decimals)})`);
    console.log("balance:    ", balBefore.toString(), `(${formatUnits(balBefore, decimals)})`);

    console.log("\n--- After ---");
    console.log("totalSupply:", supplyAfter.toString(), `(${formatUnits(supplyAfter, decimals)})`);
    console.log("balance:    ", balAfter.toString(), `(${formatUnits(balAfter, decimals)})`);

    console.log("\n--- Deltas (expected = burn wei) ---");
    console.log("totalSupply Δ:", supplyDelta.toString(), supplyDelta === burnWei ? "✅" : "❌");
    console.log("balance Δ:    ", balDelta.toString(), balDelta === burnWei ? "✅" : "❌");

    if (supplyDelta !== burnWei || balDelta !== burnWei) {
      throw new Error(
        `Assertion failed: expected supply and balance to each drop by ${burnWei.toString()}`
      );
    }

    console.log("\n✅ burn() OK — totalSupply and balance both decreased by burn amount.");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
