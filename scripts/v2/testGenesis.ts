import { ethers, upgrades } from "hardhat";

const adminSigner = new ethers.Wallet(
  process.env.ADMIN_PRIVATE_KEY,
  ethers.provider
);

async function createAgent() {
  const factory = await ethers.getContractAt(
    "AgentFactoryV2",
    process.env.VIRTUAL_FACTORY,
    adminSigner
  );
  const token = await ethers.getContractAt(
    "IERC20",
    await factory.assetToken(),
    adminSigner
  );
  const approveTx = await token.approve(factory.target, await factory.applicationThreshold());
  await approveTx.wait();
  const tx = await factory.proposeAgent(
    "KWTest",
    "KWT",
    "https://azure-rapid-lungfish-73.mypinata.cloud/ipfs/QmQBSxbMjSDPN2aT3jbLbvKbghKMyYVoDZHhdh3SKPba8e",
    [0, 1, 2],
    "0xce5d1e74b5ac2a84f803ec245ffbeddd6a0b5ef54924229aab241ade1126354e",
    "0x55266d75D1a14E4572138116aF39863Ed6596E7F",
    1800n,
    0
  );

  await tx.wait();

  const filter = factory.filters.NewApplication;
  const events = await factory.queryFilter(filter, -1);
  const event = events[0];
  const { id } = event.args;
  if (id) {
    console.log("Proposal created with id:", id.toString());
    const agentTx = await factory.executeApplication(id, true);
    await agentTx.wait();
    console.log(agentTx)
  }
}

(async () => {
  try {
    await createAgent();
  } catch (e) {
    console.log(e);
  }
})();
