import { parseEther } from "ethers";
import { ethers, upgrades } from "hardhat";

const adminSigner = new ethers.Wallet(
  process.env.ADMIN_PRIVATE_KEY,
  ethers.provider
);

(async () => {
  try {
    const args = require("../arguments/genesis/agentFactoryV5Arguments");
    const Contract = await ethers.getContractFactory("AgentFactoryV5");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    console.log("AgentFactoryV5 deployed to:", contract.target);

    const t2 = await contract.setTokenParams(
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.AGENT_TOKEN_LP_SUPPLY,
      process.env.AGENT_TOKEN_VAULT_SUPPLY,
      process.env.AGENT_TOKEN_LIMIT_WALLET,
      process.env.AGENT_TOKEN_LIMIT_TRX,
      process.env.BOT_PROTECTION,
      process.env.MINTER,
      process.env.TAX,
      process.env.TAX,
      process.env.SWAP_THRESHOLD,
      process.env.TAX_VAULT
    );
    await t2.wait();
    console.log("Token params set");

    const t3 = await contract.setParams(
      process.env.MATURITY_DURATION,
      process.env.UNISWAP_ROUTER,
      process.env.DELEGATEE, // unused
      process.env.ADMIN
    );
    await t3.wait();
    console.log("Params set");
    const t4 = await contract.grantRole(
      await contract.WITHDRAW_ROLE(),
      process.env.OP
    );
    await t4.wait();
    console.log("Withdraw role granted");

    const nft = await ethers.getContractAt(
      "AgentNftV2",
      process.env.VIRTUAL_NFT,
      adminSigner
    );
    await nft.grantRole(await nft.MINTER_ROLE(), contract.target);
    console.log("Minter role granted");
  } catch (e) {
    console.log(e);
  }
})();
