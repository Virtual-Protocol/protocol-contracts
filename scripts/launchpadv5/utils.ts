const { run } = require("hardhat");

/**
 * Verify a contract on Etherscan/Basescan
 * Handles "Already Verified" errors gracefully
 */
export async function verifyContract(address: string, constructorArguments: any[] = []) {
  console.log(`\n--- Verifying contract at ${address} ---`);
  try {
    await run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log("✅ Contract verified");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ Contract already verified");
    } else {
      console.log("⚠️ Verification failed:", error.message);
    }
  }
}
