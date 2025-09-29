const { expect } = require("chai");
const { ethers, upgrades, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { setupNewLaunchpadTest } = require("./setup.js");
const { expectTokenBalanceEqual, increaseTimeByMinutes } = require("./util.js");
const {
  ERR_INVALID_TOKEN_STATUS,
  ERR_INVALID_INPUT,
  ERR_SLIPPAGE_TOO_HIGH,
  ERR_ZERO_ADDRESSES,
  ERR_AMOUNT_MUST_BE_GREATER_THAN_ZERO,
  START_TIME_DELAY,
  APPLICATION_THRESHOLD,
  INITIAL_SUPPLY,
  ERR_INVALID_START_TIME,
} = require("./const.js");

describe("BondingV2", function () {
  let setup;
  let contracts, accounts, addresses, params;

  before(async function () {
    setup = await loadFixture(setupNewLaunchpadTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;
    params = setup.params;
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial parameters", async function () {
      const { owner } = accounts;
      const { bondingV2, virtualToken } = contracts;

      expect(await bondingV2.owner()).to.equal(owner.address);
      expect(await bondingV2.agentFactory()).to.equal(addresses.agentFactoryV6);
      expect(await bondingV2.initialSupply()).to.equal(params.initialSupply);
      expect(await bondingV2.assetRate()).to.equal(params.assetRate);
      expect(await bondingV2.gradThreshold()).to.equal(params.gradThreshold);
    });

    it("Should have correct roles granted", async function () {
      const { bondingV2, fRouterV2, agentFactoryV6, fFactoryV2 } = contracts;

      // Check EXECUTOR_ROLE in FRouterV2
      expect(
        await fRouterV2.hasRole(
          await fRouterV2.EXECUTOR_ROLE(),
          addresses.bondingV2
        )
      ).to.be.true;

      // Check BONDING_ROLE in AgentFactoryV6
      expect(
        await agentFactoryV6.hasRole(
          await agentFactoryV6.BONDING_ROLE(),
          addresses.bondingV2
        )
      ).to.be.true;

      // Check CREATOR_ROLE in FFactoryV2
      expect(
        await fFactoryV2.hasRole(
          await fFactoryV2.CREATOR_ROLE(),
          addresses.bondingV2
        )
      ).to.be.true;
    });
  });

  describe("preLaunch", function () {
    it("Should create a new token and application successfully", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      const tokenName = "Test Token";
      const tokenTicker = "TEST";
      const cores = [0, 1, 2];
      const description = "Test token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000"); // 1000 VIRTUAL tokens

      // Approve virtual tokens for bonding contract
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      // print out the balance of user1 of virtualToken
      const user1Balance = await virtualToken.balanceOf(user1.address);
      console.log("User1 balance of virtualToken:", user1Balance);
      console.log("Purchase amount:", purchaseAmount.toString());
      console.log("Fee amount:", (await bondingV2.fee()).toString());

      // Call preLaunch
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;
      const pairAddress = parsedEvent.args.pair;

      console.log("Token address:", tokenAddress);
      console.log("Pair address:", pairAddress);
      console.log(
        "Initial purchase:",
        parsedEvent.args.initialPurchase.toString()
      );

      const launchParams = await bondingV2._launchParams();
      console.log("Launch params:", launchParams);

      // Verify token was created
      expect(tokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(pairAddress).to.not.equal(ethers.ZeroAddress);

      // Check token balance in BondingV2 contract
      const tokenContract = await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
        tokenAddress
      );
      const bondingBalance = await tokenContract.balanceOf(addresses.bondingV2);
      console.log("BondingV2 token balance:", bondingBalance.toString());

      const agentTokenBalance = await tokenContract.balanceOf(pairAddress);
      console.log(
        "agentTokenBalance in agentTokenAddress:",
        agentTokenBalance.toString()
      );

      const teamWalletBalance = await tokenContract.balanceOf(
        launchParams.teamTokenReservedWallet
      );
      console.log(
        "agentTokenBalance in Team wallet:",
        teamWalletBalance.toString()
      );

      // Verify token info was stored
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
      expect(tokenInfo.trading).to.be.true;
      expect(tokenInfo.tradingOnUniswap).to.be.false;

      // Verify user received tokens
      const userBalance = await virtualToken.balanceOf(user1.address);
      expect(userBalance).to.be.greaterThan(0);
    });

    it("Should fail with insufficient purchase amount", async function () {
      const { user1 } = accounts;
      const { bondingV2 } = contracts;

      const tokenName = "Test Token";
      const tokenTicker = "TEST";
      const cores = [0, 1, 2];
      const description = "Test token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("50"); // Less than fee

      await expect(
        bondingV2
          .connect(user1)
          .preLaunch(
            tokenName,
            tokenTicker,
            cores,
            description,
            image,
            urls,
            purchaseAmount
          )
      ).to.be.revertedWithCustomError(bondingV2, ERR_INVALID_INPUT);
    });

    it("Should fail with empty cores array", async function () {
      const { user1 } = accounts;
      const { bondingV2 } = contracts;

      const tokenName = "Test Token";
      const tokenTicker = "TEST";
      const cores = []; // Empty cores array
      const description = "Test token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await expect(
        bondingV2
          .connect(user1)
          .preLaunch(
            tokenName,
            tokenTicker,
            cores,
            description,
            image,
            urls,
            purchaseAmount
          )
      ).to.be.revertedWithCustomError(bondingV2, ERR_INVALID_INPUT);
    });
  });

  describe("preLaunch with initialPurchase = creator fee 100", function () {
    it("Should allow preLaunch with purchaseAmount equal to fee (100 VIRTUAL) and subsequent launch should succeed", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;
      const { increaseTimeByDays } = require("./util");

      // Test parameters
      const tokenName = "Edge Case Token";
      const tokenTicker = "EDGE";
      const cores = [0, 1, 2];
      const description = "Testing edge case with minimum purchase amount";
      const image = "https://example.com/edge.png";
      const urls = [
        "https://twitter.com/edge",
        "https://t.me/edge",
        "https://youtube.com/edge",
        "https://example.com/edge",
      ];

      // Use exactly the fee amount (100 VIRTUAL)
      const purchaseAmount = ethers.parseEther("100"); // Exactly equal to fee

      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      // preLaunch should succeed with purchaseAmount = fee
      const preLaunchTx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount
        );

      const preLaunchReceipt = await preLaunchTx.wait();
      const preLaunchEvent = preLaunchReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(preLaunchEvent).to.not.be.undefined;
      const tokenAddress = preLaunchEvent.args.token;
      const pairAddress = preLaunchEvent.args.pair;

      // Verify token was created
      expect(tokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(pairAddress).to.not.equal(ethers.ZeroAddress);

      // Advance time to reach startTime (1 day delay)
      await increaseTimeByDays(1);

      // launch() should succeed even though initialPurchase = 0 (purchaseAmount - fee = 100 - 100 = 0)
      // This tests that the condition is purchaseAmount < fee (not <=)
      const launchTx = await bondingV2.connect(user1).launch(tokenAddress);

      const launchReceipt = await launchTx.wait();
      const launchEvent = launchReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      expect(launchEvent).to.not.be.undefined;
      expect(launchEvent.args.token).to.equal(tokenAddress);
      expect(launchEvent.args.pair).to.equal(pairAddress);

      // Verify that initialPurchase is 0 (since purchaseAmount - fee = 100 - 100 = 0)
      // args[3] is the initialPurchase parameter (4th parameter, 0-indexed)
      expect(launchEvent.args[3]).to.equal(0);

      // Verify token state is updated correctly
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.launchExecuted).to.be.true;

      // verify user1's agentToken balance is 0
      const actualTokenContract = await ethers.getContractAt(
        "AgentToken",
        tokenAddress
      );
      const user1AgentTokenBalance = await actualTokenContract.balanceOf(
        user1.address
      );
      console.log("User1 agentToken balance:", user1AgentTokenBalance);
      expect(user1AgentTokenBalance).to.equal(ethers.parseEther("0"));
    });
  });

  describe("launch", function () {
    let tokenAddress;
    let pairAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create a token first
      const tokenName = "Test Token";
      const tokenTicker = "TEST";
      const cores = [0, 1, 2];
      const description = "Test token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV2.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;
      pairAddress = parsedEvent.args.pair;
      // Check BondingV2 VT balance
      const bondingVTVBalance = await virtualToken.balanceOf(
        addresses.bondingV2
      );
      console.log("BondingV2 VT balance:", bondingVTVBalance.toString());
    });

    it("Should launch token successfully", async function () {
      const { bondingV2, virtualToken, fRouterV2, fFactoryV2 } = contracts;

      console.log("Asset token:", await fRouterV2.assetToken());
      console.log("Token address:", tokenAddress);
      console.log("Pair address:", pairAddress);
      console.log("Buy tax:", await fFactoryV2.buyTax());
      console.log("BondingV2 creation fee:", await bondingV2.fee());

      // Check BondingV2 VT balance
      const bondingVTVBalance = await virtualToken.balanceOf(
        addresses.bondingV2
      );
      console.log("BondingV2 VT balance:", bondingVTVBalance.toString());

      // Check initialPurchase value
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      console.log("Initial purchase:", tokenInfo.initialPurchase.toString());

      console.log("Grad threshold:", await bondingV2.gradThreshold());

      // Wait for start time delay
      await time.increase(START_TIME_DELAY + 1);

      const tx = await bondingV2.launch(tokenAddress);
      const receipt = await tx.wait();

      // Verify launch event
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV2.interface.parseLog(event);
      expect(parsedEvent.args.token).to.equal(tokenAddress);
      expect(parsedEvent.args.pair).to.equal(pairAddress);
    });

    it("Should fail if start time has not passed", async function () {
      const { bondingV2 } = contracts;

      await expect(bondingV2.launch(tokenAddress)).to.be.revertedWith(
        "Swap not started"
      );
    });

    it("cannot reset satrt time if it's over", async function () {
      const { owner, admin } = accounts;
      const { bondingV2, agentToken, fRouterV2 } = contracts;

      expect(
        await fRouterV2.hasRole(await fRouterV2.EXECUTOR_ROLE(), admin.address)
      ).to.be.true;
      console.log(
        "admin has EXECUTOR_ROLE:",
        await fRouterV2.hasRole(await fRouterV2.EXECUTOR_ROLE(), admin.address)
      );

      let now = await time.latest();

      tx = await fRouterV2
        .connect(admin)
        .resetTime(tokenAddress, now + START_TIME_DELAY);
      // Check if graduation event was emitted
      receipt = await tx.wait();
      const timeResetEvent = receipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "TimeReset";
        } catch (e) {
          return false;
        }
      });
      console.log("timeResetEvent:", timeResetEvent);

      if (timeResetEvent) {
        const parsedEvent = bondingV2.interface.parseLog(timeResetEvent);
        // expect(parsedEvent.args.oldStartTime).to.equal(now);
        expect(parsedEvent.args.newStartTime).to.equal(now + START_TIME_DELAY);
      }

      await time.increase(now + START_TIME_DELAY);
      now = await time.latest();
      await expect(fRouterV2.connect(admin).resetTime(tokenAddress, now + 3600))
        .to.be.reverted;
    });
  });

  describe("buy", function () {
    let tokenAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create and launch a token
      const tokenName = "Test Token";
      const tokenTicker = "TEST";
      const cores = [0, 1, 2];
      const description = "Test token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV2.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;

      console.log(
        "BondingV2 token details:",
        await bondingV2.tokenInfo(tokenAddress)
      );

      // Wait for start time and launch
      await time.increase(START_TIME_DELAY + 1);
      await bondingV2.launch(tokenAddress);
    });

    it("Should allow buying tokens and bypass anti-sniper tax", async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken, agentToken } = contracts;

      // Wait 30 minutes after launch to bypass anti-sniper tax
      await increaseTimeByMinutes(30);

      // Verify anti-sniper tax is bypassed after 30 minutes
      const currentTime = await time.latest();
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      const pairAddress = tokenInfo.pair;
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const pairStartTime = await pair.startTime();
      const timeElapsed = Number(currentTime) - Number(pairStartTime);

      // Verify we're past the 30-minute anti-sniper window
      expect(timeElapsed).to.be.greaterThan(30 * 60); // More than 30 minutes

      console.log(
        "BondingV2 virtualToken balance:",
        await virtualToken.balanceOf(addresses.bondingV2)
      );
      console.log(
        "User2 virtualToken balance:",
        await virtualToken.balanceOf(user2.address)
      );

      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);

      const tx = await bondingV2.connect(user2).buy(
        buyAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );
      // get actual token contract instance
      const actualTokenContract = await ethers.getContractAt(
        "AgentToken",
        tokenAddress
      );
      user1AgentTokenBalance = await actualTokenContract.balanceOf(
        user1.address
      );
      console.log("User1 agentToken balance:", user1AgentTokenBalance);
      user2AgentTokenBalance = await actualTokenContract.balanceOf(
        user2.address
      );
      console.log("User2 agentToken balance:", user2AgentTokenBalance);
      bondingV2AgentTokenBalance = await actualTokenContract.balanceOf(
        addresses.bondingV2
      );
      console.log("BondingV2 agentToken balance:", bondingV2AgentTokenBalance);
      expectTokenBalanceEqual(
        user1AgentTokenBalance,
        ethers.parseEther("26925659.794506749"), // 450*10^6-450*10^6*14000/(14000+(1000-100)*99%)
        "User1 agentToken"
      );
      expectTokenBalanceEqual(
        user2AgentTokenBalance,
        ethers.parseEther("2794153.4142991216"), // 450*10^6-450*10^6*14000/(14000+(1000-100)*99% + 100*99%) - user1's balance
        "User2 agentToken"
      );

      expect(tx).to.not.be.undefined;
    });

    it("Should allow buying tokens but incur anti-sniper tax", async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken, agentToken } = contracts;

      await increaseTimeByMinutes(10);
      // Verify still incur anti-sniper tax
      const currentTime = await time.latest();
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      const pairAddress = tokenInfo.pair;
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const pairStartTime = await pair.startTime();
      const timeElapsed = Number(currentTime) - Number(pairStartTime);

      // Verify we're past the 30-minute anti-sniper window
      expect(timeElapsed).to.be.greaterThan(10 * 60); // More than 10 minutes
      // now tax should be 99-600*98/30/60 = 66.3333333333%

      console.log(
        "BondingV2 virtualToken balance:",
        await virtualToken.balanceOf(addresses.bondingV2)
      );
      console.log(
        "User2 virtualToken balance:",
        await virtualToken.balanceOf(user2.address)
      );

      const buyAmount = ethers.parseEther("100");

      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);

      const tx = await bondingV2.connect(user2).buy(
        buyAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );
      // use actual token contract to get balance
      const actualTokenContract = await ethers.getContractAt(
        "AgentToken",
        tokenAddress
      );
      user1AgentTokenBalance = await actualTokenContract.balanceOf(
        user1.address
      );
      console.log("User1 agentToken balance:", user1AgentTokenBalance);
      user2AgentTokenBalance = await actualTokenContract.balanceOf(
        user2.address
      );
      console.log("User2 agentToken balance:", user2AgentTokenBalance);
      bondingV2AgentTokenBalance = await actualTokenContract.balanceOf(
        addresses.bondingV2
      );
      console.log("BondingV2 agentToken balance:", bondingV2AgentTokenBalance);
      expectTokenBalanceEqual(
        user1AgentTokenBalance,
        ethers.parseEther("26925659.794506749"), // 450*10^6-450*10^6*14000/(14000+(1000-100)*99%)
        "User1 agentToken"
      );
      expectTokenBalanceEqual(
        user2AgentTokenBalance,
        ethers.parseEther("954359.8597578289"), // 450*10^6-450*10^6*14000/(14000+(1000-100)*99% + 100*(1-66.3333333333%)) - user1's balance
        "User2 agentToken"
      );

      expect(tx).to.not.be.undefined;
    });

    it("Should fail with invalid token status", async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken, agentToken } = contracts;

      const buyAmount = ethers.parseEther("200000");
      // await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);
      console.log(
        "User2 virtualToken balance:",
        await virtualToken.balanceOf(user2.address)
      );

      let tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      prePairAddress = tokenInfo.pair;
      const actualTokenContract = await ethers.getContractAt(
        "AgentToken",
        tokenAddress
      );
      console.log(
        "Agent token balance of the pairaddress:",
        await actualTokenContract.balanceOf(prePairAddress)
      );

      // Try to buy from a non-existent token
      await expect(
        bondingV2
          .connect(user2)
          .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.reverted;

      // now start approve and buy with 200,000.002445714315 - 891 VIRTUAL tokens and buy, will succeed
      //    need to consider the tax 1%, so it will be 202,020.2044906205 VIRTUAL tokens
      // then buy with anther 0.1 * 10^-18 VIRTUAL tokens, will fail

      let toGraduateBuyAmount = ethers.parseEther("202020.2044906205");
      await virtualToken
        .connect(user1)
        .approve(addresses.fRouterV2, toGraduateBuyAmount);
      await bondingV2
        .connect(user1)
        .buy(toGraduateBuyAmount, tokenAddress, 0, (await time.latest()) + 300);
      // verify user2's agent token balance
      const user1AgentTokenBalance = await actualTokenContract.balanceOf(
        user1.address
      );
      console.log("User1 agentToken balance:", user1AgentTokenBalance);
      // verify token/tradingOnUniswap is true, which means it has alr graduated
      tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      console.log("tokenInfo.tradingOnUniswap:", tokenInfo.tradingOnUniswap);
      expect(tokenInfo.tradingOnUniswap).to.be.true;

      let verifyGraduateBuyAmount = ethers.parseEther("0.000000000000000001");
      await virtualToken
        .connect(user2)
        .approve(addresses.fRouterV2, verifyGraduateBuyAmount);
      await expect(
        bondingV2
          .connect(user2)
          .buy(
            verifyGraduateBuyAmount,
            tokenAddress,
            0,
            (await time.latest()) + 300
          )
      ).to.be.reverted;

      // verify user 1 sell also failed
      verifySellAmount = ethers.parseEther("100");
      await actualTokenContract
        .connect(user1)
        .approve(addresses.fRouterV2, verifySellAmount);
      await expect(
        bondingV2
          .connect(user1)
          .sell(verifySellAmount, tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.reverted;
    });
  });

  describe("Initial Buy to Graduation", function () {
    it("Should graduate token to Uniswap when threshold is reached", async function () {
      let tokenAddress;

      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create and launch a token
      const tokenName = "Test Token";
      const tokenTicker = "TEST";
      const cores = [0, 1, 2];
      const description = "Test token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      let tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount
        );

      let receipt = await tx.wait();
      let event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV2.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;

      // Wait for start time and launch
      await time.increase(START_TIME_DELAY + 1);
      await bondingV2.launch(tokenAddress);

      const { user2 } = accounts;

      // Buy enough tokens to reach graduation threshold
      const buyAmount = ethers.parseEther("200000"); // Large amount
      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);

      tx = await bondingV2
        .connect(user2)
        .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);

      // Check if graduation event was emitted
      receipt = await tx.wait();
      const graduationEvent = receipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "Graduated";
        } catch (e) {
          return false;
        }
      });

      if (graduationEvent) {
        const parsedEvent = bondingV2.interface.parseLog(graduationEvent);
        expect(parsedEvent.args.token).to.equal(tokenAddress);
        expect(parsedEvent.args.agentToken).to.not.equal(ethers.ZeroAddress);

        // Verify token status changed
        const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
        expect(tokenInfo.tradingOnUniswap).to.be.true;
        expect(tokenInfo.agentToken).to.not.equal(ethers.ZeroAddress);
      }
    });
  });

  describe("sell", function () {
    let tokenAddress;

    beforeEach(async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create, launch, and buy tokens
      const tokenName = "Test Token";
      const tokenTicker = "TEST";
      const cores = [0, 1, 2];
      const description = "Test token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV2.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;

      // Wait for start time and launch
      await time.increase(START_TIME_DELAY + 1);
      await bondingV2.launch(tokenAddress);

      // Buy some tokens
      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);
      await bondingV2
        .connect(user2)
        .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);
    });

    it("Should allow selling tokens", async function () {
      const { user2 } = accounts;
      const { bondingV2 } = contracts;

      // Get the token contract to check balance
      const tokenContract = await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
        tokenAddress
      );
      const balance = await tokenContract.balanceOf(user2.address);

      if (balance > 0) {
        const sellAmount = balance / 2n; // Sell half
        await tokenContract
          .connect(user2)
          .approve(addresses.fRouterV2, sellAmount);

        const tx = await bondingV2.connect(user2).sell(
          sellAmount,
          tokenAddress,
          0, // amountOutMin
          (await time.latest()) + 300 // deadline
        );

        expect(tx).to.not.be.undefined;
      }
    });

    it("Sell should fail with not enough token allowance", async function () {
      const { user2 } = accounts;
      const { bondingV2 } = contracts;

      await expect(
        bondingV2
          .connect(user2)
          .sell(
            ethers.parseEther("100"),
            tokenAddress,
            0,
            (await time.latest()) + 300
          )
      ).to.be.reverted;
    });
  });

  describe("Access Control", function () {
    it("Should only allow owner to set token parameters", async function () {
      const { user1 } = accounts;
      const { bondingV2 } = contracts;

      await expect(
        bondingV2.connect(user1).setTokenParams(
          "2000000000", // newSupply
          100000, // newGradThreshold
          200, // newMaxTx
          20000, // newAssetRate
          "200000", // newFee
          user1.address // newFeeTo
        )
      ).to.be.revertedWithCustomError(bondingV2, "OwnableUnauthorizedAccount");
    });

    it("Should only allow owner to set deploy parameters", async function () {
      const { user1 } = accounts;
      const { bondingV2 } = contracts;

      const deployParams = {
        tbaSalt:
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        tbaImplementation: user1.address,
        daoVotingPeriod: 3600,
        daoThreshold: 1000,
      };

      await expect(
        bondingV2.connect(user1).setDeployParams(deployParams)
      ).to.be.revertedWithCustomError(bondingV2, "OwnableUnauthorizedAccount");
    });
  });
});
