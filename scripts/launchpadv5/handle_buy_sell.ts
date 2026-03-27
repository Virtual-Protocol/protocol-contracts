import { parseEther, formatEther } from "ethers";
const { ethers } = require("hardhat");

// ============================================
// Configuration - Modify these values
// ============================================
const CONFIG = {
  // Token address to buy/sell
  // tokenAddress: "0x0Ee7F7450C639736d7D9A252D5f21BA4cA1379d3", // TODO: Set your token address
  tokenAddress: "0xF940345C0e54DfB1474137c45b4D50C336C95a4d", // TODO: Set your token address
  
  // Amount of VIRTUAL to spend on buy
  buyAmount: "10", // 1 VIRTUAL
  
  // Contract addresses (from environment or hardcode)
  bondingV5Address: process.env.BONDING_V5_ADDRESS || "",
  fRouterV3Address: process.env.FRouterV3_ADDRESS || "",
  virtualTokenAddress: process.env.VIRTUAL_TOKEN_ADDRESS || "",
};

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Buy and Sell Script");
  console.log("=".repeat(60));

  // Validate config
  if (CONFIG.tokenAddress === "0x..." || !CONFIG.tokenAddress) {
    throw new Error("Please set tokenAddress in CONFIG");
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
    await approveTx1.wait();
    console.log("✅ Approved to BondingV5");
  }

  if (routerAllowance < buyAmountWei) {
    console.log("Approving VIRTUAL to FRouterV2...");
    const approveTx2 = await virtualToken.approve(CONFIG.fRouterV3Address, ethers.MaxUint256);
    await approveTx2.wait();
    console.log("✅ Approved to FRouterV2");
  }

  console.log("\nBuying with", CONFIG.buyAmount, "VIRTUAL...");
  const buyTx = await bondingV5.buy(
    buyAmountWei,
    CONFIG.tokenAddress,
    0, // minAmountOut (0 for no slippage protection)
    deadline,
    { gasLimit: 500000 }
  );
  const buyReceipt = await buyTx.wait();
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

  // Approve agent token to FRouterV2 for sell
  const agentTokenAllowance = await agentToken.allowance(signerAddress, CONFIG.fRouterV3Address);
  if (agentTokenAllowance < sellAmount) {
    console.log("Approving Agent Token to FRouterV2...");
    const approveAgentTx = await agentToken.approve(CONFIG.fRouterV3Address, ethers.MaxUint256);
    await approveAgentTx.wait();
    console.log("✅ Approved Agent Token to FRouterV2");
  }

  console.log("\nSelling", formatEther(sellAmount), "tokens...");
  const sellDeadline = Math.floor(Date.now() / 1000) + 300;
  const sellTx = await bondingV5.sell(
    sellAmount,
    CONFIG.tokenAddress,
    0, // minAmountOut (0 for no slippage protection)
    sellDeadline,
    { gasLimit: 500000 }
  );
  const sellReceipt = await sellTx.wait();
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
