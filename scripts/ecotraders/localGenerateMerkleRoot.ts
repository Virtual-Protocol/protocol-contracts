import { ethers } from "hardhat";
import { MerkleTree } from "merkletreejs";
const keccak256 = require("keccak256");

/**
 * Script to generate Merkle root and proofs for CumulativeMerkleDrop
 *
 * Usage:
 *   npx hardhat run scripts/ecotraders/testMerkleRoot.ts
 *
 * Modify the USERS array below to customize addresses and amounts
 */

// Configure users: [address, amount in VIRTUAL tokens]
const USERS: Array<[string, string]> = [
  ["0x046308A74968E199C274Ae784c93a0ee18aF1aBF", "1"],
  ["0xd56dc8b053027d4f5309c60678dec898aa6c0106", "2"],
  ["0x6522fd5fdc3b265b76fbab96c201471639900af6", "3"],
];

async function main() {
  console.log("=== Generating Merkle Root and Proofs ===\n");

  // Parse amounts to wei (18 decimals)
  const accounts = USERS.map(([address]) => address);
  const amounts = USERS.map(([_, amount]) => ethers.parseEther(amount));

  console.log("Users configuration:");
  USERS.forEach(([address, amount], index) => {
    console.log(`  ${index + 1}. ${address}: ${amount} VIRTUAL_TOKEN`);
  });
  console.log("");

  // Create elements using ethers.solidityPacked to match contract's abi.encodePacked
  const elements = accounts.map((account, i) => {
    return ethers.solidityPacked(["address", "uint256"], [account, amounts[i]]);
  });

  // Hash elements and create merkle tree
  const hashedElements = elements.map((element) =>
    keccak256(Buffer.from(element.slice(2), "hex"))
  );

  const merkleTree = new MerkleTree(hashedElements, keccak256, {
    hashLeaves: false, // Already hashed
    sortPairs: true, // Sort pairs for consistent ordering
  });

  const merkleRoot = merkleTree.getHexRoot();

  console.log("=== Merkle Root ===");
  console.log(merkleRoot);
  console.log("");

  // Helper function to get proof for an account and cumulative amount
  function getProof(account: string, cumulativeAmount: bigint): string[] {
    const packed = ethers.solidityPacked(
      ["address", "uint256"],
      [account, cumulativeAmount]
    );
    const leafHash = keccak256(Buffer.from(packed.slice(2), "hex"));

    const leafHashHex = "0x" + leafHash.toString("hex");
    const index = hashedElements.findIndex(
      (hash) =>
        "0x" + hash.toString("hex").toLowerCase() === leafHashHex.toLowerCase()
    );

    if (index === -1) {
      throw new Error(
        `Could not find proof for ${account} with amount ${cumulativeAmount}`
      );
    }

    return merkleTree.getHexProof(hashedElements[index]);
  }

  console.log("=== Claim Parameters for Each User ===\n");

  // Generate proof for each user
  for (let i = 0; i < USERS.length; i++) {
    const [account, amountStr] = USERS[i];
    const cumulativeAmount = amounts[i];
    const proof = getProof(account, cumulativeAmount);

    console.log(`User ${i + 1}: ${account}`);
    console.log(
      `  Amount: ${amountStr} VIRTUAL_TOKEN (${cumulativeAmount.toString()} wei)`
    );
    console.log(`  Cumulative Amount: ${cumulativeAmount.toString()}`);
    console.log(`  Merkle Root: ${merkleRoot}`);
    console.log(`  Merkle Proof:`);
    proof.forEach((p, idx) => {
      console.log(`    [${idx}]: ${p}`);
    });
    console.log("");

    // Print claimAndMaxStake call format
    console.log(`  claimAndMaxStake call:`);
    console.log(`    await cumulativeMerkleDrop.claimAndMaxStake(`);
    console.log(`      "${account}",`);
    console.log(`      "${cumulativeAmount.toString()}",`);
    console.log(`      "${merkleRoot}",`);
    console.log(`      [${proof.map((p) => `${p}`).join(",")}]`);
    console.log(`    );`);
    console.log("");
    console.log("---");
    console.log("");
  }

  console.log("=== Summary ===");
  console.log(`Merkle Root: ${merkleRoot}`);
  console.log(`Total Users: ${USERS.length}`);
  console.log(
    `Total Amount: ${ethers.formatEther(
      amounts.reduce((sum, amount) => sum + amount, 0n)
    )} VIRTUAL_TOKEN`
  );
  console.log("");
  console.log("=== To set Merkle Root on contract ===");
  console.log(`await cumulativeMerkleDrop.setMerkleRoot("${merkleRoot}");`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
