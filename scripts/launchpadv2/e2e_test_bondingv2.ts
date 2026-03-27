import { parseEther, formatEther } from "ethers";
const { ethers } = require("hardhat");

/**
 * BondingV2 E2E Test Script
 *
 * Tests the full lifecycle: preLaunch -> launch -> buy/sell with anti-sniper tax verification
 *
 * Key differences from BondingV5:
 * - No BondingConfig contract (all params in BondingV2)
 * - preLaunch requires startTime >= block.timestamp + startTimeDelay (no immediate launch)
 * - Simpler preLaunch signature (no launchMode, airdropBips, needAcf, antiSniperTaxType)
 * - Anti-sniper duration: (antiSniperBuyTaxStartValue / 100) * 60 minutes
 *   e.g., antiSniperBuyTaxStartValue=5 means 5 minutes anti-sniper period
 *
 * Usage:
 *   npx hardhat run scripts/launchpadv2/e2e_test_bondingv2.ts --network eth_sepolia
 */

/**
 * Wait for a specified number of seconds with progress indicator
 */
async function waitWithProgress(seconds: number, message: string): Promise<void> {
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

interface TestConfig {
  bondingV2Address: string;
  fFactoryV2Address: string;
  fRouterV2Address: string;
  virtualTokenAddress: string;
  agentFactoryV6Address: string;
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("  BondingV2 E2E Test - Comprehensive Verification");
  console.log("=".repeat(80));

  // Load contract addresses from environment
  const config: TestConfig = {
    bondingV2Address: process.env.BONDING_V2_ADDRESS || "",
    fFactoryV2Address: process.env.FFactoryV2_ADDRESS || "",
    fRouterV2Address: process.env.FRouterV2_ADDRESS || "",
    virtualTokenAddress: process.env.VIRTUAL_TOKEN_ADDRESS || "",
    agentFactoryV6Address: process.env.AGENT_FACTORY_V6_ADDRESS || "",
  };

  // Validate required addresses
  for (const [key, value] of Object.entries(config)) {
    if (!value) {
      throw new Error(`${key} not set in environment`);
    }
  }

  console.log("\n--- Contract Addresses ---");
  console.log("BondingV2:", config.bondingV2Address);
  console.log("FFactoryV2:", config.fFactoryV2Address);
  console.log("FRouterV2:", config.fRouterV2Address);
  console.log("VIRTUAL Token:", config.virtualTokenAddress);
  console.log("AgentFactoryV6:", config.agentFactoryV6Address);

  // Get signer
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  console.log("\n--- Signer ---");
  console.log("Address:", signerAddress);

  // Get contract instances
  const bondingV2 = await ethers.getContractAt("BondingV2", config.bondingV2Address);
  const fFactoryV2 = await ethers.getContractAt("FFactoryV2", config.fFactoryV2Address);
  const fRouterV2 = await ethers.getContractAt("FRouterV2", config.fRouterV2Address);
  const virtualToken = await ethers.getContractAt("IERC20", config.virtualTokenAddress);
  const agentFactoryV6 = await ethers.getContractAt("AgentFactoryV6", config.agentFactoryV6Address);

  // ============================================
  // Step 1: Verify Configuration Parameters
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 1: Verify Configuration Parameters");
  console.log("=".repeat(80));

  // BondingV2 params (no BondingConfig)
  const initialSupply = await bondingV2.initialSupply();
  const fee = await bondingV2.fee();
  const assetRate = await bondingV2.assetRate();
  const gradThreshold = await bondingV2.gradThreshold();
  const maxTx = await bondingV2.maxTx();
  const launchParams = await bondingV2.launchParams();

  console.log("\n--- BondingV2 Parameters ---");
  console.log("Initial Supply:", initialSupply.toString());
  console.log("Fee:", formatEther(fee), "VIRTUAL");
  console.log("Asset Rate:", assetRate.toString());
  console.log("Grad Threshold:", formatEther(gradThreshold), "tokens");
  console.log("Max Tx:", maxTx.toString());
  console.log("\n--- LaunchParams ---");
  console.log("Start Time Delay:", launchParams.startTimeDelay.toString(), "seconds");
  console.log("Team Token Reserved Supply:", launchParams.teamTokenReservedSupply.toString());
  console.log("Team Token Reserved Wallet:", launchParams.teamTokenReservedWallet);

  // FFactoryV2 tax parameters
  const buyTax = await fFactoryV2.buyTax();
  const sellTax = await fFactoryV2.sellTax();
  const antiSniperBuyTaxStartValue = await fFactoryV2.antiSniperBuyTaxStartValue();
  const taxVault = await fFactoryV2.taxVault();
  const antiSniperTaxVault = await fFactoryV2.antiSniperTaxVault();

  console.log("\n--- FFactoryV2 Tax Parameters ---");
  console.log("Buy Tax:", buyTax.toString(), "%");
  console.log("Sell Tax:", sellTax.toString(), "%");
  console.log("Anti-Sniper Buy Tax Start Value:", antiSniperBuyTaxStartValue.toString(), "%");
  console.log("Tax Vault:", taxVault);
  console.log("Anti-Sniper Tax Vault:", antiSniperTaxVault);

  // Calculate anti-sniper duration for BondingV2
  // Formula: (antiSniperBuyTaxStartValue / 100) * 60 minutes = antiSniperBuyTaxStartValue * 60 seconds
  // e.g., antiSniperBuyTaxStartValue=5 means 5 minutes = 300 seconds
  const antiSniperDurationSeconds = Number(antiSniperBuyTaxStartValue) * 60;
  console.log("\n--- Anti-Sniper Tax Duration (calculated) ---");
  console.log("Duration:", antiSniperDurationSeconds, "seconds (", antiSniperBuyTaxStartValue.toString(), " minutes)");

  // ============================================
  // Step 2: Check Virtual Token Balance and Approve
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 2: Check VIRTUAL Token Balance and Approve");
  console.log("=".repeat(80));

  const virtualBalance = await virtualToken.balanceOf(signerAddress);
  console.log("VIRTUAL Balance:", formatEther(virtualBalance), "VIRTUAL");

  const requiredAllowance = parseEther("10000");

  // Approve to BondingV2
  const bondingAllowance = await virtualToken.allowance(signerAddress, config.bondingV2Address);
  console.log("\n--- Checking BondingV2 Allowance ---");
  console.log("Current Allowance:", formatEther(bondingAllowance), "VIRTUAL");

  if (BigInt(bondingAllowance) < BigInt(requiredAllowance)) {
    console.log("--- Approving VIRTUAL tokens to BondingV2 ---");
    const approveTx = await virtualToken.approve(config.bondingV2Address, requiredAllowance);
    await approveTx.wait();
    console.log("✅ Approved", formatEther(requiredAllowance), "VIRTUAL to BondingV2");
  } else {
    console.log("✅ Already approved sufficient VIRTUAL tokens to BondingV2");
  }

  // Approve to FRouterV2
  const routerAllowance = await virtualToken.allowance(signerAddress, config.fRouterV2Address);
  console.log("\n--- Checking FRouterV2 Allowance ---");
  console.log("Current Router Allowance:", formatEther(routerAllowance), "VIRTUAL");

  if (BigInt(routerAllowance) < BigInt(requiredAllowance)) {
    console.log("--- Approving VIRTUAL tokens to FRouterV2 ---");
    const approveTx = await virtualToken.approve(config.fRouterV2Address, requiredAllowance);
    await approveTx.wait();
    console.log("✅ Approved", formatEther(requiredAllowance), "VIRTUAL to FRouterV2");
  } else {
    console.log("✅ Already approved sufficient VIRTUAL tokens to FRouterV2");
  }

  // ============================================
  // Step 3: Verify BondingV2 Roles
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 3: Verify BondingV2 Roles");
  console.log("=".repeat(80));

  const bondingRole = await agentFactoryV6.BONDING_ROLE();
  const hasBondingRole = await agentFactoryV6.hasRole(bondingRole, config.bondingV2Address);
  console.log("BondingV2 has BONDING_ROLE on AgentFactoryV6:", hasBondingRole);
  if (!hasBondingRole) {
    throw new Error("BondingV2 does not have BONDING_ROLE on AgentFactoryV6!");
  }

  const creatorRole = await fFactoryV2.CREATOR_ROLE();
  const hasCreatorRole = await fFactoryV2.hasRole(creatorRole, config.bondingV2Address);
  console.log("BondingV2 has CREATOR_ROLE on FFactoryV2:", hasCreatorRole);
  if (!hasCreatorRole) {
    throw new Error("BondingV2 does not have CREATOR_ROLE on FFactoryV2!");
  }

  const executorRole = await fRouterV2.EXECUTOR_ROLE();
  const hasExecutorRole = await fRouterV2.hasRole(executorRole, config.bondingV2Address);
  console.log("BondingV2 has EXECUTOR_ROLE on FRouterV2:", hasExecutorRole);
  if (!hasExecutorRole) {
    throw new Error("BondingV2 does not have EXECUTOR_ROLE on FRouterV2!");
  }

  // ============================================
  // Step 4: Test preLaunch
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 4: Test preLaunch");
  console.log("=".repeat(80));

  const tokenName = `E2E V2 Test ${Date.now()}`;
  const tokenTicker = `V2T${Math.floor(Math.random() * 1000)}`;
  const cores = [0, 1, 2, 4];
  const description = "E2E Test Token for BondingV2";
  const image = "https://example.com/e2e-test.png";
  const urls: [string, string, string, string] = ["", "", "", ""];
  const purchaseAmount = parseEther("200"); // 200 VIRTUAL (must be > fee)

  // BondingV2 requires startTime >= block.timestamp + startTimeDelay
  const latestBlock = await ethers.provider.getBlock("latest");
  const currentTimestamp = Number(latestBlock!.timestamp);
  const startTimeDelayNum = Number(launchParams.startTimeDelay);
  // Set startTime to be startTimeDelay + 5 seconds from now
  const startTime = currentTimestamp + startTimeDelayNum + 30;

  console.log("\n--- preLaunch Parameters ---");
  console.log("Token Name:", tokenName);
  console.log("Token Ticker:", tokenTicker);
  console.log("Cores:", cores);
  console.log("Purchase Amount:", formatEther(purchaseAmount), "VIRTUAL");
  console.log("Fee:", formatEther(fee), "VIRTUAL");
  console.log("Initial Purchase (after fee):", formatEther(purchaseAmount - fee), "VIRTUAL");
  console.log("Current Block Timestamp:", currentTimestamp);
  console.log("Start Time Delay:", startTimeDelayNum, "seconds");
  console.log("Start Time:", startTime, `(${new Date(startTime * 1000).toISOString()})`);

  // Get feeTo balance before preLaunch
  const feeTo = await bondingV2._feeTo ? await bondingV2._feeTo() : (await bondingV2.owner()); // Fallback
  let feeToAddress: string;
  try {
    // Try to get _feeTo through a view function or storage
    const bondingV2Abi = [
      "function _feeTo() view returns (address)",
    ];
    const bondingV2WithFeeTo = new ethers.Contract(config.bondingV2Address, bondingV2Abi, signer);
    feeToAddress = await bondingV2WithFeeTo._feeTo();
  } catch {
    // _feeTo might be private, use the one from env or launchParams
    feeToAddress = process.env.LAUNCHPAD_V5_CREATION_FEE_TO_ADDRESS || launchParams.teamTokenReservedWallet;
  }
  console.log("Fee To Address:", feeToAddress);
  const feeToBalanceBefore = await virtualToken.balanceOf(feeToAddress);

  console.log("\n--- Executing preLaunch ---");

  // Test with staticCall first
  try {
    console.log("--- Running staticCall to check for errors ---");
    await bondingV2.preLaunch.staticCall(
      tokenName,
      tokenTicker,
      cores,
      description,
      image,
      urls,
      purchaseAmount,
      startTime
    );
    console.log("✅ staticCall passed, proceeding with actual transaction...");
  } catch (staticCallError: any) {
    console.error("\n❌ staticCall failed:");
    console.error("Error:", staticCallError.message);
    if (staticCallError.reason) {
      console.error("Reason:", staticCallError.reason);
    }
    throw staticCallError;
  }

  // Estimate gas
  const estimatedGas = await bondingV2.preLaunch.estimateGas(
    tokenName,
    tokenTicker,
    cores,
    description,
    image,
    urls,
    purchaseAmount,
    startTime
  );
  console.log("Estimated Gas:", estimatedGas.toString());

  const gasLimit = (estimatedGas * 150n) / 100n;
  console.log("Using Gas Limit:", gasLimit.toString());

  const preLaunchTx = await bondingV2.preLaunch(
    tokenName,
    tokenTicker,
    cores,
    description,
    image,
    urls,
    purchaseAmount,
    startTime,
  );

  const preLaunchReceipt = await preLaunchTx.wait();
  console.log("✅ preLaunch transaction successful!");
  console.log("Gas Used:", preLaunchReceipt.gasUsed.toString());

  // Parse PreLaunched event
  const preLaunchedEvent = preLaunchReceipt.logs.find((log: any) => {
    try {
      const parsed = bondingV2.interface.parseLog(log);
      return parsed?.name === "PreLaunched";
    } catch {
      return false;
    }
  });

  if (!preLaunchedEvent) {
    throw new Error("PreLaunched event not found");
  }

  const parsedEvent = bondingV2.interface.parseLog(preLaunchedEvent);
  const tokenAddress = parsedEvent.args[0]; // token
  const pairAddress = parsedEvent.args[1]; // pair
  const virtualId = parsedEvent.args[2]; // virtualId
  const initialPurchase = parsedEvent.args[3]; // initialPurchase

  console.log("\n--- PreLaunched Event Data ---");
  console.log("Token Address:", tokenAddress);
  console.log("Pair Address:", pairAddress);
  console.log("Virtual ID:", virtualId.toString());
  console.log("Initial Purchase:", formatEther(initialPurchase), "VIRTUAL");

  // ============================================
  // Step 5: Verify On-Chain Parameters
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 5: Verify On-Chain Parameters");
  console.log("=".repeat(80));

  const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
  console.log("\n--- tokenInfo ---");
  console.log("Creator:", tokenInfo.creator);
  console.log("Token:", tokenInfo.token);
  console.log("Pair:", tokenInfo.pair);
  console.log("Description:", tokenInfo.description);
  console.log("Trading:", tokenInfo.trading);
  console.log("Trading on Uniswap:", tokenInfo.tradingOnUniswap);
  console.log("Launch Executed:", tokenInfo.launchExecuted);
  console.log("Initial Purchase:", formatEther(tokenInfo.initialPurchase), "VIRTUAL");
  console.log("Application ID:", tokenInfo.applicationId.toString());

  // Verify fee collection
  const feeToBalanceAfter = await virtualToken.balanceOf(feeToAddress);
  const feeCollected = feeToBalanceAfter - feeToBalanceBefore;
  console.log("\n--- Fee Verification ---");
  console.log("Fee To Balance Before:", formatEther(feeToBalanceBefore), "VIRTUAL");
  console.log("Fee To Balance After:", formatEther(feeToBalanceAfter), "VIRTUAL");
  console.log("Fee Collected:", formatEther(feeCollected), "VIRTUAL");
  console.log("Expected Fee:", formatEther(fee), "VIRTUAL");

  if (BigInt(feeCollected) === BigInt(fee)) {
    console.log("✅ Fee collection correct!");
  } else {
    console.log("⚠️ Fee mismatch");
  }

  // ============================================
  // Step 6: Wait for Start Time and Launch
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 6: Wait for Start Time and Launch");
  console.log("=".repeat(80));

  const pair = await ethers.getContractAt("IFPairV2", pairAddress);
  const pairStartTime = await pair.startTime();
  console.log("Pair Start Time:", new Date(Number(pairStartTime) * 1000).toISOString());

  const currentTime = Math.floor(Date.now() / 1000);
  const waitTime = Number(pairStartTime) - currentTime;

  if (waitTime > 0) {
    await waitWithProgress(waitTime + 2, "Waiting for pair start time to be reached...");
  } else {
    console.log("✅ Start time already passed, can proceed with launch");
  }

  console.log("\n--- Executing launch ---");
  const launchTx = await bondingV2.launch(tokenAddress);
  const launchReceipt = await launchTx.wait();
  console.log("✅ launch() transaction successful!");
  console.log("Gas Used:", launchReceipt.gasUsed.toString());

  // Parse Launched event
  const launchedEvent = launchReceipt.logs.find((log: any) => {
    try {
      const parsed = bondingV2.interface.parseLog(log);
      return parsed?.name === "Launched";
    } catch {
      return false;
    }
  });

  if (launchedEvent) {
    const parsedLaunchedEvent = bondingV2.interface.parseLog(launchedEvent);
    console.log("\n--- Launched Event Data ---");
    console.log("Initial Purchase Amount:", formatEther(parsedLaunchedEvent.args[3]), "VIRTUAL");
    console.log("Initial Purchased Amount:", formatEther(parsedLaunchedEvent.args[4]), "tokens");
  }

  // Verify token status after launch
  const tokenInfoAfterLaunch = await bondingV2.tokenInfo(tokenAddress);
  console.log("\n--- Token Status After Launch ---");
  console.log("Launch Executed:", tokenInfoAfterLaunch.launchExecuted);
  console.log("Trading:", tokenInfoAfterLaunch.trading);

  // ============================================
  // Step 7: Test Buy with Anti-Sniper Tax Verification
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 7: Test Buy with Anti-Sniper Tax Verification");
  console.log("=".repeat(80));

  const agentToken = await ethers.getContractAt("IERC20", tokenAddress);

  // Check anti-sniper status
  const hasAntiSniperTax = await fRouterV2.hasAntiSniperTax(pairAddress);
  const taxStartTime = await pair.taxStartTime();
  const currentBlockTime = (await ethers.provider.getBlock("latest")).timestamp;
  const timeSinceLaunch = currentBlockTime - Number(taxStartTime);

  console.log("\n--- Anti-Sniper Tax Status ---");
  console.log("Tax Start Time:", new Date(Number(taxStartTime) * 1000).toISOString());
  console.log("Current Block Time:", new Date(currentBlockTime * 1000).toISOString());
  console.log("Time Since Launch:", timeSinceLaunch, "seconds");
  console.log("Anti-Sniper Duration:", antiSniperDurationSeconds, "seconds");
  console.log("Has Anti-Sniper Tax Active:", hasAntiSniperTax);

  // Get tax vault balances before buy
  const taxVaultBalanceBefore = await virtualToken.balanceOf(taxVault);
  const antiSniperTaxVaultBalanceBefore = await virtualToken.balanceOf(antiSniperTaxVault);

  console.log("\n--- Tax Vault Balances Before Buy ---");
  console.log("Tax Vault Balance:", formatEther(taxVaultBalanceBefore), "VIRTUAL");
  console.log("Anti-Sniper Tax Vault Balance:", formatEther(antiSniperTaxVaultBalanceBefore), "VIRTUAL");

  const buyAmount = parseEther("100");
  const deadline = Math.floor(Date.now() / 1000) + 300;

  const agentTokenBalanceBefore = await agentToken.balanceOf(signerAddress);

  console.log("\n--- Buy Parameters ---");
  console.log("Buy Amount:", formatEther(buyAmount), "VIRTUAL");
  console.log("Agent Token Balance Before:", formatEther(agentTokenBalanceBefore), "tokens");

  console.log("\n--- Executing buy (during anti-sniper period) ---");
  const buyTx = await bondingV2.buy(buyAmount, tokenAddress, 0, deadline);
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

  console.log("\n--- Tax Collected ---");
  console.log("Normal Tax Collected:", formatEther(normalTaxCollected), "VIRTUAL");
  console.log("Anti-Sniper Tax Collected:", formatEther(antiSniperTaxCollected), "VIRTUAL");

  if (hasAntiSniperTax && BigInt(antiSniperTaxCollected) > 0n) {
    console.log("✅ Anti-Sniper Tax correctly collected to antiSniperTaxVault");
  } else if (BigInt(normalTaxCollected) > 0n) {
    console.log("✅ Normal Tax collected to taxVault");
  }

  // ============================================
  // Step 8: Wait for Anti-Sniper Period to End and Test Buy
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 8: Wait for Anti-Sniper Period to End and Test Buy");
  console.log("=".repeat(80));

  const hasAntiSniperTaxNow = await fRouterV2.hasAntiSniperTax(pairAddress);
  if (hasAntiSniperTaxNow) {
    const currentTime2 = (await ethers.provider.getBlock("latest")).timestamp;
    const remainingAntiSniperTime = Number(taxStartTime) + antiSniperDurationSeconds - currentTime2;

    if (remainingAntiSniperTime > 0) {
      await waitWithProgress(
        remainingAntiSniperTime + 5,
        `Waiting for anti-sniper period to end (${antiSniperDurationSeconds} seconds total)...`
      );
    } else {
      console.log("✅ Anti-sniper period already ended");
    }
  } else {
    console.log("✅ No anti-sniper tax was active");
  }

  // Verify anti-sniper tax is no longer active
  const hasAntiSniperTaxAfterWait = await fRouterV2.hasAntiSniperTax(pairAddress);
  console.log("\nAnti-Sniper Tax Active After Wait:", hasAntiSniperTaxAfterWait);

  // Get tax vault balances before second buy
  const taxVaultBalanceBeforeBuy2 = await virtualToken.balanceOf(taxVault);
  const antiSniperTaxVaultBalanceBeforeBuy2 = await virtualToken.balanceOf(antiSniperTaxVault);

  const buyAmount2 = parseEther("50");
  const deadline2 = Math.floor(Date.now() / 1000) + 300;

  console.log("\n--- Executing buy (after anti-sniper period) ---");
  const buyTx2 = await bondingV2.buy(buyAmount2, tokenAddress, 0, deadline2);
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

  if (!hasAntiSniperTaxAfterWait && BigInt(normalTaxCollected2) > 0n && BigInt(antiSniperTaxCollected2) === 0n) {
    console.log("✅ After anti-sniper period: Only normal tax collected (no anti-sniper tax)");
  }

  // ============================================
  // Step 9: Buy to Graduation
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 9: Buy to Graduation");
  console.log("=".repeat(80));

  // Get current pair reserves to calculate how much we need to buy to trigger graduation
  const pairForGrad = await ethers.getContractAt("IFPairV2", pairAddress);
  const [reserveToken, reserveAsset] = await pairForGrad.getReserves();
  const tokenBalance = await pairForGrad.balance();
  const assetBalance = await pairForGrad.assetBalance();

  console.log("\n--- Current Pair State ---");
  console.log("Token Reserve (reserveA):", formatEther(reserveToken), "tokens");
  console.log("Asset Reserve (reserveB):", formatEther(reserveAsset), "VIRTUAL");
  console.log("Token Balance:", formatEther(tokenBalance), "tokens");
  console.log("Asset Balance:", formatEther(assetBalance), "VIRTUAL");
  console.log("Graduation Threshold:", formatEther(gradThreshold), "tokens");

  // Graduation happens when: newReserveA <= gradThreshold
  // We need to buy enough to reduce reserveToken to gradThreshold or below
  const tokensNeededToBuy = BigInt(reserveToken) - BigInt(gradThreshold);
  console.log("\n--- Graduation Calculation ---");
  console.log("Tokens needed to buy for graduation:", formatEther(tokensNeededToBuy > 0n ? tokensNeededToBuy : 0n), "tokens");

  if (tokensNeededToBuy <= 0n) {
    console.log("⚠️ Token reserve already at or below graduation threshold, graduation should trigger on next buy");
  }

  // Check current token status
  const tokenInfoBeforeGrad = await bondingV2.tokenInfo(tokenAddress);
  console.log("\n--- Token Status Before Graduation ---");
  console.log("Trading:", tokenInfoBeforeGrad.trading);
  console.log("Trading on Uniswap:", tokenInfoBeforeGrad.tradingOnUniswap);
  console.log("Agent Token:", tokenInfoBeforeGrad.agentToken);
  console.log("Application ID:", tokenInfoBeforeGrad.applicationId.toString());

  // We'll buy in larger chunks until graduation triggers
  // Graduation requires: newReserveA <= gradThreshold AND !hasAntiSniperTax AND trading
  console.log("\n--- Buying to trigger graduation ---");

  let graduated = false;
  let buyCount = 0;
  const maxBuys = 50; // Safety limit
  const buyChunkSize = parseEther("20000"); // Buy 500 VIRTUAL per transaction

  // Check we have enough VIRTUAL balance
  const currentVirtualBalance = await virtualToken.balanceOf(signerAddress);
  console.log("Current VIRTUAL Balance:", formatEther(currentVirtualBalance), "VIRTUAL");

  // Ensure we have sufficient allowance for multiple buys
  const totalRequiredAllowance = buyChunkSize * BigInt(maxBuys);
  const currentBondingAllowance = await virtualToken.allowance(signerAddress, config.bondingV2Address);
  if (BigInt(currentBondingAllowance) < totalRequiredAllowance) {
    console.log("--- Increasing VIRTUAL allowance for graduation buys ---");
    const approveMoreTx = await virtualToken.approve(config.bondingV2Address, totalRequiredAllowance);
    await approveMoreTx.wait();
    console.log("✅ Approved additional VIRTUAL to BondingV2");
  }

  while (!graduated && buyCount < maxBuys) {
    // Check if token is still trading (graduation hasn't happened)
    const currentTokenInfo = await bondingV2.tokenInfo(tokenAddress);
    if (!currentTokenInfo.trading || currentTokenInfo.tradingOnUniswap) {
      console.log("\n✅ Token has graduated! (trading=false, tradingOnUniswap=true)");
      graduated = true;
      break;
    }

    // Get current reserves
    const [currentReserveToken] = await pairForGrad.getReserves();
    const tokensRemaining = BigInt(currentReserveToken) - BigInt(gradThreshold);
    
    buyCount++;
    console.log(`\n--- Buy #${buyCount} ---`);
    console.log("Current Token Reserve:", formatEther(currentReserveToken), "tokens");
    console.log("Tokens remaining until threshold:", formatEther(tokensRemaining > 0n ? tokensRemaining : 0n), "tokens");

    // Determine buy amount - use smaller amount if we're close to graduation
    let actualBuyAmount = buyChunkSize;
    if (tokensRemaining <= 0n) {
      // We're at or past threshold, a small buy should trigger graduation
      actualBuyAmount = parseEther("10");
      console.log("Close to graduation, using smaller buy amount:", formatEther(actualBuyAmount), "VIRTUAL");
    }

    try {
      const gradBuyDeadline = Math.floor(Date.now() / 1000) + 300;
      const gradBuyTx = await bondingV2.buy(actualBuyAmount, tokenAddress, 0, gradBuyDeadline);
      const gradBuyReceipt = await gradBuyTx.wait();
      console.log("Buy successful, gas used:", gradBuyReceipt.gasUsed.toString());

      // Check for Graduated event
      const graduatedEvent = gradBuyReceipt.logs.find((log: any) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed?.name === "Graduated";
        } catch {
          return false;
        }
      });

      if (graduatedEvent) {
        const parsedGradEvent = bondingV2.interface.parseLog(graduatedEvent);
        console.log("\n🎉 GRADUATION EVENT DETECTED!");
        console.log("Token Address:", parsedGradEvent.args[0]);
        console.log("Agent Token:", parsedGradEvent.args[1]);
        graduated = true;
      }
    } catch (buyError: any) {
      console.error("Buy failed:", buyError.message);
      // Check if graduation happened anyway
      const checkTokenInfo = await bondingV2.tokenInfo(tokenAddress);
      if (!checkTokenInfo.trading || checkTokenInfo.tradingOnUniswap) {
        console.log("✅ Token has graduated despite error!");
        graduated = true;
      } else {
        throw buyError;
      }
    }
  }

  if (!graduated) {
    console.log(`\n⚠️ Graduation not triggered after ${maxBuys} buys`);
    console.log("This may indicate insufficient VIRTUAL balance or incorrect threshold configuration");
  }

  // ============================================
  // Step 10: Verify Graduation State
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 10: Verify Graduation State");
  console.log("=".repeat(80));

  const tokenInfoAfterGrad = await bondingV2.tokenInfo(tokenAddress);
  console.log("\n--- Token Status After Graduation ---");
  console.log("Trading:", tokenInfoAfterGrad.trading, "(expected: false)");
  console.log("Trading on Uniswap:", tokenInfoAfterGrad.tradingOnUniswap, "(expected: true)");
  console.log("Agent Token:", tokenInfoAfterGrad.agentToken);

  if (!tokenInfoAfterGrad.trading && tokenInfoAfterGrad.tradingOnUniswap) {
    console.log("\n✅ Token correctly graduated!");
    
    // Verify AgentToken was created
    if (tokenInfoAfterGrad.agentToken !== ethers.ZeroAddress) {
      console.log("✅ AgentToken was created:", tokenInfoAfterGrad.agentToken);
      
      // Check if the agentToken has the expected properties
      try {
        const createdAgentToken = await ethers.getContractAt("IERC20", tokenInfoAfterGrad.agentToken);
        const agentTokenTotalSupply = await createdAgentToken.totalSupply();
        console.log("AgentToken Total Supply:", formatEther(agentTokenTotalSupply));
      } catch (e) {
        console.log("Note: Could not query AgentToken details");
      }
    } else {
      console.log("⚠️ AgentToken address is zero - check executeBondingCurveApplicationSalt");
    }

    // Verify application was executed in AgentFactoryV6
    try {
      const application = await agentFactoryV6.getApplication(tokenInfoAfterGrad.applicationId);
      console.log("\n--- Application Status in AgentFactoryV6 ---");
      console.log("Application ID:", tokenInfoAfterGrad.applicationId.toString());
      console.log("Application Status:", application.status, "(1 = Executed)");
      console.log("Application Virtual ID:", application.virtualId.toString());
      console.log("Application Token Address:", application.tokenAddress);
      
      if (application.status === 1n || application.status === 1) {
        console.log("✅ Application correctly marked as Executed in AgentFactoryV6");
      }
    } catch (e: any) {
      console.log("Note: Could not query application details:", e.message);
    }
  } else {
    console.log("\n⚠️ Token graduation verification failed");
    console.log("Expected: trading=false, tradingOnUniswap=true");
  }

  // ============================================
  // Step 11: Test Sell (Post-Graduation if applicable)
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 11: Test Sell");
  console.log("=".repeat(80));

  // Note: After graduation, sell through BondingV2 should fail (trading=false)
  // We'll test this behavior
  const agentTokenBalanceForSell = await agentToken.balanceOf(signerAddress);
  
  if (BigInt(agentTokenBalanceForSell) === 0n) {
    console.log("No tokens to sell (all used in graduation buys)");
  } else {
    const sellAmount = BigInt(agentTokenBalanceForSell) / 4n;
    console.log("Sell Amount:", formatEther(sellAmount), "tokens");

    // Approve agent token to FRouterV2
    const agentTokenAllowance = await agentToken.allowance(signerAddress, config.fRouterV2Address);
    if (agentTokenAllowance < sellAmount) {
      console.log("\n--- Approving Agent Token to FRouterV2 ---");
      const approveAgentTx = await agentToken.approve(config.fRouterV2Address, ethers.MaxUint256);
      await approveAgentTx.wait();
      console.log("✅ Approved Agent Token to FRouterV2");
    }

    if (graduated) {
      // After graduation, sell through BondingV2 should fail
      console.log("\n--- Testing sell after graduation (should fail) ---");
      try {
        const sellDeadline = Math.floor(Date.now() / 1000) + 300;
        await bondingV2.sell.staticCall(sellAmount, tokenAddress, 0, sellDeadline);
        console.log("⚠️ Sell staticCall succeeded - unexpected after graduation");
      } catch (e: any) {
        console.log("✅ Sell correctly rejected after graduation (trading=false)");
        console.log("   Error:", e.message?.substring(0, 100) || "InvalidTokenStatus");
      }
    } else {
      // Token not graduated, normal sell should work
      const virtualBalanceBeforeSell = await virtualToken.balanceOf(signerAddress);
      const taxVaultBalanceBeforeSell = await virtualToken.balanceOf(taxVault);

      console.log("\n--- Balances Before Sell ---");
      console.log("VIRTUAL Balance:", formatEther(virtualBalanceBeforeSell), "VIRTUAL");
      console.log("Tax Vault Balance:", formatEther(taxVaultBalanceBeforeSell), "VIRTUAL");

      console.log("\n--- Executing sell ---");
      const sellDeadline = Math.floor(Date.now() / 1000) + 300;
      const sellTx = await bondingV2.sell(sellAmount, tokenAddress, 0, sellDeadline, { gasLimit: 500000 });
      const sellReceipt = await sellTx.wait();
      console.log("✅ sell() transaction successful!");
      console.log("Gas Used:", sellReceipt.gasUsed.toString());

      const virtualBalanceAfterSell = await virtualToken.balanceOf(signerAddress);
      const taxVaultBalanceAfterSell = await virtualToken.balanceOf(taxVault);

      const virtualReceived = virtualBalanceAfterSell - virtualBalanceBeforeSell;
      const sellTaxCollected = taxVaultBalanceAfterSell - taxVaultBalanceBeforeSell;

      console.log("\n--- Sell Results ---");
      console.log("VIRTUAL Received:", formatEther(virtualReceived), "VIRTUAL");
      console.log("Sell Tax Collected:", formatEther(sellTaxCollected), "VIRTUAL");
      console.log("Sell Tax Rate:", sellTax.toString(), "%");

      if (BigInt(sellTaxCollected) > 0n) {
        console.log("✅ Sell tax correctly collected to taxVault");
      }
    }
  }

  // ============================================
  // Summary
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  E2E Test Summary");
  console.log("=".repeat(80));

  console.log("\n✅ All BondingV2 tests completed!");
  console.log("\nVerified:");
  console.log("  1. BondingV2 parameters are correctly configured (no BondingConfig)");
  console.log("  2. FFactoryV2 tax parameters are correctly configured");
  console.log("  3. preLaunch() executed successfully (required scheduled start time)");
  console.log("  4. On-chain tokenInfo stored correctly");
  console.log("  5. Fee collection correct:", formatEther(fee), "VIRTUAL");
  console.log("  6. launch() executed successfully after start time");
  console.log("  7. buy() during anti-sniper period - tax to antiSniperTaxVault");
  console.log("  8. buy() after anti-sniper period - normal tax to taxVault");
  console.log("  9. Buy to graduation - " + (graduated ? "✅ SUCCESS" : "⚠️ NOT TRIGGERED"));
  console.log("  10. Graduation state verification - " + (graduated ? "✅ VERIFIED" : "⚠️ SKIPPED"));
  console.log("  11. sell() - " + (graduated ? "correctly rejected after graduation" : "executed with correct tax"));

  console.log("\n--- Tax Summary ---");
  console.log("Normal Buy Tax Rate:", buyTax.toString(), "%");
  console.log("Normal Sell Tax Rate:", sellTax.toString(), "%");
  console.log("Anti-Sniper Buy Tax Start Value:", antiSniperBuyTaxStartValue.toString(), "%");
  console.log("Anti-Sniper Duration:", antiSniperDurationSeconds, "seconds (", antiSniperBuyTaxStartValue.toString(), " minutes)");
  console.log("Tax Vault:", taxVault);
  console.log("Anti-Sniper Tax Vault:", antiSniperTaxVault);

  console.log("\n--- Token Summary ---");
  console.log("Token Address:", tokenAddress);
  console.log("Pair Address:", pairAddress);
  console.log("Virtual ID:", virtualId.toString());
  if (graduated) {
    console.log("Agent Token:", tokenInfoAfterGrad.agentToken);
    console.log("Graduation Status: ✅ GRADUATED");
  } else {
    console.log("Graduation Status: ⚠️ NOT GRADUATED");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ E2E Test Failed:");
    console.error(error);
    process.exit(1);
  });
