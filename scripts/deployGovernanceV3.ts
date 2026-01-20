import { ethers } from "hardhat";

/**
 * Deploy VirtualProtocolDAOV3
 *
 * This governance contract supports both veVIRTUAL and Virtizen tokens for voting.
 * Voting power is combined 1:1 from both tokens.
 *
 * Usage:
 *   npx hardhat run scripts/deployGovernanceV3.ts --network <network>
 *
 * Environment variables required:
 *   VE_VIRTUAL_ADDRESS - Address of veVIRTUAL token contract
 *   VIRTIZEN_ADDRESS - Address of Virtizen token contract
 *   ADMIN_ADDRESS - Address of admin (optional, defaults to deployer)
 */
(async () => {
  try {
    const [deployer] = await ethers.getSigners();
    console.log(
      "Deploying VirtualProtocolDAOV3 with account:",
      deployer.address
    );

    // Get addresses from environment or use defaults
    const veVirtualAddress = process.env.VE_VIRTUAL_ADDRESS;
    const virtizenAddress = process.env.VIRTIZEN_ADDRESS;
    const adminAddress = process.env.ADMIN_ADDRESS || deployer.address;

    if (!veVirtualAddress) {
      throw new Error("VE_VIRTUAL_ADDRESS environment variable is required");
    }
    if (!virtizenAddress) {
      throw new Error("VIRTIZEN_ADDRESS environment variable is required");
    }

    // Governance parameters (can be customized)
    const args = [
      veVirtualAddress, // veVirtualToken
      virtizenAddress, // virtizenToken
      0, // initialVotingDelay (blocks/timestamp)
      50400, // initialVotingPeriod (~1 week if block-based, or seconds if timestamp-based)
      ethers.parseEther("1000"), // initialProposalThreshold
      500, // initialQuorumNumerator (5% = 500/10000)
      adminAddress, // admin
    ];

    console.log("\nDeployment parameters:");
    console.log("  veVirtualToken:", veVirtualAddress);
    console.log("  virtizenToken:", virtizenAddress);
    console.log("  votingDelay:", args[2]);
    console.log("  votingPeriod:", args[3]);
    console.log("  proposalThreshold:", ethers.formatEther(args[4]), "tokens");
    console.log("  quorumNumerator:", args[5], "(5%)");
    console.log("  admin:", adminAddress);

    // Deploy contract
    const daoV3 = await ethers.deployContract("VirtualProtocolDAOV3", args);
    await daoV3.waitForDeployment();

    console.log("\n✅ VirtualProtocolDAOV3 deployed to:", daoV3.target);
    console.log("\nNext steps:");
    console.log("  1. Verify the contract on block explorer");
    console.log("  2. Update frontend/backend to use new DAO address");
    console.log(
      "  3. If migrating from VirtualProtocolDAOV2, create migration proposal"
    );

    // Verify token addresses
    console.log("\nVerifying token addresses...");
    const veVirtualToken = await ethers.getContractAt(
      "IVEVirtual",
      veVirtualAddress
    );
    const virtizenToken = await ethers.getContractAt(
      "IVirtizen",
      virtizenAddress
    );

    try {
      const veVirtualName = await veVirtualToken.balanceOf(deployer.address);
      console.log("  ✅ veVIRTUAL token verified");
    } catch (e) {
      console.log("  ⚠️  Warning: Could not verify veVIRTUAL token");
    }

    try {
      const virtizenName = await virtizenToken.balanceOf(deployer.address);
      console.log("  ✅ Virtizen token verified");
    } catch (e) {
      console.log("  ⚠️  Warning: Could not verify Virtizen token");
    }

    // Test voting power calculation
    console.log("\nTesting voting power calculation...");
    const currentTime = Math.floor(Date.now() / 1000);
    const votes = await daoV3.getVotesBreakdown(deployer.address, currentTime);
    console.log("  Deployer voting power breakdown:");
    console.log(
      "    veVIRTUAL votes:",
      ethers.formatEther(votes.veVirtualVotes)
    );
    console.log("    Virtizen votes:", ethers.formatEther(votes.virtizenVotes));
    console.log("    Total votes:", ethers.formatEther(votes.totalVotes));
  } catch (e) {
    console.error("Deployment failed:", e);
    process.exit(1);
  }
})();
