/**
 * BSC Testnet deploy — Phase 1 launchpad refactor.
 *
 *   chainId          : 97
 *   PancakeSwap V2   : 0xD99D1c33F9fC3444f8101754aBC46c52416550D1
 *   PancakeFactory V2: 0x6725F303b657a9451d8BA641348b6761A6CC7a17
 *
 * Pipeline:
 *   1. Deploy MockUSDT (testnet has no canonical USDT).
 *   2. Deploy LaunchpadFactory (UUPS proxy).
 *   3. Deploy implementation contracts for both templates:
 *        - dpnm:     Flow, FlowGrowToken, PhenomenalTree, FlowProtocol,
 *                    DpnmTemplate
 *        - virtuals: FFactory, FRouter, Bonding, VirtualsTemplate
 *   4. registerTemplate("dpnm",     DpnmTemplate impl,    initSelector)
 *      registerTemplate("virtuals", VirtualsTemplate impl, initSelector)
 *   5. Deploy ReferralRegistry + ReferralPayouts (UUPS proxies, used by
 *      the virtuals template's FRouter for ref-bps fee carve-out).
 *   6. Deploy Migrator (PancakeSwap-V2 graduation).
 *   7. **Launch $FLOW** through `factory.launch("dpnm", ...)`.
 *   8. Persist deployment-bsc-testnet.json with every address + the
 *      $FLOW ecosystem (template instance + flow / gwt / tree / protocol).
 *
 * Funds required: ~0.3 BNB on the deployer.
 */
import { ethers, upgrades, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { AbiCoder, id as keccakId } from "ethers";

const DPNM_ID = keccakId("dpnm");
const VIRTUALS_ID = keccakId("virtuals");

async function main() {
  const [deployer] = await ethers.getSigners();
  const initialAdmin = process.env.MULTISIG_OWNER || deployer.address;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const treeRoot = process.env.FLOW_TREE_ROOT || deployer.address;
  const initialPrice = ethers.parseEther(
    process.env.FLOW_INITIAL_PRICE || "0.1",
  );
  const dexRouter = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";

  console.log(
    `[bsc-testnet] network=${network.name} chainId=${network.config.chainId} deployer=${deployer.address}`,
  );

  // ----- 1. MockUSDT -----------------------------------------------------
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
    console.log(`[bsc-testnet] MockUSDT=${usdtAddr}`);
  } else {
    console.log(`[bsc-testnet] reusing USDT=${usdtAddr}`);
  }

  // ----- 2. LaunchpadFactory (UUPS) -------------------------------------
  const Factory = await ethers.getContractFactory("LaunchpadFactory");
  const factory = await upgrades.deployProxy(Factory, [initialAdmin], {
    kind: "uups",
  });
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log(`[bsc-testnet] LaunchpadFactory=${factoryAddr}`);

  // ----- 3a. dPNM implementations ---------------------------------------
  const Flow = await ethers.getContractFactory("Flow");
  const flowImpl = await Flow.deploy();
  await flowImpl.waitForDeployment();
  const Gwt = await ethers.getContractFactory("FlowGrowToken");
  const gwtImpl = await Gwt.deploy();
  await gwtImpl.waitForDeployment();
  const Tree = await ethers.getContractFactory("PhenomenalTree");
  const treeImpl = await Tree.deploy();
  await treeImpl.waitForDeployment();
  const Protocol = await ethers.getContractFactory("FlowProtocol");
  const protocolImpl = await Protocol.deploy();
  await protocolImpl.waitForDeployment();
  const Dpnm = await ethers.getContractFactory("DpnmTemplate");
  const dpnmImpl = await Dpnm.deploy();
  await dpnmImpl.waitForDeployment();

  console.log(`[bsc-testnet] dpnm impls:`, {
    flow: await flowImpl.getAddress(),
    gwt: await gwtImpl.getAddress(),
    tree: await treeImpl.getAddress(),
    protocol: await protocolImpl.getAddress(),
    template: await dpnmImpl.getAddress(),
  });

  // ----- 3b. virtuals implementations -----------------------------------
  const FFactory = await ethers.getContractFactory("FFactory");
  const fFactoryImpl = await FFactory.deploy();
  await fFactoryImpl.waitForDeployment();
  const FRouter = await ethers.getContractFactory("FRouter");
  const fRouterImpl = await FRouter.deploy();
  await fRouterImpl.waitForDeployment();
  const Bonding = await ethers.getContractFactory("Bonding");
  const bondingImpl = await Bonding.deploy();
  await bondingImpl.waitForDeployment();
  const Virt = await ethers.getContractFactory("VirtualsTemplate");
  const virtImpl = await Virt.deploy();
  await virtImpl.waitForDeployment();

  console.log(`[bsc-testnet] virtuals impls:`, {
    factory: await fFactoryImpl.getAddress(),
    router: await fRouterImpl.getAddress(),
    bonding: await bondingImpl.getAddress(),
    template: await virtImpl.getAddress(),
  });

  // ----- 4. registerTemplate(...) ---------------------------------------
  const dpnmInitSelector = Dpnm.interface.getFunction("initialize")!.selector;
  const virtInitSelector = Virt.interface.getFunction("initialize")!.selector;
  await (
    await factory.registerTemplate(
      DPNM_ID,
      await dpnmImpl.getAddress(),
      dpnmInitSelector,
    )
  ).wait();
  await (
    await factory.registerTemplate(
      VIRTUALS_ID,
      await virtImpl.getAddress(),
      virtInitSelector,
    )
  ).wait();
  console.log(`[bsc-testnet] templates registered: dpnm + virtuals`);

  // ----- 5. ReferralRegistry + ReferralPayouts (UUPS) -------------------
  const Reg = await ethers.getContractFactory("ReferralRegistry");
  const registry = await upgrades.deployProxy(Reg, [initialAdmin], {
    kind: "uups",
  });
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`[bsc-testnet] ReferralRegistry=${registryAddr}`);

  const Pay = await ethers.getContractFactory("ReferralPayouts");
  const payouts = await upgrades.deployProxy(
    Pay,
    [initialAdmin, registryAddr, treasury],
    { kind: "uups" },
  );
  await payouts.waitForDeployment();
  const payoutsAddr = await payouts.getAddress();
  console.log(`[bsc-testnet] ReferralPayouts=${payoutsAddr}`);

  // ----- 6. Migrator -----------------------------------------------------
  const Mig = await ethers.getContractFactory("Migrator");
  const migrator = await Mig.deploy(
    dexRouter,
    "0x000000000000000000000000000000000000dEaD",
  );
  await migrator.waitForDeployment();
  const migratorAddr = await migrator.getAddress();
  console.log(`[bsc-testnet] Migrator=${migratorAddr}`);

  // ----- 7. LAUNCH $FLOW via factory ------------------------------------
  const flowParams = AbiCoder.defaultAbiCoder().encode(
    [
      "address",
      "address",
      "address",
      "uint256",
      "address",
      "string",
      "string",
      "string",
      "string",
      "tuple(address,address,address,address)",
    ],
    [
      initialAdmin,
      treasury,
      usdtAddr,
      initialPrice,
      treeRoot,
      "AgentFlow",
      "FLOW",
      "Flow Grow",
      "GWT",
      [
        await flowImpl.getAddress(),
        await gwtImpl.getAddress(),
        await treeImpl.getAddress(),
        await protocolImpl.getAddress(),
      ],
    ],
  );
  const flowSalt = keccakId("flow-genesis");
  const tx = await factory.launch(DPNM_ID, flowParams, flowSalt);
  const receipt = await tx.wait();
  const launchedEvt = receipt!.logs
    .map((l: any) => {
      try {
        return factory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e: any) => e && e.name === "Launched");
  if (!launchedEvt) throw new Error("Launched event not emitted");
  const dpnmInstanceAddr = launchedEvt.args.instance;
  console.log(`[bsc-testnet] $FLOW DpnmTemplate instance=${dpnmInstanceAddr}`);

  const dpnm = await ethers.getContractAt("DpnmTemplate", dpnmInstanceAddr);
  const eco = await dpnm.ecosystem();
  console.log(`[bsc-testnet] $FLOW ecosystem:`, {
    flow: eco.flow,
    gwt: eco.gwt,
    tree: eco.tree,
    protocol: eco.protocol,
  });

  // ----- 8. Persist artifact --------------------------------------------
  const out = {
    chain: "bsc-testnet",
    chainId: 97,
    deployer: deployer.address,
    initialAdmin,
    treasury,
    treeRoot,
    initialPrice: initialPrice.toString(),
    addresses: {
      LaunchpadFactory: factoryAddr,
      ReferralRegistry: registryAddr,
      ReferralPayouts: payoutsAddr,
      Migrator: migratorAddr,
      paymentToken: usdtAddr,
      dexRouter,
    },
    templates: {
      dpnm: {
        templateImpl: await dpnmImpl.getAddress(),
        initSelector: dpnmInitSelector,
        subImpls: {
          flow: await flowImpl.getAddress(),
          gwt: await gwtImpl.getAddress(),
          tree: await treeImpl.getAddress(),
          protocol: await protocolImpl.getAddress(),
        },
      },
      virtuals: {
        templateImpl: await virtImpl.getAddress(),
        initSelector: virtInitSelector,
        subImpls: {
          factory: await fFactoryImpl.getAddress(),
          router: await fRouterImpl.getAddress(),
          bonding: await bondingImpl.getAddress(),
        },
      },
    },
    instances: {
      $FLOW: {
        templateId: "dpnm",
        salt: flowSalt,
        templateInstance: dpnmInstanceAddr,
        flow: eco.flow,
        gwt: eco.gwt,
        tree: eco.tree,
        protocol: eco.protocol,
      },
    },
    deployedAt: new Date().toISOString(),
    audit_todo:
      "Rotate DEFAULT_ADMIN_ROLE on every contract from deployer to multisig (Gnosis Safe) and renounce deployer admin via post-deploy script.",
  };

  const outPath = path.join(process.cwd(), `deployment-bsc-testnet.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[bsc-testnet] wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
