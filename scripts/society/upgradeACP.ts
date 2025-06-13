// npx hardhat run ./scripts/dev/upgradeFGenesis.ts --network base_sepolia
import { ethers, upgrades } from "hardhat";
import { run } from "hardhat";
const { FireblocksSDK } = require("fireblocks-sdk");

    

(async () => {
  try {

    const acpImplementationAddress = process.env.ACPSimpleProxy

  
    // 1. 首先获取合约工厂
    // const ACPSimple = await ethers.getContractFactory("ACPSimple");
    
    // 2. 强制导入现有代理
    // console.log("Forcing import of proxy at:", acpImplementationAddress);
    // await upgrades.forceImport(acpImplementationAddress, ACPSimple);

    // await run('compile', { force: true });
    const [signer] = await ethers.getSigners();

    // get old implementation address
    let implementationAddress = await upgrades.erc1967.getImplementationAddress(acpImplementationAddress);
    console.log("Old implementation address:", implementationAddress);

    await upgrades.upgradeProxy(
      acpImplementationAddress,
      await ethers.getContractFactory("ACPSimple", signer),
      {redeployImplementation: 'always'}
    );
    console.log("ACPSimple upgraded");

    // get new implementation address
    implementationAddress = await upgrades.erc1967.getImplementationAddress(acpImplementationAddress);
    console.log("New implementation address:", implementationAddress);

  } catch (e) {
    console.log(e);
  }
})();