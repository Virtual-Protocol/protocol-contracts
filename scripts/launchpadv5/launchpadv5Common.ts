/**
 * Shared BondingV5 launch + Project60days graduation helpers for scripts (e2e, drain tests).
 */
import { formatEther, parseEther } from "ethers";
import type { Contract, Signer } from "ethers";
import {
  launchpadDefaultTxGasLimit,
  launchpadGasLimitCeilingBigint,
  preLaunchGasBufferBps,
} from "./utils";
const { ethers } = require("hardhat");

// --- Launch modes / anti-sniper (aligned with BondingConfig) ---
export const LAUNCH_MODE_NORMAL = 0;
export const LAUNCH_MODE_X_LAUNCH = 1;
export const LAUNCH_MODE_ACP_SKILL = 2;

export const ANTI_SNIPER_NONE = 0;
export const ANTI_SNIPER_60S = 1;
export const ANTI_SNIPER_98M = 2;

/** Same graduation buy size as test/launchpadv5/bondingV5DrainLiquidity.js */
export const GRAD_BUY_AMOUNT = parseEther("202020.2044906205");

/** Scheduled preLaunch uses startTime >= now + delay (matches test/launchpadv2/const.js START_TIME_DELAY) */
export const DEFAULT_SCHEDULED_START_OFFSET_SEC = 86400;

/** Aligns with BondingConfig 60s anti-sniper window (ANTI_SNIPER_60S); override via ANTI_SNIPER_WAIT_SECONDS */
export const DEFAULT_ANTI_SNIPER_WAIT_BEFORE_GRAD_SEC = 60 + 10;

export function launchModeLabel(mode: number): string {
  if (mode === LAUNCH_MODE_NORMAL) return "NORMAL";
  if (mode === LAUNCH_MODE_X_LAUNCH) return "X_LAUNCH";
  if (mode === LAUNCH_MODE_ACP_SKILL) return "ACP_SKILL";
  return `UNKNOWN(${mode})`;
}

export async function waitWithProgress(
  seconds: number,
  message: string
): Promise<void> {
  console.log(`\n⏳ ${message}`);
  console.log(`   Waiting ${seconds} seconds...`);

  const startTime = Date.now();
  const endTime = startTime + seconds * 1000;
  const progressInterval = Math.max(10, Math.floor(seconds / 10));
  let lastProgress = 0;

  while (Date.now() < endTime) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const remaining = seconds - elapsed;

    if (elapsed - lastProgress >= progressInterval || remaining <= 5) {
      console.log(`   ⏱️  ${elapsed}s elapsed, ${remaining}s remaining...`);
      lastProgress = elapsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`   ✅ Wait complete!`);
}

export interface ExecutePreLaunchParams {
  bondingV5: Contract;
  virtualToken: Contract;
  signer: Signer;
  bondingV5Address: string;
  tokenName: string;
  tokenTicker: string;
  cores: number[];
  description: string;
  image: string;
  urls: string[];
  purchaseAmount: bigint;
  startTime: number;
  launchMode: number;
  airdropBips: number;
  needAcf: boolean;
  antiSniperTaxType: number;
  isProject60days: boolean;
  /** E2E-style staticCall + gas estimate logging */
  runDiagnostics?: boolean;
}

export interface ExecutePreLaunchResult {
  tokenAddress: string;
  pairAddress: string;
  virtualId: bigint;
  initialPurchase: bigint;
  eventLaunchParams: unknown;
  preLaunchReceipt: {
    gasUsed: bigint;
    logs: readonly { topics: string[]; data: string }[];
  };
  isScheduledLaunch: boolean;
  gasUsed: bigint;
}

/**
 * BondingV5.preLaunch with optional diagnostics (mirrors scripts/launchpadv5/e2e_test.ts).
 */
export async function executePreLaunch(
  params: ExecutePreLaunchParams
): Promise<ExecutePreLaunchResult> {
  const {
    bondingV5,
    virtualToken,
    signer,
    bondingV5Address,
    tokenName,
    tokenTicker,
    cores,
    description,
    image,
    urls,
    purchaseAmount,
    startTime,
    launchMode,
    airdropBips,
    needAcf,
    antiSniperTaxType,
    isProject60days,
    runDiagnostics = true,
  } = params;

  const bondingConfigAddr = await bondingV5.bondingConfig();
  const bondingConfig = await ethers.getContractAt(
    "BondingConfig",
    bondingConfigAddr
  );
  const scheduledParams = await bondingConfig.getScheduledLaunchParams();
  const startTimeDelayNum = Number(scheduledParams.startTimeDelay);
  const freshBlock = await ethers.provider.getBlock("latest");
  const freshTimestamp = Number(freshBlock!.timestamp);
  const scheduledThreshold = freshTimestamp + startTimeDelayNum;
  const isScheduledLaunch = startTime >= scheduledThreshold;

  const c = bondingV5.connect(signer) as any;

  await (virtualToken as any)
    .connect(signer)
    .approve(bondingV5Address, purchaseAmount);

  if (runDiagnostics) {
    try {
      console.log("\n--- Running staticCall to check for errors ---");
      await c.preLaunch.staticCall(
        tokenName,
        tokenTicker,
        cores,
        description,
        image,
        urls,
        purchaseAmount,
        startTime,
        launchMode,
        airdropBips,
        needAcf,
        antiSniperTaxType,
        isProject60days
      );
      console.log(
        "✅ staticCall passed, proceeding with actual transaction..."
      );
    } catch (staticCallError: unknown) {
      console.error(
        "\n❌ staticCall failed - this will likely fail on-chain too:"
      );
      console.error(staticCallError);
      throw staticCallError;
    }
  }

  const estimatedGas = await c.preLaunch.estimateGas(
    tokenName,
    tokenTicker,
    cores,
    description,
    image,
    urls,
    purchaseAmount,
    startTime,
    launchMode,
    airdropBips,
    needAcf,
    antiSniperTaxType,
    isProject60days
  );
  const cap = launchpadGasLimitCeilingBigint();
  const bps = preLaunchGasBufferBps();
  let gasLimit = (estimatedGas * bps) / 100n;
  if (gasLimit > cap) {
    console.log(
      `⚠️  Computed gas limit ${gasLimit} exceeds cap ${cap} (Monad charges fee ∝ gas_limit, not gas_used — see utils.ts). Capping. ` +
        "If the tx reverts with out-of-gas, set LAUNCHPAD_MONAD_GAS_LIMIT_CEILING or LAUNCHPAD_PRELAUNCH_BUFFER_BPS."
    );
    gasLimit = cap;
  }
  console.log("Estimated Gas:", estimatedGas.toString());
  console.log(`Buffer bps: ${bps} → Using Gas Limit:`, gasLimit.toString());

  const preLaunchTx = await c.preLaunch(
    tokenName,
    tokenTicker,
    cores,
    description,
    image,
    urls,
    purchaseAmount,
    startTime,
    launchMode,
    airdropBips,
    needAcf,
    antiSniperTaxType,
    isProject60days,
    { gasLimit }
  );

  const preLaunchReceipt = await preLaunchTx.wait();
  if (!preLaunchReceipt) throw new Error("preLaunch receipt is null");

  console.log("✅ preLaunch transaction successful!");
  console.log("Gas Used:", preLaunchReceipt.gasUsed.toString());

  const preLaunchedEvent = preLaunchReceipt.logs.find(
    (log: { topics: string[]; data: string }) => {
      try {
        const parsed = bondingV5.interface.parseLog(log);
        return parsed?.name === "PreLaunched";
      } catch {
        return false;
      }
    }
  );

  if (!preLaunchedEvent) throw new Error("PreLaunched event not found");

  const parsedEvent = bondingV5.interface.parseLog(preLaunchedEvent)!;
  const tokenAddress = parsedEvent.args.token;
  const pairAddress = parsedEvent.args.pair;
  const virtualId = parsedEvent.args.virtualId;
  const initialPurchase = parsedEvent.args.initialPurchase;
  const eventLaunchParams = parsedEvent.args.launchParams;

  return {
    tokenAddress,
    pairAddress,
    virtualId,
    initialPurchase,
    eventLaunchParams,
    preLaunchReceipt,
    isScheduledLaunch,
    gasUsed: preLaunchReceipt.gasUsed,
  };
}

/**
 * Wait until on-chain time >= pair.startTime(), then BondingV5.launch (e2e step 6).
 */
export async function waitForPairStartTimeThenLaunch(
  bondingV5: Contract,
  pairAddress: string,
  tokenAddress: string,
  launchSigner: Signer,
  options?: { gasLimit?: bigint }
): Promise<void> {
  const pair = await ethers.getContractAt("IFPairV2", pairAddress);
  const pairStartTime = await pair.startTime();
  console.log(
    "Pair Start Time:",
    new Date(Number(pairStartTime) * 1000).toISOString()
  );
  const currentTime = Math.floor(Date.now() / 1000);
  const tgt = Number(pairStartTime);
  const waitTime = tgt - currentTime;

  if (waitTime > 0) {
    await waitWithProgress(
      waitTime + 2,
      "Waiting for pair start time to be reached..."
    );
  } else {
    console.log("✅ Start time already passed, can proceed with launch");
  }

  console.log("\n--- Executing launch ---");
  const gasLimit = options?.gasLimit ?? launchpadDefaultTxGasLimit();
  const launchTx = await (bondingV5 as any)
    .connect(launchSigner)
    .launch(tokenAddress, { gasLimit });
  const launchReceipt = await launchTx.wait();
  console.log("✅ launch() transaction successful!");
  console.log("Gas Used:", launchReceipt?.gasUsed.toString());

  const launchedEvent = launchReceipt?.logs.find(
    (log: { topics: string[]; data: string }) => {
      try {
        const parsed = bondingV5.interface.parseLog(log);
        return parsed?.name === "Launched";
      } catch {
        return false;
      }
    }
  );

  if (launchedEvent) {
    const parsedLaunchedEvent = bondingV5.interface.parseLog(launchedEvent)!;
    console.log("\n--- Launched Event Data ---");
    console.log(
      "Initial Purchase Amount:",
      formatEther(parsedLaunchedEvent.args.initialPurchase),
      "VIRTUAL"
    );
    console.log(
      "Initial Purchased Amount:",
      formatEther(parsedLaunchedEvent.args.initialPurchasedAmount),
      "tokens"
    );
  }
}

/** Project60days + NORMAL + scheduled startTime (bondingV5DrainLiquidity.js style). */
export async function executeProject60daysScheduledPreLaunch(
  bondingV5: Contract,
  virtualToken: Contract,
  bondingV5Address: string,
  creator: Signer,
  purchaseAmount: bigint,
  meta?: { tokenName?: string; tokenTicker?: string }
): Promise<ExecutePreLaunchResult> {
  const latest = await ethers.provider.getBlock("latest");
  const bondingConfigAddr = await bondingV5.bondingConfig();
  const bondingConfig = await ethers.getContractAt(
    "BondingConfig",
    bondingConfigAddr
  );
  const scheduledParams = await bondingConfig.getScheduledLaunchParams();
  const delay = Number(scheduledParams.startTimeDelay);
  const startTime = Number(latest!.timestamp) + delay + 1;

  const tokenName = meta?.tokenName ?? "P60 Drain Script";
  const tokenTicker = meta?.tokenTicker ?? "P60S";

  return executePreLaunch({
    bondingV5,
    virtualToken,
    signer: creator,
    bondingV5Address,
    tokenName,
    tokenTicker,
    cores: [0, 1, 2],
    description: "Project60days drain script",
    image: "https://example.com/i.png",
    urls: ["", "", "", ""],
    purchaseAmount,
    startTime,
    launchMode: LAUNCH_MODE_NORMAL,
    airdropBips: 0,
    needAcf: false,
    antiSniperTaxType: ANTI_SNIPER_60S,
    isProject60days: true,
    runDiagnostics: false,
  });
}

export async function buyToGraduate(
  bondingV5: Contract,
  virtualToken: Contract,
  fRouterV3Address: string,
  buyer: Signer,
  tokenAddress: string,
  amount: bigint = GRAD_BUY_AMOUNT
): Promise<void> {
  const latest = await ethers.provider.getBlock("latest");
  const deadline = Number(latest!.timestamp) + 300;
  await (virtualToken as any).connect(buyer).approve(fRouterV3Address, amount);
  const tx = await (bondingV5 as any)
    .connect(buyer)
    .buy(amount, tokenAddress, 0, deadline);
  await tx.wait();
  console.log(
    "✅ Graduation buy completed, amount:",
    formatEther(amount),
    "VIRTUAL"
  );
}

/**
 * Resolve veToken from AgentNftV2 (same loop as bondingV5DrainLiquidity.js).
 */
export async function findVeTokenForAgentToken(
  agentNftV2: Contract,
  agentTokenAddr: string
): Promise<string> {
  const nextVirtualId = await agentNftV2.nextVirtualId();
  const target = agentTokenAddr.toLowerCase();
  for (let i = Number(nextVirtualId); i > 0; i--) {
    try {
      const virtualInfo = await agentNftV2.virtualInfo(i);
      if (String(virtualInfo.token).toLowerCase() === target) {
        const virtualLP = await agentNftV2.virtualLP(i);
        return virtualLP.veToken;
      }
    } catch {
      continue;
    }
  }
  throw new Error(
    `veToken not found for agent token ${agentTokenAddr} (searched AgentNft up to ${nextVirtualId})`
  );
}

export function getAntiSniperWaitSeconds(): number {
  const raw = process.env.ANTI_SNIPER_WAIT_SECONDS?.trim();
  if (raw) return Math.max(0, parseInt(raw, 10));
  return DEFAULT_ANTI_SNIPER_WAIT_BEFORE_GRAD_SEC;
}
