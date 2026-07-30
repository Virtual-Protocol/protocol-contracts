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

/** Flags + trailing recipient: abi.encode(uint256 flags, bytes32 recipient). */
function encodeFlagsWithRecipient(opts, recipient32) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes32"],
    [buildFlags(opts), recipient32]
  );
}

/** Recipient as a right-aligned integer in bytes32, matching the contract wire. */
function addressToRecipient32(addr) {
  return ethers.zeroPadValue(addr, 32); // uint160, right-aligned
}
function twitterIdToRecipient32(id) {
  return ethers.toBeHex(BigInt(id), 32); // uint64, right-aligned
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
    expect(await bondingV5.feeDelegationRecipient(tokenAddress)).to.equal(
      ethers.ZeroHash
    );
  });

  it("keeps legacy abi.encode(bool) working with new fields defaulted", async function () {
    const { bondingV5 } = contracts;
    const { tokenAddress } = await preLaunchWithExtParams(encodeLegacyBool(true));

    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(true);
    expect(await bondingV5.isRobotics(tokenAddress)).to.equal(false);
    expect(await bondingV5.feeDelegationType(tokenAddress)).to.equal(0);
    expect(await bondingV5.feeDelegationRecipient(tokenAddress)).to.equal(
      ethers.ZeroHash
    );
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
    // Address stored as a right-aligned uint160 in bytes32.
    const recipient32 = addressToRecipient32(recipient);

    const extParams = encodeFlagsWithRecipient(
      { isFeeDelegation: true, feeDelegationType: FEE_DELEGATION_TYPE_ADDRESS },
      recipient32
    );
    const { tokenAddress } = await preLaunchWithExtParams(extParams);

    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(true);
    expect(await bondingV5.feeDelegationType(tokenAddress)).to.equal(
      FEE_DELEGATION_TYPE_ADDRESS
    );
    const stored = await bondingV5.feeDelegationRecipient(tokenAddress);
    expect(stored).to.equal(recipient32);
    // The address is recoverable from the low 20 bytes.
    expect(ethers.getAddress(ethers.dataSlice(stored, 12, 32))).to.equal(recipient);
  });

  it("stores twitter id as a right-aligned uint64 recipient", async function () {
    const { bondingV5 } = contracts;
    const twitterId = "1234567890";
    const recipient32 = twitterIdToRecipient32(twitterId);

    const extParams = encodeFlagsWithRecipient(
      { isFeeDelegation: true, feeDelegationType: FEE_DELEGATION_TYPE_TWITTER },
      recipient32
    );
    const { tokenAddress } = await preLaunchWithExtParams(extParams);

    expect(await bondingV5.feeDelegationType(tokenAddress)).to.equal(
      FEE_DELEGATION_TYPE_TWITTER
    );
    const stored = await bondingV5.feeDelegationRecipient(tokenAddress);
    expect(stored).to.equal(recipient32);
    // The numeric id is recovered by reading the word as an integer.
    expect(BigInt(stored).toString()).to.equal(twitterId);
  });

  it("emits PreLaunchExtParams with the decoded settings", async function () {
    const { bondingV5, virtualToken } = contracts;
    const recipient32 = twitterIdToRecipient32("42");
    const extParams = encodeFlagsWithRecipient(
      {
        isFeeDelegation: true,
        isRobotics: true,
        feeDelegationType: FEE_DELEGATION_TYPE_TWITTER,
      },
      recipient32
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
        recipient32
      );
  });
});
