/*
 * LaunchpadFactory + DpnmTemplate + VirtualsTemplate integration tests.
 *
 * Run: npx hardhat test test/factory/factory.test.js
 */
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ZeroAddress, parseEther, AbiCoder, id: keccakId } = require("ethers");

const DPNM_ID = keccakId("dpnm");
const VIRTUALS_ID = keccakId("virtuals");
const DA_ROLE = ethers.ZeroHash;

async function deployFactoryFixture() {
  const [admin, treasury, root, alice, bob, carol] = await ethers.getSigners();

  // Mock USDT (18-dec).
  const Mock = await ethers.getContractFactory("MockERC20");
  const usdt = await Mock.deploy(
    "Mock USDT",
    "mUSDT",
    admin.address,
    parseEther("100000000"),
  );
  await usdt.waitForDeployment();

  // 1. LaunchpadFactory (UUPS).
  const Factory = await ethers.getContractFactory("LaunchpadFactory");
  const factory = await upgrades.deployProxy(Factory, [admin.address], {
    kind: "uups",
  });
  await factory.waitForDeployment();

  // 2. dPNM sub-implementations.
  const Flow = await ethers.getContractFactory("Flow");
  const flowImpl = await Flow.deploy();
  const Gwt = await ethers.getContractFactory("FlowGrowToken");
  const gwtImpl = await Gwt.deploy();
  const Tree = await ethers.getContractFactory("PhenomenalTree");
  const treeImpl = await Tree.deploy();
  const Protocol = await ethers.getContractFactory("FlowProtocol");
  const protocolImpl = await Protocol.deploy();
  await Promise.all([
    flowImpl.waitForDeployment(),
    gwtImpl.waitForDeployment(),
    treeImpl.waitForDeployment(),
    protocolImpl.waitForDeployment(),
  ]);

  // 3. DpnmTemplate.
  const Dpnm = await ethers.getContractFactory("DpnmTemplate");
  const dpnmImpl = await Dpnm.deploy();
  await dpnmImpl.waitForDeployment();
  const dpnmInitSelector = Dpnm.interface.getFunction("initialize").selector;
  await (
    await factory.registerTemplate(
      DPNM_ID,
      await dpnmImpl.getAddress(),
      dpnmInitSelector,
    )
  ).wait();

  // 4. virtuals sub-implementations + template.
  const FFactory = await ethers.getContractFactory("FFactory");
  const fFactoryImpl = await FFactory.deploy();
  const FRouter = await ethers.getContractFactory("FRouter");
  const fRouterImpl = await FRouter.deploy();
  const Bonding = await ethers.getContractFactory("Bonding");
  const bondingImpl = await Bonding.deploy();
  const Virt = await ethers.getContractFactory("VirtualsTemplate");
  const virtImpl = await Virt.deploy();
  await Promise.all([
    fFactoryImpl.waitForDeployment(),
    fRouterImpl.waitForDeployment(),
    bondingImpl.waitForDeployment(),
    virtImpl.waitForDeployment(),
  ]);
  const virtInitSelector = Virt.interface.getFunction("initialize").selector;
  await (
    await factory.registerTemplate(
      VIRTUALS_ID,
      await virtImpl.getAddress(),
      virtInitSelector,
    )
  ).wait();

  return {
    admin,
    treasury,
    root,
    alice,
    bob,
    carol,
    usdt,
    factory,
    flowImpl,
    gwtImpl,
    treeImpl,
    protocolImpl,
    dpnmImpl,
    fFactoryImpl,
    fRouterImpl,
    bondingImpl,
    virtImpl,
    dpnmInitSelector,
    virtInitSelector,
  };
}

function encodeDpnmParams(
  admin,
  treasury,
  usdt,
  initialPrice,
  treeRoot,
  ecoName,
  ecoSymbol,
  gwtName,
  gwtSymbol,
  impls,
) {
  return AbiCoder.defaultAbiCoder().encode(
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
      admin,
      treasury,
      usdt,
      initialPrice,
      treeRoot,
      ecoName,
      ecoSymbol,
      gwtName,
      gwtSymbol,
      [impls.flow, impls.gwt, impls.tree, impls.protocol],
    ],
  );
}

function encodeVirtualsParams(admin, treasury, assetToken, feeTo, bp, impls) {
  return AbiCoder.defaultAbiCoder().encode(
    [
      "address",
      "address",
      "address",
      "address",
      "tuple(uint256,uint256,uint256,uint256,uint256,address)",
      "tuple(address,address,address)",
    ],
    [
      admin,
      treasury,
      assetToken,
      feeTo,
      [
        bp.fee,
        bp.initialSupply,
        bp.assetRate,
        bp.maxTx,
        bp.gradThreshold,
        bp.agentFactory,
      ],
      [impls.factory, impls.router, impls.bonding],
    ],
  );
}

function findLaunchedEvent(receipt, factory) {
  for (const log of receipt.logs) {
    try {
      const parsed = factory.interface.parseLog(log);
      if (parsed && parsed.name === "Launched") return parsed;
    } catch (_) {}
  }
  return null;
}

describe("LaunchpadFactory — registry", function () {
  it("registers a template (admin only)", async function () {
    const f = await loadFixture(deployFactoryFixture);
    const info = await f.factory.getTemplate(DPNM_ID);
    expect(info.implementation).to.equal(await f.dpnmImpl.getAddress());
    expect(info.registered).to.equal(true);
  });

  it("rejects duplicate registration", async function () {
    const f = await loadFixture(deployFactoryFixture);
    await expect(
      f.factory
        .connect(f.admin)
        .registerTemplate(
          DPNM_ID,
          await f.dpnmImpl.getAddress(),
          f.dpnmInitSelector,
        ),
    ).to.be.revertedWithCustomError(f.factory, "TemplateAlreadyRegistered");
  });

  it("rejects launch of unknown id", async function () {
    const f = await loadFixture(deployFactoryFixture);
    const fakeId = keccakId("nonexistent");
    await expect(
      f.factory.launch(fakeId, "0x", ethers.ZeroHash),
    ).to.be.revertedWithCustomError(f.factory, "TemplateNotRegistered");
  });

  it("rejects launch of paused template", async function () {
    const f = await loadFixture(deployFactoryFixture);
    await (await f.factory.connect(f.admin).pauseTemplate(DPNM_ID, true)).wait();
    await expect(
      f.factory.launch(DPNM_ID, "0x", ethers.ZeroHash),
    ).to.be.revertedWithCustomError(f.factory, "TemplatePausedErr");
  });

  it("non-admin cannot register", async function () {
    const f = await loadFixture(deployFactoryFixture);
    await expect(
      f.factory
        .connect(f.alice)
        .registerTemplate(
          keccakId("alt"),
          await f.dpnmImpl.getAddress(),
          f.dpnmInitSelector,
        ),
    ).to.be.reverted;
  });
});

describe("LaunchpadFactory — dpnm launch", function () {
  it("launches a working dPNM ecosystem", async function () {
    const f = await loadFixture(deployFactoryFixture);
    const params = encodeDpnmParams(
      f.admin.address,
      f.treasury.address,
      await f.usdt.getAddress(),
      parseEther("0.1"),
      f.root.address,
      "AgentFlow",
      "FLOW",
      "Flow Grow",
      "GWT",
      {
        flow: await f.flowImpl.getAddress(),
        gwt: await f.gwtImpl.getAddress(),
        tree: await f.treeImpl.getAddress(),
        protocol: await f.protocolImpl.getAddress(),
      },
    );
    const salt = keccakId("flow-genesis");
    const predicted = await f.factory.predictAddress(
      DPNM_ID,
      f.admin.address,
      salt,
    );

    const tx = await f.factory.connect(f.admin).launch(DPNM_ID, params, salt);
    const receipt = await tx.wait();
    const evt = findLaunchedEvent(receipt, f.factory);
    expect(evt).to.not.equal(null);
    expect(evt.args.instance).to.equal(predicted);

    const dpnm = await ethers.getContractAt("DpnmTemplate", evt.args.instance);
    const ecosystem = await dpnm.ecosystem();

    await f.usdt
      .connect(f.admin)
      .transfer(f.alice.address, parseEther("10000"));
    const protocol = await ethers.getContractAt(
      "FlowProtocol",
      ecosystem.protocol,
    );
    await f.usdt
      .connect(f.alice)
      .approve(ecosystem.protocol, ethers.MaxUint256);

    await (await protocol.connect(f.alice).activate(ZeroAddress)).wait();
    expect(await protocol.isActivated(f.alice.address)).to.equal(true);

    await (await protocol.connect(f.alice).buy(parseEther("50"))).wait();
    const flow = await ethers.getContractAt("Flow", ecosystem.flow);
    expect(await flow.balanceOf(f.alice.address)).to.be.gt(0n);

    expect(await flow.name()).to.equal("AgentFlow");
    expect(await flow.symbol()).to.equal("FLOW");

    const flowBal = await flow.balanceOf(f.alice.address);
    await (await protocol.connect(f.alice).sell(flowBal / 4n)).wait();
  });

  it("two launches with different salts yield different instances", async function () {
    const f = await loadFixture(deployFactoryFixture);
    const baseParams = (eco, sym) =>
      encodeDpnmParams(
        f.admin.address,
        f.treasury.address,
        f.usdt.target,
        parseEther("0.1"),
        f.root.address,
        eco,
        sym,
        "Grow",
        "GWT",
        {
          flow: f.flowImpl.target,
          gwt: f.gwtImpl.target,
          tree: f.treeImpl.target,
          protocol: f.protocolImpl.target,
        },
      );

    const tx1 = await f.factory
      .connect(f.admin)
      .launch(DPNM_ID, baseParams("Token1", "T1"), keccakId("a"));
    const tx2 = await f.factory
      .connect(f.admin)
      .launch(DPNM_ID, baseParams("Token2", "T2"), keccakId("b"));

    const r1 = await tx1.wait();
    const r2 = await tx2.wait();
    expect(findLaunchedEvent(r1, f.factory).args.instance).to.not.equal(
      findLaunchedEvent(r2, f.factory).args.instance,
    );
  });

  it("predictAddress matches the actual deployment", async function () {
    const f = await loadFixture(deployFactoryFixture);
    const params = encodeDpnmParams(
      f.admin.address,
      f.treasury.address,
      f.usdt.target,
      parseEther("0.1"),
      f.root.address,
      "P",
      "P",
      "G",
      "G",
      {
        flow: f.flowImpl.target,
        gwt: f.gwtImpl.target,
        tree: f.treeImpl.target,
        protocol: f.protocolImpl.target,
      },
    );
    const salt = keccakId("predict");
    const predicted = await f.factory.predictAddress(
      DPNM_ID,
      f.admin.address,
      salt,
    );
    const tx = await f.factory.connect(f.admin).launch(DPNM_ID, params, salt);
    const r = await tx.wait();
    expect(findLaunchedEvent(r, f.factory).args.instance).to.equal(predicted);
  });
});

describe("LaunchpadFactory — virtuals launch", function () {
  it("launches a virtuals-style trio with wired roles", async function () {
    const f = await loadFixture(deployFactoryFixture);
    const params = encodeVirtualsParams(
      f.admin.address,
      f.treasury.address,
      await f.usdt.getAddress(),
      f.treasury.address,
      {
        fee: 100n,
        initialSupply: 1_000_000_000n,
        assetRate: 100n,
        maxTx: 100n,
        gradThreshold: 42_000n * 10n ** 18n,
        agentFactory: ZeroAddress,
      },
      {
        factory: await f.fFactoryImpl.getAddress(),
        router: await f.fRouterImpl.getAddress(),
        bonding: await f.bondingImpl.getAddress(),
      },
    );

    const tx = await f.factory
      .connect(f.admin)
      .launch(VIRTUALS_ID, params, keccakId("virt-1"));
    const receipt = await tx.wait();
    const evt = findLaunchedEvent(receipt, f.factory);
    const virt = await ethers.getContractAt("VirtualsTemplate", evt.args.instance);

    const fFactoryAddr = await virt.factory();
    const fRouterAddr = await virt.router();
    const bondingAddr = await virt.bonding();
    expect(fFactoryAddr).to.not.equal(ZeroAddress);
    expect(fRouterAddr).to.not.equal(ZeroAddress);
    expect(bondingAddr).to.not.equal(ZeroAddress);

    const bonding = await ethers.getContractAt("Bonding", bondingAddr);
    expect(await bonding.owner()).to.equal(f.admin.address);

    const fFactory = await ethers.getContractAt("FFactory", fFactoryAddr);
    expect(await fFactory.router()).to.equal(fRouterAddr);
  });
});

describe("LaunchpadFactory — fee + admin", function () {
  it("collects creation fee and forwards to recipient", async function () {
    const f = await loadFixture(deployFactoryFixture);
    const fee = parseEther("0.01");
    await (
      await f.factory.connect(f.admin).setCreationFee(fee, f.treasury.address)
    ).wait();

    const params = encodeDpnmParams(
      f.admin.address,
      f.treasury.address,
      f.usdt.target,
      parseEther("0.1"),
      f.root.address,
      "AA",
      "AA",
      "BB",
      "BB",
      {
        flow: f.flowImpl.target,
        gwt: f.gwtImpl.target,
        tree: f.treeImpl.target,
        protocol: f.protocolImpl.target,
      },
    );
    const balBefore = await ethers.provider.getBalance(f.treasury.address);
    await (
      await f.factory
        .connect(f.alice)
        .launch(DPNM_ID, params, keccakId("fee"), { value: fee })
    ).wait();
    const balAfter = await ethers.provider.getBalance(f.treasury.address);
    expect(balAfter - balBefore).to.equal(fee);
  });

  it("reverts when fee under-paid", async function () {
    const f = await loadFixture(deployFactoryFixture);
    const fee = parseEther("0.01");
    await (
      await f.factory.connect(f.admin).setCreationFee(fee, f.treasury.address)
    ).wait();

    const params = encodeDpnmParams(
      f.admin.address,
      f.treasury.address,
      f.usdt.target,
      parseEther("0.1"),
      f.root.address,
      "AA",
      "AA",
      "BB",
      "BB",
      {
        flow: f.flowImpl.target,
        gwt: f.gwtImpl.target,
        tree: f.treeImpl.target,
        protocol: f.protocolImpl.target,
      },
    );
    await expect(
      f.factory
        .connect(f.alice)
        .launch(DPNM_ID, params, keccakId("fee"), { value: 0 }),
    ).to.be.revertedWithCustomError(f.factory, "InsufficientFee");
  });
});
