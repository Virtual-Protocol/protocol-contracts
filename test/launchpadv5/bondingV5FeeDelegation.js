/**
 * BondingV5 `extParams` validation and isFeeDelegation decoding.
 *
 * extParams layout (strict length whitelist):
 *   V0 — empty (0 bytes)    : all fields default, isFeeDelegation = false
 *   V1 — 32 bytes           : abi.encode(bool isFeeDelegation)
 *   Any other length or non-canonical bool word → revert InvalidInput
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { START_TIME_DELAY } = require("../launchpadv2/const.js");
const { setupV2V3TaxComparisonTest } = require("./bondingV5Tax.fixture.js");

const LAUNCH_MODE_NORMAL = 0;
const ANTI_SNIPER_60S = 1;

/** Canonical ABI-encoded bool word (32 bytes). */
function encodeFeeDelegationFlag(isFeeDelegation) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [isFeeDelegation]);
}

async function feeDelegationFixture() {
  return setupV2V3TaxComparisonTest({ includeBondingV4: false });
}

describe("BondingV5 extParams — validation and isFeeDelegation", function () {
  let contracts;
  /** @type {import('ethers').Signer} */
  let owner;
  /** @type {import('ethers').Signer} */
  let user2;

  before(async function () {
    const setup = await loadFixture(feeDelegationFixture);
    contracts = setup.contracts;
    owner = setup.accounts.owner;
    user2 = setup.accounts.user2;
  });

  async function preLaunchWithExtParams(extParamsHex) {
    const { bondingV5, virtualToken, fFactoryV3 } = contracts;

    await virtualToken
      .connect(user2)
      .approve(await bondingV5.getAddress(), ethers.MaxUint256);

    const purchaseAmount = ethers.parseEther("1000");
    const startTime = (await time.latest()) + START_TIME_DELAY + 1;

    const tx = await bondingV5.connect(user2).preLaunch(
      "FeeDel Token",
      "FDEL",
      [0, 1, 2],
      "desc",
      "https://example.com/i.png",
      ["", "", "", ""],
      purchaseAmount,
      startTime,
      LAUNCH_MODE_NORMAL,
      0,
      false,
      ANTI_SNIPER_60S,
      false,
      extParamsHex
    );

    const receipt = await tx.wait();
    const event = receipt.logs.find((log) => {
      try {
        return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
      } catch {
        return false;
      }
    });
    const tokenAddress = bondingV5.interface.parseLog(event).args.token;
    const pairAddress = await fFactoryV3.getPair(
      tokenAddress,
      await virtualToken.getAddress()
    );

    return { tokenAddress, pairAddress, startTime };
  }

  async function expectPreLaunchRevert(extParamsHex) {
    const { bondingV5, virtualToken } = contracts;

    await virtualToken
      .connect(user2)
      .approve(await bondingV5.getAddress(), ethers.MaxUint256);

    const purchaseAmount = ethers.parseEther("1000");
    const startTime = (await time.latest()) + START_TIME_DELAY + 1;

    return expect(
      bondingV5.connect(user2).preLaunch(
        "Bad Token",
        "BAD",
        [0],
        "desc",
        "https://example.com/i.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        0,
        false,
        ANTI_SNIPER_60S,
        false,
        extParamsHex
      )
    ).to.be.revertedWithCustomError(bondingV5, "InvalidInput");
  }

  // ─── Valid extParams (V0 and V1) ─────────────────────────────────────────

  describe("Valid extParams", function () {
    it("V0: empty extParams → isFeeDelegation false", async function () {
      const { bondingV5 } = contracts;
      const { tokenAddress } = await preLaunchWithExtParams("0x");
      expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(false);
    });

    it("V1: abi.encode(false) → isFeeDelegation false", async function () {
      const { bondingV5 } = contracts;
      const { tokenAddress } = await preLaunchWithExtParams(
        encodeFeeDelegationFlag(false)
      );
      expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(false);
    });

    it("V1: abi.encode(true) → isFeeDelegation true", async function () {
      const { bondingV5 } = contracts;
      const { tokenAddress } = await preLaunchWithExtParams(
        encodeFeeDelegationFlag(true)
      );
      expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(true);
    });

    it("V1: raw extParams bytes are stored verbatim in tokenPreLaunchExtParams", async function () {
      const { bondingV5 } = contracts;
      const extParams = encodeFeeDelegationFlag(true);
      const { tokenAddress } = await preLaunchWithExtParams(extParams);
      expect(await bondingV5.tokenPreLaunchExtParams(tokenAddress)).to.equal(
        extParams
      );
    });
  });

  // ─── Invalid extParams — non-ABI-aligned lengths ─────────────────────────

  describe("Invalid extParams — non-aligned length", function () {
    it("1 byte → revert InvalidInput", async function () {
      await expectPreLaunchRevert(ethers.hexlify(new Uint8Array([0x01])));
    });

    it("31 bytes → revert InvalidInput", async function () {
      await expectPreLaunchRevert(
        ethers.hexlify(new Uint8Array(31).fill(0x00))
      );
    });

    it("33 bytes (32-byte word + 1 stray byte) → revert InvalidInput", async function () {
      const word = ethers.zeroPadValue(ethers.toBeHex(1), 32); // valid bool true
      const extra = "01";
      await expectPreLaunchRevert(word + extra);
    });
  });

  // ─── Invalid extParams — non-canonical bool word ──────────────────────────

  describe("Invalid extParams — non-canonical first word", function () {
    it("value 2 (one above bool range) → revert InvalidInput", async function () {
      await expectPreLaunchRevert(ethers.zeroPadValue(ethers.toBeHex(2), 32));
    });

    it("value 255 (0xff) → revert InvalidInput", async function () {
      await expectPreLaunchRevert(ethers.zeroPadValue(ethers.toBeHex(255), 32));
    });

    it("MAX_UINT256 → revert InvalidInput", async function () {
      await expectPreLaunchRevert(ethers.zeroPadValue(ethers.toBeHex(ethers.MaxUint256), 32));
    });

    it("ASCII-encoded hex string '0x000...' (observed attack payload) → revert InvalidInput", async function () {
      // Reproduces the exact attack: caller passes UTF-8 bytes of "0x" + "0"*30
      // instead of a canonical ABI-encoded bool. First byte is 0x30 ('0'), not 0x00.
      const attackBytes = ethers.toUtf8Bytes("0x" + "0".repeat(30));
      await expectPreLaunchRevert(ethers.hexlify(attackBytes));
    });
  });

  // ─── Invalid extParams — unknown version length ───────────────────────────

  describe("Invalid extParams — unknown version (length > 32)", function () {
    it("64 bytes (V2 not yet defined) → revert InvalidInput", async function () {
      const word0 = ethers.zeroPadValue(ethers.toBeHex(1), 32); // valid bool true
      const word1 = ethers.zeroPadValue(ethers.toBeHex(0), 32); // placeholder second word
      await expectPreLaunchRevert(word0 + word1.slice(2)); // concat without 0x prefix
    });

    it("96 bytes (V3 not yet defined) → revert InvalidInput", async function () {
      const word = ethers.zeroPadValue(ethers.toBeHex(0), 32);
      await expectPreLaunchRevert(word + word.slice(2) + word.slice(2));
    });
  });

  // ─── Post-launch state persistence ───────────────────────────────────────

  describe("isFeeDelegation state after launch", function () {
    it("isFeeDelegation true survives launch when caller is privileged", async function () {
      const { bondingV5, bondingConfig } = contracts;

      const extParams = encodeFeeDelegationFlag(true);
      const { tokenAddress, startTime } = await preLaunchWithExtParams(extParams);

      expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(true);

      await bondingConfig.connect(owner).setPrivilegedLauncher(user2.address, true);
      await time.increaseTo(startTime + 1);
      await bondingV5.connect(user2).launch(tokenAddress);

      expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(true);

      await bondingConfig.connect(owner).setPrivilegedLauncher(user2.address, false);
    });

    it("launch reverts for fee-delegation token when caller is not privileged", async function () {
      const { bondingV5, bondingConfig } = contracts;

      await bondingConfig.connect(owner).setPrivilegedLauncher(user2.address, false);

      const extParams = encodeFeeDelegationFlag(true);
      const { tokenAddress, startTime } = await preLaunchWithExtParams(extParams);

      await time.increaseTo(startTime + 1);

      await expect(
        bondingV5.connect(user2).launch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV5, "UnauthorizedLauncher");
    });
  });
});
