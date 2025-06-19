import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const simpleAgentFactory = await ethers.getContractFactory("SimpleAgentFactory");
    const factoryAddress = process.env.ETH_AGENT_FACTORY
    const tokenContract = simpleAgentFactory.attach(factoryAddress);
    const lockupAddress = process.env.LOCKUP_ADDRESS
    // 4. Agent Token Add initial Liquidity

    //send 84k virtuals to agenttoken
    const virtualToken = process.env.BRIDGED_TOKEN
    const agentToken = "TOKEN ADDRESS"
    const initialLiquidityAmount = "84000"

    const agentTokenContract = await ethers.getContractFactory("AgentToken")
    const agentTokenProxy = agentTokenContract.attach(agentToken)
    //4. send token
    const virtualTokenContract = await ethers.getContractAt("ERC20", virtualToken);
    const tx = await virtualTokenContract.transfer(agentToken, ethers.parseEther(initialLiquidityAmount));
    console.log("Transaction hash:", tx.hash);
    console.log("Sent Virtuals Token")
    await tx.wait();


    // // 5. send 500 million to lock up
    const tx5 = await agentTokenProxy.transfer(lockupAddress, ethers.parseEther("500000000"))
    console.log("Transaction hash:", tx5.hash);
    console.log("Sent Agent Token to lock")
    await tx5.wait();

    // 6. create staking contract
    const args = [agentToken, 2, "Staked Token", "stToken"];
    const Contract = await ethers.getContractFactory("StakedToken");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();

    // console.log("stakedToken deployed to:", contract.target);

    // 8. transfer tokens into distributor
    const merkleDistributorAddress = "merkle address"
    const tx8 = await agentTokenProxy.transfer(merkleDistributorAddress, ethers.parseEther("375000000"))
    console.log("Transaction hash:", tx8.hash);
    await tx8.wait();

    // 8.5 transfer tokens into airdrop distributor
    const airdropAddress = "airdrop merkle"
    const tx8_5 = await agentTokenProxy.transfer(airdropAddress, ethers.parseEther("amount"))
    console.log("Transaction hash:", tx8_5.hash);
    await tx8_5.wait();

    // 9. add initial liquidity

    const tx6 = await agentTokenProxy.addInitialLiquidity(lockupAddress)
    console.log("Transaction hash:", tx6.hash);
    await tx6.wait();


  } catch (e) {
    console.log(e);
  }
})();