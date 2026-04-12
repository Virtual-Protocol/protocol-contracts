/**
 * Batch Swap Tax Script for AgentTaxV2
 * 
 * Calls batchSwapForTokenAddress to swap accumulated tax and distribute to creators.
 * 
 * Usage:
 *   ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/batch_swap_tax.ts --network local
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/batch_swap_tax.ts --network base_sepolia
 *   ENV_FILE=.env.launchpadv5_prod npx hardhat run scripts/launchpadv5/batch_swap_tax.ts --network base
 * 
 * Required env variables:
 *   - AGENT_TAX_V2_CONTRACT_ADDRESS: AgentTaxV2 contract address
 *   - Signer (hardhat.config private key) must have SWAP_ROLE on AgentTaxV2 for
 *     swapForTokenAddress / batchSwapForTokenAddress (see deployLaunchpadv5_0: BE_TAX_OPS_WALLETS).
 *     EXECUTOR_ROLE alone is not sufficient — the contract uses onlyRole(SWAP_ROLE).
 * 
 * Configuration (edit below):
 *   - TOKEN_ADDRESSES: Array of token addresses to swap tax for
 *   - MIN_OUTPUTS: Array of minimum output amounts (use 0 for no slippage protection)
 */
import { formatEther } from "ethers";
import { launchpadBatchSwapGasLimit } from "./utils";
const { ethers } = require("hardhat");

// ============================================================================
// CONFIGURATION - Edit these values (only used when running as standalone script)
// ============================================================================
const TOKEN_ADDRESSES: string[] = [
  // Add token addresses here, e.g.:
  // "0x36883376506272Fb7BB9062246100C69EFA61Ceb",
  "0x99326F4CF8f6fC7153FbF6080430BF2459FafC1C"
];

// Minimum output amounts for each token (same length as TOKEN_ADDRESSES)
// Use 0n for no slippage protection (for testing only!)
const MIN_OUTPUTS: bigint[] = [
  // Add min outputs here, e.g.:
  0n,
];
// ============================================================================

export interface BatchSwapResult {
  success: boolean;
  txHash?: string;
  gasUsed?: bigint;
  swappedTokens: string[];
  failedTokens: string[];
  error?: string;
}

/**
 * Execute batchSwapForTokenAddress on AgentTaxV2 contract
 * @param agentTaxV2Address - Address of the AgentTaxV2 contract
 * @param tokenAddresses - Array of token addresses to swap tax for
 * @param minOutputs - Array of minimum output amounts (same length as tokenAddresses)
 * @param signer - Optional signer to use (defaults to first signer from ethers)
 * @returns BatchSwapResult with transaction details
 */
export async function executeBatchSwap(
  agentTaxV2Address: string,
  tokenAddresses: string[],
  minOutputs: bigint[],
  signer?: any
): Promise<BatchSwapResult> {
  console.log("\n" + "=".repeat(80));
  console.log("  Batch Swap Tax - AgentTaxV2");
  console.log("=".repeat(80));

  if (tokenAddresses.length === 0) {
    console.log("\n⚠️ No token addresses provided");
    return { success: false, swappedTokens: [], failedTokens: [], error: "No token addresses provided" };
  }

  if (tokenAddresses.length !== minOutputs.length) {
    const error = `tokenAddresses length (${tokenAddresses.length}) must match minOutputs length (${minOutputs.length})`;
    console.log(`\n⚠️ ${error}`);
    return { success: false, swappedTokens: [], failedTokens: [], error };
  }

  console.log("\n--- Configuration ---");
  console.log("AgentTaxV2 Address:", agentTaxV2Address);
  console.log("Token Addresses:", tokenAddresses.length);
  for (let i = 0; i < tokenAddresses.length; i++) {
    console.log(`  [${i}] ${tokenAddresses[i]} -> minOutput: ${minOutputs[i].toString()}`);
  }

  const agentTaxV2 = await ethers.getContractAt("AgentTaxV2", agentTaxV2Address);

  const minSwapThreshold = await agentTaxV2.minSwapThreshold();
  const maxSwapThreshold = await agentTaxV2.maxSwapThreshold();
  const assetTokenAddress = await agentTaxV2.assetToken();
  const treasuryAddress = await agentTaxV2.treasury();

  console.log("\n--- AgentTaxV2 Parameters ---");
  console.log("Min Swap Threshold:", formatEther(minSwapThreshold), "VIRTUAL");
  console.log("Max Swap Threshold:", formatEther(maxSwapThreshold), "VIRTUAL");
  console.log("Asset Token:", assetTokenAddress);
  console.log("Treasury:", treasuryAddress);

  console.log("\n--- Token Tax Status ---");
  const tokensToSwap: string[] = [];
  const minOutputsToSwap: bigint[] = [];

  for (let i = 0; i < tokenAddresses.length; i++) {
    const tokenAddress = tokenAddresses[i];
    const [amountCollected, amountSwapped] = await agentTaxV2.getTokenTaxAmounts(tokenAddress);
    const pendingTax = amountCollected - amountSwapped;
    const tokenRecipient = await agentTaxV2.tokenRecipients(tokenAddress);

    console.log(`\n[${i}] Token: ${tokenAddress}`);
    console.log(`    Creator: ${tokenRecipient.creator}`);
    console.log(`    Amount Collected: ${formatEther(amountCollected)} VIRTUAL`);
    console.log(`    Amount Swapped: ${formatEther(amountSwapped)} VIRTUAL`);
    console.log(`    Pending Tax: ${formatEther(pendingTax)} VIRTUAL`);

    if (tokenRecipient.creator === ethers.ZeroAddress) {
      console.log(`    ⚠️ Token not registered in AgentTaxV2 - SKIPPING`);
    } else if (pendingTax < minSwapThreshold) {
      console.log(`    ⚠️ Pending tax below threshold (${formatEther(minSwapThreshold)}) - SKIPPING`);
    } else {
      console.log(`    ✅ Ready to swap`);
      tokensToSwap.push(tokenAddress);
      minOutputsToSwap.push(minOutputs[i]);
    }
  }

  if (tokensToSwap.length === 0) {
    console.log("\n⚠️ No tokens eligible for swap");
    return { success: true, swappedTokens: [], failedTokens: [], error: "No tokens eligible for swap" };
  }

  console.log(`\n--- Preparing to swap ${tokensToSwap.length} token(s) ---`);

  if (!signer) {
    [signer] = await ethers.getSigners();
  }
  const signerAddress = await signer.getAddress();
  console.log("Signer Address:", signerAddress);

  const swapRole = await agentTaxV2.SWAP_ROLE();
  const hasSwapRole = await agentTaxV2.hasRole(swapRole, signerAddress);
  const executorRole = await agentTaxV2.EXECUTOR_ROLE();
  const hasExecutorRole = await agentTaxV2.hasRole(executorRole, signerAddress);
  console.log("Has SWAP_ROLE (required for batch swap):", hasSwapRole);
  console.log("Has EXECUTOR_ROLE (other ops only):", hasExecutorRole);

  if (!hasSwapRole) {
    const error = `Signer ${signerAddress} does not have SWAP_ROLE on AgentTaxV2 (grant via BE_TAX_OPS_WALLETS in deploy step 0)`;
    console.log(`\n⚠️ ${error}`);
    return { success: false, swappedTokens: [], failedTokens: tokensToSwap, error };
  }

  const assetToken = await ethers.getContractAt("IERC20", assetTokenAddress);
  const treasuryBalanceBefore = await assetToken.balanceOf(treasuryAddress);

  console.log("\n--- Executing batchSwapForTokenAddress ---");
  console.log("Tokens:", tokensToSwap);
  console.log("Min Outputs:", minOutputsToSwap.map(m => m.toString()));

  const batchSwapGasLimit = launchpadBatchSwapGasLimit(tokensToSwap.length);

  try {
    const agentTaxV2WithSigner = agentTaxV2.connect(signer);

    await agentTaxV2WithSigner.batchSwapForTokenAddress.staticCall(
      tokensToSwap,
      minOutputsToSwap,
      { gasLimit: batchSwapGasLimit }
    );

    const tx = await agentTaxV2WithSigner.batchSwapForTokenAddress(
      tokensToSwap,
      minOutputsToSwap,
      { gasLimit: batchSwapGasLimit }
    );

    console.log("Transaction submitted:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("\n✅ Transaction confirmed!");
    console.log("Gas Used:", receipt.gasUsed.toString());
    console.log("Block Number:", receipt.blockNumber);

    const swapEvents = receipt.logs.filter((log: any) => {
      try {
        const parsed = agentTaxV2.interface.parseLog(log);
        return parsed?.name === "SwapExecuted";
      } catch {
        return false;
      }
    });

    const failedEvents = receipt.logs.filter((log: any) => {
      try {
        const parsed = agentTaxV2.interface.parseLog(log);
        return parsed?.name === "SwapFailed";
      } catch {
        return false;
      }
    });

    const swappedTokens: string[] = [];
    const failedTokens: string[] = [];

    console.log("\n--- Swap Results ---");
    console.log("Successful swaps:", swapEvents.length);
    console.log("Failed swaps:", failedEvents.length);

    for (const event of swapEvents) {
      const parsed = agentTaxV2.interface.parseLog(event);
      console.log(`\n✅ SwapExecuted:`);
      console.log(`   Token: ${parsed.args.tokenAddress}`);
      console.log(`   Tax Token Swapped: ${formatEther(parsed.args.taxTokenAmount)} VIRTUAL`);
      console.log(`   Asset Token Received: ${parsed.args.assetTokenAmount.toString()}`);
      swappedTokens.push(parsed.args.tokenAddress);
    }

    for (const event of failedEvents) {
      const parsed = agentTaxV2.interface.parseLog(event);
      console.log(`\n❌ SwapFailed:`);
      console.log(`   Token: ${parsed.args.tokenAddress}`);
      console.log(`   Amount: ${formatEther(parsed.args.taxTokenAmount)} VIRTUAL`);
      failedTokens.push(parsed.args.tokenAddress);
    }

    const treasuryBalanceAfter = await assetToken.balanceOf(treasuryAddress);
    console.log("\n--- Treasury Balance Change ---");
    console.log("Before:", treasuryBalanceBefore.toString());
    console.log("After:", treasuryBalanceAfter.toString());
    console.log("Received:", (treasuryBalanceAfter - treasuryBalanceBefore).toString());

    console.log("\n--- Updated Tax Amounts ---");
    for (const tokenAddress of tokensToSwap) {
      const [amountCollected, amountSwapped] = await agentTaxV2.getTokenTaxAmounts(tokenAddress);
      const pendingTax = amountCollected - amountSwapped;
      console.log(`${tokenAddress}:`);
      console.log(`  Collected: ${formatEther(amountCollected)} | Swapped: ${formatEther(amountSwapped)} | Pending: ${formatEther(pendingTax)}`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("  Batch Swap Complete!");
    console.log("=".repeat(80));

    return {
      success: true,
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed,
      swappedTokens,
      failedTokens,
    };

  } catch (error: any) {
    console.error("\n❌ Transaction failed:", error.message);
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    return {
      success: false,
      swappedTokens: [],
      failedTokens: tokensToSwap,
      error: error.message,
    };
  }
}

async function main() {
  if (TOKEN_ADDRESSES.length === 0) {
    console.log("\n⚠️ No TOKEN_ADDRESSES configured!");
    console.log("Edit the script and add token addresses to TOKEN_ADDRESSES array.");
    console.log("\nExample:");
    console.log('const TOKEN_ADDRESSES: string[] = [');
    console.log('  "0x1234567890123456789012345678901234567890",');
    console.log('];');
    return;
  }

  const agentTaxV2Address = process.env.AGENT_TAX_V2_CONTRACT_ADDRESS;
  if (!agentTaxV2Address) {
    throw new Error("AGENT_TAX_V2_CONTRACT_ADDRESS not set in environment");
  }

  const result = await executeBatchSwap(agentTaxV2Address, TOKEN_ADDRESSES, MIN_OUTPUTS);
  
  if (!result.success && result.error) {
    throw new Error(result.error);
  }
}

// Only run main() when this script is executed directly, not when imported as a module
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("\n❌ Script failed:");
      console.error(error);
      process.exit(1);
    });
}