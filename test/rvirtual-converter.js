/*
Test RVirtualConverter: an open, permissionless 1:1 VIRTUAL -> rVirtual converter.
Also verifies the UUPS upgrade path round-trips cleanly (upgrade forward, verify new code
is live, upgrade back, confirm final bytecode matches the original).
*/
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { parseEther } = ethers;

describe("RVirtualConverter", function () {
  let virtual, rVirtual, converter;
  let deployer, user, other, adminWallet;

  before(async function () {
    [deployer, user, other, adminWallet] = await ethers.getSigners();
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

    const Converter = await ethers.getContractFactory("RVirtualConverter");
    converter = await upgrades.deployProxy(Converter, [
      virtual.target,
      rVirtual.target,
    ]);

    // Pre-fund the converter with rVirtual liquidity for these tests (production pre-funds
    // the full 1B supply, but a smaller amount here leaves deployer enough spare VIRTUAL
    // balance to fully drain it in the "insufficient liquidity" test below).
    await rVirtual.transfer(converter.target, parseEther("10000"));

    await virtual.transfer(user.address, parseEther("1000"));
    await virtual.connect(user).approve(converter.target, parseEther("1000"));
  });

  describe("convertVirtualToRVirtual", function () {
    it("should convert at a flat 1:1 rate for any caller", async function () {
      await expect(
        converter.connect(user).convertVirtualToRVirtual(parseEther("100"), user.address)
      )
        .to.emit(converter, "ConvertedVirtualToRVirtual")
        .withArgs(user.address, user.address, parseEther("100"));

      expect(await virtual.balanceOf(user.address)).to.be.equal(parseEther("900"));
      expect(await virtual.balanceOf(converter.target)).to.be.equal(parseEther("100"));
      expect(await rVirtual.balanceOf(user.address)).to.be.equal(parseEther("100"));
    });

    it("should allow sending the rVirtual to a different receiver than the caller", async function () {
      await converter
        .connect(user)
        .convertVirtualToRVirtual(parseEther("100"), other.address);

      expect(await rVirtual.balanceOf(other.address)).to.be.equal(parseEther("100"));
      expect(await rVirtual.balanceOf(user.address)).to.be.equal(0);
    });

    it("should be fully open - no allowlist, no cap", async function () {
      // Large relative to a normal user conversion, but within the test pool's pre-funded
      // rVirtual liquidity (10000) - the point here is the absence of any allowlist/cap
      // check, not exercising the liquidity limit (covered separately below).
      await virtual.transfer(other.address, parseEther("5000"));
      await virtual.connect(other).approve(converter.target, parseEther("5000"));

      await expect(
        converter.connect(other).convertVirtualToRVirtual(parseEther("5000"), other.address)
      ).to.not.be.reverted;
      expect(await rVirtual.balanceOf(other.address)).to.be.equal(parseEther("5000"));
    });

    it("should revert without prior VIRTUAL approval", async function () {
      await virtual.connect(user).approve(converter.target, 0);
      await expect(
        converter.connect(user).convertVirtualToRVirtual(parseEther("100"), user.address)
      ).to.be.reverted;
    });

    it("should revert if the converter has insufficient rVirtual liquidity", async function () {
      // Drain the pre-funded rVirtual balance first.
      const drained = await rVirtual.balanceOf(converter.target);
      // Impersonate is unnecessary - just have deployer pull it out via a huge legit conversion
      // from a funded wallet to exhaust the pool, then attempt one more.
      await virtual.transfer(other.address, drained);
      await virtual.connect(other).approve(converter.target, drained);
      await converter.connect(other).convertVirtualToRVirtual(drained, other.address);

      expect(await rVirtual.balanceOf(converter.target)).to.be.equal(0);

      await expect(
        converter.connect(user).convertVirtualToRVirtual(parseEther("100"), user.address)
      ).to.be.reverted;
    });

    it("should reject a zero receiver address", async function () {
      await expect(
        converter.connect(user).convertVirtualToRVirtual(parseEther("100"), ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid receiver");
    });

    it("should reject a zero amount", async function () {
      await expect(
        converter.connect(user).convertVirtualToRVirtual(0, user.address)
      ).to.be.revertedWith("Amount must be greater than 0");
    });
  });

  describe("withdrawVirtual", function () {
    beforeEach(async function () {
      await converter.setAdminWallet(adminWallet.address);
      await converter.connect(user).convertVirtualToRVirtual(parseEther("100"), user.address);
    });

    it("should allow only adminWallet to withdraw the accumulated VIRTUAL", async function () {
      await expect(
        converter.connect(adminWallet).withdrawVirtual(parseEther("100"))
      )
        .to.emit(converter, "VirtualWithdrawn")
        .withArgs(adminWallet.address, parseEther("100"));

      expect(await virtual.balanceOf(adminWallet.address)).to.be.equal(parseEther("100"));
      expect(await virtual.balanceOf(converter.target)).to.be.equal(0);
    });

    it("should allow withdrawing up to the full current balance, no reserve floor", async function () {
      const full = await virtual.balanceOf(converter.target);
      await expect(converter.connect(adminWallet).withdrawVirtual(full)).to.not.be.reverted;
      expect(await virtual.balanceOf(converter.target)).to.be.equal(0);
    });

    it("should reject withdrawal from anyone other than adminWallet", async function () {
      await expect(
        converter.connect(user).withdrawVirtual(parseEther("100"))
      ).to.be.revertedWith("Only admin wallet");
      await expect(
        converter.connect(deployer).withdrawVirtual(parseEther("100"))
      ).to.be.revertedWith("Only admin wallet");
    });

    it("should reject non-admin-role setting of adminWallet", async function () {
      await expect(
        converter.connect(user).setAdminWallet(other.address)
      ).to.be.reverted;
    });
  });

  it("should provide no path to withdraw rVirtual or any other token", async function () {
    // The contract intentionally only exposes withdrawVirtual() - there is no generic
    // rescue/withdraw function for rVirtual or arbitrary tokens.
    expect(converter.withdrawRVirtual).to.be.undefined;
    expect(converter.rescueToken).to.be.undefined;
    expect(converter.recoverToken).to.be.undefined;
  });

  describe("UUPS upgradeability", function () {
    it("should upgrade to V2, run new code, upgrade back to V1, and end up with identical bytecode", async function () {
      const implBefore = await upgrades.erc1967.getImplementationAddress(converter.target);
      const codeBefore = await ethers.provider.getCode(implBefore);
      expect(codeBefore).to.not.equal("0x");

      // Upgrade forward to V2. RVirtualConverterV2Mock adds no new storage or initializer -
      // it only appends a function/event - so the plugin's "missing initializer" heuristic
      // (which fires for any child contract without its own initialize()) is a false
      // positive here and safe to bypass.
      const V2 = await ethers.getContractFactory("RVirtualConverterV2Mock");
      const upgraded = await upgrades.upgradeProxy(converter.target, V2, {
        unsafeAllow: ["missing-initializer"],
      });

      const implAfterV2 = await upgrades.erc1967.getImplementationAddress(upgraded.target);
      expect(implAfterV2).to.not.equal(implBefore);

      // Prove the new code is actually live.
      await expect(upgraded.triggerV2Marker())
        .to.emit(upgraded, "V2UpgradeMarker")
        .withArgs("upgraded");

      // Existing state and functionality must survive the upgrade untouched.
      expect(await upgraded.virtualToken()).to.be.equal(virtual.target);
      expect(await upgraded.rVirtualToken()).to.be.equal(rVirtual.target);
      await expect(
        upgraded.connect(user).convertVirtualToRVirtual(parseEther("50"), user.address)
      ).to.emit(upgraded, "ConvertedVirtualToRVirtual");

      // Upgrade back to V1.
      const V1 = await ethers.getContractFactory("RVirtualConverter");
      const backToV1 = await upgrades.upgradeProxy(upgraded.target, V1);

      const implAfterRoundTrip = await upgrades.erc1967.getImplementationAddress(
        backToV1.target
      );
      const codeAfterRoundTrip = await ethers.provider.getCode(implAfterRoundTrip);

      // Final deployed code must match the original V1 bytecode exactly - the round trip
      // (V1 -> V2 -> V1) leaves the contract functionally and byte-for-byte identical to
      // where it started, even though the implementation address itself differs (each
      // upgrade deploys a fresh implementation contract).
      expect(codeAfterRoundTrip).to.be.equal(codeBefore);

      // V2-only function must no longer be part of the (V1) interface/ABI.
      expect(backToV1.triggerV2Marker).to.be.undefined;

      // Original functionality still works post-round-trip.
      expect(await backToV1.virtualToken()).to.be.equal(virtual.target);
      await expect(
        backToV1.connect(user).convertVirtualToRVirtual(parseEther("50"), user.address)
      ).to.emit(backToV1, "ConvertedVirtualToRVirtual");
    });

    it("should reject upgrade attempts from non-admin accounts", async function () {
      const V2 = await ethers.getContractFactory("RVirtualConverterV2Mock", user);
      await expect(
        upgrades.upgradeProxy(converter.target, V2, {
          unsafeAllow: ["missing-initializer"],
        })
      ).to.be.reverted;
    });
  });
});
