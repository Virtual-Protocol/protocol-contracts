import { ethers, upgrades } from "hardhat";

const adminSigner = new ethers.Wallet(
  process.env.ADMIN_PRIVATE_KEY,
  ethers.provider
);

const deployerSigner = new ethers.Wallet(
  process.env.PRIVATE_KEY,
  ethers.provider
);

async function upgradeFactory(implementations, assetToken) {
  const AgentFactory = await ethers.getContractFactory("AgentFactoryV2");
  const factory = await upgrades.upgradeProxy(
    process.env.VIRTUAL_FACTORY,
    AgentFactory
  );
  if (implementations) {
    await factory.setImplementations(
      implementations.tokenImpl.target,
      implementations.veTokenImpl.target,
      implementations.daoImpl.target
    );
  }

  if (assetToken) {
    await factory.setAssetToken(assetToken);
  }
  await factory.setTokenAdmin(process.env.ADMIN);
  await factory.setTokenSupplyParams(
    process.env.AGENT_TOKEN_LIMIT,
    process.env.AGENT_TOKEN_LP_SUPPLY,
    process.env.AGENT_TOKEN_VAULT_SUPPLY,
    process.env.AGENT_TOKEN_LIMIT,
    process.env.AGENT_TOKEN_LIMIT,
    process.env.BOT_PROTECTION,
    process.env.MINTER
  );
  await factory.setTokenTaxParams(
    process.env.TAX,
    process.env.TAX,
    process.env.SWAP_THRESHOLD,
    process.env.TAX_VAULT
  );

  console.log("Upgraded FactoryV2", factory.target);
}

async function importContract() {
  const ContractFactory = await ethers.getContractFactory(
    "AgentNftV2",
    adminSigner
  );
  await upgrades.forceImport(
    "0x8f767259867Cc93df37e59ba445019418871ea57",
    ContractFactory
  );
}

async function deployAgentNft() {
  const nft = await ethers.deployContract("AgentNftV2");
  console.log("AgentNft deployed to:", nft.target);
}

async function updateAgentNftRoles() {
  const nft = await ethers.getContractAt(
    "AgentNftV2",
    process.env.VIRTUAL_NFT,
    adminSigner
  );
  await nft.grantRole(ethers.id("ADMIN_ROLE"), process.env.ADMIN);
  console.log("Updated Admin Role");
}

async function upgradeAgentNft() {
  const nft = await ethers.deployContract("AgentNftV2");
  console.log("AgentNft deployed to:", nft.target);

  const proxyAdmin = await ethers.getContractAt(
    "MyProxyAdmin",
    process.env.VIRTUAL_NFT_PROXY,
    adminSigner
  );
  await proxyAdmin.upgradeAndCall(process.env.VIRTUAL_NFT, nft.target, "0x");
  console.log("Upgraded AgentNft");

  const contract = await ethers.getContractAt(
    "AgentNftV2",
    process.env.VIRTUAL_NFT
  );
  await contract.setEloCalculator(process.env.ELO);
}

async function deployImplementations() {
  const daoImpl = await ethers.deployContract("AgentDAO");
  await daoImpl.waitForDeployment();
  console.log("AgentDAO deployed to:", daoImpl.target);

  // const tokenImpl = await ethers.deployContract("AgentToken");
  // await tokenImpl.waitForDeployment();
  // console.log("AgentToken deployed to:", tokenImpl.target);

  // const veTokenImpl = await ethers.deployContract("AgentVeToken");
  // await veTokenImpl.waitForDeployment();
  // console.log("AgentVeToken deployed to:", veTokenImpl.target);

  return { daoImpl, tokenImpl: null, veTokenImpl: null };
}

(async () => {
  try {
    //const implementations = await deployImplementations();
    await upgradeFactory();
    //await deployAgentNft();
    //await upgradeAgentNft();
  } catch (e) {
    console.log(e);
  }
})();
