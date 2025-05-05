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
