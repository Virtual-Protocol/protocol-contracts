import { ethers } from "hardhat";

(async () => {
  try {
    const simpleAgentFactory = await ethers.getContractFactory("SimpleAgentFactory");
    const factoryAddress = process.env.ETH_AGENT_FACTORY
    const taxRecipient = process.env.TAX_RECIPIENT
    const tokenContract = simpleAgentFactory.attach(factoryAddress);

    const [signer] = await ethers.getSigners();
    console.log("Using signer address:", signer.address);
    

    // Create supply parameters structure
        //set implementations
    const uniswapRouter = "" // uniswap v2 router

    const tx = await tokenContract.setParams(uniswapRouter, signer.address);
    await tx.wait();
 
    console.log("Transaction hash:", tx.hash);


    const tx2 = await tokenContract.setTokenParams(
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.AGENT_TOKEN_LP_SUPPLY,
      process.env.AGENT_TOKEN_VAULT_SUPPLY,
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.BOT_PROTECTION,
      signer.address,
      process.env.TAX,
      process.env.TAX,
      process.env.SWAP_THRESHOLD,
      taxRecipient
    );

    console.log("Transaction hash:", tx2.hash);
    await tx2.wait();


  } catch (e) {
    console.log(e);
  }
})();