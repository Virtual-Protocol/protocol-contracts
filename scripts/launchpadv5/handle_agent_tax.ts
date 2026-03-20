/**
 * Script to call AgentTax.handleAgentTaxes() to distribute tax to creator and treasury
 * 
 * Usage:
 *   npx hardhat run scripts/launchpadv5/handle_agent_tax.ts --network <network>
 * 
 * Before running:
 *   1. Set the correct .env file (e.g., .env.launchpadv5_dev_eth_sepolia)
 *   2. Update the hardcoded parameters below
 */

import { ethers } from "hardhat";

// AgentTax contract ABI (only the function we need)
const AGENT_TAX_ABI = [
  "function handleAgentTaxes(uint256 agentId, bytes32[] memory txhashes, uint256[] memory amounts, uint256 minOutput) external",
  "function agentTaxAmounts(uint256 agentId) view returns (uint256 amountCollected, uint256 amountSwapped)",
  "function taxHistory(bytes32 txhash) view returns (uint256 agentId, uint256 amount)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

async function main() {
  console.log("\n=== Handle Agent Tax Script ===\n");

  // ============================================
  // CONFIGURATION - UPDATE THESE VALUES
  // ============================================

  /**
   * agentTaxAddress: The deployed AgentTax contract address
   */
  const agentTaxAddress = process.env.AGENT_TAX_CONTRACT_ADDRESS;
  if (!agentTaxAddress) {
    throw new Error("AGENT_TAX_CONTRACT_ADDRESS not set in environment");
  }

  /**
   * AGENT_ID: The agent/virtual ID (NFT token ID from AgentNft contract)
   * Where to get: 
   *   - From AgentNft contract - use tokenOfOwnerByIndex() or check Transfer events
   *   - From AgentFactoryV6 NewPersona event - the virtualId parameter
   *   - From AgentFactoryV6.applications(applicationId).virtualId - after application is executed
   * 
   * NOTE: This is NOT the same as BondingV5.tokenInfo(token).virtualId which starts at 50_000_000_000!
   *       The AGENT_ID here is the real NFT token ID (1, 2, 3, etc.) from AgentNft.
   */
  const AGENT_ID = 1050000000001; // TODO: Fill in the agent ID (NFT token ID from AgentNft)

  /**
   * TX_HASHES: Array of transaction hashes that collected tax
   * Where to get:
   *   - From blockchain explorer (buy/sell transactions on the token)
   *   - From backend database tracking tax collection
   *   - Each txhash can only be used once (contract will revert if duplicate)
   * Format: bytes32 array (use ethers.id() or keccak256 to convert string to bytes32)
   */
  const TX_HASHES: string[] = [
    ethers.id("0x314d5817326615d46a961a4621d02523762bef360543d0e2d2a013f1e81cf6bd"), // TODO: Replace with actual tx hashes
    ethers.id("0x3d37f6cd612d2857aad5a8351e88475415e42e1abfb3462312baccac5baf4b1c"), // Example: ethers.id("0x1234...abcd")
    ethers.id("0x249fe02a374d15ec513644ad4ff21e32644c2c57b52694479ff2c4f78fdb0e64"), // Example: ethers.id("0x1234...abcd")
  ];

  /**
   * AMOUNTS: Array of tax amounts corresponding to each txhash (in wei)
   * Where to get:
   *   - From backend calculation based on buy/sell amounts and tax rate
   *   - Must match the length of TX_HASHES array
   * Format: BigInt in wei (e.g., ethers.parseEther("10") for 10 tokens)
   */
  const AMOUNTS: bigint[] = [
    ethers.parseEther("1"), // TODO: Replace with actual amounts
    ethers.parseEther("0.5"),
    ethers.parseEther("0.377586634943622633"),
  ];

  /**
   * MIN_OUTPUT: Minimum output amount from the swap (slippage protection)
   * Where to get:
   *   - Calculate based on expected swap output minus slippage tolerance
   *   - Can use router.getAmountsOut() to estimate
   *   - Set to 0 for testing (not recommended for production)
   */
  const MIN_OUTPUT = ethers.parseEther("0"); // TODO: Set appropriate slippage protection

  // ============================================
  // SCRIPT EXECUTION
  // ============================================

  // Validate inputs
  if (TX_HASHES.length !== AMOUNTS.length) {
    throw new Error("TX_HASHES and AMOUNTS arrays must have the same length");
  }

  if (TX_HASHES.length === 0) {
    throw new Error("TX_HASHES array cannot be empty");
  }

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log("Signer address:", signer.address);

  // Connect to AgentTax contract
  const agentTax = new ethers.Contract(agentTaxAddress, AGENT_TAX_ABI, signer);
  console.log("Connected to AgentTax contract at:", agentTaxAddress);

  // Check if signer has EXECUTOR_ROLE
  const executorRole = await agentTax.EXECUTOR_ROLE();
  const hasRole = await agentTax.hasRole(executorRole, signer.address);
  console.log("Signer has EXECUTOR_ROLE:", hasRole);

  if (!hasRole) {
    throw new Error("Signer does not have EXECUTOR_ROLE on AgentTax contract");
  }

  // Check current tax amounts for this agent
  console.log("\n--- Current Tax Amounts for Agent", AGENT_ID, "---");
  const taxAmounts = await agentTax.agentTaxAmounts(AGENT_ID);
  console.log("Amount Collected:", ethers.formatEther(taxAmounts.amountCollected));
  console.log("Amount Swapped:", ethers.formatEther(taxAmounts.amountSwapped));

  // Check if any txhash already exists
  console.log("\n--- Checking TX Hash History ---");
  for (let i = 0; i < TX_HASHES.length; i++) {
    const history = await agentTax.taxHistory(TX_HASHES[i]);
    if (history.agentId > 0) {
      console.log(`WARNING: TX_HASH[${i}] already used for agentId ${history.agentId}`);
    } else {
      console.log(`TX_HASH[${i}]: OK (not used)`);
    }
  }

  // Calculate total amount
  const totalAmount = AMOUNTS.reduce((a, b) => a + b, 0n);
  console.log("\n--- Transaction Summary ---");
  console.log("Agent ID:", AGENT_ID);
  console.log("Number of transactions:", TX_HASHES.length);
  console.log("Total tax amount:", ethers.formatEther(totalAmount));
  console.log("Min output:", ethers.formatEther(MIN_OUTPUT));

  // Confirm before executing
  console.log("\n⚠️  About to call handleAgentTaxes()...");
  console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...\n");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Execute the transaction
  console.log("--- Executing handleAgentTaxes() ---");
  try {
    const tx = await agentTax.handleAgentTaxes(AGENT_ID, TX_HASHES, AMOUNTS, MIN_OUTPUT);
    console.log("Transaction hash:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Check updated tax amounts
    console.log("\n--- Updated Tax Amounts for Agent", AGENT_ID, "---");
    const updatedTaxAmounts = await agentTax.agentTaxAmounts(AGENT_ID);
    console.log("Amount Collected:", ethers.formatEther(updatedTaxAmounts.amountCollected));
    console.log("Amount Swapped:", ethers.formatEther(updatedTaxAmounts.amountSwapped));

  } catch (error: any) {
    console.error("❌ Transaction failed:", error.message);
    
    // Try to get more details
    if (error.data) {
      console.error("Error data:", error.data);
    }
    throw error;
  }

  console.log("\n=== Script Completed ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
