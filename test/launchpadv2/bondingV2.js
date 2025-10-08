const { expect } = require("chai");
const { ethers, upgrades, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { setupNewLaunchpadTest } = require("./setup.js");
const {
  expectTokenBalanceEqual,
  increaseTimeByMinutes,
  increaseTimeAndMine,
} = require("./util.js");
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
  TEAM_TOKEN_RESERVED_SUPPLY,
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

      // Call preLaunch with valid startTime (current time + START_TIME_DELAY + buffer)
      // Add a small buffer to ensure startTime meets the validation requirement
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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
      console.log("preLaunch succeed, tx:", tx);

      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;
      const pairAddress = parsedEvent.args.pair;

      console.log("Token address:", tokenAddress);
      console.log("Pair address:", pairAddress);
      console.log(
        "Initial purchase:",
        parsedEvent.args.initialPurchase.toString()
      );

      const launchParams = await bondingV2.launchParams();
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
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

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
            purchaseAmount,
            startTime
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

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
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
            purchaseAmount,
            startTime
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
      // Add a small buffer to ensure startTime meets the validation requirement
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const preLaunchTx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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
        "AgentTokenV2",
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

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      // First, successfully reset the time to a future time
      const newStartTime = now + START_TIME_DELAY * 2; // Set to 2x delay to be safe
      tx = await fRouterV2.connect(admin).resetTime(tokenAddress, newStartTime);

      // Check if TimeReset event was emitted
      receipt = await tx.wait();

      // Get the pair contract to parse its events
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      const pairContract = await ethers.getContractAt(
        "FPairV2",
        tokenInfo.pair
      );

      const timeResetEvent = receipt.logs.find((log) => {
        try {
          const parsed = pairContract.interface.parseLog(log);
          return parsed.name === "TimeReset";
        } catch (e) {
          return false;
        }
      });
      console.log("timeResetEvent found:", timeResetEvent !== undefined);

      if (timeResetEvent) {
        const parsedEvent = pairContract.interface.parseLog(timeResetEvent);
        expect(parsedEvent.args.newStartTime).to.equal(newStartTime);
        console.log(
          "timeResetEvent parsedEvent, newStartTime from event is meet:",
          parsedEvent,
          newStartTime
        );
      }

      // Now advance time past the new startTime
      await time.increase(START_TIME_DELAY * 2 + 1);
      now = await time.latest();
      await increaseTimeAndMine(2 * 86400 + 1);

      // Now we're past the startTime, so resetTime should fail because block.timestamp >= startTime
      await expect(
        fRouterV2
          .connect(admin)
          .resetTime(tokenAddress, now + START_TIME_DELAY + 1)
      ).to.be.reverted;
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

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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
      const { owner, user1, user2 } = accounts;
      const { bondingV2, virtualToken, agentToken } = contracts;

      // Wait 98 minutes after launch to bypass anti-sniper tax
      await increaseTimeByMinutes(98);

      // Verify anti-sniper tax is bypassed after 98 minutes
      const currentTime = await time.latest();
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      const pairAddress = tokenInfo.pair;
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const pairStartTime = await pair.startTime();
      const timeElapsed = Number(currentTime) - Number(pairStartTime);

      // Verify we're past the 98-minute anti-sniper window
      expect(timeElapsed).to.be.greaterThan(98 * 60); // More than 98 minutes

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
        "AgentTokenV2",
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
      const teamTokenReservedWalletBalance =
        await actualTokenContract.balanceOf(owner.address);
      console.log(
        "teamTokenReservedWallet agentToken balance:",
        teamTokenReservedWalletBalance
      );

      // user1 (creator) should have 0 balance since initialPurchase tokens go to teamTokenReservedWallet
      expect(user1AgentTokenBalance).to.equal(0);

      // but teamTokenReservedWallet should have the initialPurchase tokens + TEAM_TOKEN_RESERVED_SUPPLY tokens
      expectTokenBalanceEqual(
        teamTokenReservedWalletBalance -
          BigInt(TEAM_TOKEN_RESERVED_SUPPLY) * 10n ** 18n,
        ethers.parseEther("26925659.794506749"), // 450*10^6-450*10^6*14000/(14000+(1000-100)*99%)
        "teamTokenReservedWallet agentToken"
      );

      // user2 should get tokens from their 100 VIRTUAL purchase (with 1% tax after 98 minutes)
      expectTokenBalanceEqual(
        user2AgentTokenBalance,
        ethers.parseEther("2794153.4142991216"), // 450*10^6-450*10^6*14000/(14000+900+100*99%) - adjusted for no user1 balance
        "User2 agentToken"
      );

      expect(tx).to.not.be.undefined;
    });

    it("Should allow buying tokens but incur anti-sniper tax", async function () {
      const { owner, user1, user2 } = accounts;
      const { bondingV2, virtualToken, agentToken } = contracts;

      await increaseTimeByMinutes(10);
      // Verify still incur anti-sniper tax
      let currentTime = await time.latest();
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      const pairAddress = tokenInfo.pair;
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      let pairStartTime = await pair.startTime();
      let timeElapsed = Number(currentTime) - Number(pairStartTime);
      console.log(
        "currentTime, pairStartTime, timeElapsed:",
        currentTime,
        pairStartTime,
        timeElapsed
      );

      // Verify we're past the 98-minute anti-sniper window
      expect(timeElapsed).to.be.greaterThan(10 * 60); // More than 10 minutes

      console.log(
        "BondingV2 virtualToken balance:",
        await virtualToken.balanceOf(addresses.bondingV2)
      );
      console.log(
        "User2 virtualToken balance:",
        await virtualToken.balanceOf(user2.address)
      );

      // use actual token contract to get balance
      const actualTokenContract = await ethers.getContractAt(
        "AgentTokenV2",
        tokenAddress
      );
      user1AgentTokenBalance = await actualTokenContract.balanceOf(
        user1.address
      );
      console.log("User1 agentToken balance:", user1AgentTokenBalance);
      bondingV2AgentTokenBalance = await actualTokenContract.balanceOf(
        addresses.bondingV2
      );
      console.log("BondingV2 agentToken balance:", bondingV2AgentTokenBalance);
      const teamTokenReservedWalletBalance =
        await actualTokenContract.balanceOf(owner.address);
      console.log(
        "teamTokenReservedWallet agentToken balance:",
        teamTokenReservedWalletBalance
      );

      // user1 (creator) should have 0 balance since initialPurchase tokens go to teamTokenReservedWallet
      expect(user1AgentTokenBalance).to.equal(0);

      // but teamTokenReservedWallet should have the initialPurchase tokens + TEAM_TOKEN_RESERVED_SUPPLY tokens
      // 26925659.794506749
      initialBuyAmount =
        BigInt(
          Math.floor(
            450 * 10 ** 6 -
              (450 * 10 ** 6 * 14000) / (14000 + (1000 - 100) * 0.99)
          )
        ) *
        10n ** 18n;
      expectedTeamTokenReservedWallet =
        BigInt(TEAM_TOKEN_RESERVED_SUPPLY) * 10n ** 18n + initialBuyAmount;
      expectTokenBalanceEqual(
        teamTokenReservedWalletBalance,
        expectedTeamTokenReservedWallet,
        "teamTokenReservedWallet agentToken"
      );
      console.log("initialBuyAmount:", initialBuyAmount);
      console.log(
        "expectedTeamTokenReservedWallet:",
        expectedTeamTokenReservedWallet
      );

      currentTime = await time.latest();
      timeElapsed = Number(currentTime) - Number(pairStartTime);
      console.log(
        "currentTime, pairStartTime, timeElapsed:",
        currentTime,
        pairStartTime,
        timeElapsed
      );

      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);
      const tx = await bondingV2.connect(user2).buy(
        buyAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );
      let tax = Math.ceil(99 - timeElapsed / 60) / 100; // 99% - 1% per minute, contract side rounds up
      console.log("tax:", tax);
      console.log("factory.buyTax():", await contracts.fFactoryV2.buyTax());
      console.log(
        "factory.antiSniperBuyTaxStartValue():",
        await contracts.fFactoryV2.antiSniperBuyTaxStartValue()
      );
      user2AgentTokenBalance = await actualTokenContract.balanceOf(
        user2.address
      );
      console.log("User2 agentToken balance:", user2AgentTokenBalance);
      // user2 should get tokens from their 100 VIRTUAL purchase (with anti-sniper tax at ~10 minutes)
      let expectedUser2AgentToken =
        BigInt(
          Math.floor(
            450 * 10 ** 6 -
              (450 * 10 ** 6 * 14000) /
                (14000 + (1000 - 100) * 0.99 + 100 * (1 - tax))
          )
        ) *
          10n ** 18n -
        initialBuyAmount;
      expectTokenBalanceEqual(
        user2AgentTokenBalance,
        expectedUser2AgentToken,
        // 450*10^6-450*10^6*14000/(14000+(1000-100)*99% + 100*(1-66.3333333333%)) - user1's balance
        // ethers.parseEther("935503.432510137"),
        "User2 agentToken"
      );

      expect(tx).to.not.be.undefined;
    });

    it("Should fail with invalid token status", async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken, agentToken } = contracts;

      await increaseTimeByMinutes(98); // make sure no tax

      const buyAmount = ethers.parseEther("200000");
      // await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);
      console.log(
        "User2 virtualToken balance:",
        await virtualToken.balanceOf(user2.address)
      );

      let tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      prePairAddress = tokenInfo.pair;
      const actualTokenContract = await ethers.getContractAt(
        "AgentTokenV2",
        tokenAddress
      );
      console.log(
        "Agent token balance of the pairaddress:",
        await actualTokenContract.balanceOf(prePairAddress)
      );

      // Check pair reserves for graduation calculation
      const pairContract = await ethers.getContractAt(
        "FPairV2",
        prePairAddress
      );
      const [reserve0, reserve1] = await pairContract.getReserves();

      // no approve cannot buy
      await expect(
        bondingV2
          .connect(user2)
          .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.reverted;

      // now start approve and buy with 200,000.002445714315 - 891 VIRTUAL tokens and buy, will succeed
      //    need to consider the tax 1%, so it will be 202,020.2044906205 VIRTUAL tokens
      // then buy with anther 0.1 * 10^-18 VIRTUAL tokens, will fail

      let toGraduateBuyAmount = ethers.parseEther("202020.2044906205"); // 20M VIRTUAL should be enough
      await virtualToken
        .connect(user1)
        .approve(addresses.fRouterV2, toGraduateBuyAmount);
      await bondingV2
        .connect(user1)
        .buy(toGraduateBuyAmount, tokenAddress, 0, (await time.latest()) + 300);
      // verify user1's agent token balance after large purchase
      const user1AgentTokenBalance = await actualTokenContract.balanceOf(
        user1.address
      );
      console.log("User1 agentToken balance:", user1AgentTokenBalance);
      const user1VirtualTokenBalance = await virtualToken.balanceOf(
        user1.address
      );
      console.log("User1 virtualToken balance:", user1VirtualTokenBalance);
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

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      let tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

  describe("AgentTokenV2 Blacklist", function () {
    let tokenAddress;
    let actualTokenContract;
    let uniswapV2PairAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create a token for testing
      const tokenName = "Blacklist Test Token";
      const tokenTicker = "BTT";
      const cores = [0, 1, 2];
      const description = "Token for blacklist testing";
      const image = "https://example.com/blacklist.png";
      const urls = [
        "https://twitter.com/blacklist",
        "https://t.me/blacklist",
        "https://youtube.com/blacklist",
        "https://example.com/blacklist",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      // preLaunch
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const preLaunchTx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      tokenAddress = preLaunchEvent.args.token;
      pairAddress = preLaunchEvent.args.pair;

      // Get actual token contract instance
      actualTokenContract = await ethers.getContractAt(
        "AgentTokenV2",
        tokenAddress
      );
      uniswapV2PairAddress = (await actualTokenContract.liquidityPools())[0];
      console.log("uniswapV2PairAddress:", uniswapV2PairAddress);

      // Advance time to reach startTime
      await time.increase(START_TIME_DELAY + 1);

      // Launch the token
      await bondingV2.connect(user1).launch(tokenAddress);
    });

    it("Should only allow owner to add blacklist address", async function () {
      const { owner, user1, user2 } = accounts;
      const { fRouterV2 } = contracts;
      const blacklistAddress = user2.address;

      // User1 should not be able to add blacklist address, only the fRouterV2/owner can
      await expect(
        actualTokenContract.connect(user1).addBlacklistAddress(blacklistAddress)
      ).to.be.reverted;
      // Verify address is not blacklisted
      expect(await actualTokenContract.blacklists(blacklistAddress)).to.be
        .false;

      // Owner should be able to add blacklist address
      await expect(
        actualTokenContract.connect(owner).addBlacklistAddress(blacklistAddress)
      ).to.not.be.reverted;
      // Verify address is blacklisted
      expect(await actualTokenContract.blacklists(blacklistAddress)).to.be.true;

      // Non-owner (user2) should not be able to add blacklist address
      const randomAddress = ethers.Wallet.createRandom().address;
      await expect(
        actualTokenContract.connect(user2).addBlacklistAddress(randomAddress)
      ).to.be.revertedWithCustomError(
        actualTokenContract,
        "CallerIsNotAdminNorFactory"
      );

      // Owner should be able to remove blacklist address
      await expect(
        actualTokenContract
          .connect(owner)
          .removeBlacklistAddress(blacklistAddress)
      ).to.not.be.reverted;

      // Verify address is no longer blacklisted
      expect(await actualTokenContract.blacklists(blacklistAddress)).to.be
        .false;
    });

    it("Should not allow transfer to blacklist address before graduation", async function () {
      const { owner, user1, user2 } = accounts;
      const { bondingV2, virtualToken } = contracts;
      const blacklistAddress = ethers.Wallet.createRandom().address;

      // Add address to blacklist
      await actualTokenContract
        .connect(owner)
        .addBlacklistAddress(blacklistAddress);

      // Buy some tokens for user2
      const buyAmount = ethers.parseEther("1000");
      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);

      await bondingV2.connect(user2).buy(
        buyAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );

      // Get user2's token balance
      const user2Balance = await actualTokenContract.balanceOf(user2.address);
      const user2BalanceBeforeTransfer = user2Balance;
      console.log("user2BalanceBeforeTransfer:", user2BalanceBeforeTransfer);
      expect(user2Balance).to.be.greaterThan(0);

      // Try to transfer to blacklisted address - should fail
      const transferAmount = ethers.parseEther("100");
      await expect(
        actualTokenContract
          .connect(user2)
          .transfer(blacklistAddress, transferAmount)
      ).to.be.revertedWithCustomError(
        actualTokenContract,
        "TransferToBlacklistedAddress"
      );

      // Try transferFrom to blacklisted address - should also fail
      await actualTokenContract
        .connect(user2)
        .approve(user1.address, transferAmount);
      await expect(
        actualTokenContract
          .connect(user1)
          .transferFrom(user2.address, blacklistAddress, transferAmount)
      ).to.be.revertedWithCustomError(
        actualTokenContract,
        "TransferToBlacklistedAddress"
      );

      // Transfer to non-blacklisted address should work
      await expect(
        actualTokenContract
          .connect(user2)
          .transfer(user1.address, transferAmount)
      ).to.not.be.reverted;
      const user2BalanceAfterTransfer = await actualTokenContract.balanceOf(
        user2.address
      );
      console.log("user2BalanceAfterTransfer:", user2BalanceAfterTransfer);
      user1BalanceAfterTransfer = await actualTokenContract.balanceOf(
        user1.address
      );
      console.log("user1BalanceAfterTransfer:", user1BalanceAfterTransfer);
      expect(user2BalanceAfterTransfer).to.equal(
        user2BalanceBeforeTransfer - transferAmount
      );
      expect(user1BalanceAfterTransfer).to.equal(transferAmount);
    });

    it("Should allow transfer to blacklist address after graduation and uniswapV2Pair liquidity is added", async function () {
      const { owner, user1, user2 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      console.log(
        "blacklist before add manually, uniswapV2PairAddress should be blacklisted, randomBlacklistAddress should be not blacklisted"
      );
      expect(await actualTokenContract.blacklists(uniswapV2PairAddress)).to.be
        .true;
      const randomBlacklistAddress = ethers.Wallet.createRandom().address;
      expect(await actualTokenContract.blacklists(randomBlacklistAddress)).to.be
        .false;

      // Add address to blacklist
      await actualTokenContract
        .connect(owner)
        .addBlacklistAddress(randomBlacklistAddress);

      // Buy enough tokens to graduate the token
      // Need to buy enough to reduce reserve0 below gradThreshold
      await increaseTimeByMinutes(98); // Ensure no anti-sniper tax

      const graduationBuyAmount = ethers.parseEther("202020.2044906205");
      await virtualToken
        .connect(user2)
        .approve(addresses.fRouterV2, graduationBuyAmount);

      await bondingV2.connect(user2).buy(
        graduationBuyAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );

      console.log(
        "blacklist after graduation, uniswapV2PairAddress should not be blacklisted, randomBlacklistAddress should be blacklisted"
      );
      expect(await actualTokenContract.blacklists(uniswapV2PairAddress)).to.be
        .false;
      expect(await actualTokenContract.blacklists(randomBlacklistAddress)).to.be
        .true;

      // Verify token has graduated
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.tradingOnUniswap).to.be.true;

      // Get user2's token balance
      const user2Balance = await actualTokenContract.balanceOf(user2.address);
      const user2BalanceBeforeTransfer = user2Balance;
      console.log("user2BalanceBeforeTransfer:", user2BalanceBeforeTransfer);
      expect(user2Balance).to.be.greaterThan(0);

      // After graduation, transfers to blacklisted addresses should still be blocked
      // The blacklist restriction should persist even after graduation
      const transferAmount = ethers.parseEther("100");
      await expect(
        actualTokenContract
          .connect(user2)
          .transfer(randomBlacklistAddress, transferAmount)
      ).to.be.revertedWithCustomError(
        actualTokenContract,
        "TransferToBlacklistedAddress"
      );

      // Remove from blacklist
      await actualTokenContract
        .connect(owner)
        .removeBlacklistAddress(randomBlacklistAddress);
      console.log(
        "blacklist after remove manually, uniswapV2PairAddress should be not blacklisted, randomBlacklistAddress should be not blacklisted"
      );
      expect(await actualTokenContract.blacklists(tokenAddress)).to.be.false;
      expect(await actualTokenContract.blacklists(randomBlacklistAddress)).to.be
        .false;

      // Now transfer should work
      await expect(
        actualTokenContract
          .connect(user2)
          .transfer(randomBlacklistAddress, transferAmount)
      ).to.not.be.reverted;

      // Verify the transfer was successful
      const blacklistBalance = await actualTokenContract.balanceOf(
        randomBlacklistAddress
      );
      expect(blacklistBalance).to.equal(transferAmount);
    });
  });

  describe("normal and anti-sniper tax vault", function () {
    let tokenAddress;
    let actualTokenContract;
    let pairAddress;
    let initialTaxVaultBalanceBeforeLaunch;
    let initialAntiSniperTaxVaultBalanceBeforeLaunch;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;
      const { taxVault, antiSniperTaxVault } = addresses;

      // Create a token for testing
      const tokenName = "Tax Test Token";
      const tokenTicker = "TTT";
      const cores = [0, 1, 2];
      const description = "Token for tax testing";
      const image = "https://example.com/tax.png";
      const urls = [
        "https://twitter.com/tax",
        "https://t.me/tax",
        "https://youtube.com/tax",
        "https://example.com/tax",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      // preLaunch
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const preLaunchTx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      tokenAddress = preLaunchEvent.args.token;
      pairAddress = preLaunchEvent.args.pair;

      // Get actual token contract instance
      actualTokenContract = await ethers.getContractAt(
        "AgentTokenV2",
        tokenAddress
      );

      // Advance time to reach startTime
      await time.increase(START_TIME_DELAY + 1);

      initialTaxVaultBalanceBeforeLaunch = await virtualToken.balanceOf(
        taxVault
      );
      initialAntiSniperTaxVaultBalanceBeforeLaunch =
        await virtualToken.balanceOf(antiSniperTaxVault);
      console.log(
        "initialTaxVaultBalanceBeforeLaunch:",
        ethers.formatEther(initialTaxVaultBalanceBeforeLaunch)
      );
      console.log(
        "initialAntiSniperTaxVaultBalanceBeforeLaunch:",
        ethers.formatEther(initialAntiSniperTaxVaultBalanceBeforeLaunch)
      );

      // Launch the token
      await bondingV2.connect(user1).launch(tokenAddress);
    });

    it("when anti-sniper tax is incurred, tax should be splitted and should go to different vault", async function () {
      const { user2 } = accounts;
      const { virtualToken, fFactoryV2, bondingV2 } = contracts;

      // Get initial balances of both tax vaults
      const taxVault = await fFactoryV2.taxVault();
      const antiSniperTaxVault = await fFactoryV2.antiSniperTaxVault();
      // Verify tax vault addresses are different
      expect(taxVault).to.not.equal(antiSniperTaxVault);

      const initialTaxVaultBalance =
        (await virtualToken.balanceOf(taxVault)) -
        initialTaxVaultBalanceBeforeLaunch;
      console.log(
        "initialTaxVaultBalance:",
        ethers.formatEther(initialTaxVaultBalance)
      );
      const initialAntiSniperTaxVaultBalance =
        (await virtualToken.balanceOf(antiSniperTaxVault)) -
        initialAntiSniperTaxVaultBalanceBeforeLaunch;
      console.log(
        "initialAntiSniperTaxVaultBalance:",
        ethers.formatEther(initialAntiSniperTaxVaultBalance)
      );

      expect(initialTaxVaultBalance).to.be.equal(BigInt(9 * 10 ** 18));
      expect(initialAntiSniperTaxVaultBalance).to.be.equal(0);

      const currentTime = await time.latest();
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      const pairAddress = tokenInfo.pair;
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const pairStartTime = await pair.startTime();
      const timeElapsed = Number(currentTime) - Number(pairStartTime);
      console.log(
        "currentTime, pairStartTime, timeElapsed:",
        currentTime,
        pairStartTime,
        timeElapsed
      );
      tax = Math.ceil(99 - timeElapsed / 60) / 100; // 99% - 1% per minute, contract side rounds up
      console.log("tax:", tax);
      console.log("factory.buyTax():", await contracts.fFactoryV2.buyTax());
      console.log(
        "factory.antiSniperBuyTaxStartValue():",
        await contracts.fFactoryV2.antiSniperBuyTaxStartValue()
      );

      // Buy immediately after launch (within anti-sniper period)
      const buyAmount = ethers.parseEther("1000");
      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);
      const buyTx = await bondingV2.connect(user2).buy(
        buyAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );

      // Get final balances
      const finalTaxVaultBalance =
        (await virtualToken.balanceOf(taxVault)) -
        initialTaxVaultBalanceBeforeLaunch;
      console.log(
        "finalTaxVaultBalance:",
        ethers.formatEther(finalTaxVaultBalance)
      );
      const finalAntiSniperTaxVaultBalance =
        (await virtualToken.balanceOf(antiSniperTaxVault)) -
        initialAntiSniperTaxVaultBalanceBeforeLaunch;
      console.log(
        "finalAntiSniperTaxVaultBalance:",
        ethers.formatEther(finalAntiSniperTaxVaultBalance)
      );

      expect(finalTaxVaultBalance).to.be.equal(
        initialTaxVaultBalance +
          BigInt(parseFloat(ethers.formatEther(buyAmount)) * 10 ** 18 * 0.01)
      );
      expect(finalAntiSniperTaxVaultBalance).to.be.equal(
        initialAntiSniperTaxVaultBalance +
          BigInt(
            parseFloat(ethers.formatEther(buyAmount)) * 10 ** 18 * (tax - 0.01)
          )
      );
    });

    it("when anti-sniper tax is not incurred, only normal tax value will go to tax vault", async function () {
      const { user2 } = accounts;
      const { virtualToken, fFactoryV2, bondingV2 } = contracts;

      // Wait for anti-sniper period to end (98 minutes + buffer)
      await increaseTimeByMinutes(100);

      // Get initial balances of both tax vaults
      const taxVault = await fFactoryV2.taxVault();
      const antiSniperTaxVault = await fFactoryV2.antiSniperTaxVault();
      // Verify tax vault addresses
      expect(taxVault).to.not.equal(antiSniperTaxVault);

      const initialTaxVaultBalance =
        (await virtualToken.balanceOf(taxVault)) -
        initialTaxVaultBalanceBeforeLaunch;
      const initialAntiSniperTaxVaultBalance =
        (await virtualToken.balanceOf(antiSniperTaxVault)) -
        initialAntiSniperTaxVaultBalanceBeforeLaunch;
      console.log(
        "initialTaxVaultBalance:",
        ethers.formatEther(initialTaxVaultBalance)
      );
      console.log(
        "initialAntiSniperTaxVaultBalance:",
        ethers.formatEther(initialAntiSniperTaxVaultBalance)
      );
      expect(initialTaxVaultBalance).to.be.equal(BigInt(9 * 10 ** 18));
      expect(initialAntiSniperTaxVaultBalance).to.be.equal(0);

      // Buy after anti-sniper period
      const buyAmount = ethers.parseEther("1000");
      await virtualToken.connect(user2).approve(addresses.fRouterV2, buyAmount);

      const currentTime = await time.latest();
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      const pairAddress = tokenInfo.pair;
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const pairStartTime = await pair.startTime();
      const timeElapsed = Number(currentTime) - Number(pairStartTime);
      console.log(
        "currentTime, pairStartTime, timeElapsed:",
        currentTime,
        pairStartTime,
        timeElapsed
      );
      tax = Math.max(Math.ceil(99 - (timeElapsed * 98) / 30 / 60) / 100, 0.01); // 99% cuz contract side round up
      console.log("tax:", tax);
      console.log("factory.buyTax():", await contracts.fFactoryV2.buyTax());
      console.log(
        "factory.antiSniperBuyTaxStartValue():",
        await contracts.fFactoryV2.antiSniperBuyTaxStartValue()
      );

      const buyTx = await bondingV2.connect(user2).buy(
        buyAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );

      // Get final balances
      const finalTaxVaultBalance =
        (await virtualToken.balanceOf(taxVault)) -
        initialTaxVaultBalanceBeforeLaunch;
      const finalAntiSniperTaxVaultBalance =
        (await virtualToken.balanceOf(antiSniperTaxVault)) -
        initialAntiSniperTaxVaultBalanceBeforeLaunch;
      console.log(
        "finalTaxVaultBalance:",
        ethers.formatEther(finalTaxVaultBalance)
      );
      console.log(
        "finalAntiSniperTaxVaultBalance:",
        ethers.formatEther(finalAntiSniperTaxVaultBalance)
      );
      expect(finalTaxVaultBalance).to.be.equal(
        initialTaxVaultBalance +
          BigInt(parseFloat(ethers.formatEther(buyAmount)) * 10 ** 18 * 0.01)
      );
      expect(finalAntiSniperTaxVaultBalance).to.be.equal(
        initialAntiSniperTaxVaultBalance +
          BigInt(
            parseFloat(ethers.formatEther(buyAmount)) * 10 ** 18 * (tax - 0.01)
          )
      );

      // Test sell tax as well
      const initialTaxVaultBalanceBeforeSell = await virtualToken.balanceOf(
        taxVault
      );
      const initialAntiSniperTaxVaultBalanceBeforeSell =
        await virtualToken.balanceOf(antiSniperTaxVault);

      // Get user's agent token balance for selling
      const userAgentTokenBalance = await actualTokenContract.balanceOf(
        user2.address
      );
      expect(userAgentTokenBalance).to.be.greaterThan(0);

      // Sell some tokens
      const sellAmount = userAgentTokenBalance / 2n; // Sell half
      await actualTokenContract
        .connect(user2)
        .approve(addresses.fRouterV2, sellAmount);

      const sellTx = await bondingV2.connect(user2).sell(
        sellAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );

      // Get final balances after sell
      const finalTaxVaultBalanceAfterSell = await virtualToken.balanceOf(
        taxVault
      );
      const finalAntiSniperTaxVaultBalanceAfterSell =
        await virtualToken.balanceOf(antiSniperTaxVault);

      // Calculate sell tax amounts
      const sellTaxAmount =
        finalTaxVaultBalanceAfterSell - initialTaxVaultBalanceBeforeSell;
      const sellAntiSniperTaxAmount =
        finalAntiSniperTaxVaultBalanceAfterSell -
        initialAntiSniperTaxVaultBalanceBeforeSell;

      console.log("Sell tax amount:", ethers.formatEther(sellTaxAmount));
      console.log(
        "Sell anti-sniper tax amount:",
        ethers.formatEther(sellAntiSniperTaxAmount)
      );

      // Verify sell tax behavior
      expect(sellTaxAmount).to.be.greaterThan(0); // Normal sell tax should be collected
      expect(sellAntiSniperTaxAmount).to.equal(0); // No anti-sniper tax on sells

      // Get sell tax rate for verification
      const sellTaxRate = await fFactoryV2.sellTax(); // Should be 1%
      console.log("Sell tax rate:", sellTaxRate, "%");
    });
  });

  describe("AgentVeTokenV2 remove liquidity", function () {
    let tokenAddress;
    let veTokenAddress;
    let actualTokenContract;
    let veTokenContract;
    let uniswapV2PairAddress;

    beforeEach(async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create a token for testing
      const tokenName = "LP Removal Test Token";
      const tokenTicker = "LRTT";
      const cores = [0, 1, 2];
      const description = "Token for LP removal testing";
      const image = "https://example.com/lpremoval.png";
      const urls = [
        "https://twitter.com/lpremoval",
        "https://t.me/lpremoval",
        "https://youtube.com/lpremoval",
        "https://example.com/lpremoval",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      // preLaunch
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const preLaunchTx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      tokenAddress = preLaunchEvent.args.token;
      const pairAddress = preLaunchEvent.args.pair;

      // Get actual token contract instance
      actualTokenContract = await ethers.getContractAt(
        "AgentTokenV2",
        tokenAddress
      );

      // Advance time to reach startTime
      await time.increase(START_TIME_DELAY + 1);

      // Launch the token
      await bondingV2.connect(user1).launch(tokenAddress);

      // Buy enough tokens to graduate the token
      await increaseTimeByMinutes(98); // Ensure no anti-sniper tax

      const graduationBuyAmount = ethers.parseEther("202020.2044906205");
      await virtualToken
        .connect(user2)
        .approve(addresses.fRouterV2, graduationBuyAmount);

      await bondingV2.connect(user2).buy(
        graduationBuyAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );

      // Verify token has graduated
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.tradingOnUniswap).to.be.true;
      expect(tokenInfo.agentToken).to.not.equal(ethers.ZeroAddress);

      console.log("Token graduated successfully");
      console.log("AgentToken address:", tokenInfo.agentToken);

      // Get the veToken address from the AgentNft
      const agentNft = contracts.agentNftV2;

      // Get the next virtualId to know how many to check
      const nextVirtualId = await agentNft.nextVirtualId();
      console.log("Next virtualId:", nextVirtualId.toString());

      // Find the virtualId that corresponds to our agentToken
      let foundVirtualId = null;

      for (let i = 1; i < nextVirtualId; i++) {
        try {
          const virtualInfo = await agentNft.virtualInfo(i);
          console.log(`VirtualId ${i}:`, {
            token: virtualInfo.token,
            veToken: virtualInfo.veToken,
            dao: virtualInfo.dao,
            lp: virtualInfo.lp,
          });

          if (virtualInfo.token === tokenInfo.agentToken) {
            foundVirtualId = i;
            // Get the veToken from virtualLP
            const virtualLP = await agentNft.virtualLP(i);
            veTokenAddress = virtualLP.veToken;
            console.log("Found matching virtualId:", i);
            console.log("VeToken address:", veTokenAddress);
            console.log("LP pool address:", virtualLP.pool);
            break;
          }
        } catch (e) {
          console.log(`Error getting virtualInfo for ${i}:`, e.message);
          continue;
        }
      }

      if (!foundVirtualId) {
        console.log(
          "Could not find virtualId for agentToken:",
          tokenInfo.agentToken
        );
        console.log("Available virtualIds and their tokens:");
        for (let i = 1; i < nextVirtualId; i++) {
          try {
            const virtualInfo = await agentNft.virtualInfo(i);
            console.log(`  ${i}: ${virtualInfo.token}`);
          } catch (e) {
            console.log(`  ${i}: Error - ${e.message}`);
          }
        }
      }

      expect(foundVirtualId).to.not.be.null;
      expect(veTokenAddress).to.not.equal(ethers.ZeroAddress);

      // Get veToken contract instance
      veTokenContract = await ethers.getContractAt(
        "AgentVeTokenV2",
        veTokenAddress
      );

      console.log("Token graduated successfully");
      console.log("AgentToken address:", tokenInfo.agentToken);
      console.log("VeToken address:", veTokenAddress);
    });

    it("After graduation, call agentVeTokenV2.removeLpLiquidity should be allowed for the agentFactoryV6", async function () {
      const { owner, admin, user1 } = accounts;
      const { agentFactoryV6, virtualToken } = contracts;

      // Verify the veToken exists and has the correct asset token
      expect(veTokenAddress).to.not.equal(ethers.ZeroAddress);
      const assetTokenFromVeToken = await veTokenContract.assetToken();
      console.log("Asset token from veToken:", assetTokenFromVeToken);

      // Check founder's veToken balance
      const founder = await veTokenContract.founder();
      const founderVeTokenBalance = await veTokenContract.balanceOf(founder);
      const veTokenOwner = await veTokenContract.owner();
      console.log("Founder:", founder);
      console.log("VeToken Owner:", veTokenOwner);
      console.log(
        "Founder veToken balance at the beginning:",
        founderVeTokenBalance
      );

      expect(founderVeTokenBalance).to.be.greaterThan(0);

      // Grant REMOVE_LIQUIDITY_ROLE to admin
      const REMOVE_LIQUIDITY_ROLE =
        await agentFactoryV6.REMOVE_LIQUIDITY_ROLE();

      // no need to grant role to admin, it's already granted in setup.js
      // await agentFactoryV6
      //   .connect(owner)
      //   .grantRole(REMOVE_LIQUIDITY_ROLE, admin.address);

      // Verify admin has the role
      expect(await agentFactoryV6.hasRole(REMOVE_LIQUIDITY_ROLE, admin.address))
        .to.be.true;

      // Get initial balances
      const initialVirtualBalance = await virtualToken.balanceOf(user1.address);
      const initialAgentTokenBalance = await actualTokenContract.balanceOf(
        user1.address
      );

      console.log(
        "Initial VIRTUAL balance of user1:",
        ethers.formatEther(initialVirtualBalance)
      );
      console.log(
        "Initial AgentToken balance of user1:",
        ethers.formatEther(initialAgentTokenBalance)
      );

      // Calculate removal amount (remove half of founder's veToken balance)
      const removalAmount = founderVeTokenBalance / 2n;
      console.log("Removal amount:", removalAmount);

      // Test that AgentFactoryV6 has the removeLpLiquidity function
      // Note: There's a bug in AgentFactoryV6.removeLpLiquidity where it uses assetToken as router
      // For this test, we'll verify the function exists and has the right signature
      expect(typeof agentFactoryV6.removeLpLiquidity).to.equal("function");

      // For demonstration, let's show what the correct call would look like
      // calling the veToken directly with factory permission
      const factoryAddress = addresses.agentFactoryV6;
      const factorySigner = await ethers.getImpersonatedSigner(factoryAddress);

      // Give factory some ETH for gas (using setBalance instead of transfer)
      await network.provider.send("hardhat_setBalance", [
        factoryAddress,
        "0x1000000000000000000", // 1 ETH in hex
      ]);

      const mockRouterAddress = addresses.mockUniswapRouter;
      // This would work if called by the factory with correct router
      const tx = await veTokenContract.connect(factorySigner).removeLpLiquidity(
        mockRouterAddress, // correct router address
        removalAmount, // veTokenAmount
        user1.address, // recipient
        0, // amountAMin (minimum tokenA)
        0, // amountBMin (minimum tokenB)
        (await time.latest()) + 300 // deadline
      );

      // Verify the transaction succeeded
      expect(tx).to.not.be.undefined;

      // Check that LiquidityRemoved event was emitted
      const receipt = await tx.wait();
      const liquidityRemovedEvent = receipt.logs.find((log) => {
        try {
          const parsed = veTokenContract.interface.parseLog(log);
          return parsed.name === "LiquidityRemoved";
        } catch (e) {
          return false;
        }
      });

      expect(liquidityRemovedEvent).to.not.be.undefined;

      if (liquidityRemovedEvent) {
        const parsedEvent = veTokenContract.interface.parseLog(
          liquidityRemovedEvent
        );
        expect(parsedEvent.args.veTokenHolder).to.equal(founder);
        expect(parsedEvent.args.veTokenAmount).to.equal(removalAmount);
        expect(parsedEvent.args.recipient).to.equal(user1.address);

        console.log(
          "✅ Liquidity removed successfully via factory permission:"
        );
        console.log(
          "- veTokenAmount (LP tokens):",
          ethers.formatEther(parsedEvent.args.veTokenAmount)
        );
        console.log(
          "- amountA (tokenA received):",
          ethers.formatEther(parsedEvent.args.amountA)
        );
        console.log(
          "- amountB (tokenB received):",
          ethers.formatEther(parsedEvent.args.amountB)
        );
        console.log(
          "📝 Note: In MockRouter, amountA + amountB = veTokenAmount due to simplified 1:1 split logic"
        );
        console.log(
          "🔍 In real Uniswap V2, amounts depend on pool reserves and LP token supply"
        );
      }

      // Verify founder's veToken balance decreased
      const founderVeTokenBalanceAfter1stRemoval =
        await veTokenContract.balanceOf(founder);
      console.log(
        "Founder veToken balance after 1st factory permission removal:",
        founderVeTokenBalanceAfter1stRemoval
      );
      expect(founderVeTokenBalanceAfter1stRemoval).to.equal(
        founderVeTokenBalance - removalAmount
      );

      console.log(
        "✅ Test completed: AgentVeTokenV2.removeLpLiquidity works when called by factory" +
          "\n"
      );

      // except for the factorySigner, the admin should also be able to call removeLpLiquidity
      const adminTx = await agentFactoryV6
        .connect(admin)
        .removeLpLiquidity(
          veTokenAddress,
          user1.address,
          removalAmount,
          0,
          0,
          (await time.latest()) + 300
        );
      expect(adminTx).to.not.be.undefined;
      const adminReceipt = await adminTx.wait();
      const adminLiquidityRemovedEvent = adminReceipt.logs.find((log) => {
        try {
          const parsed = veTokenContract.interface.parseLog(log);
          return parsed.name === "LiquidityRemoved";
        } catch (e) {
          return false;
        }
      });
      expect(adminLiquidityRemovedEvent).to.not.be.undefined;
      if (adminLiquidityRemovedEvent) {
        const parsedEvent = veTokenContract.interface.parseLog(
          adminLiquidityRemovedEvent
        );
        expect(parsedEvent.args.veTokenHolder).to.equal(founder);
        expect(parsedEvent.args.veTokenAmount).to.equal(removalAmount);
        expect(parsedEvent.args.recipient).to.equal(user1.address);
        console.log("✅ Liquidity removed successfully via admin permission:");
        console.log(
          "- veTokenAmount (LP tokens):",
          ethers.formatEther(parsedEvent.args.veTokenAmount)
        );
        console.log(
          "- amountA (tokenA received):",
          ethers.formatEther(parsedEvent.args.amountA)
        );
        console.log(
          "- amountB (tokenB received):",
          ethers.formatEther(parsedEvent.args.amountB)
        );
        console.log(
          "📝 Note: In MockRouter, amountA + amountB = veTokenAmount due to simplified 1:1 split logic"
        );
        console.log(
          "🔍 In real Uniswap V2, amounts depend on pool reserves and LP token supply"
        );
      }

      // Verify founder's veToken balance decreased
      const founderVeTokenBalanceAfter2ndRemoval =
        await veTokenContract.balanceOf(founder);
      console.log(
        "Founder veToken balance after 2nd factory permission removal:",
        founderVeTokenBalanceAfter2ndRemoval
      );
      expect(founderVeTokenBalanceAfter2ndRemoval).to.equal(
        founderVeTokenBalanceAfter1stRemoval - removalAmount
      );

      console.log(
        "✅ Test completed: AgentVeTokenV2.removeLpLiquidity works when called by admin" +
          "\n"
      );
    });

    it("Should not allow non-admin to call removeLpLiquidity", async function () {
      const { user1, user2 } = accounts;
      const { agentFactoryV6 } = contracts;

      // Get founder's veToken balance
      const founder = await veTokenContract.founder();
      const founderVeTokenBalance = await veTokenContract.balanceOf(founder);
      const removalAmount = founderVeTokenBalance / 2n;

      // user2 (non-admin) should not be able to call removeLpLiquidity
      await expect(
        agentFactoryV6
          .connect(user2)
          .removeLpLiquidity(
            veTokenAddress,
            user1.address,
            removalAmount,
            0,
            0,
            (await time.latest()) + 300
          )
      ).to.be.reverted; // Should be reverted due to missing REMOVE_LIQUIDITY_ROLE
    });

    it("Should not allow removeLpLiquidity with insufficient veToken balance", async function () {
      const { owner, admin, user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      // Grant REMOVE_LIQUIDITY_ROLE to admin
      const REMOVE_LIQUIDITY_ROLE =
        await agentFactoryV6.REMOVE_LIQUIDITY_ROLE();
      await agentFactoryV6
        .connect(owner)
        .grantRole(REMOVE_LIQUIDITY_ROLE, admin.address);

      // Get founder's veToken balance
      const founder = await veTokenContract.founder();
      const founderVeTokenBalance = await veTokenContract.balanceOf(founder);

      // Try to remove more than available balance
      const excessiveAmount = founderVeTokenBalance + ethers.parseEther("1000");

      await expect(
        agentFactoryV6
          .connect(admin)
          .removeLpLiquidity(
            veTokenAddress,
            user1.address,
            excessiveAmount,
            0,
            0,
            (await time.latest()) + 300
          )
      ).to.be.revertedWith("Insufficient veToken balance");
    });
  });

  describe(
    "first sell when no virtuals in the pool will fail \n" +
      "due to IFPairV2(pair).transferAsset(to, amount); insufficient balance",
    function () {
      it("Should fail when trying to sell tokens when pool has insufficient virtual tokens", async function () {
        const { user1, user2 } = accounts;
        const { bondingV2, virtualToken, fRouterV2 } = contracts;

        // Create and launch a token
        const tokenName = "Test Token Insufficient Liquidity";
        const tokenTicker = "TESTIL";
        const cores = [0, 1, 2];
        const description = "Test token with insufficient liquidity";
        const image = "https://example.com/image.png";
        const urls = [
          "https://twitter.com/test",
          "https://t.me/test",
          "https://youtube.com/test",
          "https://example.com",
        ];
        const purchaseAmount = ethers.parseEther("100");

        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV2, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV2
          .connect(user1)
          .preLaunch(
            tokenName,
            tokenTicker,
            cores,
            description,
            image,
            urls,
            purchaseAmount,
            startTime
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

        // Wait for start time and launch
        await time.increase(START_TIME_DELAY + 1);
        await bondingV2.launch(tokenAddress);

        // Get the pair address
        const pairAddress = await contracts.fFactoryV2.getPair(
          tokenAddress,
          addresses.virtualToken
        );
        const pair = await ethers.getContractAt("FPairV2", pairAddress);
        let [reserveA, reserveB] = await pair.getReserves();
        console.log(
          "before buy Pair reserves - reserveA:",
          ethers.formatEther(reserveA)
        );
        console.log(
          "before buy Pair reserves - reserveB:",
          ethers.formatEther(reserveB)
        );
        let pairVirtualBalance = await virtualToken.balanceOf(pairAddress);
        console.log(
          "before buy Pair virtual token balance:",
          ethers.formatEther(pairVirtualBalance)
        );

        // Get the token contract
        const tokenContract = await ethers.getContractAt(
          "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
          tokenAddress
        );

        // Get the teamTokenReservedWallet address from BondingV2 contract
        const bondingV2Contract = await ethers.getContractAt(
          "BondingV2",
          bondingV2
        );
        const launchParams = await bondingV2Contract.launchParams();
        const teamTokenReservedWallet = launchParams.teamTokenReservedWallet;
        console.log("Team token reserved wallet:", teamTokenReservedWallet);

        // Transfer tokens from teamTokenReservedWallet to user2
        const transferAmount = ethers.parseEther("1000"); // Transfer 1000 tokens
        await tokenContract
          .connect(await ethers.getSigner(teamTokenReservedWallet))
          .transfer(user2.address, transferAmount);

        // Check user2's token balance after transfer
        const user2TokenBalance = await tokenContract.balanceOf(user2.address);
        console.log(
          "User2 token balance after transfer:",
          ethers.formatEther(user2TokenBalance)
        );

        // Check the pair's virtual token balance (should be 0 since no buy happened)
        pairVirtualBalance = await virtualToken.balanceOf(pairAddress);
        console.log(
          "Pair virtual token balance (should be 0):",
          ethers.formatEther(pairVirtualBalance)
        );

        // Now try to sell tokens when pool has no virtual tokens
        const sellAmount = ethers.parseEther("100"); // Try to sell 100 tokens

        // Approve the router to spend tokens
        await tokenContract
          .connect(user2)
          .approve(addresses.fRouterV2, sellAmount);

        // Calculate what the expected amountOut would be
        const expectedAmountOut = await fRouterV2.getAmountsOut(
          tokenAddress,
          ethers.ZeroAddress,
          sellAmount
        );
        console.log(
          "Expected amountOut:",
          ethers.formatEther(expectedAmountOut)
        );
        console.log(
          "Available virtual tokens:",
          ethers.formatEther(pairVirtualBalance)
        );

        // This should fail because pool has no virtual tokens to transfer
        await expect(
          bondingV2.connect(user2).sell(
            sellAmount,
            tokenAddress,
            0, // amountOutMin
            (await time.latest()) + 300 // deadline
          )
        ).to.be.reverted; // Should fail due to insufficient virtual token balance in pair
      });
    }
  );

  describe("cancelLaunch", function () {
    it("Should fail when token does not exist", async function () {
      const { user1 } = accounts;
      const { bondingV2 } = contracts;

      // Use a random address that doesn't exist in the system
      const nonExistentToken = ethers.Wallet.createRandom().address;

      await expect(
        bondingV2.connect(user1).cancelLaunch(nonExistentToken)
      ).to.be.revertedWithCustomError(bondingV2, ERR_INVALID_INPUT);
    });

    it("Should fail when msg.sender is not the creator", async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create a token with user1
      const tokenName = "Cancel Test Token";
      const tokenTicker = "CANCEL";
      const cores = [0, 1, 2];
      const description = "Token for cancel testing";
      const image = "https://example.com/cancel.png";
      const urls = [
        "https://twitter.com/cancel",
        "https://t.me/cancel",
        "https://youtube.com/cancel",
        "https://example.com/cancel",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // user2 (not the creator) tries to cancel
      await expect(
        bondingV2.connect(user2).cancelLaunch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV2, ERR_INVALID_INPUT);
    });

    it("Should fail when token has already been launched", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create and launch a token
      const tokenName = "Already Launched Token";
      const tokenTicker = "LAUNCHED";
      const cores = [0, 1, 2];
      const description = "Token already launched";
      const image = "https://example.com/launched.png";
      const urls = [
        "https://twitter.com/launched",
        "https://t.me/launched",
        "https://youtube.com/launched",
        "https://example.com/launched",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Wait and launch the token
      await time.increase(START_TIME_DELAY + 1);
      await bondingV2.connect(user1).launch(tokenAddress);

      // Try to cancel after launch - should fail
      await expect(
        bondingV2.connect(user1).cancelLaunch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV2, ERR_INVALID_TOKEN_STATUS);
    });

    it("Should successfully cancel launch and transfer virtual tokens when initialPurchase > 0", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create a token
      const tokenName = "Cancel Success Token";
      const tokenTicker = "SUCCESS";
      const cores = [0, 1, 2];
      const description = "Token for successful cancel";
      const image = "https://example.com/success.png";
      const urls = [
        "https://twitter.com/success",
        "https://t.me/success",
        "https://youtube.com/success",
        "https://example.com/success",
      ];
      const purchaseAmount = ethers.parseEther("1000");
      const fee = await bondingV2.fee();
      const expectedInitialPurchase = purchaseAmount - fee;

      // Get user1's initial virtual token balance
      const initialUser1Balance = await virtualToken.balanceOf(user1.address);
      const initialBondingBalance = await virtualToken.balanceOf(
        addresses.bondingV2
      );

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;
      const pairAddress = parsedEvent.args.pair;

      // Get token contract instance
      const agentTokenContract = await ethers.getContractAt(
        "AgentTokenV2",
        tokenAddress
      );

      // Verify bonding contract received the initialPurchase amount
      const bondingBalanceAfterPreLaunch = await virtualToken.balanceOf(
        addresses.bondingV2
      );
      expect(bondingBalanceAfterPreLaunch).to.equal(
        initialBondingBalance + expectedInitialPurchase
      );

      // Get token info before cancel
      let tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.initialPurchase).to.equal(expectedInitialPurchase);
      expect(tokenInfo.launchExecuted).to.be.false;

      // Cancel the launch
      const cancelTx = await bondingV2
        .connect(user1)
        .cancelLaunch(tokenAddress);
      const cancelReceipt = await cancelTx.wait();

      // Verify CancelledLaunch event was emitted
      const cancelEvent = cancelReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "CancelledLaunch";
        } catch (e) {
          return false;
        }
      });

      expect(cancelEvent).to.not.be.undefined;
      const parsedCancelEvent = bondingV2.interface.parseLog(cancelEvent);
      expect(parsedCancelEvent.args.token).to.equal(tokenAddress);
      expect(parsedCancelEvent.args.pair).to.equal(pairAddress);

      // Verify virtual tokens were transferred back to creator
      const user1BalanceAfterCancel = await virtualToken.balanceOf(
        user1.address
      );
      const bondingBalanceAfterCancel = await virtualToken.balanceOf(
        addresses.bondingV2
      );

      // Note: user1 paid purchaseAmount, got back expectedInitialPurchase (fee was sent to feeTo)
      expect(user1BalanceAfterCancel).to.equal(
        initialUser1Balance - purchaseAmount + expectedInitialPurchase
      );
      expect(bondingBalanceAfterCancel).to.equal(initialBondingBalance);

      // Verify token info was updated
      tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.initialPurchase).to.equal(0);
      expect(tokenInfo.launchExecuted).to.be.true;

      console.log("✅ Cancel launch successful:");
      console.log(
        "- Initial purchase returned:",
        ethers.formatEther(expectedInitialPurchase)
      );
      console.log(
        "- Token info updated: initialPurchase = 0, launchExecuted = true"
      );
    });

    it("Should successfully cancel launch without transfer when initialPurchase = 0", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create a token with purchase amount equal to fee (so initialPurchase = 0)
      const tokenName = "Zero Initial Purchase Token";
      const tokenTicker = "ZERO";
      const cores = [0, 1, 2];
      const description = "Token with zero initial purchase";
      const image = "https://example.com/zero.png";
      const urls = [
        "https://twitter.com/zero",
        "https://t.me/zero",
        "https://youtube.com/zero",
        "https://example.com/zero",
      ];
      const fee = await bondingV2.fee();
      const purchaseAmount = fee; // Exactly equal to fee, so initialPurchase = 0

      const initialUser1Balance = await virtualToken.balanceOf(user1.address);
      const initialBondingBalance = await virtualToken.balanceOf(
        addresses.bondingV2
      );

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify initialPurchase is 0
      let tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.initialPurchase).to.equal(0);

      // Cancel the launch
      const cancelTx = await bondingV2
        .connect(user1)
        .cancelLaunch(tokenAddress);
      const cancelReceipt = await cancelTx.wait();

      // Verify CancelledLaunch event was emitted
      const cancelEvent = cancelReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "CancelledLaunch";
        } catch (e) {
          return false;
        }
      });

      expect(cancelEvent).to.not.be.undefined;

      // Verify no virtual tokens were transferred (since initialPurchase was 0)
      const user1BalanceAfterCancel = await virtualToken.balanceOf(
        user1.address
      );
      const bondingBalanceAfterCancel = await virtualToken.balanceOf(
        addresses.bondingV2
      );

      // User should have lost only the fee
      expect(user1BalanceAfterCancel).to.equal(
        initialUser1Balance - purchaseAmount
      );
      // Bonding contract balance should remain the same (no initialPurchase to return)
      expect(bondingBalanceAfterCancel).to.equal(initialBondingBalance);

      // Verify token info was updated
      tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.initialPurchase).to.equal(0);
      expect(tokenInfo.launchExecuted).to.be.true;

      console.log("✅ Cancel launch with zero initialPurchase successful:");
      console.log("- No tokens transferred (initialPurchase was 0)");
      console.log(
        "- Token info updated: initialPurchase = 0, launchExecuted = true"
      );
    });

    it("Should fail when trying to cancel again after already cancelled", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create a token
      const tokenName = "Double Cancel Token";
      const tokenTicker = "DOUBLE";
      const cores = [0, 1, 2];
      const description = "Token for double cancel testing";
      const image = "https://example.com/double.png";
      const urls = [
        "https://twitter.com/double",
        "https://t.me/double",
        "https://youtube.com/double",
        "https://example.com/double",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Cancel the launch for the first time
      await bondingV2.connect(user1).cancelLaunch(tokenAddress);

      // Try to cancel again - should fail
      await expect(
        bondingV2.connect(user1).cancelLaunch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV2, ERR_INVALID_TOKEN_STATUS);
    });

    it("Should verify all state changes after successful cancel", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create a token
      const tokenName = "State Verification Token";
      const tokenTicker = "STATE";
      const cores = [0, 1, 2];
      const description = "Token for state verification";
      const image = "https://example.com/state.png";
      const urls = [
        "https://twitter.com/state",
        "https://t.me/state",
        "https://youtube.com/state",
        "https://example.com/state",
      ];
      const purchaseAmount = ethers.parseEther("1000");
      const fee = await bondingV2.fee();
      const expectedInitialPurchase = purchaseAmount - fee;

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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

      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;
      const pairAddress = parsedEvent.args.pair;
      const virtualId = parsedEvent.args[2];

      // Get initial state
      let tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
      expect(tokenInfo.token).to.equal(tokenAddress);
      expect(tokenInfo.pair).to.equal(pairAddress);
      expect(tokenInfo.initialPurchase).to.equal(expectedInitialPurchase);
      expect(tokenInfo.launchExecuted).to.be.false;

      // Cancel the launch
      const cancelTx = await bondingV2
        .connect(user1)
        .cancelLaunch(tokenAddress);
      const cancelReceipt = await cancelTx.wait();

      // Verify CancelledLaunch event with all parameters
      const cancelEvent = cancelReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "CancelledLaunch";
        } catch (e) {
          return false;
        }
      });

      expect(cancelEvent).to.not.be.undefined;
      const parsedCancelEvent = bondingV2.interface.parseLog(cancelEvent);
      expect(parsedCancelEvent.args.token).to.equal(tokenAddress);
      expect(parsedCancelEvent.args.pair).to.equal(pairAddress);
      expect(parsedCancelEvent.args[2]).to.equal(virtualId);
      // Note: initialPurchase in event should be 0 because it's read after being set to 0
      expect(parsedCancelEvent.args.initialPurchase).to.equal(0);

      // Verify final state
      tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.initialPurchase).to.equal(0);
      expect(tokenInfo.launchExecuted).to.be.true;
      // Other fields should remain unchanged
      expect(tokenInfo.creator).to.equal(user1.address);
      expect(tokenInfo.token).to.equal(tokenAddress);
      expect(tokenInfo.pair).to.equal(pairAddress);

      console.log("✅ All state changes verified:");
      console.log("- initialPurchase: reset to 0");
      console.log("- launchExecuted: set to true");
      console.log("- CancelledLaunch event emitted with correct parameters");
      console.log("- Other token info fields remain unchanged");
    });
  });

  describe("call launch for a token that hasn't prelaunched or not exist:", function () {
    it("Should fail when trying to launch a token that doesn't exist", async function () {
      const { bondingV2 } = contracts;
      const tokenAddress = ethers.ZeroAddress;
      await expect(
        bondingV2.launch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV2, "InvalidInput");
    });

    it("Should fail when trying to launch a token that hasn't prelaunched", async function () {
      const { bondingV2, virtualToken } = contracts;
      const { user1 } = accounts;
      const tokenAddressHasNotPreLaunched = ethers.ZeroAddress;
      const tokenName = "Test Token Not Exists";
      const tokenTicker = "TESTNE";
      const cores = [0, 1, 2];
      const description = "Test token that doesn't exist";
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

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV2
        .connect(user1)
        .preLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
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
      await expect(
        bondingV2.launch(tokenAddressHasNotPreLaunched)
      ).to.be.revertedWithCustomError(bondingV2, "InvalidInput");
    });
  });
});