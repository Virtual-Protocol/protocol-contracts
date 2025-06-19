import { ethers } from "hardhat";

(async () => {
  try {
    const simpleAgentFactory = await ethers.getContractFactory("SimpleAgentFactory");
    const factoryAddress = process.env.ETH_AGENT_FACTORY

    const tokenContract = simpleAgentFactory.attach(factoryAddress);

    const name = "Token";
    const symbol = "Token";

    const [signer] = await ethers.getSigners();
    console.log("Using signer address:", signer.address);

    // Generate random salt
    const salt = ethers.randomBytes(32);
    // Create agent token with all parameters

    const tx3 = await tokenContract.createNewAgentToken(
      name,
      symbol,
      salt,
    );
    
    console.log("Transaction hash:", tx3.hash);
    const receipt = await tx3.wait()

  } catch (e) {
    console.log(e);
  }
})();