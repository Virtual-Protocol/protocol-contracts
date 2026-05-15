/**
 * BSC Testnet deploy — DPNM "Growing Token" stack (new tokenomics).
 *
 *   chainId : 97
 *   USDT    : provide via env (FLOW_USDT_ADDRESS) or a MockERC20 is deployed.
 *
 * Pipeline:
 *   1. Deploy implementations: DPNMToken, DPNMGrowToken, DPNMTree,
 *      BuybackPools, Whitelist, DPNMProtocol — all are EIP-1167 cloneable.
 *   2. For each: deploy a clone via Cloner helper, then call initialize().
 *   3. Wire roles:
 *        - DPNMToken.MINTER_ROLE          -> DPNMProtocol
 *        - DPNMGrowToken.MINTER_ROLE      -> DPNMProtocol
 *        - DPNMTree.TREE_OPERATOR_ROLE    -> DPNMProtocol
 *        - BuybackPools.POOL_OPERATOR_ROLE -> DPNMProtocol
 *   4. Persist deployment-dpnm-bsc-testnet.json.
 *
 * Env (all optional except PRIVATE_KEY):
 *   - FLOW_USDT_ADDRESS         : skip MockUSDT, use existing token
 *   - DPNM_TREE_ROOT            : tree root sentinel (defaults to deployer)
 *   - DPNM_COMMISSION_COLLECTOR : default deployer
 *   - DPNM_INITIAL_PRICE        : default "0.1"
 *   - DPNM_NAME / DPNM_SYMBOL   : default "dPNM" / "DPNM"
 *   - GWT_NAME  / GWT_SYMBOL    : default "dPNM Grow" / "GWT"
 *
 * Funds required: ~0.05 BNB on deployer.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function deployClone(
  cloner: any,
  name: string,
): Promise<{ impl: string; instance: string; contract: any }> {
  const Impl = await ethers.getContractFactory(name);
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const tx = await cloner.clone(await impl.getAddress());
  const r = await tx.wait();
  const ev = r!.logs
    .map((l: any) => {
      try {
        return cloner.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e: any) => e && e.name === "Cloned");
  if (!ev) throw new Error(`Cloner did not emit Cloned for ${name}`);
  const inst = await ethers.getContractAt(name, ev.args.instance);
  return {
    impl: await impl.getAddress(),
    instance: await inst.getAddress(),
    contract: inst,
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.MULTISIG_OWNER || deployer.address;
  // Bug-fix: treeRoot must NOT be the deployer — the deployer's activate()
  // call would revert with AlreadyPlaced because the tree root address is
  // already pre-placed in DPNMTree.initialize. Use a neutral sentinel by
  // default; override with DPNM_TREE_ROOT for the actual protocol root.
  const treeRoot = process.env.DPNM_TREE_ROOT || "0x000000000000000000000000000000000000dEaD";
  const collector = process.env.DPNM_COMMISSION_COLLECTOR || deployer.address;
  const initialPrice = ethers.parseEther(
    process.env.DPNM_INITIAL_PRICE || "0.1",
  );
  const dpnmName = process.env.DPNM_NAME || "dPNM";
  const dpnmSymbol = process.env.DPNM_SYMBOL || "DPNM";
  const gwtName = process.env.GWT_NAME || "dPNM Grow";
  const gwtSymbol = process.env.GWT_SYMBOL || "GWT";

  console.log(
    `[dpnm-bsc-testnet] network=${network.name} chainId=${network.config.chainId} deployer=${deployer.address}`,
  );

  // ----- 1. USDT --------------------------------------------------------
  let usdtAddr = process.env.FLOW_USDT_ADDRESS;
  if (!usdtAddr) {
    const Mock = await ethers.getContractFactory("MockERC20");
    const usdt = await Mock.deploy(
      "Mock USDT (testnet)",
      "mUSDT",
      deployer.address,
      ethers.parseEther("100000000"),
    );
    await usdt.waitForDeployment();
    usdtAddr = await usdt.getAddress();
    console.log(`[dpnm-bsc-testnet] MockUSDT=${usdtAddr}`);
  } else {
    console.log(`[dpnm-bsc-testnet] reusing USDT=${usdtAddr}`);
  }

  // ----- 2. Cloner -------------------------------------------------------
  const Cloner = await ethers.getContractFactory("Cloner");
  const cloner = await Cloner.deploy();
  await cloner.waitForDeployment();
  console.log(`[dpnm-bsc-testnet] Cloner=${await cloner.getAddress()}`);

  // ----- 3. Clone every contract + initialize ---------------------------
  const dpnmTok = await deployClone(cloner, "DPNMToken");
  await (
    await dpnmTok.contract.initialize(admin, dpnmName, dpnmSymbol)
  ).wait();
  console.log(
    `[dpnm-bsc-testnet] DPNMToken impl=${dpnmTok.impl} instance=${dpnmTok.instance}`,
  );

  const gwtTok = await deployClone(cloner, "DPNMGrowToken");
  await (await gwtTok.contract.initialize(admin, gwtName, gwtSymbol)).wait();
  console.log(
    `[dpnm-bsc-testnet] DPNMGrowToken impl=${gwtTok.impl} instance=${gwtTok.instance}`,
  );

  const tree = await deployClone(cloner, "DPNMTree");
  await (await tree.contract.initialize(admin, treeRoot)).wait();
  console.log(
    `[dpnm-bsc-testnet] DPNMTree impl=${tree.impl} instance=${tree.instance}`,
  );

  const buyback = await deployClone(cloner, "BuybackPools");
  await (await buyback.contract.initialize(admin)).wait();
  console.log(
    `[dpnm-bsc-testnet] BuybackPools impl=${buyback.impl} instance=${buyback.instance}`,
  );

  const whitelist = await deployClone(cloner, "Whitelist");
  await (await whitelist.contract.initialize(admin)).wait();
  console.log(
    `[dpnm-bsc-testnet] Whitelist impl=${whitelist.impl} instance=${whitelist.instance}`,
  );

  const protocol = await deployClone(cloner, "DPNMProtocol");
  await (
    await protocol.contract.initialize({
      admin,
      usdt: usdtAddr,
      dpnm: dpnmTok.instance,
      gwt: gwtTok.instance,
      tree: tree.instance,
      buybackPools: buyback.instance,
      whitelist: whitelist.instance,
      commissionCollector: collector,
      initialPrice,
    })
  ).wait();
  console.log(
    `[dpnm-bsc-testnet] DPNMProtocol impl=${protocol.impl} instance=${protocol.instance}`,
  );

  // ----- 4. Wire roles ---------------------------------------------------
  // The deployer must currently hold DEFAULT_ADMIN_ROLE on each clone,
  // because we passed `admin = deployer.address` (or the MULTISIG_OWNER which
  // is also the env-driven admin). When MULTISIG_OWNER differs from the
  // deployer, you must run the role-grant txs from that signer instead.
  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    console.warn(
      `[dpnm-bsc-testnet] WARNING: admin (${admin}) differs from deployer (${deployer.address}). ` +
        `Role grants below will revert; run them manually from the admin signer.`,
    );
  }

  await (
    await dpnmTok.contract.grantRole(
      await dpnmTok.contract.MINTER_ROLE(),
      protocol.instance,
    )
  ).wait();
  await (
    await gwtTok.contract.grantRole(
      await gwtTok.contract.MINTER_ROLE(),
      protocol.instance,
    )
  ).wait();
  await (
    await tree.contract.grantRole(
      await tree.contract.TREE_OPERATOR_ROLE(),
      protocol.instance,
    )
  ).wait();
  await (
    await buyback.contract.grantRole(
      await buyback.contract.POOL_OPERATOR_ROLE(),
      protocol.instance,
    )
  ).wait();
  console.log(`[dpnm-bsc-testnet] roles wired`);

  // ----- 5. Persist artifact --------------------------------------------
  const out = {
    chain: "bsc-testnet",
    chainId: 97,
    deployer: deployer.address,
    admin,
    commissionCollector: collector,
    treeRoot,
    initialPrice: initialPrice.toString(),
    paymentToken: usdtAddr,
    cloner: await cloner.getAddress(),
    contracts: {
      DPNMToken:      { impl: dpnmTok.impl,   instance: dpnmTok.instance },
      DPNMGrowToken:  { impl: gwtTok.impl,    instance: gwtTok.instance },
      DPNMTree:       { impl: tree.impl,      instance: tree.instance },
      BuybackPools:   { impl: buyback.impl,   instance: buyback.instance },
      Whitelist:      { impl: whitelist.impl, instance: whitelist.instance },
      DPNMProtocol:   { impl: protocol.impl,  instance: protocol.instance },
    },
    deployedAt: new Date().toISOString(),
    todo: [
      "Add real users to Whitelist before mainnet (admin.add / addBatch).",
      "If admin is multisig, rotate any deployer-held roles.",
      "Verify contracts on BscScan: npx hardhat verify --network bsc_testnet <addr> [args].",
      "Pre-start auto-ends after 3 weeks OR at prestartMaxUsers (default 10000).",
    ],
  };

  const outPath = path.join(
    process.cwd(),
    `deployment-dpnm-bsc-testnet.json`,
  );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[dpnm-bsc-testnet] wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
