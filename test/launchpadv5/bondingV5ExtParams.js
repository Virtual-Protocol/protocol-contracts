/**
 * BondingV5 `extParams` v3: append-only, backward-compatible encoding that carries
 * isFeeDelegation (bit 0), skipSuffix (bit 1), isRobotics (bit 2),
 * feeDelegationType (bits 3-4) and an optional trailing feeDelegationRecipient.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const { START_TIME_DELAY } = require("../launchpadv2/const.js");
const { setupV2V3TaxComparisonTest } = require("./bondingV5Tax.fixture.js");

const LAUNCH_MODE_NORMAL = 0;
const ANTI_SNIPER_60S = 1;

const FLAG_FEE_DELEGATION = 1n;
const FLAG_SKIP_SUFFIX = 2n;
const FLAG_ROBOTICS = 4n;
const FEE_DELEGATION_TYPE_SHIFT = 3n;

const FEE_DELEGATION_TYPE_ADDRESS = 1;
const FEE_DELEGATION_TYPE_TWITTER = 2;

function buildFlags({
  isFeeDelegation = false,
  skipSuffix = false,
  isRobotics = false,
  feeDelegationType = 0,
} = {}) {
  let word = 0n;
  if (isFeeDelegation) word |= FLAG_FEE_DELEGATION;
  if (skipSuffix) word |= FLAG_SKIP_SUFFIX;
  if (isRobotics) word |= FLAG_ROBOTICS;
  word |= (BigInt(feeDelegationType) & 0x3n) << FEE_DELEGATION_TYPE_SHIFT;
  return word;
}

/** Flags-only payload (single word). */
function encodeFlags(opts) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [buildFlags(opts)]);
}

/** Flags + trailing recipient: abi.encode(uint256 flags, bytes recipient). */
function encodeFlagsWithRecipient(opts, recipientBytes) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes"],
    [buildFlags(opts), recipientBytes]
  );
}

/** Legacy V1 encoding: abi.encode(bool isFeeDelegation). */
function encodeLegacyBool(isFeeDelegation) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [isFeeDelegation]);
}

async function extParamsFixture() {
  return setupV2V3TaxComparisonTest({ includeBondingV4: false });
}

describe("BondingV5 extParams — v3 launch settings (robotics + fee delegation)", function () {
  let contracts;
  let user2;

  before(async function () {
    const setup = await loadFixture(extParamsFixture);
    contracts = setup.contracts;
    user2 = setup.accounts.user2;
  });

  async function preLaunchWithExtParams(extParamsHex) {
    const { bondingV5, virtualToken } = contracts;

    await virtualToken
      .connect(user2)
      .approve(await bondingV5.getAddress(), ethers.MaxUint256);

    const purchaseAmount = ethers.parseEther("1000");
    const startTime = (await time.latest()) + START_TIME_DELAY + 1;

    const tx = await bondingV5.connect(user2).preLaunch(
      "ExtParams Token",
      "EXT",
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

    return { tokenAddress, startTime };
  }

  it("defaults to all-off for empty extParams (backward compatible)", async function () {
    const { bondingV5 } = contracts;
    const { tokenAddress } = await preLaunchWithExtParams("0x");

    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(false);
    expect(await bondingV5.isRobotics(tokenAddress)).to.equal(false);
    expect(await bondingV5.feeDelegationType(tokenAddress)).to.equal(0);
    expect(await bondingV5.feeDelegationRecipient(tokenAddress)).to.equal("0x");
  });

  it("keeps legacy abi.encode(bool) working with new fields defaulted", async function () {
    const { bondingV5 } = contracts;
    const { tokenAddress } = await preLaunchWithExtParams(encodeLegacyBool(true));

    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(true);
    expect(await bondingV5.isRobotics(tokenAddress)).to.equal(false);
    expect(await bondingV5.feeDelegationType(tokenAddress)).to.equal(0);
    expect(await bondingV5.feeDelegationRecipient(tokenAddress)).to.equal("0x");
  });

  it("decodes isRobotics from bit 2", async function () {
    const { bondingV5 } = contracts;
    const { tokenAddress } = await preLaunchWithExtParams(
      encodeFlags({ isRobotics: true })
    );

    expect(await bondingV5.isRobotics(tokenAddress)).to.equal(true);
    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(false);
  });

  it("stores address-type fee delegation recipient", async function () {
    const { bondingV5 } = contracts;
    const recipient = ethers.getAddress(
      "0x00000000000000000000000000000000000000aa"
    );
    const recipientBytes = ethers.hexlify(ethers.getBytes(recipient));

    const extParams = encodeFlagsWithRecipient(
      { isFeeDelegation: true, feeDelegationType: FEE_DELEGATION_TYPE_ADDRESS },
      recipientBytes
    );
    const { tokenAddress } = await preLaunchWithExtParams(extParams);

    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(true);
    expect(await bondingV5.feeDelegationType(tokenAddress)).to.equal(
      FEE_DELEGATION_TYPE_ADDRESS
    );
    expect(await bondingV5.feeDelegationRecipient(tokenAddress)).to.equal(
      recipientBytes
    );
  });

  it("stores raw twitter id bytes as fee delegation recipient", async function () {
    const { bondingV5 } = contracts;
    const twitterId = "1234567890";
    const recipientBytes = ethers.hexlify(ethers.toUtf8Bytes(twitterId));

    const extParams = encodeFlagsWithRecipient(
      { isFeeDelegation: true, feeDelegationType: FEE_DELEGATION_TYPE_TWITTER },
      recipientBytes
    );
    const { tokenAddress } = await preLaunchWithExtParams(extParams);

    expect(await bondingV5.feeDelegationType(tokenAddress)).to.equal(
      FEE_DELEGATION_TYPE_TWITTER
    );
    expect(await bondingV5.feeDelegationRecipient(tokenAddress)).to.equal(
      recipientBytes
    );
    expect(ethers.toUtf8String(await bondingV5.feeDelegationRecipient(tokenAddress))).to.equal(
      twitterId
    );
  });

  it("emits PreLaunchExtParams with the decoded settings", async function () {
    const { bondingV5, virtualToken } = contracts;
    const recipientBytes = ethers.hexlify(ethers.toUtf8Bytes("42"));
    const extParams = encodeFlagsWithRecipient(
      {
        isFeeDelegation: true,
        isRobotics: true,
        feeDelegationType: FEE_DELEGATION_TYPE_TWITTER,
      },
      recipientBytes
    );

    await virtualToken
      .connect(user2)
      .approve(await bondingV5.getAddress(), ethers.MaxUint256);
    const purchaseAmount = ethers.parseEther("1000");
    const startTime = (await time.latest()) + START_TIME_DELAY + 1;

    await expect(
      bondingV5
        .connect(user2)
        .preLaunch(
          "ExtParams Token",
          "EXT",
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
          extParams
        )
    )
      .to.emit(bondingV5, "PreLaunchExtParams")
      .withArgs(
        anyValue,
        true,
        true,
        FEE_DELEGATION_TYPE_TWITTER,
        recipientBytes
      );
  });
});
