/**
 * Project60days — full launch (scheduled preLaunch → privileged launch → anti-sniper wait →
 * graduation buy) then drain UniV2 LP to the creator wallet. Use DRAIN_LIQUIDITY_MODE=private
 * for bonding private pool drain only (no graduation).
 *
 * Flow mirrors test/launchpadv5/bondingV5DrainLiquidity.js (drainUniV2Pool + graduation buy).
 *
 * Wallets:
 *   - PRIVATE_KEY: creator — preLaunch, graduation buy, recipient for drained funds (launch creator)
 *   - DRAIN_EXECUTOR_PRIVATE_KEY or CONTRACT_CONTROLLER_PRIVATE_KEY: optional — FRouterV3 EXECUTOR_ROLE
 *     for drain* calls (defaults to PRIVATE_KEY)
 *
 * Usage (default: univ2 — launch → wait → grad buy → drainUniV2):
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/60daysDrainLiquidity.ts --network base_sepolia
 *
 * Usage (private — launch → drainPrivatePool only, no graduation / no UniV2):
 *   DRAIN_LIQUIDITY_MODE=private ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/60daysDrainLiquidity.ts --network base_sepolia
 *
 * Required env: BONDING_V5_ADDRESS, BONDING_CONFIG_ADDRESS, FRouterV3_ADDRESS, VIRTUAL_TOKEN_ADDRESS, PRIVATE_KEY
 *               AGENT_NFT_V2_ADDRESS — only for default univ2 mode (resolve veToken)
 *
 * Optional: P60_PRELAUNCH_PURCHASE (default 1000 VIRTUAL), ANTI_SNIPER_WAIT_SECONDS (default 60, univ2 only),
 *           DRAIN_LIQUIDITY_MODE=univ2|private (default univ2)
 */
import { formatEther, parseEther } from "ethers";
const { ethers } = require("hardhat");
import {
  waitWithProgress,
  executeProject60daysScheduledPreLaunch,
  waitForPairStartTimeThenLaunch,
  buyToGraduate,
  findVeTokenForAgentToken,
  getAntiSniperWaitSeconds,
  GRAD_BUY_AMOUNT,
} from "./launchpadv5Common";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} not set`);
  return v;
}

function walletFromPk(pk: string | undefined, label: string) {
  const t = pk?.trim();
  if (!t) throw new Error(label);
  return new ethers.Wallet(t, ethers.provider);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const mode = (process.env.DRAIN_LIQUIDITY_MODE || "univ2")
    .trim()
    .toLowerCase();

  const bondingV5Address = requireEnv("BONDING_V5_ADDRESS");
  const bondingConfigAddress = requireEnv("BONDING_CONFIG_ADDRESS");
  const fRouterV3Address = requireEnv("FRouterV3_ADDRESS");
  const virtualTokenAddress = requireEnv("VIRTUAL_TOKEN_ADDRESS");

  const purchaseAmount = parseEther(
    process.env.P60_PRELAUNCH_PURCHASE?.trim() || "1000"
  );

  const creator = walletFromPk(process.env.PRIVATE_KEY, "PRIVATE_KEY not set");
  const launchPk = process.env.PRIVATE_KEY!.trim();
  const launchSigner = walletFromPk(launchPk, "PRIVATE_KEY not set");
  const execPk = process.env.PRIVATE_KEY!.trim();
  const executor = walletFromPk(execPk, "PRIVATE_KEY not set");

  const creatorAddress = await creator.getAddress();
  const launchAddress = await launchSigner.getAddress();
  const executorAddress = await executor.getAddress();

  console.log("\n" + "=".repeat(72));
  console.log("  Project60days — 60daysDrainLiquidity");
  console.log("=".repeat(72));
  console.log(
    "Mode:",
    mode,
    "(univ2 = launch + grad buy + drainUniV2 | private = launch + drainPrivate only)"
  );
  console.log("Creator / drain recipient:", creatorAddress);
  console.log("Privileged launcher (launch()):", launchAddress);
  console.log("FRouterV3 executor (drain*):", executorAddress);

  const bondingV5 = await ethers.getContractAt("BondingV5", bondingV5Address);
  const bondingConfig = await ethers.getContractAt(
    "BondingConfig",
    bondingConfigAddress
  );
  const virtualToken = await ethers.getContractAt(
    "IERC20",
    virtualTokenAddress
  );
  const fRouterV3 = await ethers.getContractAt(
    "FRouterV3",
    fRouterV3Address,
    executor
  );

  const priv = await bondingConfig.isPrivilegedLauncher(launchAddress);
  if (!priv) {
    throw new Error(
      `launch signer ${launchAddress} is not a privileged launcher`
    );
  }

  const beOpsRole = await fRouterV3.BE_OPS_ROLE();
  if (!(await fRouterV3.hasRole(beOpsRole, executorAddress))) {
    throw new Error(
      `Executor ${executorAddress} lacks BE_OPS_ROLE on FRouterV3`
    );
  }

  /**
   * drainUniV2Pool is onlyRole(BE_OPS_ROLE) on FRouter, but it calls
   * AgentFactoryV7.removeLpLiquidity — that uses msg.sender == FRouter, so the
   * **router contract** must hold REMOVE_LIQUIDITY_ROLE on the factory (not your EOA).
   */
  const agentFactoryAddress = await bondingV5.agentFactory();
  const agentFactory = await ethers.getContractAt(
    "AgentFactoryV7",
    agentFactoryAddress
  );
  const removeLiqRole = await agentFactory.REMOVE_LIQUIDITY_ROLE();
  if (!(await agentFactory.hasRole(removeLiqRole, fRouterV3Address))) {
    throw new Error(
      `FRouterV3 ${fRouterV3Address} is missing REMOVE_LIQUIDITY_ROLE on AgentFactoryV7 ${agentFactoryAddress}. ` +
        `BE_OPS_ROLE only allows your wallet to call drainUniV2Pool on the router; ` +
        `the router then calls agentFactory.removeLpLiquidity (as msg.sender = FRouter). ` +
        `Fix: admin on AgentFactoryV7 must grantRole(REMOVE_LIQUIDITY_ROLE, <this FRouterV3 address>).`
    );
  }
  console.log(
    "AgentFactory REMOVE_LIQUIDITY_ROLE on FRouterV3:",
    fRouterV3Address,
    "✅"
  );

  const bal = await virtualToken.balanceOf(creatorAddress);
  if (mode === "univ2" && bal < GRAD_BUY_AMOUNT) {
    throw new Error(
      `Creator needs at least ${formatEther(
        GRAD_BUY_AMOUNT
      )} VIRTUAL for graduation buy; have ${formatEther(bal)}`
    );
  }
  if (bal < purchaseAmount) {
    throw new Error(
      `Creator needs at least ${formatEther(
        purchaseAmount
      )} VIRTUAL for preLaunch; have ${formatEther(bal)}`
    );
  }

  console.log("\n--- 1) Project60days scheduled preLaunch (creator) ---");
  const pre = await executeProject60daysScheduledPreLaunch(
    bondingV5,
    virtualToken,
    bondingV5Address,
    creator,
    purchaseAmount,
    {
      tokenName: `P60 ${Date.now()}`,
      tokenTicker: `D${Math.floor(Math.random() * 900 + 100)}`,
    }
  );
  const { tokenAddress, pairAddress } = pre;
  console.log("Bonding token (pair key):", tokenAddress);
  console.log("Pair:", pairAddress);

  console.log("\n--- 2) Wait pair start + launch (privileged) ---");
  await waitForPairStartTimeThenLaunch(
    bondingV5,
    pairAddress,
    tokenAddress,
    launchSigner
  );

  if (mode === "private") {
    console.log("\n--- 3) drainPrivatePool → creator ---");
    const tx = await fRouterV3.drainPrivatePool(tokenAddress, creatorAddress);
    const r = await tx.wait();
    console.log("✅ drainPrivatePool tx:", r?.hash);
    console.log("Done (private pool only; no graduation).\n");
    return;
  }

  const waitSec = getAntiSniperWaitSeconds();
  console.log(
    `\n--- 3) Wait ${waitSec}s (bondingV5DrainLiquidity.js parity before grad buy) ---`
  );
  await waitWithProgress(
    waitSec,
    "Anti-sniper / settlement window before graduation buy"
  );

  console.log("\n--- 4) Graduation buy (creator, GRAD_BUY_AMOUNT) ---");
  console.log("Amount:", formatEther(GRAD_BUY_AMOUNT), "VIRTUAL");
  await buyToGraduate(
    bondingV5,
    virtualToken,
    fRouterV3Address,
    creator,
    tokenAddress,
    GRAD_BUY_AMOUNT
  );

  const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
  const agentTokenAddr = tokenInfo.agentToken;
  console.log("agentToken (sentient):", agentTokenAddr);
  console.log("tradingOnUniswap:", tokenInfo.tradingOnUniswap);

  const agentNftV2 = await ethers.getContractAt(
    "AgentNftV2",
    requireEnv("AGENT_NFT_V2_ADDRESS")
  );
  const veToken = await findVeTokenForAgentToken(agentNftV2, tokenAddress);
  console.log("veToken:", veToken);

  await sleep(10000); // wait for 10 seconds to drain

  // `removeLiquidity` needs deadline > block.timestamp. Using wall clock avoids RPC
  // "latest" block timestamp lag; ensure this machine's time is not behind the chain.
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
  console.log("\n--- 5) drainUniV2Pool → creator ---");
  console.log("deadline (unix s):", deadline.toString());
  const txU = await fRouterV3.drainUniV2Pool(
    tokenAddress,
    veToken,
    creatorAddress,
    deadline
  );
  const rU = await txU.wait();
  console.log("✅ drainUniV2Pool tx:", rU?.hash);
  console.log("\n✅ Flow complete. Recipient (creator):", creatorAddress);
  console.log("=".repeat(72) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
