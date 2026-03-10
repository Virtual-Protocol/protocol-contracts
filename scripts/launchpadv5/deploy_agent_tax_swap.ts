// npx hardhat run scripts/launchpadv5/deploy_tax_token_and_test_swap.ts --network eth_sepolia
import { parseEther, formatEther } from "ethers";
const { ethers, run } = require("hardhat");

// Uniswap V2 Router ABI (only the functions we need)
const UNISWAP_V2_ROUTER_ABI = [
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)",
  "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
];

// Uniswap V2 Factory ABI
const UNISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function createPair(address tokenA, address tokenB) external returns (address pair)",
];

// ERC20 ABI
const ERC20_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
];

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("  Deploy Tax Token and Test Uniswap V2 Swap");
  console.log("=".repeat(80));

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log("Deployer address:", deployerAddress);

  // Load required environment variables
  const virtualTokenAddress = process.env.VIRTUAL_TOKEN_ADDRESS;
  if (!virtualTokenAddress) {
    throw new Error("VIRTUAL_TOKEN_ADDRESS not set in environment");
  }
  const uniswapV2RouterAddress = process.env.UNISWAP_V2_ROUTER;
  if (!uniswapV2RouterAddress) {
    throw new Error("UNISWAP_V2_ROUTER not set in environment");
  }

  console.log("\n--- Configuration ---");
  console.log("VIRTUAL_TOKEN_ADDRESS:", virtualTokenAddress);
  console.log("UNISWAP_V2_ROUTER:", uniswapV2RouterAddress);

  // Get VIRTUAL token contract
  const virtualToken = new ethers.Contract(virtualTokenAddress, ERC20_ABI, deployer);
  const virtualSymbol = await virtualToken.symbol();
  const virtualDecimals = await virtualToken.decimals();
  console.log(`VIRTUAL Token: ${virtualSymbol} (${virtualDecimals} decimals)`);

  // Check deployer's VIRTUAL balance
  const virtualBalance = await virtualToken.balanceOf(deployerAddress);
  console.log(`Deployer VIRTUAL balance: ${formatEther(virtualBalance)} ${virtualSymbol}`);

  if (virtualBalance < parseEther("1000")) {
    throw new Error("Deployer needs at least 1000 VIRTUAL tokens for this test");
  }

  // ============================================
  // Step 1: Deploy Tax Token (MockERC20)
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 1: Deploy Tax Token (MockERC20)");
  console.log("=".repeat(80));

  // Check if TAX_TOKEN already exists in env
  let taxTokenAddress = process.env.AGENT_TAX_TOKEN;
  let taxToken: any;

  if (taxTokenAddress) {
    console.log("Using existing AGENT_TAX_TOKEN:", taxTokenAddress);
    taxToken = await ethers.getContractAt("MockERC20", taxTokenAddress);
  } else {
    console.log("Deploying new MockERC20 as Tax Token...");
    console.log("Note: Anyone can mint tokens via mint(address, amount)");
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    // Deploy with zero initial balance - we'll mint as needed
    const taxTokenContract = await MockERC20.deploy(
      "Fake WETH",
      "WETH",
      deployerAddress,
      0 // zero initial supply
    );
    await taxTokenContract.waitForDeployment();
    taxTokenAddress = await taxTokenContract.getAddress();
    taxToken = taxTokenContract;
    
    console.log("Tax Token deployed at:", taxTokenAddress);

    // Verify the contract
    console.log("\n--- Verifying Tax Token on Etherscan ---");
    try {
      await run("verify:verify", {
        address: taxTokenAddress,
        constructorArguments: [
          "Test Tax Token",
          "TAX",
          deployerAddress,
          "0",
        ],
      });
      console.log("✅ Tax Token verified on Etherscan");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Tax Token already verified");
      } else {
        console.log("⚠️ Verification failed:", error.message);
      }
    }
  }

  const taxSymbol = await taxToken.symbol();
  let taxBalance = await taxToken.balanceOf(deployerAddress);
  console.log(`Tax Token: ${taxSymbol}`);
  console.log(`Deployer TAX balance: ${formatEther(taxBalance)} ${taxSymbol}`);

  // Mint TAX tokens if balance is low (need at least 1000 for liquidity + tests)
  const minRequiredTax = parseEther("1000");
  if (taxBalance < minRequiredTax) {
    console.log("\n--- Minting TAX tokens ---");
    const mintAmount = parseEther("1000000"); // Mint 1M TAX tokens
    const mintTx = await taxToken.mint(deployerAddress, mintAmount);
    await mintTx.wait();
    taxBalance = await taxToken.balanceOf(deployerAddress);
    console.log(`✅ Minted ${formatEther(mintAmount)} TAX tokens`);
    console.log(`New TAX balance: ${formatEther(taxBalance)} ${taxSymbol}`);
  }

  // ============================================
  // Step 2: Setup Uniswap V2 Router and Factory
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 2: Setup Uniswap V2 Liquidity Pool");
  console.log("=".repeat(80));

  const uniswapRouter = new ethers.Contract(uniswapV2RouterAddress, UNISWAP_V2_ROUTER_ABI, deployer);
  const factoryAddress = await uniswapRouter.factory();
  console.log("Uniswap V2 Factory:", factoryAddress);

  const uniswapFactory = new ethers.Contract(factoryAddress, UNISWAP_V2_FACTORY_ABI, deployer);

  // Check if pair already exists
  let pairAddress = await uniswapFactory.getPair(virtualTokenAddress, taxTokenAddress);
  console.log("Existing pair address:", pairAddress);

  // Amount of liquidity to add
  const virtualLiquidityAmount = parseEther("500"); // 500 VIRTUAL
  const taxLiquidityAmount = parseEther("500"); // 500 TAX (1:1 ratio)

  // Approve tokens for router
  console.log("\n--- Approving tokens for Uniswap Router ---");
  
  const virtualAllowance = await virtualToken.allowance(deployerAddress, uniswapV2RouterAddress);
  if (virtualAllowance < virtualLiquidityAmount) {
    const approveTx1 = await virtualToken.approve(uniswapV2RouterAddress, ethers.MaxUint256);
    await approveTx1.wait();
    console.log("✅ Approved VIRTUAL tokens");
  } else {
    console.log("✅ VIRTUAL already approved");
  }

  const taxAllowance = await taxToken.allowance(deployerAddress, uniswapV2RouterAddress);
  if (taxAllowance < taxLiquidityAmount) {
    const approveTx2 = await taxToken.approve(uniswapV2RouterAddress, ethers.MaxUint256);
    await approveTx2.wait();
    console.log("✅ Approved TAX tokens");
  } else {
    console.log("✅ TAX already approved");
  }

  // Add liquidity if pair doesn't exist or has no liquidity
  if (pairAddress === ethers.ZeroAddress) {
    console.log("\n--- Adding initial liquidity ---");
    console.log(`Adding ${formatEther(virtualLiquidityAmount)} VIRTUAL + ${formatEther(taxLiquidityAmount)} TAX`);

    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    
    const addLiquidityTx = await uniswapRouter.addLiquidity(
      virtualTokenAddress,
      taxTokenAddress,
      virtualLiquidityAmount,
      taxLiquidityAmount,
      0, // amountAMin (accept any)
      0, // amountBMin (accept any)
      deployerAddress,
      deadline
    );
    const receipt = await addLiquidityTx.wait();
    console.log("✅ Liquidity added! Gas used:", receipt.gasUsed.toString());

    // Get the new pair address
    pairAddress = await uniswapFactory.getPair(virtualTokenAddress, taxTokenAddress);
    console.log("New pair address:", pairAddress);
  } else {
    console.log("✅ Pair already exists, skipping liquidity addition");
  }

  // ============================================
  // Step 3: Swap VIRTUAL -> TAX
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 3: Swap 100 VIRTUAL -> TAX");
  console.log("=".repeat(80));

  const swapAmountIn = parseEther("100"); // 100 VIRTUAL
  const path1 = [virtualTokenAddress, taxTokenAddress];
  
  // Get expected output
  const amountsOut1 = await uniswapRouter.getAmountsOut(swapAmountIn, path1);
  const expectedTaxOut = amountsOut1[1];
  console.log(`Swapping ${formatEther(swapAmountIn)} VIRTUAL`);
  console.log(`Expected TAX output: ${formatEther(expectedTaxOut)} TAX`);

  // Record balances before swap
  const virtualBalanceBefore1 = await virtualToken.balanceOf(deployerAddress);
  const taxBalanceBefore1 = await taxToken.balanceOf(deployerAddress);

  // Execute swap
  const deadline1 = Math.floor(Date.now() / 1000) + 3600;
  const swap1Tx = await uniswapRouter.swapExactTokensForTokens(
    swapAmountIn,
    0, // amountOutMin (accept any for test)
    path1,
    deployerAddress,
    deadline1
  );
  const swap1Receipt = await swap1Tx.wait();
  console.log("✅ Swap executed! Gas used:", swap1Receipt.gasUsed.toString());

  // Record balances after swap
  const virtualBalanceAfter1 = await virtualToken.balanceOf(deployerAddress);
  const taxBalanceAfter1 = await taxToken.balanceOf(deployerAddress);

  const virtualSpent = virtualBalanceBefore1 - virtualBalanceAfter1;
  const taxReceived = taxBalanceAfter1 - taxBalanceBefore1;

  console.log("\n--- Swap 1 Results ---");
  console.log(`VIRTUAL spent: ${formatEther(virtualSpent)} ${virtualSymbol}`);
  console.log(`TAX received: ${formatEther(taxReceived)} ${taxSymbol}`);

  // ============================================
  // Step 4: Swap TAX -> VIRTUAL (swap back)
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Step 4: Swap TAX -> VIRTUAL (swap back)");
  console.log("=".repeat(80));

  const swapAmountIn2 = taxReceived; // Swap all the TAX we received
  const path2 = [taxTokenAddress, virtualTokenAddress];
  
  // Get expected output
  const amountsOut2 = await uniswapRouter.getAmountsOut(swapAmountIn2, path2);
  const expectedVirtualOut = amountsOut2[1];
  console.log(`Swapping ${formatEther(swapAmountIn2)} TAX`);
  console.log(`Expected VIRTUAL output: ${formatEther(expectedVirtualOut)} VIRTUAL`);

  // Record balances before swap
  const virtualBalanceBefore2 = await virtualToken.balanceOf(deployerAddress);
  const taxBalanceBefore2 = await taxToken.balanceOf(deployerAddress);

  // Execute swap
  const deadline2 = Math.floor(Date.now() / 1000) + 3600;
  const swap2Tx = await uniswapRouter.swapExactTokensForTokens(
    swapAmountIn2,
    0, // amountOutMin (accept any for test)
    path2,
    deployerAddress,
    deadline2
  );
  const swap2Receipt = await swap2Tx.wait();
  console.log("✅ Swap executed! Gas used:", swap2Receipt.gasUsed.toString());

  // Record balances after swap
  const virtualBalanceAfter2 = await virtualToken.balanceOf(deployerAddress);
  const taxBalanceAfter2 = await taxToken.balanceOf(deployerAddress);

  const taxSpent = taxBalanceBefore2 - taxBalanceAfter2;
  const virtualReceived = virtualBalanceAfter2 - virtualBalanceBefore2;

  console.log("\n--- Swap 2 Results ---");
  console.log(`TAX spent: ${formatEther(taxSpent)} ${taxSymbol}`);
  console.log(`VIRTUAL received: ${formatEther(virtualReceived)} ${virtualSymbol}`);

  // ============================================
  // Summary
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("  Summary");
  console.log("=".repeat(80));

  console.log("\n--- Deployed Contracts ---");
  console.log(`AGENT_TAX_TOKEN=${taxTokenAddress}`);

  console.log("\n--- Final Balances ---");
  const finalVirtualBalance = await virtualToken.balanceOf(deployerAddress);
  const finalTaxBalance = await taxToken.balanceOf(deployerAddress);
  console.log(`VIRTUAL: ${formatEther(finalVirtualBalance)} ${virtualSymbol}`);
  console.log(`TAX: ${formatEther(finalTaxBalance)} ${taxSymbol}`);

  console.log("\n--- Swap Summary ---");
  console.log(`Swap 1: ${formatEther(virtualSpent)} VIRTUAL -> ${formatEther(taxReceived)} TAX`);
  console.log(`Swap 2: ${formatEther(taxSpent)} TAX -> ${formatEther(virtualReceived)} VIRTUAL`);
  
  const netVirtualLoss = virtualSpent - virtualReceived;
  console.log(`Net VIRTUAL loss (due to AMM fees): ${formatEther(netVirtualLoss)} VIRTUAL`);

  console.log("\n" + "=".repeat(80));
  console.log("  ✅ Test Complete!");
  console.log("=".repeat(80));
  console.log("\nAdd to your .env file:");
  console.log(`AGENT_TAX_TOKEN=${taxTokenAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Test Failed:", error);
    process.exit(1);
  });
