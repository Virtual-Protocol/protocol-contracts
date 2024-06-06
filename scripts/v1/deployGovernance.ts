import { ethers } from "hardhat";

(async () => {
  try {
    const dao = await ethers.deployContract("VirtualProtocolDAO", [
      process.env.VOTING_TOKEN,
      process.env.PROTOCOL_VOTING_DELAY,
      process.env.PROTOCOL_VOTING_PERIOD,
      process.env.PROTOCOL_PROPOSAL_THRESHOLD,
      process.env.PROTOCOL_QUORUM_NUMERATOR
    ]);

    console.log("VirtualProtocolDAO deployed to:", dao.target);
  } catch (e) {
    console.log(e);
  }
})();
