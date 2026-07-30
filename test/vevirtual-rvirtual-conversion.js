/*
Test veVirtual.convertVeVirtualToRVirtual(): deletes a staking position and routes its
underlying VIRTUAL through RVirtualConverter for a flat 1:1 rVirtual payout. No maturity
requirement, no autoRenew restriction - any position can be converted directly.
*/
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers;
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("veVIRTUAL - convertVeVirtualToRVirtual", function () {
  let virtual, rVirtual, veVirtual, converter;
  let deployer, staker, staker2, other, treasury;

  before(async function () {
    [deployer, staker, staker2, other, treasury] = await ethers.getSigners();
  });

  beforeEach(async function () {
    virtual = await ethers.deployContract("VirtualToken", [
      parseEther("1000000000"),
      deployer.address,
    ]);
    rVirtual = await ethers.deployContract("MockERC20", [
      "rVirtual",
      "rVIRTUAL",
      deployer.address,
      parseEther("1000000000"),
    ]);

    const VeVirtualContract = await ethers.getContractFactory("veVirtual");
    veVirtual = await upgrades.deployProxy(VeVirtualContract, [virtual.target, 104]);

    const ConverterContract = await ethers.getContractFactory("RVirtualConverter");
    converter = await upgrades.deployProxy(ConverterContract, [
      virtual.target,
      rVirtual.target,
      treasury.address,
    ]);
    await rVirtual.transfer(converter.target, parseEther("1000000000"));

    await virtual.transfer(staker.address, parseEther("1000"));
    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
  });

  it("should reject conversion when rVirtualConverter is not set", async function () {
    await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
    const id = (await veVirtual.locks(staker.address, 0)).id;

    await expect(
      veVirtual.connect(staker).convertVeVirtualToRVirtual(id)
    ).to.be.revertedWith("Converter not set");
  });

  it("should reject non-admin setting rVirtualConverter", async function () {
    await expect(
      veVirtual.connect(staker).setRVirtualConverter(converter.target)
    ).to.be.reverted;
  });

  describe("with rVirtualConverter configured", function () {
    beforeEach(async function () {
      await veVirtual.setRVirtualConverter(converter.target);
    });

    it("should convert a NOT-yet-matured lock at a flat 1:1 rate", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;

      // Confirm it's genuinely not matured - withdraw() would revert here.
      await expect(veVirtual.connect(staker).withdraw(id)).to.be.revertedWith(
        "Lock is not expired"
      );

      await expect(veVirtual.connect(staker).convertVeVirtualToRVirtual(id))
        .to.emit(veVirtual, "ConvertedVeVirtualToRVirtual")
        .withArgs(staker.address, id, parseEther("100"));

      expect(await veVirtual.numPositions(staker.address)).to.be.equal(0);
      expect(await veVirtual.balanceOf(staker.address)).to.be.equal(0);
      expect(await rVirtual.balanceOf(staker.address)).to.be.equal(parseEther("100"));
      // Incoming VIRTUAL is routed straight to treasury (L-02 fix), never held by the converter.
      expect(await virtual.balanceOf(converter.target)).to.be.equal(0);
      expect(await virtual.balanceOf(treasury.address)).to.be.equal(parseEther("100"));
    });

    it("should also convert an already-matured lock", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(53 * 7 * 24 * 60 * 60);

      await veVirtual.connect(staker).convertVeVirtualToRVirtual(id);
      expect(await rVirtual.balanceOf(staker.address)).to.be.equal(parseEther("100"));
    });

    it("should convert an auto-renewing lock too - no autoRenew restriction", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, true);
      const id = (await veVirtual.locks(staker.address, 0)).id;

      await expect(veVirtual.connect(staker).convertVeVirtualToRVirtual(id)).to.not.be
        .reverted;
      expect(await rVirtual.balanceOf(staker.address)).to.be.equal(parseEther("100"));
      expect(await veVirtual.numPositions(staker.address)).to.be.equal(0);
    });

    it("should convert regardless of remaining lock time, always at 1:1", async function () {
      await virtual.transfer(staker.address, parseEther("100"));
      await veVirtual.connect(staker).stake(parseEther("100"), 104, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;

      // Fresh position, maximum remaining lock time - still full 1:1, no discount.
      await veVirtual.connect(staker).convertVeVirtualToRVirtual(id);
      expect(await rVirtual.balanceOf(staker.address)).to.be.equal(parseEther("100"));
    });

    it("should not allow converting someone else's lock id", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;

      await expect(
        veVirtual.connect(staker2).convertVeVirtualToRVirtual(id)
      ).to.be.revertedWith("Lock not found");
    });

    it("should not allow withdrawing or re-converting after conversion", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await veVirtual.connect(staker).convertVeVirtualToRVirtual(id);

      await expect(veVirtual.connect(staker).withdraw(id)).to.be.revertedWith(
        "Lock not found"
      );
      await expect(
        veVirtual.connect(staker).convertVeVirtualToRVirtual(id)
      ).to.be.revertedWith("Lock not found");
    });

    it("should only remove the converted lock, leaving other positions untouched", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false); // id 1
      await veVirtual.connect(staker).stake(parseEther("50"), 52, false); // id 2
      expect(await veVirtual.numPositions(staker.address)).to.be.equal(2);

      const firstId = (await veVirtual.locks(staker.address, 0)).id;
      await veVirtual.connect(staker).convertVeVirtualToRVirtual(firstId);

      expect(await veVirtual.numPositions(staker.address)).to.be.equal(1);
      expect(await rVirtual.balanceOf(staker.address)).to.be.equal(parseEther("100"));
    });

    it("should remove voting power on conversion but preserve historical snapshots", async function () {
      await veVirtual.connect(staker).delegate(staker.address);
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;

      expect(await veVirtual.getVotes(staker.address)).to.be.equal(parseEther("100"));
      const blockBeforeConversion = await ethers.provider.getBlockNumber();

      await veVirtual.connect(staker).convertVeVirtualToRVirtual(id);

      expect(await veVirtual.getVotes(staker.address)).to.be.equal(0);
      expect(
        await veVirtual.getPastVotes(staker.address, blockBeforeConversion)
      ).to.be.equal(parseEther("100"));
    });

    it("should not leave any residual VIRTUAL allowance on veVirtual toward the converter", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await veVirtual.connect(staker).convertVeVirtualToRVirtual(id);

      expect(
        await virtual.allowance(veVirtual.target, converter.target)
      ).to.be.equal(0);
    });
  });

  describe("forceApprove instead of raw approve (L-04 fix)", function () {
    it("should overwrite (not error on) a stale nonzero allowance toward a no-op converter", async function () {
      // A no-op converter never pulls the approved VIRTUAL, so the allowance from the
      // FIRST conversion call is left standing at the full lock amount.
      const noOpConverter = await ethers.deployContract("NoOpConverterMock");
      await veVirtual.setRVirtualConverter(noOpConverter.target);

      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const firstId = (await veVirtual.locks(staker.address, 0)).id;
      await veVirtual.connect(staker).convertVeVirtualToRVirtual(firstId);

      expect(
        await virtual.allowance(veVirtual.target, noOpConverter.target)
      ).to.be.equal(parseEther("100"));

      // A SECOND lock/conversion must not revert despite the standing non-zero
      // allowance - forceApprove() overwrites it cleanly. (A raw, non-force approve()
      // would also succeed on a standard ERC20 like VIRTUAL, but forceApprove is the
      // hardened SafeERC20 path that also works on tokens which reject a direct
      // nonzero-to-nonzero approve, e.g. USDT-style tokens.)
      await virtual.transfer(staker.address, parseEther("50"));
      await veVirtual.connect(staker).stake(parseEther("50"), 52, false);
      const secondId = (await veVirtual.locks(staker.address, 0)).id;

      await expect(
        veVirtual.connect(staker).convertVeVirtualToRVirtual(secondId)
      ).to.not.be.reverted;

      // Allowance now reflects only the second call's amount - overwritten, not summed.
      expect(
        await virtual.allowance(veVirtual.target, noOpConverter.target)
      ).to.be.equal(parseEther("50"));
    });
  });
});
