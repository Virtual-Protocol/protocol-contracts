/**
 * BondingV5-only tax tests (no BondingV4 / legacy V2 curve).
 * Fixture deploys BondingV5 + AgentTaxV2; BondingV4 is not deployed.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { START_TIME_DELAY, BUY_TAX } = require("../launchpadv2/const.js");

const { setupV2V3TaxComparisonTest } = require("./bondingV5Tax.fixture.js");

const LAUNCH_MODE_NORMAL = 0;
const ANTI_SNIPER_60S = 1;

async function bondingV5TaxFixture() {
  return setupV2V3TaxComparisonTest({ includeBondingV4: false });
}

describe("BondingV5 tax flow (AgentTaxV2)", function () {
  let contracts, accounts;
  /** BondingV5-launched agent token + pair */
  let tokenAddress, pairAddress;

  before(async function () {
    const setup = await loadFixture(bondingV5TaxFixture);
    contracts = setup.contracts;
    accounts = setup.accounts;
  });

  describe("AgentFactoryV7 + BondingV5 preLaunch → launch", function () {
    it("Should use AgentFactoryV7 with AgentTokenV4 implementation for BondingV5", async function () {
      const { agentFactoryV7, agentTokenV4Impl } = contracts;

      expect(await agentFactoryV7.tokenImplementation()).to.equal(
        await agentTokenV4Impl.getAddress()
      );
    });

    it("Should create AgentTokenV4 via BondingV5 preLaunch + launch", async function () {
      const { bondingV5, virtualToken, fFactoryV3, fRouterV3, agentTax } =
        contracts;
      const { user2 } = accounts;

      await virtualToken
        .connect(user2)
        .approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken
        .connect(user2)
        .approve(await fRouterV3.getAddress(), ethers.MaxUint256);

      const purchaseAmount = ethers.parseEther("1000");
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      const tx = await bondingV5.connect(user2).preLaunch(
        "BondingV5 Tax Token",
        "BV5TX",
        [0, 1, 2],
        "BondingV5 AgentTax integration",
        "https://example.com/v5.png",
        ["https://twitter.com/x", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        0,
        false,
        ANTI_SNIPER_60S,
        false,
        "0x"
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      tokenAddress = bondingV5.interface.parseLog(event).args.token;
      pairAddress = await fFactoryV3.getPair(
        tokenAddress,
        await virtualToken.getAddress()
      );

      expect(tokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(pairAddress).to.not.equal(ethers.ZeroAddress);

      const tokenRegisteredEvent = receipt.logs.find((log) => {
        try {
          return agentTax.interface.parseLog(log)?.name === "TokenRegistered";
        } catch (e) {
          return false;
        }
      });
      expect(tokenRegisteredEvent).to.not.be.undefined;

      const recipient = await agentTax.tokenRecipients(tokenAddress);
      expect(recipient.creator).to.equal(user2.address);

      await time.increaseTo(startTime + 1);
      await bondingV5.launch(tokenAddress);

      console.log("BondingV5 token:", tokenAddress);
      console.log("Pair:", pairAddress);
    });
  });

  describe("BUY / SELL tax attribution on-chain", function () {
    it("BUY: Should emit TaxDeposited and record tokenTaxAmounts", async function () {
      const { bondingV5, virtualToken, fRouterV3, agentTax } = contracts;
      const { user1 } = accounts;

      await virtualToken
        .connect(user1)
        .approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken
        .connect(user1)
        .approve(await fRouterV3.getAddress(), ethers.MaxUint256);

      const buyAmount = ethers.parseEther("500");
      const expectedTax = (buyAmount * BigInt(BUY_TAX)) / 100n;

      const taxBefore = await agentTax.tokenTaxAmounts(tokenAddress);

      const tx = await bondingV5
        .connect(user1)
        .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      const taxDepositedEvent = receipt.logs.find((log) => {
        try {
          return agentTax.interface.parseLog(log)?.name === "TaxDeposited";
        } catch (e) {
          return false;
        }
      });

      expect(taxDepositedEvent).to.not.be.undefined;
      const parsedEvent = agentTax.interface.parseLog(taxDepositedEvent);
      expect(parsedEvent.args.tokenAddress).to.equal(tokenAddress);
      expect(parsedEvent.args.amount).to.equal(expectedTax);

      const taxAfter = await agentTax.tokenTaxAmounts(tokenAddress);
      expect(taxAfter.amountCollected).to.equal(
        taxBefore.amountCollected + expectedTax
      );

      console.log(
        "BUY TaxDeposited:",
        ethers.formatEther(parsedEvent.args.amount)
      );
      console.log(
        "tokenTaxAmounts.amountCollected:",
        ethers.formatEther(taxAfter.amountCollected)
      );
    });

    it("SELL: Should emit TaxDeposited and record tokenTaxAmounts", async function () {
      const { bondingV5, virtualToken, fRouterV3, agentTax } = contracts;
      const { user1 } = accounts;

      await virtualToken
        .connect(user1)
        .approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken
        .connect(user1)
        .approve(await fRouterV3.getAddress(), ethers.MaxUint256);
      await bondingV5
        .connect(user1)
        .buy(ethers.parseEther("1000"), tokenAddress, 0, (await time.latest()) + 300);

      const agentToken = await ethers.getContractAt("AgentTokenV4", tokenAddress);
      const tokenBalance = await agentToken.balanceOf(user1.address);
      await agentToken
        .connect(user1)
        .approve(await bondingV5.getAddress(), tokenBalance);
      await agentToken
        .connect(user1)
        .approve(await fRouterV3.getAddress(), tokenBalance);

      const taxBefore = await agentTax.tokenTaxAmounts(tokenAddress);
      const sellAmount = tokenBalance / 2n;

      const tx = await bondingV5
        .connect(user1)
        .sell(sellAmount, tokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      const taxDepositedEvent = receipt.logs.find((log) => {
        try {
          return agentTax.interface.parseLog(log)?.name === "TaxDeposited";
        } catch (e) {
          return false;
        }
      });

      expect(taxDepositedEvent).to.not.be.undefined;
      const parsedEvent = agentTax.interface.parseLog(taxDepositedEvent);
      expect(parsedEvent.args.tokenAddress).to.equal(tokenAddress);
      expect(parsedEvent.args.amount).to.be.gt(0);

      const taxAfter = await agentTax.tokenTaxAmounts(tokenAddress);
      expect(taxAfter.amountCollected).to.be.gt(taxBefore.amountCollected);

      console.log(
        "SELL TaxDeposited:",
        ethers.formatEther(parsedEvent.args.amount)
      );
      console.log(
        "tokenTaxAmounts.amountCollected:",
        ethers.formatEther(taxAfter.amountCollected)
      );
    });

    it("Tax transfers from FRouterV3 should not match preTokenPair (tax-listener heuristic)", async function () {
      const { bondingV5, virtualToken, fRouterV3, agentTax } = contracts;
      const { user2 } = accounts;

      await virtualToken
        .connect(user2)
        .approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken
        .connect(user2)
        .approve(await fRouterV3.getAddress(), ethers.MaxUint256);

      const tx = await bondingV5
        .connect(user2)
        .buy(ethers.parseEther("100"), tokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      const agentTaxAddress = await agentTax.getAddress();
      const fRouterV3Address = await fRouterV3.getAddress();

      const transfersToTax = receipt.logs.filter((log) => {
        try {
          const parsed = virtualToken.interface.parseLog(log);
          return (
            parsed?.name === "Transfer" && parsed.args.to === agentTaxAddress
          );
        } catch (e) {
          return false;
        }
      });

      for (const log of transfersToTax) {
        const parsed = virtualToken.interface.parseLog(log);
        const fromAddress = parsed.args.from;
        const wouldTaxListenerProcess =
          fromAddress.toLowerCase() === pairAddress.toLowerCase();

        if (fromAddress.toLowerCase() === fRouterV3Address.toLowerCase()) {
          expect(wouldTaxListenerProcess).to.be.false;
          console.log(
            "Tax transfer from FRouterV3 — not classifiable as preTokenPair by from-address alone"
          );
        }
      }
    });
  });

  describe("Summary", function () {
    it("Should record positive on-chain tax for the BondingV5 token", async function () {
      const { agentTax } = contracts;

      const amounts = await agentTax.tokenTaxAmounts(tokenAddress);
      expect(amounts.amountCollected).to.be.gt(0n);

      const recipient = await agentTax.tokenRecipients(tokenAddress);
      expect(recipient.creator).to.not.equal(ethers.ZeroAddress);

      console.log("\n=== BondingV5 AgentTax summary ===");
      console.log("Token:", tokenAddress);
      console.log(
        "amountCollected:",
        ethers.formatEther(amounts.amountCollected),
        "VIRTUAL"
      );
      console.log("Creator:", recipient.creator);
    });
  });
});
