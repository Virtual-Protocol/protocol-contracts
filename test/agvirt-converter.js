/*
Test AgVirtConverter: an open, permissionless 1:1 VIRTUAL -> agVirt converter.
Also verifies the UUPS upgrade path round-trips cleanly (upgrade forward, verify new code
is live, upgrade back, confirm final bytecode matches the original).
*/
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { parseEther } = ethers;

describe("AgVirtConverter", function () {
  let virtual, agVirt, converter;
  let deployer, user, other, treasury;

  before(async function () {
    [deployer, user, other, treasury] = await ethers.getSigners();
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

    const Converter = await ethers.getContractFactory("AgVirtConverter");
    converter = await upgrades.deployProxy(Converter, [
      virtual.target,
      agVirt.target,
      treasury.address,
    ]);

    // Pre-fund the converter with agVirt liquidity for these tests (production pre-funds
    // the full 1B supply, but a smaller amount here leaves deployer enough spare VIRTUAL
    // balance to fully drain it in the "insufficient liquidity" test below).
    await agVirt.transfer(converter.target, parseEther("10000"));

    await virtual.transfer(user.address, parseEther("1000"));
    await virtual.connect(user).approve(converter.target, parseEther("1000"));
  });

  describe("convertVirtualToAgVirt", function () {
    it("should convert at a flat 1:1 rate for any caller", async function () {
      await expect(
        converter.connect(user).convertVirtualToAgVirt(parseEther("100"), user.address)
      )
        .to.emit(converter, "ConvertedVirtualToAgVirt")
        .withArgs(user.address, user.address, parseEther("100"));

      expect(await virtual.balanceOf(user.address)).to.be.equal(parseEther("900"));
      // Incoming VIRTUAL is routed straight to the treasury (L-02 fix) - the converter
      // itself never custodies any VIRTUAL.
      expect(await virtual.balanceOf(converter.target)).to.be.equal(0);
      expect(await virtual.balanceOf(treasury.address)).to.be.equal(parseEther("100"));
      expect(await agVirt.balanceOf(user.address)).to.be.equal(parseEther("100"));
    });

    it("should allow sending the agVirt to a different receiver than the caller", async function () {
      await converter
        .connect(user)
        .convertVirtualToAgVirt(parseEther("100"), other.address);

      expect(await agVirt.balanceOf(other.address)).to.be.equal(parseEther("100"));
      expect(await agVirt.balanceOf(user.address)).to.be.equal(0);
    });

    it("should be fully open - no allowlist, no cap", async function () {
      // Large relative to a normal user conversion, but within the test pool's pre-funded
      // agVirt liquidity (10000) - the point here is the absence of any allowlist/cap
      // check, not exercising the liquidity limit (covered separately below).
      await virtual.transfer(other.address, parseEther("5000"));
      await virtual.connect(other).approve(converter.target, parseEther("5000"));

      await expect(
        converter.connect(other).convertVirtualToAgVirt(parseEther("5000"), other.address)
      ).to.not.be.reverted;
      expect(await agVirt.balanceOf(other.address)).to.be.equal(parseEther("5000"));
    });

    it("should revert without prior VIRTUAL approval", async function () {
      await virtual.connect(user).approve(converter.target, 0);
      await expect(
        converter.connect(user).convertVirtualToAgVirt(parseEther("100"), user.address)
      ).to.be.reverted;
    });

    it("should revert if the converter has insufficient agVirt liquidity", async function () {
      // Drain the pre-funded agVirt balance first.
      const drained = await agVirt.balanceOf(converter.target);
      // Impersonate is unnecessary - just have deployer pull it out via a huge legit conversion
      // from a funded wallet to exhaust the pool, then attempt one more.
      await virtual.transfer(other.address, drained);
      await virtual.connect(other).approve(converter.target, drained);
      await converter.connect(other).convertVirtualToAgVirt(drained, other.address);

      expect(await agVirt.balanceOf(converter.target)).to.be.equal(0);

      await expect(
        converter.connect(user).convertVirtualToAgVirt(parseEther("100"), user.address)
      ).to.be.reverted;
    });

    it("should reject a zero receiver address", async function () {
      await expect(
        converter.connect(user).convertVirtualToAgVirt(parseEther("100"), ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid receiver");
    });

    it("should reject a zero amount", async function () {
      await expect(
        converter.connect(user).convertVirtualToAgVirt(0, user.address)
      ).to.be.revertedWith("Amount must be greater than 0");
    });
  });

  describe("delivery verification (M-01 fix)", function () {
    let taxedAgVirt, taxedConverter;

    beforeEach(async function () {
      // 10% fee-on-transfer token standing in for a taxed agVirt configuration.
      taxedAgVirt = await ethers.deployContract("FeeOnTransferMock", [
        "agVirt",
        "agVIRT",
        deployer.address,
        parseEther("1000000000"),
        1000, // 10% fee
        other.address, // fee sink
      ]);

      const Converter = await ethers.getContractFactory("AgVirtConverter");
      taxedConverter = await upgrades.deployProxy(Converter, [
        virtual.target,
        taxedAgVirt.target,
        treasury.address,
      ]);
      await taxedAgVirt.transfer(taxedConverter.target, parseEther("10000"));

      await virtual.connect(user).approve(taxedConverter.target, parseEther("1000"));
    });

    it("should revert the whole conversion instead of silently under-delivering", async function () {
      await expect(
        taxedConverter.connect(user).convertVirtualToAgVirt(parseEther("100"), user.address)
      ).to.be.revertedWith("agVirt delivery mismatch");

      // Both legs must have unwound - caller keeps their VIRTUAL, receives no agVirt.
      expect(await virtual.balanceOf(user.address)).to.be.equal(parseEther("1000"));
      expect(await taxedAgVirt.balanceOf(user.address)).to.be.equal(0);
    });

    it("should still succeed and emit the exact delivered amount for a non-taxed token", async function () {
      await expect(
        converter.connect(user).convertVirtualToAgVirt(parseEther("100"), user.address)
      )
        .to.emit(converter, "ConvertedVirtualToAgVirt")
        .withArgs(user.address, user.address, parseEther("100"));

      expect(await agVirt.balanceOf(user.address)).to.be.equal(parseEther("100"));
    });
  });

  describe("treasury routing (L-02 fix)", function () {
    it("should reject a zero-address treasury at initialize", async function () {
      const Converter = await ethers.getContractFactory("AgVirtConverter");
      await expect(
        upgrades.deployProxy(Converter, [
          virtual.target,
          agVirt.target,
          ethers.ZeroAddress,
        ])
      ).to.be.revertedWith("Invalid treasury");
    });

    it("should reject virtualToken and agVirtToken being the same address (L-09 fix)", async function () {
      const Converter = await ethers.getContractFactory("AgVirtConverter");
      await expect(
        upgrades.deployProxy(Converter, [
          virtual.target,
          virtual.target,
          treasury.address,
        ])
      ).to.be.revertedWith("Tokens must differ");
    });

    it("should route every conversion's incoming VIRTUAL straight to treasury, never the converter", async function () {
      await converter.connect(user).convertVirtualToAgVirt(parseEther("30"), user.address);
      await converter.connect(user).convertVirtualToAgVirt(parseEther("20"), other.address);

      expect(await virtual.balanceOf(treasury.address)).to.be.equal(parseEther("50"));
      expect(await virtual.balanceOf(converter.target)).to.be.equal(0);
    });
  });

  describe("decimals equivalence check (audit I-03 fix)", function () {
    it("should reject initialize() when virtualToken and agVirtToken have different decimals", async function () {
      const sixDecimalToken = await ethers.deployContract("MockERC20SixDecimals", [
        "USDC-like", "SIX", deployer.address, parseEther("1000000"),
      ]);

      const Converter = await ethers.getContractFactory("AgVirtConverter");
      await expect(
        upgrades.deployProxy(Converter, [
          virtual.target,
          sixDecimalToken.target,
          treasury.address,
        ])
      ).to.be.revertedWith("Decimals mismatch");
    });

    it("should still deploy normally when both tokens use 18 decimals", async function () {
      // converter (from beforeEach) already deployed successfully with virtual/agVirt,
      // both 18 decimals - this just documents that the new check doesn't false-positive
      // on the intended pair.
      expect(await converter.virtualToken()).to.equal(virtual.target);
      expect(await converter.agVirtToken()).to.equal(agVirt.target);
    });
  });

  it("should provide no VIRTUAL/agVirt sweep mechanism at all (I-06 fix)", async function () {
    // withdrawVirtual()/adminWallet/setAdminWallet were removed entirely once L-02's
    // treasury routing made them unnecessary - VIRTUAL is never custodied by this
    // contract, so there is nothing left for an admin-controlled sweep to reach.
    expect(converter.withdrawVirtual).to.be.undefined;
    expect(converter.setAdminWallet).to.be.undefined;
    expect(converter.adminWallet).to.be.undefined;
    expect(converter.withdrawAgVirt).to.be.undefined;
    expect(converter.rescueToken).to.be.undefined;
    expect(converter.recoverToken).to.be.undefined;
  });

  describe("_disableInitializers on implementation (L-12 fix)", function () {
    it("should reject calling initialize() directly on the raw implementation contract", async function () {
      const implAddress = await upgrades.erc1967.getImplementationAddress(converter.target);
      const implementation = await ethers.getContractAt("AgVirtConverter", implAddress);

      await expect(
        implementation.initialize(virtual.target, agVirt.target, treasury.address)
      ).to.be.reverted;
    });
  });

  describe("UUPS upgradeability", function () {
    it("should upgrade to V2, run new code, upgrade back to V1, and end up with identical bytecode", async function () {
      const implBefore = await upgrades.erc1967.getImplementationAddress(converter.target);
      const codeBefore = await ethers.provider.getCode(implBefore);
      expect(codeBefore).to.not.equal("0x");

      // Upgrade forward to V2. AgVirtConverterV2Mock adds no new storage or initializer -
      // it only appends a function/event - so the plugin's "missing initializer" heuristic
      // (which fires for any child contract without its own initialize()) is a false
      // positive here and safe to bypass.
      const V2 = await ethers.getContractFactory("AgVirtConverterV2Mock");
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
      expect(await upgraded.agVirtToken()).to.be.equal(agVirt.target);
      await expect(
        upgraded.connect(user).convertVirtualToAgVirt(parseEther("50"), user.address)
      ).to.emit(upgraded, "ConvertedVirtualToAgVirt");

      // Upgrade back to V1.
      const V1 = await ethers.getContractFactory("AgVirtConverter");
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
        backToV1.connect(user).convertVirtualToAgVirt(parseEther("50"), user.address)
      ).to.emit(backToV1, "ConvertedVirtualToAgVirt");
    });

    it("should reject upgrade attempts from non-admin accounts", async function () {
      const V2 = await ethers.getContractFactory("AgVirtConverterV2Mock", user);
      await expect(
        upgrades.upgradeProxy(converter.target, V2, {
          unsafeAllow: ["missing-initializer"],
        })
      ).to.be.reverted;
    });
  });
});
