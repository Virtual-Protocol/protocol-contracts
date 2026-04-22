/**
 * BondingV5 `extParams` V1 encodes optional `abi.encode(bool isFeeDelegation)` (same flag the app calls fee delegation).
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

/** @returns {Promise<string>} hex `extParams` with first word = canonical ABI-encoded bool */
function encodeFeeDelegationFlag(isFeeDelegation) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [isFeeDelegation]);
}

async function feeDelegationFixture() {
  return setupV2V3TaxComparisonTest({ includeBondingV4: false });
}

describe("BondingV5 extParams — isFeeDelegation (fee delegation)", function () {
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

  it("Should store isFeeDelegation true when extParams encodes bool true", async function () {
    const { bondingV5 } = contracts;

    const extParams = encodeFeeDelegationFlag(true);
    const { tokenAddress } = await preLaunchWithExtParams(extParams);

    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(true);
  });

  it("Should store isFeeDelegation false when extParams is empty", async function () {
    const { bondingV5 } = contracts;

    const { tokenAddress } = await preLaunchWithExtParams("0x");

    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(false);
  });

  it("Should store isFeeDelegation false when extParams encodes bool false", async function () {
    const { bondingV5 } = contracts;

    const extParams = encodeFeeDelegationFlag(false);
    const { tokenAddress } = await preLaunchWithExtParams(extParams);

    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(false);
  });

  it("Should treat non-canonical bool word as false", async function () {
    const { bondingV5 } = contracts;

    const badWord = ethers.zeroPadValue(ethers.toBeHex(2), 32);
    const extParams = ethers.hexlify(badWord);

    const { tokenAddress } = await preLaunchWithExtParams(extParams);

    expect(await bondingV5.isFeeDelegation(tokenAddress)).to.equal(false);
  });

  it("Should still read isFeeDelegation true after launch when caller is privileged", async function () {
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

  it("Should revert launch for fee-delegation token when caller is not privileged", async function () {
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
