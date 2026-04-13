import { parseEther, formatEther, type TransactionReceipt } from "ethers";
import { launchpadDefaultTxGasLimit } from "./utils";
const hre = require("hardhat");
const { ethers } = hre;

// USAGE:
// ENV_FILE=.env.launchpadv5_dev npx hardhat run ./scripts/launchpadv5/handle_buy_sell.ts --network base_sepolia
// ENV_FILE=.env.launchpadv5_dev_eth_sepolia npx hardhat run ./scripts/launchpadv5/handle_buy_sell.ts --network eth_sepolia
// ENV_FILE=.env.launchpadv5_dev_arbitrum_sepolia npx hardhat run ./scripts/launchpadv5/handle_buy_sell.ts --network arbitrum_sepolia
// ENV_FILE=.env.launchpadv5_dev_bsc_testnet npx hardhat run ./scripts/launchpadv5/handle_buy_sell.ts --network bsc_testnet

// ============================================
// Configuration - Modify these values
// ============================================
const TOKEN_ADDRESS_BY_NETWORK: Record<string, string> = {
  // base_sepolia: "0xC4C27033ac81b7f6CE94bFcf5577956d5B690a08", // agentTokenV4 on base sepolia
  base_sepolia: "0x4ce7abA63294C7E9E9c54DbaCc79BefE79B022F8", // agentTokenV3 on base sepolia
  // arbitrum_sepolia: "0x17742fa86139ed9dB81B2ec8037b2525061F97B9", // agentTokenV4 on arbitrum sepolia
  arbitrum_sepolia: "0x85A02c33aced66eD39a0fD07FB0cd8d75290939D", // agentTokenV3 on arbitrum sepolia
  eth_sepolia: "0x02b6d8a16f9D79Cb9E8eD685492a1cD64fF627c3",
  bsc_testnet: "0x6B9048DFF2fA0ACd74fC9b195dC4768E1d541FBf",
};

function resolveTokenAddress(): string {
  const networkName = String(hre.network?.name || "").trim();
  const defaultByNetwork = TOKEN_ADDRESS_BY_NETWORK[networkName];

  return defaultByNetwork;
}

const CONFIG = {
  // Token address auto-resolves by network (see resolveTokenAddress()).
  tokenAddress: resolveTokenAddress(),
  
  // Amount of VIRTUAL to spend on buy
  buyAmount: "43000", // 1 VIRTUAL
  
  // Contract addresses (from environment or hardcode)
  bondingV5Address: process.env.BONDING_V5_ADDRESS || "",
  fRouterV3Address: process.env.FRouterV3_ADDRESS || "",
  virtualTokenAddress: process.env.VIRTUAL_TOKEN_ADDRESS || "",
  txConfirmTimeoutMs: Number(process.env.TX_CONFIRM_TIMEOUT_MS || "180000"),
};

async function waitWithProgress(txHash: string, label: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (true) {
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (receipt) return receipt;
    const elapsed = Date.now() - startedAt;
    if (elapsed > timeoutMs) {
      throw new Error(
        `${label} tx still pending after ${Math.floor(timeoutMs / 1000)}s, txHash=${txHash}`
      );
    }
    console.log(
      `⏳ ${label} pending... ${Math.floor(elapsed / 1000)}s elapsed, txHash=${txHash}`
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

/** Reverted txs still get a receipt with status 0 — do not treat that as success. */
function assertSuccessfulReceipt(
  receipt: TransactionReceipt | null,
  label: string,
  txHash: string
): asserts receipt is TransactionReceipt {
  if (receipt == null) {
    throw new Error(`${label} tx has no receipt (null), txHash=${txHash}`);
  }
  if (receipt.status !== 1) {
    throw new Error(
      `${label} failed on-chain (receipt status ${String(receipt.status)}). ` +
        `See explorer for revert data (e.g. InvalidTokenStatus). txHash=${txHash}`
    );
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Buy and Sell Script");
  console.log("=".repeat(60));
  console.log("Network:", hre.network.name);

  // Validate config
  if (!CONFIG.tokenAddress) {
    throw new Error(
      `Token address is empty for network=${hre.network.name}. ` +
      `Set TOKEN_ADDRESS_${hre.network.name.toUpperCase()} or TOKEN_ADDRESS, ` +
      `or add default in TOKEN_ADDRESS_BY_NETWORK`
    );
  }
  if (!ethers.isAddress(CONFIG.bondingV5Address)) {
    throw new Error(
      `Invalid BONDING_V5_ADDRESS: "${CONFIG.bondingV5Address}". Please set a valid 0x address in ENV_FILE.`
    );
  }
  if (!ethers.isAddress(CONFIG.fRouterV3Address)) {
    throw new Error(
      `Invalid FRouterV3 address: "${CONFIG.fRouterV3Address}". ` +
      `Set FRouterV3_ADDRESS (or legacy FRouterV2_ADDRESS) in ENV_FILE.`
    );
  }
  if (!ethers.isAddress(CONFIG.virtualTokenAddress)) {
    throw new Error(
      `Invalid VIRTUAL_TOKEN_ADDRESS: "${CONFIG.virtualTokenAddress}". Please set a valid 0x address in ENV_FILE.`
    );
  }
  if (!ethers.isAddress(CONFIG.tokenAddress)) {
    throw new Error(
      `Invalid tokenAddress for network=${hre.network.name}: "${CONFIG.tokenAddress}".`
    );
  }

  // Get signer
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  console.log("\nSigner:", signerAddress);

  // Get contract instances
  const bondingV5 = await ethers.getContractAt("BondingV5", CONFIG.bondingV5Address);
  const fRouterV3 = await ethers.getContractAt("FRouterV3", CONFIG.fRouterV3Address);
  const virtualToken = await ethers.getContractAt("IERC20", CONFIG.virtualTokenAddress);
  const agentToken = await ethers.getContractAt("IERC20", CONFIG.tokenAddress);

  // Get token info
  const tokenInfo = await bondingV5.tokenInfo(CONFIG.tokenAddress);
  const pairAddress = tokenInfo.pair;
  
  console.log("\n--- Token Info ---");
  console.log("Token Address:", CONFIG.tokenAddress);
  console.log("Pair Address:", pairAddress);
  console.log("Trading:", tokenInfo.trading);
  console.log("Trading on Uniswap:", tokenInfo.tradingOnUniswap);

  if (!tokenInfo.trading) {
    throw new Error("Token is not trading yet");
  }

  // ============================================
  // Step 1: Check Balances
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("  Step 1: Check Balances");
  console.log("=".repeat(60));

  const virtualBalanceBefore = await virtualToken.balanceOf(signerAddress);
  const agentTokenBalanceBefore = await agentToken.balanceOf(signerAddress);

  console.log("VIRTUAL Balance:", formatEther(virtualBalanceBefore), "VIRTUAL");
  console.log("Agent Token Balance:", formatEther(agentTokenBalanceBefore), "tokens");

  // ============================================
  // Step 2: Approve and Buy
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("  Step 2: Buy Tokens");
  console.log("=".repeat(60));

  const buyAmountWei = parseEther(CONFIG.buyAmount);
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  // Check and approve VIRTUAL token
  const bondingAllowance = await virtualToken.allowance(signerAddress, CONFIG.bondingV5Address);
  const routerAllowance = await virtualToken.allowance(signerAddress, CONFIG.fRouterV3Address);

  if (bondingAllowance < buyAmountWei) {
    console.log("Approving VIRTUAL to BondingV5...");
    const approveTx1 = await virtualToken.approve(CONFIG.bondingV5Address, ethers.MaxUint256);
    assertSuccessfulReceipt(
      await approveTx1.wait(),
      "Approve VIRTUAL to BondingV5",
      approveTx1.hash
    );
    console.log("✅ Approved to BondingV5");
  }

  if (routerAllowance < buyAmountWei) {
    console.log("Approving VIRTUAL to FRouterV3...");
    const approveTx2 = await virtualToken.approve(CONFIG.fRouterV3Address, ethers.MaxUint256);
    assertSuccessfulReceipt(
      await approveTx2.wait(),
      "Approve VIRTUAL to FRouterV3",
      approveTx2.hash
    );
    console.log("✅ Approved to FRouterV3");
  }

  console.log("\nBuying with", CONFIG.buyAmount, "VIRTUAL...");
  const buyTx = await bondingV5.buy(
    buyAmountWei,
    CONFIG.tokenAddress,
    0, // minAmountOut (0 for no slippage protection)
    deadline,
    { gasLimit: launchpadDefaultTxGasLimit() }
  );
  console.log("Buy tx submitted:", buyTx.hash);
  const buyReceipt = await waitWithProgress(
    buyTx.hash,
    "Buy",
    CONFIG.txConfirmTimeoutMs
  );
  assertSuccessfulReceipt(buyReceipt, "Buy", buyTx.hash);
  console.log("✅ Buy successful!");
  console.log("Gas Used:", buyReceipt.gasUsed.toString());

  // Check balances after buy
  const virtualBalanceAfterBuy = await virtualToken.balanceOf(signerAddress);
  const agentTokenBalanceAfterBuy = await agentToken.balanceOf(signerAddress);
  const tokensReceived = agentTokenBalanceAfterBuy - agentTokenBalanceBefore;

  console.log("\n--- After Buy ---");
  console.log("VIRTUAL Spent:", formatEther(virtualBalanceBefore - virtualBalanceAfterBuy), "VIRTUAL");
  console.log("Tokens Received:", formatEther(tokensReceived), "tokens");
  console.log("Agent Token Balance:", formatEther(agentTokenBalanceAfterBuy), "tokens");

  // ============================================
  // Step 3: Sell All Tokens
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("  Step 3: Sell All Tokens");
  console.log("=".repeat(60));

  const sellAmount = agentTokenBalanceAfterBuy;
  
  if (sellAmount === 0n) {
    console.log("No tokens to sell!");
    return;
  }

  // Approve agent token to FRouterV3 for sell
  const agentTokenAllowance = await agentToken.allowance(signerAddress, CONFIG.fRouterV3Address);
  if (agentTokenAllowance < sellAmount) {
    console.log("Approving Agent Token to FRouterV3...");
    const approveAgentTx = await agentToken.approve(CONFIG.fRouterV3Address, ethers.MaxUint256);
    assertSuccessfulReceipt(
      await approveAgentTx.wait(),
      "Approve agent token to FRouterV3",
      approveAgentTx.hash
    );
    console.log("✅ Approved Agent Token to FRouterV3");
  }

  console.log("\nSelling", formatEther(sellAmount), "tokens...");
  const sellDeadline = Math.floor(Date.now() / 1000) + 300;
  const sellTx = await bondingV5.sell(
    sellAmount,
    CONFIG.tokenAddress,
    0, // minAmountOut (0 for no slippage protection)
    sellDeadline,
    { gasLimit: launchpadDefaultTxGasLimit() }
  );
  console.log("Sell tx submitted:", sellTx.hash);
  const sellReceipt = await waitWithProgress(
    sellTx.hash,
    "Sell",
    CONFIG.txConfirmTimeoutMs
  );
  assertSuccessfulReceipt(sellReceipt, "Sell", sellTx.hash);
  console.log("✅ Sell successful!");
  console.log("Gas Used:", sellReceipt.gasUsed.toString());

  // Check balances after sell
  const virtualBalanceAfterSell = await virtualToken.balanceOf(signerAddress);
  const agentTokenBalanceAfterSell = await agentToken.balanceOf(signerAddress);
  const virtualReceived = virtualBalanceAfterSell - virtualBalanceAfterBuy;

  console.log("\n--- After Sell ---");
  console.log("VIRTUAL Received:", formatEther(virtualReceived), "VIRTUAL");
  console.log("Agent Token Balance:", formatEther(agentTokenBalanceAfterSell), "tokens");

  // ============================================
  // Summary
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("  Summary");
  console.log("=".repeat(60));

  const netVirtualChange = virtualBalanceAfterSell - virtualBalanceBefore;
  
  console.log("\n--- Net Result ---");
  console.log("VIRTUAL Before:", formatEther(virtualBalanceBefore));
  console.log("VIRTUAL After:", formatEther(virtualBalanceAfterSell));
  console.log("Net Change:", formatEther(netVirtualChange), "VIRTUAL", netVirtualChange < 0n ? "(loss from fees)" : "");
  console.log("Agent Tokens Remaining:", formatEther(agentTokenBalanceAfterSell));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Script Failed:");
    console.error(error);
    process.exit(1);
  });