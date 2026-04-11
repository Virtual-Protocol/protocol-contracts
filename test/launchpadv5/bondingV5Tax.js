const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const {
  START_TIME_DELAY,
  INITIAL_SUPPLY,
  TBA_SALT,
  TBA_IMPLEMENTATION,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,
  BUY_TAX,
  SELL_TAX,
  ANTI_SNIPER_BUY_TAX_START_VALUE,
  FFactoryV2_TAX_VAULT,
  FFactoryV2_ANTI_SNIPER_TAX_VAULT,
  ASSET_RATE,
  GRAD_THRESHOLD,
  MAX_TX,
} = require("../launchpadv2/const.js");

const { setupV2V3TaxComparisonTest } = require("./bondingV5Tax.fixture.js");

// BondingV4 launch mode constants
const LAUNCH_MODE_NORMAL_V4 = 0;

// BondingV5 launch mode constants
const LAUNCH_MODE_NORMAL = 0;

// Anti-sniper tax type constants
const ANTI_SNIPER_NONE = 0;
const ANTI_SNIPER_60S = 1;

// Reserve supply parameters
const MAX_AIRDROP_BIPS = 500;
const MAX_TOTAL_RESERVED_BIPS = 5500;
const ACF_RESERVED_BIPS = 5000;

// Fee structure
const NORMAL_LAUNCH_FEE = ethers.parseEther("100");
const ACF_FEE = ethers.parseEther("10");

// Bonding curve params
const FAKE_INITIAL_VIRTUAL_LIQ = ethers.parseEther("6300");
const TARGET_REAL_VIRTUAL = ethers.parseEther("42000");

describe("V2 vs V3 Tax Attribution Comparison", function () {
  let setup;
  let contracts, accounts;
  let v2TokenAddress, v2PairAddress;
  let v3TokenAddress, v3PairAddress;

  before(async function () {
    setup = await loadFixture(setupV2V3TaxComparisonTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
  });

  describe("Phase 1: Create V2 Token via BondingV4", function () {
    it("Should create V2 token with AgentTokenV2 implementation", async function () {
      const { bondingV4, virtualToken, fFactoryV2, fRouterV2, agentFactoryV6 } = contracts;
      const { user1 } = accounts;

      // Verify AgentFactoryV6 is using V2 implementation
      const currentImpl = await agentFactoryV6.tokenImplementation();
      expect(currentImpl).to.equal(await contracts.agentTokenV2Impl.getAddress());

      // Approve tokens
      await virtualToken.connect(user1).approve(await bondingV4.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user1).approve(await fRouterV2.getAddress(), ethers.MaxUint256);

      const tokenName = "V2 Test Token";
      const tokenTicker = "V2TEST";
      const cores = [0, 1, 2];
      const description = "V2 Token for tax comparison";
      const image = "https://example.com/v2.png";
      const urls = ["https://twitter.com/v2", "https://t.me/v2", "https://youtube.com/v2", "https://example.com/v2"];
      const purchaseAmount = ethers.parseEther("1000");
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // PreLaunch V2 token
      const tx = await bondingV4.connect(user1).preLaunch(
        tokenName, tokenTicker, cores, description, image, urls,
        purchaseAmount, startTime, LAUNCH_MODE_NORMAL_V4
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try { return bondingV4.interface.parseLog(log)?.name === "PreLaunched"; } catch (e) { return false; }
      });
      v2TokenAddress = bondingV4.interface.parseLog(event).args.token;
      v2PairAddress = await fFactoryV2.getPair(v2TokenAddress, await virtualToken.getAddress());

      expect(v2TokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(v2PairAddress).to.not.equal(ethers.ZeroAddress);

      // Wait and launch
      await time.increaseTo(startTime + 1);
      await bondingV4.launch(v2TokenAddress);

      console.log("V2 Token created:", v2TokenAddress);
      console.log("V2 Pair:", v2PairAddress);
    });
  });

  describe("Phase 2: AgentFactoryV7 + AgentTokenV3 via BondingV5", function () {
    it("Should use AgentFactoryV7 with AgentTokenV3 implementation for BondingV5", async function () {
      const { agentFactoryV7, agentTokenV3Impl } = contracts;

      expect(await agentFactoryV7.tokenImplementation()).to.equal(
        await agentTokenV3Impl.getAddress()
      );
    });

    it("Should create V3 token with AgentTokenV3 implementation", async function () {
      const { bondingV5, virtualToken, fFactoryV3, fRouterV3, agentTax } = contracts;
      const { user2 } = accounts;

      // No need to switch router - BondingV5 uses FFactoryV3 which is already configured with FRouterV3
      // This is cleaner than reusing FFactoryV2 because:
      // 1. Frontend can determine router by factory (BondingV5 -> FFactoryV3 -> FRouterV3)
      // 2. No risk of BondingV4 tokens accidentally getting FRouterV3

      // Approve tokens
      await virtualToken.connect(user2).approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user2).approve(await fRouterV3.getAddress(), ethers.MaxUint256);

      const tokenName = "V3 Test Token";
      const tokenTicker = "V3TEST";
      const cores = [0, 1, 2];
      const description = "V3 Token for tax comparison";
      const image = "https://example.com/v3.png";
      const urls = ["https://twitter.com/v3", "https://t.me/v3", "https://youtube.com/v3", "https://example.com/v3"];
      const purchaseAmount = ethers.parseEther("1000");
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // PreLaunch V3 token
      const tx = await bondingV5.connect(user2).preLaunch(
        tokenName, tokenTicker, cores, description, image, urls,
        purchaseAmount, startTime, LAUNCH_MODE_NORMAL, 0, false, ANTI_SNIPER_60S, false
          );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
        try { return bondingV5.interface.parseLog(log)?.name === "PreLaunched"; } catch (e) { return false; }
      });
      v3TokenAddress = bondingV5.interface.parseLog(event).args.token;
      v3PairAddress = await fFactoryV3.getPair(v3TokenAddress, await virtualToken.getAddress());

      expect(v3TokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(v3PairAddress).to.not.equal(ethers.ZeroAddress);

      // Verify TokenRegistered event was emitted during preLaunch (not launch)
      const tokenRegisteredEvent = receipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TokenRegistered"; } catch (e) { return false; }
      });
      expect(tokenRegisteredEvent).to.not.be.undefined;

      // Verify creator info is recorded in AgentTax
      const recipient = await agentTax.tokenRecipients(v3TokenAddress);
      expect(recipient.creator).to.equal(user2.address);

      // Wait and launch
      await time.increaseTo(startTime + 1);
      await bondingV5.launch(v3TokenAddress);

      console.log("V3 Token created:", v3TokenAddress);
      console.log("V3 Pair:", v3PairAddress);
    });
  });

  describe("Phase 3: V2 Token Tax Flow (tax-listener simulation)", function () {
    it("V2 BUY: Tax should be sent directly to taxVault (tax-listener would process)", async function () {
      const { bondingV4, virtualToken, fRouterV2, agentTax } = contracts;
        const { user1 } = accounts;

      // BondingV4 uses its stored FRouterV2 reference - no need to switch FFactoryV2.router
      await virtualToken.connect(user1).approve(await bondingV4.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user1).approve(await fRouterV2.getAddress(), ethers.MaxUint256);

      const buyAmount = ethers.parseEther("500");
      const agentTaxAddress = await agentTax.getAddress();

      const tx = await bondingV4.connect(user1).buy(buyAmount, v2TokenAddress, 0, (await time.latest()) + 300);
        const receipt = await tx.wait();

      // Find Transfer events to AgentTax (taxVault)
      const transfersToTax = receipt.logs.filter((log) => {
        try {
          const parsed = virtualToken.interface.parseLog(log);
          return parsed?.name === "Transfer" && parsed.args.to === agentTaxAddress;
        } catch (e) { return false; }
      });

      expect(transfersToTax.length).to.be.gt(0);

      // For V2 BUY: tax comes from buyer directly
      // Tax-listener would find this via fallback (Swap event matching)
      let foundBuyerTransfer = false;
      for (const log of transfersToTax) {
        const parsed = virtualToken.interface.parseLog(log);
        console.log("V2 BUY tax transfer from:", parsed.args.from, "amount:", ethers.formatEther(parsed.args.value));
        
        // Assert: tax transfer comes from buyer (user1)
        if (parsed.args.from.toLowerCase() === user1.address.toLowerCase()) {
          foundBuyerTransfer = true;
          console.log("  -> Tax from buyer (user1) - tax-listener uses fallback to find agent");
        }
      }
      expect(foundBuyerTransfer).to.be.true;

      // V2 should NOT have TaxDeposited event (no depositTax called)
      const taxDepositedEvent = receipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TaxDeposited"; } catch (e) { return false; }
      });
      expect(taxDepositedEvent).to.be.undefined;

      // V2 should NOT have tokenTaxAmounts recorded
      const v2TaxAmounts = await agentTax.tokenTaxAmounts(v2TokenAddress);
      expect(v2TaxAmounts.amountCollected).to.equal(0n);
    });

    it("V2 SELL: Tax should be sent from preTokenPair to taxVault", async function () {
      const { bondingV4, virtualToken, fRouterV2, agentTax } = contracts;
        const { user1 } = accounts;

      // Get some V2 tokens first by buying
      await virtualToken.connect(user1).approve(await bondingV4.getAddress(), ethers.MaxUint256);
      await bondingV4.connect(user1).buy(ethers.parseEther("1000"), v2TokenAddress, 0, (await time.latest()) + 300);

      // Get token contract and approve for sell
      const v2Token = await ethers.getContractAt("AgentTokenV2", v2TokenAddress);
      const tokenBalance = await v2Token.balanceOf(user1.address);
      await v2Token.connect(user1).approve(await bondingV4.getAddress(), tokenBalance);
      await v2Token.connect(user1).approve(await fRouterV2.getAddress(), tokenBalance);

      const agentTaxAddress = await agentTax.getAddress();
      const sellAmount = tokenBalance / 2n;

      const tx = await bondingV4.connect(user1).sell(sellAmount, v2TokenAddress, 0, (await time.latest()) + 300);
        const receipt = await tx.wait();

      // Find Transfer events to AgentTax
      const transfersToTax = receipt.logs.filter((log) => {
        try {
          const parsed = virtualToken.interface.parseLog(log);
          return parsed?.name === "Transfer" && parsed.args.to === agentTaxAddress;
        } catch (e) { return false; }
      });

      expect(transfersToTax.length).to.be.gt(0);

      // For V2 SELL: tax comes from preTokenPair
      // Tax-listener would process this (log.from matches preTokenPair)
      let foundPairTransfer = false;
      for (const log of transfersToTax) {
        const parsed = virtualToken.interface.parseLog(log);
        console.log("V2 SELL tax transfer from:", parsed.args.from, "amount:", ethers.formatEther(parsed.args.value));
        
        // Assert: tax transfer comes from preTokenPair
        if (parsed.args.from.toLowerCase() === v2PairAddress.toLowerCase()) {
          foundPairTransfer = true;
          console.log("  -> Tax from preTokenPair - tax-listener would process directly");
        }
      }
      expect(foundPairTransfer).to.be.true;

      // V2 should NOT have TaxDeposited event
      const taxDepositedEvent = receipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TaxDeposited"; } catch (e) { return false; }
      });
      expect(taxDepositedEvent).to.be.undefined;
    });
  });

  describe("Phase 4: V3 Token Tax Flow (on-chain attribution)", function () {
    // BondingV5 uses its stored FRouterV3 reference - no need to switch FFactoryV2.router

    it("V3 BUY: Should emit TaxDeposited and record in tokenTaxAmounts", async function () {
      const { bondingV5, virtualToken, fRouterV3, agentTax } = contracts;
      const { user1 } = accounts;

      await virtualToken.connect(user1).approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user1).approve(await fRouterV3.getAddress(), ethers.MaxUint256);

      const buyAmount = ethers.parseEther("500");
      const expectedTax = (buyAmount * BigInt(BUY_TAX)) / 100n;

      const taxBefore = await agentTax.tokenTaxAmounts(v3TokenAddress);

      const tx = await bondingV5.connect(user1).buy(buyAmount, v3TokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      // V3 SHOULD have TaxDeposited event
      const taxDepositedEvent = receipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TaxDeposited"; } catch (e) { return false; }
      });

      expect(taxDepositedEvent).to.not.be.undefined;
      const parsedEvent = agentTax.interface.parseLog(taxDepositedEvent);
      expect(parsedEvent.args.tokenAddress).to.equal(v3TokenAddress);
      expect(parsedEvent.args.amount).to.equal(expectedTax);

      // V3 SHOULD have tokenTaxAmounts updated
      const taxAfter = await agentTax.tokenTaxAmounts(v3TokenAddress);
      expect(taxAfter.amountCollected).to.equal(taxBefore.amountCollected + expectedTax);

      console.log("V3 BUY: TaxDeposited event amount:", ethers.formatEther(parsedEvent.args.amount));
      console.log("V3 BUY: tokenTaxAmounts.amountCollected:", ethers.formatEther(taxAfter.amountCollected));
    });

    it("V3 SELL: Should emit TaxDeposited and record in tokenTaxAmounts", async function () {
      const { bondingV5, virtualToken, fRouterV3, agentTax } = contracts;
      const { user1 } = accounts;

      // Get some V3 tokens first
      await virtualToken.connect(user1).approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user1).approve(await fRouterV3.getAddress(), ethers.MaxUint256);
      await bondingV5.connect(user1).buy(ethers.parseEther("1000"), v3TokenAddress, 0, (await time.latest()) + 300);

      // Get token contract and approve for sell (V3 token uses AgentTokenV3)
      const v3Token = await ethers.getContractAt("AgentTokenV3", v3TokenAddress);
      const tokenBalance = await v3Token.balanceOf(user1.address);
      await v3Token.connect(user1).approve(await bondingV5.getAddress(), tokenBalance);
      await v3Token.connect(user1).approve(await fRouterV3.getAddress(), tokenBalance);

      const taxBefore = await agentTax.tokenTaxAmounts(v3TokenAddress);
      const sellAmount = tokenBalance / 2n;

      const tx = await bondingV5.connect(user1).sell(sellAmount, v3TokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      // V3 SHOULD have TaxDeposited event
      const taxDepositedEvent = receipt.logs.find((log) => {
        try { return agentTax.interface.parseLog(log)?.name === "TaxDeposited"; } catch (e) { return false; }
      });

      expect(taxDepositedEvent).to.not.be.undefined;
      const parsedEvent = agentTax.interface.parseLog(taxDepositedEvent);
      expect(parsedEvent.args.tokenAddress).to.equal(v3TokenAddress);
      expect(parsedEvent.args.amount).to.be.gt(0);

      // V3 SHOULD have tokenTaxAmounts updated
      const taxAfter = await agentTax.tokenTaxAmounts(v3TokenAddress);
      expect(taxAfter.amountCollected).to.be.gt(taxBefore.amountCollected);

      console.log("V3 SELL: TaxDeposited event amount:", ethers.formatEther(parsedEvent.args.amount));
      console.log("V3 SELL: tokenTaxAmounts.amountCollected:", ethers.formatEther(taxAfter.amountCollected));
    });

    it("V3: Tax transfers should NOT be processable by tax-listener (from FRouterV3)", async function () {
      const { bondingV5, virtualToken, fRouterV3, agentTax } = contracts;
      const { user2 } = accounts;

      await virtualToken.connect(user2).approve(await bondingV5.getAddress(), ethers.MaxUint256);
      await virtualToken.connect(user2).approve(await fRouterV3.getAddress(), ethers.MaxUint256);

      const tx = await bondingV5.connect(user2).buy(ethers.parseEther("100"), v3TokenAddress, 0, (await time.latest()) + 300);
      const receipt = await tx.wait();

      const agentTaxAddress = await agentTax.getAddress();
      const fRouterV3Address = await fRouterV3.getAddress();

      // Find Transfer events to AgentTax
      const transfersToTax = receipt.logs.filter((log) => {
        try {
          const parsed = virtualToken.interface.parseLog(log);
          return parsed?.name === "Transfer" && parsed.args.to === agentTaxAddress;
        } catch (e) { return false; }
      });

      // For V3: transfers to AgentTax come from FRouterV3 (via depositTax)
      // Tax-listener checks: lpSource, uniV2PoolAddr, preTokenPair - FRouterV3 is none of these
      for (const log of transfersToTax) {
        const parsed = virtualToken.interface.parseLog(log);
        const fromAddress = parsed.args.from;

        // Tax-listener would check if fromAddress matches known LP addresses
        const wouldTaxListenerProcess = 
          fromAddress.toLowerCase() === v3PairAddress.toLowerCase(); // preTokenPair

        // FRouterV3 is NOT preTokenPair, so tax-listener would NOT process directly
        // (though fallback might find Swap event - that's why tax-listener needs to skip BondingV5 tokens)
        if (fromAddress.toLowerCase() === fRouterV3Address.toLowerCase()) {
          expect(wouldTaxListenerProcess).to.be.false;
          console.log("V3: Tax transfer from FRouterV3 - tax-listener would NOT process by log.from");
        }
      }
    });
  });

  describe("Phase 5: Summary Comparison", function () {
    it("Should show V2 vs V3 tax attribution differences", async function () {
      const { agentTax } = contracts;

      const v2TaxAmounts = await agentTax.tokenTaxAmounts(v2TokenAddress);
      const v3TaxAmounts = await agentTax.tokenTaxAmounts(v3TokenAddress);

      console.log("\n=== V2 vs V3 Tax Attribution Summary ===");
      console.log("V2 Token:", v2TokenAddress);
      console.log("  - tokenTaxAmounts.amountCollected:", ethers.formatEther(v2TaxAmounts.amountCollected), "VIRTUAL");
      console.log("  - Tax tracking: OFF-CHAIN (tax-listener required)");

      console.log("\nV3 Token:", v3TokenAddress);
      console.log("  - tokenTaxAmounts.amountCollected:", ethers.formatEther(v3TaxAmounts.amountCollected), "VIRTUAL");
      console.log("  - Tax tracking: ON-CHAIN (no tax-listener needed)");

      // V2 should have 0 on-chain tax recorded
      expect(v2TaxAmounts.amountCollected).to.equal(0n);
      // V3 should have tax recorded on-chain
      expect(v3TaxAmounts.amountCollected).to.be.gt(0n);

      // V3 should also have creator recorded
      const v3Recipient = await agentTax.tokenRecipients(v3TokenAddress);
      expect(v3Recipient.creator).to.not.equal(ethers.ZeroAddress);
      console.log("  - Creator:", v3Recipient.creator);
    });
  });
});
