/*
Test delegation with history
*/
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers;
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { formatEther } = require("ethers");

describe("veVIRTUAL", function () {
  let virtual, veVirtual;
  let deployer, staker;

  before(async function () {
    [deployer, staker] = await ethers.getSigners();
  });

  beforeEach(async function () {
    virtual = await ethers.deployContract("VirtualToken", [
      parseEther("1000000000"),
      deployer.address,
    ]);

    const Contract = await ethers.getContractFactory("veVirtual");
    veVirtual = await upgrades.deployProxy(Contract, [virtual.target, 104]);
  });

  it("should reject calling initialize() directly on the raw implementation contract (L-12 fix)", async function () {
    const implAddress = await upgrades.erc1967.getImplementationAddress(veVirtual.target);
    const implementation = await ethers.getContractAt("veVirtual", implAddress);

    await expect(implementation.initialize(virtual.target, 104)).to.be.reverted;
  });

  it("should preserve all existing proxy state across an upgrade that adds the L-12 constructor", async function () {
    // Simulates upgrading an already-live veVirtual proxy (existing user stakes/votes)
    // to a new implementation that adds `constructor() { _disableInitializers(); }`.
    // Proves the constructor - which only ever runs once, at the NEW implementation's
    // own deployment - never touches the proxy's storage.
    await virtual.transfer(staker.address, parseEther("1000"));
    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
    await veVirtual.connect(staker).delegate(staker.address);
    await veVirtual.connect(staker).stake(parseEther("300"), 52, false);
    const id = (await veVirtual.locks(staker.address, 0)).id;

    const implBefore = await upgrades.erc1967.getImplementationAddress(veVirtual.target);
    const balanceBefore = await veVirtual.balanceOf(staker.address);
    const votesBefore = await veVirtual.getVotes(staker.address);

    // Upgrade to a fresh deployment of the SAME (current, constructor-having) contract -
    // this is exactly what a real upgrade does: deploy a brand-new implementation and
    // repoint the existing proxy at it. The new implementation's constructor runs during
    // THIS deployment, not against the proxy.
    const VeVirtualContract = await ethers.getContractFactory("veVirtual");
    const upgraded = await upgrades.upgradeProxy(veVirtual.target, VeVirtualContract, {
      // Force a genuinely new implementation deployment even though the bytecode is
      // identical to the current one - a real upgrade always deploys fresh, and this
      // is what proves the constructor runs on a NEW address, not the old one.
      redeployImplementation: "always",
    });
    const implAfter = await upgrades.erc1967.getImplementationAddress(upgraded.target);

    expect(implAfter).to.not.equal(implBefore);
    expect(upgraded.target).to.equal(veVirtual.target); // same proxy address throughout

    // All pre-upgrade state survives untouched. balanceOf is intentionally time-decayed
    // (see L-11), so it ticks down by a negligible amount over the 1-2 blocks the
    // upgrade transaction itself takes to mine - compare with a tight tolerance rather
    // than exact equality. getVotes is the raw, undecayed sum and must match exactly.
    expect(await upgraded.numPositions(staker.address)).to.be.equal(1);
    expect((await upgraded.locks(staker.address, 0)).id).to.be.equal(id);
    expect(await upgraded.balanceOf(staker.address)).to.be.closeTo(
      balanceBefore,
      parseEther("0.001")
    );
    expect(await upgraded.getVotes(staker.address)).to.be.equal(votesBefore);

    // The functionality still works post-upgrade.
    await expect(upgraded.connect(staker).stake(parseEther("50"), 52, false)).to.not.be
      .reverted;

    // And the NEW implementation is independently hardened too.
    const newImplementation = await ethers.getContractAt("veVirtual", implAfter);
    await expect(newImplementation.initialize(virtual.target, 104)).to.be.reverted;
  });

  it("should allow staking", async function () {
    await virtual.transfer(staker.address, parseEther("1000"));

    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );
    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
    await veVirtual.connect(staker).stake(parseEther("100"), 52, false);

    expect(await veVirtual.numPositions(staker.address)).to.be.equal(1);
    expect(await veVirtual.balanceOf(staker.address)).to.be.equal(
      parseEther("50")
    );
  });

  it("should decay balance over time", async function () {
    await virtual.transfer(staker.address, parseEther("1000"));

    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );

    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
    await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
    await time.increase(26 * 7 * 24 * 60 * 60);
    expect(
      parseInt(formatEther(await veVirtual.balanceOf(staker.address)))
    ).to.be.equal(25);
  });

  it("should allow withdrawal on maturity only", async function () {
    await virtual.transfer(staker.address, parseEther("1000"));

    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );

    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
    await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
    const id = (await veVirtual.locks(staker.address, 0)).id;
    await time.increase(26 * 7 * 24 * 60 * 60);
    await expect(veVirtual.connect(staker).withdraw(id)).to.be.revertedWith(
      "Lock is not expired"
    );

    await time.increase(26 * 7 * 24 * 60 * 60);
    expect(await veVirtual.balanceOf(staker.address)).to.be.equal("0");
    expect(await veVirtual.connect(staker).withdraw(id)).to.be.not.reverted;
  });

  it("should allow extension", async function () {
    await virtual.transfer(staker.address, parseEther("1000"));

    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );

    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
    await veVirtual.connect(staker).stake(parseEther("1000"), 52, false);
    expect(await veVirtual.balanceOf(staker.address)).to.be.equal(
      parseEther("500")
    );

    await veVirtual.connect(staker).extend(1, 52);
    expect(await veVirtual.balanceOf(staker.address)).to.be.greaterThan(
      parseEther("999")
    );
  });

  it("should allow over extension", async function () {
    await virtual.transfer(staker.address, parseEther("1000"));

    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );

    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
    await veVirtual.connect(staker).stake(parseEther("1000"), 52, false);

    await expect(veVirtual.connect(staker).extend(1, 104)).to.be.revertedWith(
      "Num weeks must be less than max weeks"
    );
  });

  it("should continue decay after extension", async function () {
    await virtual.transfer(staker.address, parseEther("1000"));

    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );

    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
    await veVirtual.connect(staker).stake(parseEther("1000"), 52, false);
    expect(await veVirtual.balanceOf(staker.address)).to.be.equal(
      parseEther("500")
    );

    await time.increase(364 * 24 * 60 * 60 - 2);

    await veVirtual.connect(staker).extend(1, 52);
    expect(
      parseInt(formatEther(await veVirtual.balanceOf(staker.address)))
    ).to.be.equal(500);

    await time.increase(51 * 7 * 24 * 60 * 60);
    expect(await veVirtual.balanceOf(staker.address)).to.be.lessThan(
      parseEther("10")
    );

    await time.increase(7 * 24 * 60 * 60);
    await veVirtual.connect(staker).withdraw(1);
    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );
  });

  it("should allow toggle auto renew", async function () {
    await virtual.transfer(staker.address, parseEther("1000"));

    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );

    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
    await veVirtual.connect(staker).stake(parseEther("1000"), 52, false);
    expect(await veVirtual.balanceOf(staker.address)).to.be.equal(
      parseEther("500")
    );

    await time.increase(51 * 7 * 24 * 60 * 60);
    const start = await time.latest();
    await veVirtual.connect(staker).toggleAutoRenew(1);
    expect(await veVirtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );
    const position2 = (await veVirtual.getPositions(staker.address, 0, 1))[0];

    expect(position2.autoRenew).to.be.equal(true);
    expect(position2.numWeeks).to.be.equal(104);
    expect(position2.end).to.be.equal(start + 104 * 7 * 24 * 60 * 60 + 1);
  });

  it("should keep track of voting power without decay", async function () {
    await virtual.transfer(staker.address, parseEther("1000"));

    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("1000")
    );

    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
    await veVirtual.connect(staker).stake(parseEther("1000"), 52, false);
    expect(await veVirtual.balanceOf(staker.address)).to.be.equal(
      parseEther("500")
    );
    expect(await veVirtual.getVotes(staker.address)).to.be.equal(
      parseEther("0")
    );
    await veVirtual.connect(staker).delegate(staker.address);
    expect(await veVirtual.getVotes(staker.address)).to.be.equal(
      parseEther("1000")
    );

    await time.increase(51 * 7 * 24 * 60 * 60);
    expect(await veVirtual.getVotes(staker.address)).to.be.equal(
      parseEther("1000")
    );
  });

  it("shoudl calculate voting power correctly when restaking and withdrawing", async function () {
    await virtual.transfer(staker.address, parseEther("2000"));

    expect(await virtual.balanceOf(staker.address)).to.be.equal(
      parseEther("2000")
    );

    await veVirtual.connect(staker).delegate(staker.address);
    await virtual.connect(staker).approve(veVirtual.target, parseEther("2000"));

    await veVirtual.connect(staker).stake(parseEther("1000"), 52, false);
    expect(await veVirtual.getVotes(staker.address)).to.be.equal(
      parseEther("1000")
    );

    const firstBlock = await ethers.provider.getBlockNumber();

    await time.increase(52 * 7 * 24 * 60 * 60);

    await veVirtual.connect(staker).stake(parseEther("1000"), 52, false);
    const secondBlock = await ethers.provider.getBlockNumber();
    await time.increase(52 * 7 * 24 * 60 * 60);
    expect(await veVirtual.getVotes(staker.address)).to.be.equal(
      parseEther("2000")
    );

    await veVirtual.connect(staker).withdraw(1);

    expect(await veVirtual.getVotes(staker.address)).to.be.equal(
      parseEther("1000")
    );
    await veVirtual.connect(staker).withdraw(2);
    expect(await veVirtual.getVotes(staker.address)).to.be.equal(
      parseEther("0")
    );
    expect(
      await veVirtual.getPastVotes(staker.address, firstBlock)
    ).to.be.equal(parseEther("1000"));
    expect(
      await veVirtual.getPastVotes(staker.address, secondBlock)
    ).to.be.equal(parseEther("2000"));
  });
});
