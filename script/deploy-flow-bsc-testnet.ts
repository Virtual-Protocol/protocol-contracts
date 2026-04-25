/**
 * AgentFlow $FLOW deployment — BSC Testnet (chainId 97).
 *
 * Run:
 *   npx hardhat run script/deploy-flow-bsc-testnet.ts --network bsc_testnet
 *
 * Requires (in .env or process.env):
 *   PRIVATE_KEY            — deployer EOA
 *   BSC_TESTNET_RPC_URL    — testnet RPC
 *   TREASURY_ADDRESS       — treasury sink (defaults to deployer)
 *   FLOW_INITIAL_PRICE     — initial $FLOW price in USDT, 18-dec decimal-string
 *                            (default 0.1)
 *   FLOW_USDT_ADDRESS      — optional: pre-existing testnet MockUSDT.
 *                            If unset we deploy a fresh MockERC20.
 *   FLOW_TREE_ROOT         — optional sentinel root address for the
 *                            phenomenal tree. Defaults to the deployer.
 *
 * Output: writes deployment-flow-bsc-testnet.json to repo root.
 *
 * @audit-todo Production deploy MUST set `MULTISIG_OWNER` (Gnosis Safe)
 *             and after wiring, call `grantRole(DEFAULT_ADMIN_ROLE, multisig)`
 *             plus `renounceRole(DEFAULT_ADMIN_ROLE, deployer)` on every
 *             contract. The deploy script keeps the EOA as admin so the
 *             role-grant calls below succeed; rotation is a separate
 *             post-deploy script.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(
    `[flow] network=${network.name} chainId=${network.config.chainId} deployer=${deployer.address}`,
  );
  if (network.config.chainId !== 97) {
    throw new Error(`expected BSC testnet (97), got ${network.config.chainId}`);
  }

  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const treeRoot = process.env.FLOW_TREE_ROOT || deployer.address;
  const initialPrice = ethers.parseEther(
    process.env.FLOW_INITIAL_PRICE || "0.1",
  );

  // 1. USDT — reuse if specified, otherwise deploy a fresh MockERC20
  //    with 18 decimals (matches BSC mainnet USDT).
  let usdtAddr = process.env.FLOW_USDT_ADDRESS;
  if (!usdtAddr) {
    console.log("[flow] deploying MockERC20 USDT (18-dec)");
    const Mock = await ethers.getContractFactory("MockERC20");
    const usdt = await Mock.deploy(
      "Mock USDT (testnet)",
      "mUSDT",
      deployer.address,
      ethers.parseEther("100000000"), // 100M to deployer
    );
    await usdt.waitForDeployment();
    usdtAddr = await usdt.getAddress();
    console.log(`[flow] MockUSDT=${usdtAddr}`);
  } else {
    console.log(`[flow] reusing USDT=${usdtAddr}`);
  }

  // 2. $FLOW token.
  console.log("[flow] deploying Flow token");
  const Flow = await ethers.getContractFactory("Flow");
  const flow = await Flow.deploy(deployer.address);
  await flow.waitForDeployment();
  const flowAddr = await flow.getAddress();
  console.log(`[flow] Flow=${flowAddr}`);

  // 3. GWT token.
  console.log("[flow] deploying FlowGrowToken (GWT)");
  const Gwt = await ethers.getContractFactory("FlowGrowToken");
  const gwt = await Gwt.deploy(deployer.address);
  await gwt.waitForDeployment();
  const gwtAddr = await gwt.getAddress();
  console.log(`[flow] GWT=${gwtAddr}`);

  // 4. PhenomenalTree (immutable structure, root = deployer or supplied).
  console.log(`[flow] deploying PhenomenalTree (root=${treeRoot})`);
  const Tree = await ethers.getContractFactory("PhenomenalTree");
  const tree = await Tree.deploy(deployer.address, treeRoot);
  await tree.waitForDeployment();
  const treeAddr = await tree.getAddress();
  console.log(`[flow] PhenomenalTree=${treeAddr}`);

  // 5. FlowProtocol.
  console.log("[flow] deploying FlowProtocol");
  const Protocol = await ethers.getContractFactory("FlowProtocol");
  const protocol = await Protocol.deploy(
    deployer.address,
    usdtAddr,
    flowAddr,
    gwtAddr,
    treeAddr,
    treasury,
    initialPrice,
  );
  await protocol.waitForDeployment();
  const protocolAddr = await protocol.getAddress();
  console.log(`[flow] FlowProtocol=${protocolAddr}`);

  // 6. Wire roles.
  console.log("[flow] granting MINTER_ROLE on Flow to Protocol");
  const flowMinterRole = await flow.MINTER_ROLE();
  await (await flow.grantRole(flowMinterRole, protocolAddr)).wait();

  console.log("[flow] granting MINTER_ROLE on GWT to Protocol");
  const gwtMinterRole = await gwt.MINTER_ROLE();
  await (await gwt.grantRole(gwtMinterRole, protocolAddr)).wait();

  console.log("[flow] granting TREE_OPERATOR_ROLE on PhenomenalTree to Protocol");
  const treeOpRole = await tree.TREE_OPERATOR_ROLE();
  await (await tree.grantRole(treeOpRole, protocolAddr)).wait();

  // 7. Persist artifact.
  const out = {
    network: network.name,
    chainId: network.config.chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    treasury,
    treeRoot,
    initialPrice: initialPrice.toString(),
    contracts: {
      USDT: usdtAddr,
      Flow: flowAddr,
      GWT: gwtAddr,
      PhenomenalTree: treeAddr,
      FlowProtocol: protocolAddr,
    },
    roles: {
      "Flow.MINTER_ROLE": [protocolAddr],
      "GWT.MINTER_ROLE": [protocolAddr],
      "PhenomenalTree.TREE_OPERATOR_ROLE": [protocolAddr],
      "*.DEFAULT_ADMIN_ROLE": [deployer.address],
    },
    audit_todo:
      "Rotate DEFAULT_ADMIN_ROLE to multisig (Gnosis Safe) and renounce deployer admin via post-deploy script.",
  };
  const outPath = path.join(process.cwd(), "deployment-flow-bsc-testnet.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[flow] wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
