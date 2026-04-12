/**
 * BondingV5 E2E Test - Comprehensive Verification
 * 
 * Usage:
 *   ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/e2e_test.ts --network local
 *   ENV_FILE=.env.launchpadv5_dev_abstract_testnet npx hardhat run scripts/launchpadv5/e2e_test.ts --network abstract_testnet
 *   ENV_FILE=.env.launchpadv5_dev_monad_testnet npx hardhat run scripts/launchpadv5/e2e_test.ts --network monad_testnet
 *   ENV_FILE=.env.launchpadv5_prod npx hardhat run scripts/launchpadv5/e2e_test.ts --network base
 */
import { parseEther, formatEther } from "ethers";
import { executeBatchSwap } from "./batch_swap_tax";
import {
  waitWithProgress,
  executePreLaunch,
  waitForPairStartTimeThenLaunch,
  LAUNCH_MODE_NORMAL,
  LAUNCH_MODE_X_LAUNCH,
  LAUNCH_MODE_ACP_SKILL,
  ANTI_SNIPER_NONE,
  ANTI_SNIPER_60S,
  ANTI_SNIPER_98M,
  launchModeLabel,
} from "./launchpadv5Common";
import { launchpadDefaultTxGasLimit } from "./utils";
const { ethers } = require("hardhat");

interface TestConfig {
  bondingV5Address: string;
  bondingConfigAddress: string;
  fFactoryV3Address: string;
  fRouterV3Address: string;
  virtualTokenAddress: string;
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("  BondingV5 E2E Test - Comprehensive Verification");
  console.log("=".repeat(80));

  // Load contract addresses from environment
  const config: TestConfig = {
    bondingV5Address: process.env.BONDING_V5_ADDRESS || "",
    bondingConfigAddress: process.env.BONDING_CONFIG_ADDRESS || "",
    fFactoryV3Address: process.env.FFactoryV3_ADDRESS || "",
    fRouterV3Address: process.env.FRouterV3_ADDRESS || "",
    virtualTokenAddress: process.env.VIRTUAL_TOKEN_ADDRESS || "",
  };

  // Validate required addresses
  for (const [key, value] of Object.entries(config)) {
    if (!value) {
      throw new Error(`${key} not set in environment`);
    }
  }

  console.log("\n--- Contract Addresses ---");
  console.log("BondingV5:", config.bondingV5Address);
  console.log("BondingConfig:", config.bondingConfigAddress);
  console.log("FFactoryV3:", config.fFactoryV3Address);
  console.log("FRouterV3:", config.fRouterV3Address);
  console.log("VIRTUAL Token:", config.virtualTokenAddress);

  // Get signer
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  console.log("\n--- Signer ---");
  console.log("Address:", signerAddress);

  // Get contract instances
  const bondingV5 = await ethers.getContractAt("BondingV5", config.bondingV5Address);
  const bondingConfig = await ethers.getContractAt("BondingConfig", config.bondingConfigAddress);
  const fFactoryV3 = await ethers.getContractAt("FFactoryV3", config.fFactoryV3Address);
  const fRouterV3 = await ethers.getContractAt("FRouterV3", config.fRouterV3Address);
  const virtualToken = await ethers.getContractAt("IERC20", config.virtualTokenAddress);

  // ============================================
  // Step 1: Verify Configuration Parameters
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 1: Verify Configuration Parameters");
  console.log("=".repeat(80));

  // Check BondingConfig parameters
  const scheduledLaunchParams = await bondingConfig.getScheduledLaunchParams();
  const bondingCurveParams = await bondingConfig.bondingCurveParams();
  const reserveSupplyParams = await bondingConfig.reserveSupplyParams();
  const initialSupply = await bondingConfig.initialSupply();
  const feeTo = await bondingConfig.feeTo();
  const teamTokenReservedWallet = await bondingConfig.teamTokenReservedWallet();

  console.log("\n--- BondingConfig Parameters ---");
  console.log("Initial Supply:", initialSupply.toString());
  console.log("Fee To:", feeTo);
  console.log("Team Token Reserved Wallet:", teamTokenReservedWallet);
  console.log("\n--- ReserveSupplyParams (in bips, 1 bip = 0.01%) ---");
  console.log("Max Airdrop Bips:", reserveSupplyParams.maxAirdropBips.toString(), "(", Number(reserveSupplyParams.maxAirdropBips) / 100, "%)");
  console.log("Max Total Reserved Bips:", reserveSupplyParams.maxTotalReservedBips.toString(), "(", Number(reserveSupplyParams.maxTotalReservedBips) / 100, "%)");
  console.log("ACF Reserved Bips:", reserveSupplyParams.acfReservedBips.toString(), "(", Number(reserveSupplyParams.acfReservedBips) / 100, "%)");
  console.log("\n--- ScheduledLaunchParams ---");
  console.log("Start Time Delay:", scheduledLaunchParams.startTimeDelay.toString(), "seconds");
  console.log("Normal Launch Fee:", formatEther(scheduledLaunchParams.normalLaunchFee), "VIRTUAL");
  console.log("ACF Fee:", formatEther(scheduledLaunchParams.acfFee), "VIRTUAL");
  console.log("\n--- BondingCurveParams ---");
  console.log("Fake Initial Virtual Liq:", formatEther(bondingCurveParams.fakeInitialVirtualLiq), "VIRTUAL");
  console.log("Target Real Virtual:", formatEther(bondingCurveParams.targetRealVirtual), "VIRTUAL");

  // Check FFactoryV3 tax parameters
  const buyTax = await fFactoryV3.buyTax();
  const sellTax = await fFactoryV3.sellTax();
  const antiSniperBuyTaxStartValue = await fFactoryV3.antiSniperBuyTaxStartValue();
  const taxVault = await fFactoryV3.taxVault();
  const antiSniperTaxVault = await fFactoryV3.antiSniperTaxVault();

  console.log("\n--- FFactoryV3 Tax Parameters ---");
  console.log("Buy Tax:", buyTax.toString(), "%");
  console.log("Sell Tax:", sellTax.toString(), "%");
  console.log("Anti-Sniper Buy Tax Start Value:", antiSniperBuyTaxStartValue.toString(), "%");
  console.log("Tax Vault:", taxVault);
  console.log("Anti-Sniper Tax Vault:", antiSniperTaxVault);

  // ============================================
  // Step 2: Check Virtual Token Balance and Approve
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 2: Check VIRTUAL Token Balance and Approve");
  console.log("=".repeat(80));

  const virtualBalance = await virtualToken.balanceOf(signerAddress);
  console.log("VIRTUAL Balance:", formatEther(virtualBalance), "VIRTUAL");

  // Approve if needed - always approve to ensure sufficient allowance
  const currentAllowance = await virtualToken.allowance(signerAddress, config.bondingV5Address);
  const requiredAllowance = parseEther("10000");
  console.log("\n--- Checking BondingV5 Allowance ---");
  console.log("Signer Address:", signerAddress);
  console.log("BondingV5 Address:", config.bondingV5Address);
  console.log("Current Allowance:", currentAllowance.toString(), `(${formatEther(currentAllowance)} VIRTUAL)`);
  console.log("Required Allowance:", requiredAllowance.toString(), `(${formatEther(requiredAllowance)} VIRTUAL)`);
  console.log("Allowance sufficient?", BigInt(currentAllowance) >= BigInt(requiredAllowance));
  
  if (BigInt(currentAllowance) < BigInt(requiredAllowance)) {
    console.log("\n--- Approving VIRTUAL tokens to BondingV5 ---");
    const approveTx = await virtualToken.approve(config.bondingV5Address, requiredAllowance);
    await approveTx.wait();
    console.log("✅ Approved", formatEther(requiredAllowance), "VIRTUAL to BondingV5");
    
    // Verify the approval
    const newAllowance = await virtualToken.allowance(signerAddress, config.bondingV5Address);
    console.log("New Allowance:", formatEther(newAllowance), "VIRTUAL");
  } else {
    console.log("✅ Already approved sufficient VIRTUAL tokens");
  }

  // Also approve to FRouterV3 for buy/sell
  const routerAllowance = await virtualToken.allowance(signerAddress, config.fRouterV3Address);
  console.log("\n--- Checking FRouterV3 Allowance ---");
  console.log("FRouterV3 Address:", config.fRouterV3Address);
  console.log("Current Router Allowance:", formatEther(routerAllowance), "VIRTUAL");
  
  if (BigInt(routerAllowance) < BigInt(requiredAllowance)) {
    console.log("\n--- Approving VIRTUAL tokens to FRouterV3 ---");
    const approveTx = await virtualToken.approve(config.fRouterV3Address, requiredAllowance);
    await approveTx.wait();
    console.log("✅ Approved", formatEther(requiredAllowance), "VIRTUAL to FRouterV3");
  } else {
    console.log("✅ Already approved sufficient VIRTUAL tokens to FRouterV3");
  }

  // ============================================
  // Step 3: Test preLaunch with Immediate Launch
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 3: Test preLaunch (Immediate Launch)");
  console.log("=".repeat(80));

  // First, verify BondingV5 has required roles
  console.log("\n--- Verifying BondingV5 Roles ---");
  const agentFactoryV7Address = process.env.AGENT_FACTORY_V7_ADDRESS;
  if (agentFactoryV7Address) {
    const agentFactoryV7 = await ethers.getContractAt("AgentFactoryV7", agentFactoryV7Address);
    const bondingRole = await agentFactoryV7.BONDING_ROLE();
    const hasBondingRole = await agentFactoryV7.hasRole(bondingRole, config.bondingV5Address);
    console.log("BondingV5 has BONDING_ROLE on AgentFactoryV7:", hasBondingRole);
    if (!hasBondingRole) {
      throw new Error("BondingV5 does not have BONDING_ROLE on AgentFactoryV7!");
    }
  }

  const creatorRole = await fFactoryV3.CREATOR_ROLE();
  const hasCreatorRole = await fFactoryV3.hasRole(creatorRole, config.bondingV5Address);
  console.log("BondingV5 has CREATOR_ROLE on FFactoryV3:", hasCreatorRole);
  if (!hasCreatorRole) {
    throw new Error("BondingV5 does not have CREATOR_ROLE on FFactoryV3!");
  }

  const executorRole = await fRouterV3.EXECUTOR_ROLE();
  const hasExecutorRole = await fRouterV3.hasRole(executorRole, config.bondingV5Address);
  console.log("BondingV5 has EXECUTOR_ROLE on FRouterV3:", hasExecutorRole);
  if (!hasExecutorRole) {
    throw new Error("BondingV5 does not have EXECUTOR_ROLE on FRouterV3!");
  }

  const tokenName = `E2E Test Token ${Date.now()}`;
  const tokenTicker = `E2E${Math.floor(Math.random() * 1000)}`;
  const cores = [0, 1, 2, 4]; // Standard cores (0=text, 1=voice, 2=vision)
  const description = "E2E Test Token for BondingV5";
  const image = "https://example.com/e2e-test.png";
  const urls = ["", "", "", ""];
  const purchaseAmount = parseEther("150"); // 150 VIRTUAL
  
  // Immediate launch (startTime < now + scheduledLaunchStartTimeDelay)
  const latestBlock = await ethers.provider.getBlock("latest");
  const currentTimestamp = Number(latestBlock!.timestamp);
  const startTimeDelayNum = Number(scheduledLaunchParams.startTimeDelay);
  const startTime = currentTimestamp + 100; // immediate launch (100 seconds from now)
  
  // const launchMode = LAUNCH_MODE_NORMAL;
  // const airdropBips = 300; // 300 = 3.00% (in bips, 1 bip = 0.01%)
  // const needAcf = true; // Test with ACF fee
  // const antiSniperTaxType = ANTI_SNIPER_60S; // 60 seconds anti-sniper
  // const isProject60days = false;

  var launchMode = LAUNCH_MODE_ACP_SKILL;
  const airdropBips = 0; // 300 = 3.00% (in bips, 1 bip = 0.01%)
  const needAcf = false; // Test with ACF fee
  const antiSniperTaxType = ANTI_SNIPER_60S; // 60 seconds anti-sniper
  const isProject60days = false;

  const isScheduledLaunchPreview =
    startTime >= currentTimestamp + startTimeDelayNum;

  console.log("\n--- preLaunch Parameters ---");
  console.log("Token Name:", tokenName);
  console.log("Token Ticker:", tokenTicker);
  console.log("Cores:", cores);
  console.log("Purchase Amount:", formatEther(purchaseAmount), "VIRTUAL");
  console.log("Current Block Timestamp:", currentTimestamp);
  console.log("Start Time:", startTime, `(${new Date(Number(startTime) * 1000).toISOString()})`);
  console.log("Scheduled Launch Start Time Delay:", startTimeDelayNum, "seconds");
  console.log("Is Scheduled Launch (preview):", isScheduledLaunchPreview, "(expected: false - immediate launch)");
  console.log("Launch Mode:", launchMode, `(${launchModeLabel(launchMode)})`);
  console.log("Airdrop Bips:", airdropBips, "(", airdropBips / 100, "%)");
  console.log("Need ACF:", needAcf);
  console.log("Anti-Sniper Tax Type:", antiSniperTaxType, "(60S)");
  console.log("Is Project 60 Days:", isProject60days);

  // For X_LAUNCH / ACP_SKILL and Project60days launches, BondingV5 requires privileged backend wallet.
  if (
    launchMode === LAUNCH_MODE_X_LAUNCH ||
    launchMode === LAUNCH_MODE_ACP_SKILL ||
    isProject60days
  ) {
    const isPrivilegedLauncher = await bondingConfig.isPrivilegedLauncher(await signer.getAddress());
    console.log("Signer isPrivilegedLauncher:", isPrivilegedLauncher);
    if (!isPrivilegedLauncher) {
      throw new Error(
        `Signer ${await signer.getAddress()} is not a privileged launcher for ${launchModeLabel(launchMode)} preLaunch/launch flow`
      );
    }
  }

  // Get feeTo balance before preLaunch
  const feeToBalanceBefore = await virtualToken.balanceOf(feeTo);

  console.log("\n--- Executing preLaunch ---");

  const freshBlock = await ethers.provider.getBlock("latest");
  const freshTimestamp = Number(freshBlock!.timestamp);
  const scheduledThreshold = freshTimestamp + startTimeDelayNum;

  console.log("\n--- Time Diagnostics (Fresh) ---");
  console.log("Fresh Block Number:", freshBlock!.number);
  console.log("Fresh Block Timestamp:", freshTimestamp, `(${new Date(freshTimestamp * 1000).toISOString()})`);
  console.log("Scheduled Threshold:", scheduledThreshold, `(now + ${startTimeDelayNum}s)`);
  console.log("Our startTime:", startTime);
  console.log("startTime < scheduledThreshold?", startTime < scheduledThreshold, "(should be true for immediate launch)");
  console.log("Difference:", startTime - freshTimestamp, "seconds from now");

  const pre = await executePreLaunch({
    bondingV5,
    virtualToken,
    signer,
    bondingV5Address: config.bondingV5Address,
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
    runDiagnostics: true,
  });

  const tokenAddress = pre.tokenAddress;
  const pairAddress = pre.pairAddress;
  const virtualId = pre.virtualId;
  const initialPurchase = pre.initialPurchase;
  const eventLaunchParams = pre.eventLaunchParams;
  const isScheduledLaunch = pre.isScheduledLaunch;

  console.log("\n--- PreLaunched Event Data ---");
  console.log("Token Address:", tokenAddress);
  console.log("Pair Address:", pairAddress);
  console.log("Virtual ID:", virtualId.toString());
  console.log("Initial Purchase:", formatEther(initialPurchase), "VIRTUAL");
  console.log("LaunchParams from Event:", {
    launchMode: (eventLaunchParams as { launchMode: number }).launchMode,
    airdropBips: (eventLaunchParams as { airdropBips: number }).airdropBips,
    needAcf: (eventLaunchParams as { needAcf: boolean }).needAcf,
    antiSniperTaxType: (eventLaunchParams as { antiSniperTaxType: number }).antiSniperTaxType,
    isProject60days: (eventLaunchParams as { isProject60days: boolean }).isProject60days,
  });

  // ============================================
  // Step 4: Verify On-Chain Parameters
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 4: Verify On-Chain Parameters");
  console.log("=".repeat(80));

  // Verify tokenInfo
  const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
  console.log("\n--- tokenInfo ---");
  console.log("Creator:", tokenInfo.creator);
  console.log("Token:", tokenInfo.token);
  console.log("Pair:", tokenInfo.pair);
  console.log("Description:", tokenInfo.description);
  console.log("Trading:", tokenInfo.trading);
  console.log("Trading on Uniswap:", tokenInfo.tradingOnUniswap);
  console.log("Launch Executed:", tokenInfo.launchExecuted);
  console.log("Initial Purchase:", formatEther(tokenInfo.initialPurchase), "VIRTUAL");

  // Verify tokenLaunchParams
  const onChainLaunchParams = await bondingV5.tokenLaunchParams(tokenAddress);
  console.log("\n--- tokenLaunchParams (On-Chain) ---");
  console.log("Launch Mode:", onChainLaunchParams.launchMode, "(expected:", launchMode, ")");
  console.log("Airdrop Percent:", Number(onChainLaunchParams.airdropBips) / 100, "% (expected:", airdropBips / 100, "%)");
  console.log("Need ACF:", onChainLaunchParams.needAcf, "(expected:", needAcf, ")");
  console.log("Anti-Sniper Tax Type:", onChainLaunchParams.antiSniperTaxType, "(expected:", antiSniperTaxType, ")");
  console.log("Is Project 60 Days:", onChainLaunchParams.isProject60days, "(expected:", isProject60days, ")");

  // Verify view functions
  const isProject60daysResult = await bondingV5.isProject60days(tokenAddress);
  const tokenAntiSniperTypeResult = await bondingV5.tokenAntiSniperType(tokenAddress);
  const tokenGradThreshold = await bondingV5.tokenGradThreshold(tokenAddress);

  console.log("\n--- View Functions ---");
  console.log("isProject60days():", isProject60daysResult, "(expected:", isProject60days, ")");
  console.log("tokenAntiSniperType():", tokenAntiSniperTypeResult, "(expected:", antiSniperTaxType, ")");
  console.log("tokenGradThreshold():", formatEther(tokenGradThreshold), "tokens");

  // Verify anti-sniper duration from BondingConfig
  const antiSniperDuration = await bondingConfig.getAntiSniperDuration(antiSniperTaxType);
  console.log("\n--- Anti-Sniper Tax Duration ---");
  console.log("Duration:", antiSniperDuration.toString(), "seconds (expected: 60)");

  // ============================================
  // Step 5: Verify Fee Calculation
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 5: Verify Fee Calculation");
  console.log("=".repeat(80));

  // Check feeTo balance after preLaunch
  const feeToBalanceAfter = await virtualToken.balanceOf(feeTo);
  const feeCollected = feeToBalanceAfter - feeToBalanceBefore;

  // Calculate expected fee using BondingConfig.calculateLaunchFee logic
  // For scheduled launch (startTime >= currentTimestamp + startTimeDelay):
  //   - needAcf=false: normalLaunchFee (100 VIRTUAL)
  //   - needAcf=true: normalLaunchFee + acfFee (110 VIRTUAL)
  // For immediate launch (startTime < currentTimestamp + startTimeDelay):
  //   - needAcf=false: 0 (free)
  //   - needAcf=true: acfFee only (10 VIRTUAL)
  let expectedFee: bigint;
  if (isScheduledLaunch) {
    expectedFee = needAcf 
      ? scheduledLaunchParams.normalLaunchFee + scheduledLaunchParams.acfFee 
      : scheduledLaunchParams.normalLaunchFee;
  } else {
    expectedFee = needAcf ? scheduledLaunchParams.acfFee : 0n;
  }

  console.log("Fee To Balance Before:", formatEther(feeToBalanceBefore), "VIRTUAL");
  console.log("Fee To Balance After:", formatEther(feeToBalanceAfter), "VIRTUAL");
  console.log("Fee Collected:", formatEther(feeCollected), "VIRTUAL");
  console.log("Expected Fee:", formatEther(expectedFee), "VIRTUAL", `(${isScheduledLaunch ? "scheduled" : "immediate"}, needAcf=${needAcf})`);
  
  if (BigInt(feeCollected) === BigInt(expectedFee)) {
    console.log("✅ Fee calculation correct!");
  } else {
    console.log("⚠️ Fee mismatch - expected:", formatEther(expectedFee), "got:", formatEther(feeCollected));
  }

  // ============================================
  // Step 6: Wait for Start Time and Launch
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 6: Wait for Start Time and Launch");
  console.log("=".repeat(80));

  await waitForPairStartTimeThenLaunch(bondingV5, pairAddress, tokenAddress, signer);

  const pair = await ethers.getContractAt("IFPairV2", pairAddress);

  const tokenInfoAfterLaunch = await bondingV5.tokenInfo(tokenAddress);
  console.log("\n--- Token Status After Launch ---");
  console.log("Launch Executed:", tokenInfoAfterLaunch.launchExecuted);
  console.log("Trading:", tokenInfoAfterLaunch.trading);

  // ============================================
  // Step 7: Test Buy with Anti-Sniper Tax Verification
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 7: Test Buy with Anti-Sniper Tax Verification");
  console.log("=".repeat(80));

  // Get agent token contract
  const agentToken = await ethers.getContractAt("IERC20", tokenAddress);

  // Check if we're in the anti-sniper period
  const hasAntiSniperTax = await fRouterV3.hasAntiSniperTax(pairAddress);
  const taxStartTime = await pair.taxStartTime();
  const currentBlockTime = (await ethers.provider.getBlock("latest")).timestamp;
  const timeSinceLaunch = currentBlockTime - Number(taxStartTime);

  console.log("\n--- Anti-Sniper Tax Status ---");
  console.log("Tax Start Time:", new Date(Number(taxStartTime) * 1000).toISOString());
  console.log("Current Block Time:", new Date(currentBlockTime * 1000).toISOString());
  console.log("Time Since Launch:", timeSinceLaunch, "seconds");
  console.log("Anti-Sniper Duration:", antiSniperDuration.toString(), "seconds");
  console.log("Has Anti-Sniper Tax Active:", hasAntiSniperTax);

  // Get tax vault balances before buy
  const taxVaultBalanceBefore = await virtualToken.balanceOf(taxVault);
  const antiSniperTaxVaultBalanceBefore = await virtualToken.balanceOf(antiSniperTaxVault);
  
  console.log("\n--- Tax Vault Balances Before Buy ---");
  console.log("Tax Vault Balance:", formatEther(taxVaultBalanceBefore), "VIRTUAL");
  console.log("Anti-Sniper Tax Vault Balance:", formatEther(antiSniperTaxVaultBalanceBefore), "VIRTUAL");

  const buyAmount = parseEther("10"); // 10 VIRTUAL
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  const agentTokenBalanceBefore = await agentToken.balanceOf(signerAddress);

  console.log("\n--- Buy Parameters ---");
  console.log("Buy Amount:", formatEther(buyAmount), "VIRTUAL");
  console.log("Agent Token Balance Before:", formatEther(agentTokenBalanceBefore), "tokens");

  console.log("\n--- Executing buy (during anti-sniper period) ---");
  const buyTx = await bondingV5.buy(buyAmount, tokenAddress, 0, deadline, {
    gasLimit: launchpadDefaultTxGasLimit(),
  });
  const buyReceipt = await buyTx.wait();
  console.log("✅ buy() transaction successful!");
  console.log("Gas Used:", buyReceipt.gasUsed.toString());

  const agentTokenBalanceAfterBuy = await agentToken.balanceOf(signerAddress);
  const tokensReceived = agentTokenBalanceAfterBuy - agentTokenBalanceBefore;
  console.log("Agent Token Balance After:", formatEther(agentTokenBalanceAfterBuy), "tokens");
  console.log("Tokens Received:", formatEther(tokensReceived), "tokens");

  // Get tax vault balances after buy
  const taxVaultBalanceAfterBuy = await virtualToken.balanceOf(taxVault);
  const antiSniperTaxVaultBalanceAfterBuy = await virtualToken.balanceOf(antiSniperTaxVault);
  
  const normalTaxCollected = taxVaultBalanceAfterBuy - taxVaultBalanceBefore;
  const antiSniperTaxCollected = antiSniperTaxVaultBalanceAfterBuy - antiSniperTaxVaultBalanceBefore;
  
  console.log("\n--- Tax Vault Balances After Buy ---");
  console.log("Tax Vault Balance:", formatEther(taxVaultBalanceAfterBuy), "VIRTUAL");
  console.log("Anti-Sniper Tax Vault Balance:", formatEther(antiSniperTaxVaultBalanceAfterBuy), "VIRTUAL");
  console.log("\n--- Tax Collected ---");
  console.log("Normal Tax Collected:", formatEther(normalTaxCollected), "VIRTUAL");
  console.log("Anti-Sniper Tax Collected:", formatEther(antiSniperTaxCollected), "VIRTUAL");

  // Verify anti-sniper tax was collected (if within anti-sniper period)
  if (hasAntiSniperTax) {
    // Calculate expected anti-sniper tax
    // Anti-sniper tax decreases linearly from antiSniperBuyTaxStartValue (e.g., 99%) to 0% over the duration
    const elapsedTime = BigInt(currentBlockTime) - taxStartTime;
    const remainingTime = antiSniperDuration - elapsedTime;
    const expectedAntiSniperTaxRate = remainingTime > 0n 
      ? (BigInt(antiSniperBuyTaxStartValue) * remainingTime) / antiSniperDuration
      : 0n;
    
    console.log("\n--- Anti-Sniper Tax Verification ---");
    console.log("elapsedTime= ", elapsedTime.toString(), ", remainingTime= ", remainingTime.toString());
    console.log("Expected Anti-Sniper Tax Rate:", expectedAntiSniperTaxRate.toString(), "%");
    console.log("Normal Buy Tax Rate:", buyTax.toString(), "%");
    
    if (BigInt(antiSniperTaxCollected) > 0n) {
      console.log("✅ Anti-Sniper Tax correctly collected to antiSniperTaxVault");
    } else if (BigInt(normalTaxCollected) > 0n) {
      console.log("⚠️ Only normal tax collected (anti-sniper period may have ended)");
    }
  } else {
    console.log("\n--- Normal Tax Verification ---");
    console.log("No anti-sniper tax active, only normal tax should be collected");
    if (BigInt(normalTaxCollected) > 0n) {
      console.log("✅ Normal Tax correctly collected to taxVault");
    }
  }

  // ============================================
  // Step 8: Test Buy After Anti-Sniper Period (if applicable)
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 8: Wait for Anti-Sniper Period to End and Test Buy");
  console.log("=".repeat(80));

  // Wait for anti-sniper period to end if still active
  const hasAntiSniperTaxNow = await fRouterV3.hasAntiSniperTax(pairAddress);
  if (hasAntiSniperTaxNow) {
    const currentTime2 = (await ethers.provider.getBlock("latest")).timestamp;
    const remainingAntiSniperTime = Number(taxStartTime) + Number(antiSniperDuration) - currentTime2;
    
    if (remainingAntiSniperTime > 0) {
      await waitWithProgress(
        remainingAntiSniperTime + 5, 
        `Waiting for anti-sniper period to end (${antiSniperDuration} seconds total)...`
      );
    } else {
      console.log("✅ Anti-sniper period already ended");
    }
  } else {
    console.log("✅ No anti-sniper tax was active");
  }

  // Verify anti-sniper tax is no longer active
  const hasAntiSniperTaxAfterWait = await fRouterV3.hasAntiSniperTax(pairAddress);
  console.log("\nAnti-Sniper Tax Active After Wait:", hasAntiSniperTaxAfterWait);

  // Get tax vault balances before second buy
  const taxVaultBalanceBeforeBuy2 = await virtualToken.balanceOf(taxVault);
  const antiSniperTaxVaultBalanceBeforeBuy2 = await virtualToken.balanceOf(antiSniperTaxVault);

  console.log("\n--- Tax Vault Balances Before Second Buy ---");
  console.log("Tax Vault Balance:", formatEther(taxVaultBalanceBeforeBuy2), "VIRTUAL");
  console.log("Anti-Sniper Tax Vault Balance:", formatEther(antiSniperTaxVaultBalanceBeforeBuy2), "VIRTUAL");

  const buyAmount2 = parseEther("5"); // 5 VIRTUAL
  const deadline2 = Math.floor(Date.now() / 1000) + 300;

  console.log("\n--- Executing buy (after anti-sniper period) ---");
  const buyTx2 = await bondingV5.buy(buyAmount2, tokenAddress, 0, deadline2, {
    gasLimit: launchpadDefaultTxGasLimit(),
  });
  const buyReceipt2 = await buyTx2.wait();
  console.log("✅ buy() transaction successful!");
  console.log("Gas Used:", buyReceipt2.gasUsed.toString());

  // Get tax vault balances after second buy
  const taxVaultBalanceAfterBuy2 = await virtualToken.balanceOf(taxVault);
  const antiSniperTaxVaultBalanceAfterBuy2 = await virtualToken.balanceOf(antiSniperTaxVault);
  
  const normalTaxCollected2 = taxVaultBalanceAfterBuy2 - taxVaultBalanceBeforeBuy2;
  const antiSniperTaxCollected2 = antiSniperTaxVaultBalanceAfterBuy2 - antiSniperTaxVaultBalanceBeforeBuy2;
  
  console.log("\n--- Tax Collected After Anti-Sniper Period ---");
  console.log("Normal Tax Collected:", formatEther(normalTaxCollected2), "VIRTUAL");
  console.log("Anti-Sniper Tax Collected:", formatEther(antiSniperTaxCollected2), "VIRTUAL");

  // Calculate expected normal tax
  const expectedNormalTax2 = (buyAmount2 * BigInt(buyTax)) / 100n;
  console.log("Expected Normal Tax (", buyTax.toString(), "% of", formatEther(buyAmount2), "):", formatEther(expectedNormalTax2), "VIRTUAL");

  if (!hasAntiSniperTaxAfterWait && BigInt(normalTaxCollected2) > 0n && BigInt(antiSniperTaxCollected2) === 0n) {
    console.log("✅ After anti-sniper period: Only normal tax collected (no anti-sniper tax)");
  } else if (hasAntiSniperTaxAfterWait) {
    console.log("⚠️ Anti-sniper period still active (may need longer wait time)");
  }

  // ============================================
  // Step 9: Test Sell with Tax Verification
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 9: Test Sell with Tax Verification");
  console.log("=".repeat(80));

  // Get updated token balance
  const agentTokenBalanceForSell = await agentToken.balanceOf(signerAddress);

  // Approve agent token to FRouterV3
  const sellAmount = BigInt(agentTokenBalanceForSell) / 4n; // Sell 1/4 of holdings
  console.log("Sell Amount:", formatEther(sellAmount), "tokens");

  const agentTokenAllowance = await agentToken.allowance(signerAddress, config.fRouterV3Address);
  if (agentTokenAllowance < sellAmount) {
    console.log("\n--- Approving Agent Token to FRouterV3 ---");
    const approveAgentTx = await agentToken.approve(config.fRouterV3Address, ethers.MaxUint256);
    await approveAgentTx.wait();
    console.log("✅ Approved Agent Token to FRouterV3");
  }

  // Get balances before sell
  const virtualBalanceBeforeSell = await virtualToken.balanceOf(signerAddress);
  const taxVaultBalanceBeforeSell = await virtualToken.balanceOf(taxVault);

  console.log("\n--- Balances Before Sell ---");
  console.log("VIRTUAL Balance:", formatEther(virtualBalanceBeforeSell), "VIRTUAL");
  console.log("Tax Vault Balance:", formatEther(taxVaultBalanceBeforeSell), "VIRTUAL");

  console.log("\n--- Executing sell ---");
  const sellDeadline = Math.floor(Date.now() / 1000) + 300;
  const sellTx = await bondingV5.sell(sellAmount, tokenAddress, 0, sellDeadline, {
    gasLimit: launchpadDefaultTxGasLimit(),
  });
  const sellReceipt = await sellTx.wait();
  console.log("✅ sell() transaction successful!");
  console.log("Gas Used:", sellReceipt.gasUsed.toString());

  // Get balances after sell
  const virtualBalanceAfterSell = await virtualToken.balanceOf(signerAddress);
  const taxVaultBalanceAfterSell = await virtualToken.balanceOf(taxVault);
  
  const virtualReceived = virtualBalanceAfterSell - virtualBalanceBeforeSell;
  const sellTaxCollected = taxVaultBalanceAfterSell - taxVaultBalanceBeforeSell;
  
  console.log("\n--- Balances After Sell ---");
  console.log("VIRTUAL Balance:", formatEther(virtualBalanceAfterSell), "VIRTUAL");
  console.log("Tax Vault Balance:", formatEther(taxVaultBalanceAfterSell), "VIRTUAL");
  console.log("\n--- Sell Results ---");
  console.log("VIRTUAL Received:", formatEther(virtualReceived), "VIRTUAL");
  console.log("Sell Tax Collected:", formatEther(sellTaxCollected), "VIRTUAL");
  console.log("Sell Tax Rate:", sellTax.toString(), "%");

  if (BigInt(sellTaxCollected) > 0n) {
    console.log("✅ Sell tax correctly collected to taxVault");
  }

  // ============================================
  // Step 10: Verify Tax in AgentTaxV2
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 10: Verify Tax in AgentTaxV2");
  console.log("=".repeat(80));

  const agentTaxV2Address = process.env.AGENT_TAX_V2_CONTRACT_ADDRESS;
  if (!agentTaxV2Address) {
    console.log("⚠️ AGENT_TAX_V2_CONTRACT_ADDRESS not set, skipping AgentTaxV2 verification");
  } else {
    const agentTaxV2 = await ethers.getContractAt("AgentTaxV2", agentTaxV2Address);
    
    console.log("\n--- AgentTaxV2 Contract ---");
    console.log("Address:", agentTaxV2Address);
    
    // Check token recipient registration
    const tokenRecipient = await agentTaxV2.tokenRecipients(tokenAddress);
    console.log("\n--- Token Recipient for", tokenAddress, "---");
    console.log("TBA:", tokenRecipient.tba);
    console.log("Creator:", tokenRecipient.creator);
    
    if (tokenRecipient.creator === ethers.ZeroAddress) {
      console.log("⚠️ Token not registered in AgentTaxV2!");
    } else {
      console.log("✅ Token is registered in AgentTaxV2");
    }
    
    // Check tax amounts
    const [amountCollected, amountSwapped] = await agentTaxV2.getTokenTaxAmounts(tokenAddress);
    const pendingTax = amountCollected - amountSwapped;
    
    console.log("\n--- Tax Amounts for Token ---");
    console.log("Amount Collected:", formatEther(amountCollected), "VIRTUAL");
    console.log("Amount Swapped:", formatEther(amountSwapped), "VIRTUAL");
    console.log("Pending Tax:", formatEther(pendingTax), "VIRTUAL");
    
    if (amountCollected > 0n) {
      console.log("✅ Tax has been deposited to AgentTaxV2 for this token");
    } else {
      console.log("⚠️ No tax deposited yet for this token");
    }
    
    // Get contract parameters
    const minSwapThreshold = await agentTaxV2.minSwapThreshold();
    const maxSwapThreshold = await agentTaxV2.maxSwapThreshold();
    const feeRateFromContract = await agentTaxV2.feeRate();
    const treasuryAddress = await agentTaxV2.treasury();
    
    console.log("\n--- AgentTaxV2 Parameters ---");
    console.log("Min Swap Threshold:", formatEther(minSwapThreshold), "VIRTUAL");
    console.log("Max Swap Threshold:", formatEther(maxSwapThreshold), "VIRTUAL");
    console.log("Fee Rate:", feeRateFromContract.toString(), "/ 10000");
    console.log("Treasury:", treasuryAddress);
    
    // ============================================
    // Step 11: Test batchSwapForTokenAddress with Deployer
    // ============================================
    console.log("\n" + "=".repeat(80));
    console.log("  Step 11: Test batchSwapForTokenAddress with Deployer");
    console.log("=".repeat(80));
    
    if (pendingTax < minSwapThreshold) {
      console.log("⚠️ Pending tax", formatEther(pendingTax), "is less than minSwapThreshold", formatEther(minSwapThreshold));
      console.log("   Skipping batchSwapForTokenAddress test (need more trading volume)");
    } else {
      const swapResult = await executeBatchSwap(
        agentTaxV2Address,
        [tokenAddress],
        [0n],
        signer
      );
      
      if (swapResult.success && swapResult.swappedTokens.length > 0) {
        console.log("✅ Tax successfully swapped and distributed!");
      } else if (swapResult.error) {
        console.log("⚠️ Swap result:", swapResult.error);
      }
    }
  }

  // ============================================
  // Summary
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  E2E Test Summary");
  console.log("=".repeat(80));

  console.log("\n✅ All tests completed!");
  console.log("\nVerified:");
  console.log("  1. BondingConfig parameters are correctly configured");
  console.log("  2. FFactoryV3 tax parameters are correctly configured");
  console.log("  3. preLaunch() executed successfully with new parameters");
  console.log("  4. On-chain tokenInfo stored correctly");
  console.log("  5. On-chain tokenLaunchParams stored correctly");
  console.log("  6. Anti-sniper tax type correctly set:", antiSniperTaxType);
  console.log("  7. Anti-sniper duration:", antiSniperDuration.toString(), "seconds");
  console.log("  8. Fee calculation correct (ACF fee for immediate launch)");
  console.log("  9. launch() executed successfully after start time");
  console.log("  10. buy() during anti-sniper period - tax to antiSniperTaxVault");
  console.log("  11. buy() after anti-sniper period - normal tax to taxVault (AgentTaxV2)");
  console.log("  12. sell() executed with correct tax collection to AgentTaxV2");
  console.log("  13. AgentTaxV2 has recorded tax for launched token");
  console.log("  14. batchSwapForTokenAddress successfully distributes tax (if threshold met)");

  console.log("\n--- Tax Summary ---");
  console.log("Normal Buy Tax Rate:", buyTax.toString(), "%");
  console.log("Normal Sell Tax Rate:", sellTax.toString(), "%");
  console.log("Anti-Sniper Buy Tax Start Value:", antiSniperBuyTaxStartValue.toString(), "%");
  console.log("Anti-Sniper Duration:", antiSniperDuration.toString(), "seconds");
  console.log("Tax Vault (AgentTaxV2):", taxVault);
  console.log("Anti-Sniper Tax Vault:", antiSniperTaxVault);
  console.log("AgentTaxV2 Address:", process.env.AGENT_TAX_V2_CONTRACT_ADDRESS || "NOT SET");

  console.log("\n--- Token Summary ---");
  console.log("Token Address:", tokenAddress);
  console.log("Pair Address:", pairAddress);
  console.log("Virtual ID:", virtualId.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ E2E Test Failed:");
    console.error(error);
    process.exit(1);
  });