/*
Test veVirtual.convertVeVirtualToAgVirt(): deletes a staking position and routes its
underlying VIRTUAL through AgVirtConverter for a flat 1:1 agVirt payout. No maturity
requirement and no autoRenew restriction, but the lock must be at least MIN_CONVERT_AGE old.
*/
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers;
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const MIN_CONVERT_AGE = 30 * 24 * 60 * 60; // veVirtual.MIN_CONVERT_AGE

describe("veVIRTUAL - convertVeVirtualToAgVirt", function () {
  let virtual, agVirt, veVirtual, converter;
  let deployer, staker, staker2, other, treasury;

  before(async function () {
    [deployer, staker, staker2, other, treasury] = await ethers.getSigners();
  });

  beforeEach(async function () {
    virtual = await ethers.deployContract("VirtualToken", [
      parseEther("1000000000"),
      deployer.address,
    ]);
    agVirt = await ethers.deployContract("MockERC20", [
      "agVirt",
      "agVIRT",
      deployer.address,
      parseEther("1000000000"),
    ]);

    const VeVirtualContract = await ethers.getContractFactory("veVirtual");
    veVirtual = await upgrades.deployProxy(VeVirtualContract, [virtual.target, 104]);

    const ConverterContract = await ethers.getContractFactory("AgVirtConverter");
    converter = await upgrades.deployProxy(ConverterContract, [
      virtual.target,
      agVirt.target,
      treasury.address,
    ]);
    await agVirt.transfer(converter.target, parseEther("1000000000"));

    await virtual.transfer(staker.address, parseEther("1000"));
    await virtual.connect(staker).approve(veVirtual.target, parseEther("1000"));
  });

  it("should reject conversion when agVirtConverter is not set", async function () {
    await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
    const id = (await veVirtual.locks(staker.address, 0)).id;

    await expect(
      veVirtual.connect(staker).convertVeVirtualToAgVirt(id)
    ).to.be.revertedWith("Converter not set");
  });

  it("should reject non-admin setting agVirtConverter", async function () {
    await expect(
      veVirtual.connect(staker).setAgVirtConverter(converter.target)
    ).to.be.reverted;
  });

  it("should reject a converter whose virtualToken doesn't match veVirtual's baseToken (L-09 fix)", async function () {
    // A converter wired up with a DIFFERENT token as its virtualToken (e.g. agVirt
    // itself, standing in for any mismatched deployment).
    const ConverterContract = await ethers.getContractFactory("AgVirtConverter");
    const mismatchedConverter = await upgrades.deployProxy(ConverterContract, [
      agVirt.target,
      virtual.target,
      other.address,
    ]);

    await expect(
      veVirtual.setAgVirtConverter(mismatchedConverter.target)
    ).to.be.revertedWith("Converter token mismatch");
  });

  describe("with agVirtConverter configured", function () {
    beforeEach(async function () {
      await veVirtual.setAgVirtConverter(converter.target);
    });

    it("should convert a NOT-yet-matured lock at a flat 1:1 rate", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);

      // Confirm it's genuinely not matured - withdraw() would revert here.
      await expect(veVirtual.connect(staker).withdraw(id)).to.be.revertedWith(
        "Lock is not expired"
      );

      await expect(veVirtual.connect(staker).convertVeVirtualToAgVirt(id))
        .to.emit(veVirtual, "ConvertedVeVirtualToAgVirt")
        .withArgs(staker.address, id, parseEther("100"));

      expect(await veVirtual.numPositions(staker.address)).to.be.equal(0);
      expect(await veVirtual.balanceOf(staker.address)).to.be.equal(0);
      expect(await agVirt.balanceOf(staker.address)).to.be.equal(parseEther("100"));
      // Incoming VIRTUAL is routed straight to treasury (L-02 fix), never held by the converter.
      expect(await virtual.balanceOf(converter.target)).to.be.equal(0);
      expect(await virtual.balanceOf(treasury.address)).to.be.equal(parseEther("100"));
    });

    it("should reject converting a lock younger than MIN_CONVERT_AGE", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await expect(
        veVirtual.connect(staker).convertVeVirtualToAgVirt(id)
      ).to.be.revertedWith("Lock too recent to convert");
    });

    it("should also convert an already-matured lock", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);
      await time.increase(53 * 7 * 24 * 60 * 60);

      await veVirtual.connect(staker).convertVeVirtualToAgVirt(id);
      expect(await agVirt.balanceOf(staker.address)).to.be.equal(parseEther("100"));
    });

    it("should convert an auto-renewing lock too - no autoRenew restriction", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, true);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);

      await expect(veVirtual.connect(staker).convertVeVirtualToAgVirt(id)).to.not.be
        .reverted;
      expect(await agVirt.balanceOf(staker.address)).to.be.equal(parseEther("100"));
      expect(await veVirtual.numPositions(staker.address)).to.be.equal(0);
    });

    it("should convert regardless of remaining lock time, always at 1:1", async function () {
      await virtual.transfer(staker.address, parseEther("100"));
      await veVirtual.connect(staker).stake(parseEther("100"), 104, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);

      // Fresh position, maximum remaining lock time - still full 1:1, no discount.
      await veVirtual.connect(staker).convertVeVirtualToAgVirt(id);
      expect(await agVirt.balanceOf(staker.address)).to.be.equal(parseEther("100"));
    });

    it("should not allow converting someone else's lock id", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);

      await expect(
        veVirtual.connect(staker2).convertVeVirtualToAgVirt(id)
      ).to.be.revertedWith("Lock not found");
    });

    it("should not allow withdrawing or re-converting after conversion", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);
      await veVirtual.connect(staker).convertVeVirtualToAgVirt(id);

      await expect(veVirtual.connect(staker).withdraw(id)).to.be.revertedWith(
        "Lock not found"
      );
      await expect(
        veVirtual.connect(staker).convertVeVirtualToAgVirt(id)
      ).to.be.revertedWith("Lock not found");
    });

    it("should only remove the converted lock, leaving other positions untouched", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false); // id 1
      await veVirtual.connect(staker).stake(parseEther("50"), 52, false); // id 2
      expect(await veVirtual.numPositions(staker.address)).to.be.equal(2);

      const firstId = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);
      await veVirtual.connect(staker).convertVeVirtualToAgVirt(firstId);

      expect(await veVirtual.numPositions(staker.address)).to.be.equal(1);
      expect(await agVirt.balanceOf(staker.address)).to.be.equal(parseEther("100"));
    });

    it("should remove voting power on conversion but preserve historical snapshots", async function () {
      await veVirtual.connect(staker).delegate(staker.address);
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);

      expect(await veVirtual.getVotes(staker.address)).to.be.equal(parseEther("100"));
      const blockBeforeConversion = await ethers.provider.getBlockNumber();

      await veVirtual.connect(staker).convertVeVirtualToAgVirt(id);

      expect(await veVirtual.getVotes(staker.address)).to.be.equal(0);
      expect(
        await veVirtual.getPastVotes(staker.address, blockBeforeConversion)
      ).to.be.equal(parseEther("100"));
    });

    it("should not leave any residual VIRTUAL allowance on veVirtual toward the converter", async function () {
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);
      await veVirtual.connect(staker).convertVeVirtualToAgVirt(id);

      expect(
        await virtual.allowance(veVirtual.target, converter.target)
      ).to.be.equal(0);
    });
  });

  describe("forceApprove instead of raw approve (L-04 fix)", function () {
    it("should overwrite (not error on) a stale nonzero allowance toward a non-consuming converter", async function () {
      // A SECOND lock/conversion must not revert despite the first call's converter never
      // having pulled the funds - forceApprove() overwrites cleanly regardless. (A raw,
      // non-force approve() would also succeed on a standard ERC20 like VIRTUAL, but
      // forceApprove is the hardened SafeERC20 path that also works on tokens which reject a
      // direct nonzero-to-nonzero approve, e.g. USDT-style tokens.)
      //
      // Uses NonConsumingConverterMock, not NoOpConverterMock: once the M-02 delivery check
      // is in place, a converter that delivers nothing (NoOpConverterMock) makes the whole
      // conversion revert, so it can no longer reach a *successful* call that leaves the
      // allowance standing - only a converter that delivers correctly via a path that
      // doesn't touch the allowance can.
      const nonConsumingConverter = await ethers.deployContract("NonConsumingConverterMock", [
        virtual.target,
        agVirt.target,
      ]);
      await agVirt.mint(nonConsumingConverter.target, parseEther("1000"));
      await veVirtual.setAgVirtConverter(nonConsumingConverter.target);

      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const firstId = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);
      await veVirtual.connect(staker).convertVeVirtualToAgVirt(firstId);

      await virtual.transfer(staker.address, parseEther("50"));
      await veVirtual.connect(staker).stake(parseEther("50"), 52, false);
      const secondId = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);

      await expect(
        veVirtual.connect(staker).convertVeVirtualToAgVirt(secondId)
      ).to.not.be.reverted;
    });

    it("should clear the allowance after a successful call even when the converter never pulled the funds (audit I-04 fix)", async function () {
      // NonConsumingConverterMock delivers correctly (so the M-02 check passes and the call
      // succeeds) but never calls transferFrom on the approved VIRTUAL. Previously the
      // allowance was left standing at the full lock amount indefinitely in this scenario
      // (including after a later repoint to a different converter); veVirtual now clears it
      // itself regardless of what the converter did.
      const nonConsumingConverter = await ethers.deployContract("NonConsumingConverterMock", [
        virtual.target,
        agVirt.target,
      ]);
      await agVirt.mint(nonConsumingConverter.target, parseEther("1000"));
      await veVirtual.setAgVirtConverter(nonConsumingConverter.target);

      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);
      await veVirtual.connect(staker).convertVeVirtualToAgVirt(id);

      expect(
        await virtual.allowance(veVirtual.target, nonConsumingConverter.target)
      ).to.be.equal(0);
    });
  });

  describe("delivery verification (audit M-02 fix)", function () {
    it("should revert the whole conversion, preserving the lock, when the converter delivers nothing and doesn't pull funds", async function () {
      const noOpConverter = await ethers.deployContract("NoOpConverterMock", [
        virtual.target,
        agVirt.target,
      ]);
      await veVirtual.setAgVirtConverter(noOpConverter.target);

      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);

      await expect(
        veVirtual.connect(staker).convertVeVirtualToAgVirt(id)
      ).to.be.revertedWith("Conversion shortfall");

      // The lock survives - the revert rolled back the deletion too.
      expect((await veVirtual.locks(staker.address, 0)).id).to.equal(id);
      expect(await veVirtual.stakedAmountOf(staker.address)).to.equal(parseEther("100"));
    });

    it("should revert the whole conversion, preserving the lock, when a malicious converter steals the VIRTUAL and delivers nothing", async function () {
      // Simulates exactly the audit's repointed-converter scenario: the converter pulls the
      // approved VIRTUAL via transferFrom and routes it to an attacker address, delivering
      // zero agVirt, without reverting itself. Before the M-02 fix, veVirtual had no way to
      // notice - the lock was already deleted and the call "succeeded". Now the balance-delta
      // check catches the shortfall and reverts the whole transaction.
      const maliciousConverter = await ethers.deployContract("MaliciousConverterMock", [
        virtual.target,
        agVirt.target,
        other.address,
      ]);
      await veVirtual.setAgVirtConverter(maliciousConverter.target);

      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);

      await expect(
        veVirtual.connect(staker).convertVeVirtualToAgVirt(id)
      ).to.be.revertedWith("Conversion shortfall");

      expect((await veVirtual.locks(staker.address, 0)).id).to.equal(id);
      expect(await virtual.balanceOf(other.address)).to.equal(0);
    });

    it("should still succeed normally against the real converter, unaffected by the new check", async function () {
      await veVirtual.setAgVirtConverter(converter.target);

      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const id = (await veVirtual.locks(staker.address, 0)).id;
      await time.increase(MIN_CONVERT_AGE);

      await expect(
        veVirtual.connect(staker).convertVeVirtualToAgVirt(id)
      ).to.not.be.reverted;

      expect(await agVirt.balanceOf(staker.address)).to.equal(parseEther("100"));
    });
  });

  describe("payout token pinning on repoint (audit H-1 follow-up fix)", function () {
    it("should reject repointing to a converter that nominates a DIFFERENT payout token than the one already pinned", async function () {
      // The gap the M-02 fix alone didn't close: setAgVirtConverter re-read
      // agVirtToken() from whichever converter was being wired in, with no check against
      // the previously stored value. A repoint to a brand new converter could nominate a
      // worthless token as its own agVirtToken() - passing the virtualToken() check (which
      // only verifies the INPUT side) while the M-02 delivery check then validates against
      // that nomination instead of against real value.
      await veVirtual.setAgVirtConverter(converter.target); // pins agVirtToken = agVirt.target

      const worthlessToken = await ethers.deployContract("MockERC20", [
        "Worthless", "WORTHLESS", deployer.address, parseEther("1000000"),
      ]);
      const maliciousConverter = await ethers.deployContract("NonConsumingConverterMock", [
        virtual.target,      // virtualToken() - matches baseToken, passes that check
        worthlessToken.target, // agVirtToken() - a token the attacker fully controls
      ]);
      await worthlessToken.transfer(maliciousConverter.target, parseEther("1000"));

      await expect(
        veVirtual.setAgVirtConverter(maliciousConverter.target)
      ).to.be.revertedWith("Payout token mismatch");

      // agVirtConverter and agVirtToken are both untouched - the malicious converter was
      // never wired in.
      expect(await veVirtual.agVirtConverter()).to.equal(converter.target);
      expect(await veVirtual.agVirtToken()).to.equal(agVirt.target);
    });

    it("should allow the FIRST wiring to pin any payout token (no prior value to conflict with)", async function () {
      const freshVeVirtual = await upgrades.deployProxy(
        await ethers.getContractFactory("veVirtual"),
        [virtual.target, 104],
      );
      expect(await freshVeVirtual.agVirtToken()).to.equal(ethers.ZeroAddress);

      await expect(
        freshVeVirtual.setAgVirtConverter(converter.target)
      ).to.not.be.reverted;
      expect(await freshVeVirtual.agVirtToken()).to.equal(agVirt.target);
    });

    it("should allow repointing to a DIFFERENT converter that pays out the SAME already-pinned token", async function () {
      await veVirtual.setAgVirtConverter(converter.target); // pins agVirtToken = agVirt.target

      const secondConverter = await ethers.deployContract("NonConsumingConverterMock", [
        virtual.target,
        agVirt.target, // same payout token as the first converter
      ]);
      await agVirt.mint(secondConverter.target, parseEther("1000"));

      await expect(
        veVirtual.setAgVirtConverter(secondConverter.target)
      ).to.not.be.reverted;
      expect(await veVirtual.agVirtConverter()).to.equal(secondConverter.target);
      expect(await veVirtual.agVirtToken()).to.equal(agVirt.target);
    });
  });
});
