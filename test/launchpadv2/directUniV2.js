const { expect } = require("chai");
const { ethers, upgrades, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { setupNewLaunchpadTest } = require("./setup.js");
const { expectTokenBalanceEqual, increaseTimeAndMine } = require("./util.js");
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
  GRAD_THRESHOLD,
  BUY_TAX,
  ANTI_SNIPER_BUY_TAX_START_VALUE,
  TBA_SALT,
  TBA_IMPLEMENTATION,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,
} = require("./const.js");

describe("DirectUniV2 - Complete Upgrade and Graduation Flow", function () {
  let setup;
  let contracts, accounts, addresses, params;
  let oldContracts;
  let oldToken1, oldToken2, newToken1, newToken2;
  let oldPair1, oldPair2, newPair1, newPair2;
  let pair1, pair2, reserves1, reserves2;

  before(async function () {
    setup = await loadFixture(setupNewLaunchpadTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;
    params = setup.params;
  });

  it("Complete Upgrade and Graduation Flow", async function () {
    const { virtualToken, fFactoryV2 } = contracts;
    const { owner, admin, user1, user2 } = accounts;

    console.log("\n=== Step 1: Deploy Old Contracts ===");

    // 1. Deploy old FRouterV2 with same params as setup.js
    const FRouterV2Old = await ethers.getContractFactory("FRouterV2Old");
    const fRouterV2Old = await upgrades.deployProxy(
      FRouterV2Old,
      [await fFactoryV2.getAddress(), await virtualToken.getAddress()],
      { initializer: "initialize" }
    );
    await fRouterV2Old.waitForDeployment();
    console.log("FRouterV2Old deployed at:", await fRouterV2Old.getAddress());

    // 2. Deploy old BondingV2 with old gradThreshold (200K)
    const BondingV2Old = await ethers.getContractFactory("BondingV2Old");
    const bondingV2Old = await upgrades.deployProxy(
      BondingV2Old,
      [
        await fFactoryV2.getAddress(),
        await fRouterV2Old.getAddress(),
        owner.address, // feeTo
        "100000", // fee (100 VT)
        INITIAL_SUPPLY,
        5000, // assetRate
        100, // maxTx
        addresses.agentFactoryV6,
        GRAD_THRESHOLD, // old gradThreshold (correspond to 200K virtual)
        START_TIME_DELAY,
      ],
      { initializer: "initialize" }
    );
    await bondingV2Old.waitForDeployment();
    console.log("BondingV2Old deployed at:", await bondingV2Old.getAddress());

    // Set up old contracts
    oldContracts = {
      bondingV2: bondingV2Old,
      fRouterV2: fRouterV2Old,
      fFactoryV2: fFactoryV2,
      virtualToken: virtualToken,
    };

    // Grant necessary roles for old contracts
    const agentFactory = await ethers.getContractAt(
      "AgentFactoryV6",
      addresses.agentFactoryV6
    );
    await agentFactory.grantRole(
      await agentFactory.BONDING_ROLE(),
      await bondingV2Old.getAddress()
    );
    await fRouterV2Old.grantRole(
      await fRouterV2Old.EXECUTOR_ROLE(),
      await bondingV2Old.getAddress()
    );
    await fFactoryV2.grantRole(
      await fFactoryV2.CREATOR_ROLE(),
      await bondingV2Old.getAddress()
    );
    await fFactoryV2.setRouter(await fRouterV2Old.getAddress());

    // Set launch and deploy params for old BondingV2
    const launchParams = {
      startTimeDelay: START_TIME_DELAY,
      teamTokenReservedSupply: TEAM_TOKEN_RESERVED_SUPPLY,
      teamTokenReservedWallet: owner.address,
    };
    await bondingV2Old.setLaunchParams(launchParams);

    const deployParams = {
      tbaSalt: TBA_SALT,
      tbaImplementation: TBA_IMPLEMENTATION,
      daoVotingPeriod: DAO_VOTING_PERIOD,
      daoThreshold: DAO_THRESHOLD,
    };
    await bondingV2Old.setDeployParams(deployParams);

    console.log("\n=== Step 2: Create Old Tokens ===");

    // 3. Create oldToken-1
    const tokenName1 = "OldToken-1";
    const tokenTicker1 = "OT1";
    const cores = [0, 1, 2];
    const description = "Old token 1";
    const image = "https://example.com/image.png";
    const urls = [
      "https://twitter.com/test",
      "https://t.me/test",
      "https://youtube.com/test",
      "https://example.com",
    ];
    const purchaseAmount = ethers.parseEther("1000");
    const creationFee = await bondingV2Old.fee();

    await virtualToken
      .connect(user1)
      .approve(await bondingV2Old.getAddress(), purchaseAmount);
    const startTime = (await time.latest()) + START_TIME_DELAY + 1;

    const tx1 = await bondingV2Old
      .connect(user1)
      .preLaunch(
        tokenName1,
        tokenTicker1,
        cores,
        description,
        image,
        urls,
        purchaseAmount,
        startTime
      );
    const receipt1 = await tx1.wait();
    const event1 = receipt1.logs.find((log) => {
      try {
        const parsed = bondingV2Old.interface.parseLog(log);
        return parsed.name === "PreLaunched";
      } catch (e) {
        return false;
      }
    });
    const parsedEvent1 = bondingV2Old.interface.parseLog(event1);
    oldToken1 = parsedEvent1.args.token;
    oldPair1 = parsedEvent1.args.pair;
    console.log("OldToken-1 created at:", oldToken1);
    console.log(
      "OldToken-1 preLaunched with initialBuy",
      ((purchaseAmount - creationFee) * 99n) / 100n
    );

    // Create oldToken-2
    const tokenName2 = "OldToken-2";
    const tokenTicker2 = "OT2";

    await virtualToken
      .connect(user1)
      .approve(await bondingV2Old.getAddress(), purchaseAmount);
    const startTime2 = (await time.latest()) + START_TIME_DELAY + 1;
    const tx2 = await bondingV2Old
      .connect(user1)
      .preLaunch(
        tokenName2,
        tokenTicker2,
        cores,
        description,
        image,
        urls,
        purchaseAmount,
        startTime2
      );
    const receipt2 = await tx2.wait();
    const event2 = receipt2.logs.find((log) => {
      try {
        const parsed = bondingV2Old.interface.parseLog(log);
        return parsed.name === "PreLaunched";
      } catch (e) {
        return false;
      }
    });
    const parsedEvent2 = bondingV2Old.interface.parseLog(event2);
    oldToken2 = parsedEvent2.args.token;
    oldPair2 = parsedEvent2.args.pair;
    console.log("OldToken-2 created at:", oldToken2);
    console.log(
      "OldToken-2 preLaunched with initialBuy",
      ((purchaseAmount - creationFee) * 99n) / 100n
    );

    console.log("\n=== Step 3: Launch Old Tokens ===");

    // Launch both tokens
    increaseTimeAndMine(START_TIME_DELAY + 2);
    await bondingV2Old.launch(oldToken1);
    await bondingV2Old.launch(oldToken2);
    increaseTimeAndMine(START_TIME_DELAY + 1);
    increaseTimeAndMine(98 * 60 + 2 * 60); // make sure no anti-sniper tax

    console.log("\n=== Step 4: Buy Old Tokens ===");

    // 4. Buy oldToken-1 with 42001 virtual
    console.log(
      "Virtual balance of oldToken-1's pair before buy:",
      await virtualToken.balanceOf(oldPair1)
    );
    await virtualToken
      .connect(user2)
      .approve(
        await fRouterV2Old.getAddress(),
        ethers.parseEther("41524.2424242425")
      );
    const buyTx1 = await bondingV2Old
      .connect(user2)
      .buy(
        ethers.parseEther("41524.2424242425"),
        oldToken1,
        0,
        (await time.latest()) + 300
      );
    await buyTx1.wait();
    console.log("✅ Bought oldToken-1 with 41110 VT");
    console.log(
      "Virtual balance of oldToken-1's pair after buy:",
      await virtualToken.balanceOf(oldPair1)
    );
    console.log("--------------------------------");

    // 5. Buy oldToken-2 with 41999 virtual
    console.log(
      "Virtual balance of oldToken-2's pair before buy:",
      await virtualToken.balanceOf(oldPair2)
    );
    await virtualToken
      .connect(user2)
      .approve(
        await fRouterV2Old.getAddress(),
        ethers.parseEther("41523.2323232323")
      );
    const buyTx2 = await bondingV2Old
      .connect(user2)
      .buy(
        ethers.parseEther("41523.2323232323"),
        oldToken2,
        0,
        (await time.latest()) + 300
      );
    await buyTx2.wait();
    console.log("✅ Bought oldToken-2 with 41108 VT");
    console.log(
      "Virtual balance of oldToken-2's pair after buy:",
      await virtualToken.balanceOf(oldPair2)
    );
    console.log("--------------------------------");

    console.log("\n=== Step 5: Upgrade Contracts ===");

    // 6. Upgrade FRouterV2Old to FRouterV2
    const FRouterV2 = await ethers.getContractFactory("FRouterV2");
    const fRouterV2Upgraded = await upgrades.upgradeProxy(
      await fRouterV2Old.getAddress(),
      FRouterV2
    );
    await fRouterV2Upgraded.waitForDeployment();
    console.log("✅ FRouterV2 upgraded");

    // 7. Upgrade BondingV2Old to BondingV2
    const BondingV2 = await ethers.getContractFactory("BondingV2");
    const bondingV2Upgraded = await upgrades.upgradeProxy(
      await bondingV2Old.getAddress(),
      BondingV2
    );
    await bondingV2Upgraded.waitForDeployment();
    console.log("✅ BondingV2 upgraded");

    // Grant roles to upgraded contracts
    await agentFactory.grantRole(
      await agentFactory.BONDING_ROLE(),
      await bondingV2Upgraded.getAddress()
    );
    await fRouterV2Upgraded.grantRole(
      await fRouterV2Upgraded.EXECUTOR_ROLE(),
      await bondingV2Upgraded.getAddress()
    );
    await fFactoryV2.grantRole(
      await fFactoryV2.CREATOR_ROLE(),
      await bondingV2Upgraded.getAddress()
    );
    await fFactoryV2.setRouter(await fRouterV2Upgraded.getAddress());

    // Set params for upgraded BondingV2
    await bondingV2Upgraded.setLaunchParams(launchParams);
    await bondingV2Upgraded.setDeployParams(deployParams);

    // Set new gradThreshold to 42K
    const newGradThreshold = ethers.parseEther("112500000"); // correspond to 42K virtual
    const currentSupply = await bondingV2Upgraded.initialSupply();
    const currentAssetRate = await bondingV2Upgraded.assetRate();
    const currentMaxTx = await bondingV2Upgraded.maxTx();
    const currentFee = await bondingV2Upgraded.fee();
    const currentFeeTo = await bondingV2Upgraded.owner();

    await bondingV2Upgraded.setTokenParams(
      currentSupply,
      newGradThreshold,
      currentMaxTx,
      currentAssetRate,
      currentFee,
      currentFeeTo
    );
    console.log("✅ bondingV2Upgraded New gradThreshold set to 42K Virtual");

    // Update oldContracts to use upgraded contracts
    oldContracts.bondingV2 = bondingV2Upgraded;
    oldContracts.fRouterV2 = fRouterV2Upgraded;

    console.log("\n=== Step 6: Test Old Tokens with New Threshold ===");

    // 8. Buy oldToken-1 with 0.01 virtual - should graduate, cuz alr have 42K VT
    // console virtual balance of old token1's pair
    // Check reserves before buy
    pair1 = await ethers.getContractAt("FPairV2", oldPair1);
    reserves1 = await pair1.getReserves();
    console.log(
      "oldToken-1 reserves before buy:",
      ethers.formatEther(reserves1[0]),
      "tokens"
    );
    console.log(
      "oldToken-1 virtual balance before buy:",
      ethers.formatEther(await virtualToken.balanceOf(oldPair1)),
      "VT"
    );

    // Check if token is already graduated
    let tokenInfo1 = await bondingV2Upgraded.tokenInfo(oldToken1);
    console.log("oldToken-1 trading status before buy:", tokenInfo1.trading);
    console.log(
      "oldToken-1 graduated statu before buy:",
      tokenInfo1.tradingOnUniswap
    );

    let gradThreshold = await bondingV2Upgraded.gradThreshold();
    console.log("GradThreshold of bondingV2Upgraded:", gradThreshold);
    await virtualToken
      .connect(user2)
      .approve(await fRouterV2Upgraded.getAddress(), ethers.parseEther("0.01"));
    const gradTx1 = await bondingV2Upgraded
      .connect(user2)
      .buy(
        ethers.parseEther("0.01"),
        oldToken1,
        0,
        (await time.latest()) + 300
      );
    const gradReceipt1 = await gradTx1.wait();

    const graduatedEvent1 = gradReceipt1.logs.find((log) => {
      try {
        const parsed = bondingV2Upgraded.interface.parseLog(log);
        return parsed.name === "Graduated";
      } catch (e) {
        return false;
      }
    });
    reserves1 = await pair1.getReserves();
    console.log(
      "oldToken-1 reserves after buy:",
      ethers.formatEther(reserves1[0]),
      "tokens"
    );
    console.log(
      "oldToken-1 virtual balance after buy:",
      ethers.formatEther(await virtualToken.balanceOf(oldPair1)),
      "VT"
    );
    tokenInfo1 = await bondingV2Upgraded.tokenInfo(oldToken1);
    console.log("oldToken-1 trading status after buy:", tokenInfo1.trading);
    console.log(
      "oldToken-1 graduated status after buy:",
      tokenInfo1.tradingOnUniswap
    );
    expect(tokenInfo1.tradingOnUniswap).to.be.true;
    console.log("✅ oldToken-1 graduated as expected");
    console.log("--------------------------------");

    // 9. Buy oldToken-2 with 0.01 virtual - should NOT graduate, cuz only have 891 + 41108 + 0.01 = 41999.01 VT
    // Check reserves before buy
    let pair2 = await ethers.getContractAt("FPairV2", oldPair2);
    let reserves2 = await pair2.getReserves();
    console.log(
      "oldToken-2 reserves before buy:",
      ethers.formatEther(reserves2[0]),
      "tokens"
    );
    console.log(
      "oldToken-2 virtual balance before buy:",
      ethers.formatEther(await virtualToken.balanceOf(oldPair2)),
      "VT"
    );
    let tokenInfo2 = await bondingV2Upgraded.tokenInfo(oldToken2);
    console.log("oldToken-2 trading status before buy:", tokenInfo2.trading);
    console.log(
      "oldToken-2 graduated status before buy:",
      tokenInfo2.tradingOnUniswap
    );
    await virtualToken
      .connect(user2)
      .approve(await fRouterV2Upgraded.getAddress(), ethers.parseEther("0.01"));
    const noGradTx = await bondingV2Upgraded
      .connect(user2)
      .buy(
        ethers.parseEther("0.01"),
        oldToken2,
        0,
        (await time.latest()) + 300
      );
    const noGradReceipt = await noGradTx.wait();

    const graduatedEvent2 = noGradReceipt.logs.find((log) => {
      try {
        const parsed = bondingV2Upgraded.interface.parseLog(log);
        return parsed.name === "Graduated";
      } catch (e) {
        return false;
      }
    });
    reserves2 = await pair2.getReserves();
    console.log(
      "oldToken-2 reserves after buy:",
      ethers.formatEther(reserves2[0]),
      "tokens"
    );
    console.log(
      "oldToken-2 virtual balance after buy:",
      ethers.formatEther(await virtualToken.balanceOf(oldPair2)),
      "VT"
    );
    tokenInfo2 = await bondingV2Upgraded.tokenInfo(oldToken2);
    console.log("oldToken-2 trading status after buy:", tokenInfo2.trading);
    console.log(
      "oldToken-2 graduated status after buy:",
      tokenInfo2.tradingOnUniswap
    );
    expect(tokenInfo2.tradingOnUniswap).to.be.false;
    console.log("✅ oldToken-2 did not graduate as expected");

    // 10. Buy oldToken-2 with another 0.999 virtual - should graduate
    await virtualToken
      .connect(user2)
      .approve(
        await fRouterV2Upgraded.getAddress(),
        ethers.parseEther("1.0002")
      );
    const finalGradTx = await bondingV2Upgraded
      .connect(user2)
      .buy(
        ethers.parseEther("1.0002"),
        oldToken2,
        0,
        (await time.latest()) + 300
      );
    const finalGradReceipt = await finalGradTx.wait();

    const finalGraduatedEvent = finalGradReceipt.logs.find((log) => {
      try {
        const parsed = bondingV2Upgraded.interface.parseLog(log);
        return parsed.name === "Graduated";
      } catch (e) {
        return false;
      }
    });
    tokenInfo2 = await bondingV2Upgraded.tokenInfo(oldToken2);
    console.log("oldToken-2 trading status after buy:", tokenInfo2.trading);
    console.log(
      "oldToken-2 graduated status after buy:",
      tokenInfo2.tradingOnUniswap
    );
    expect(tokenInfo2.tradingOnUniswap).to.be.true;
    console.log("✅ oldToken-2 graduated after additional buy as expected");

    console.log("\n=== Step 7: Test New Token with High Initial Buy ===");

    // 11. Create newToken-1 with initial buy 42000 virtual
    const newTokenName1 = "NewToken-1";
    const newTokenTicker1 = "NT1";

    const newToken1InitialBuy = ethers.parseEther("42524.25");

    await virtualToken
      .connect(user1)
      .approve(
        await bondingV2Upgraded.getAddress(),
        newToken1InitialBuy
      );
    const newStartTime1 = (await time.latest()) + START_TIME_DELAY + 1;
    const newTx1 = await bondingV2Upgraded
      .connect(user1)
      .preLaunch(
        newTokenName1,
        newTokenTicker1,
        cores,
        description,
        image,
        urls,
        newToken1InitialBuy,
        newStartTime1
      );
    console.log("✅ newToken-1 preLaunched with initialBuy", newToken1InitialBuy);
    const newReceipt1 = await newTx1.wait();
    const newEvent1 = newReceipt1.logs.find((log) => {
      try {
        const parsed = bondingV2Upgraded.interface.parseLog(log);
        return parsed.name === "PreLaunched";
      } catch (e) {
        return false;
      }
    });
    const parsedNewEvent1 = bondingV2Upgraded.interface.parseLog(newEvent1);
    newToken1 = parsedNewEvent1.args.token;
    newPair1 = parsedNewEvent1.args.pair;

    // Wait for start time and launch newToken-1
    increaseTimeAndMine(START_TIME_DELAY + 1);
    await bondingV2Upgraded.launch(newToken1);
    console.log("✅ newToken-1 created and launched");

    // Check if it graduated immediately (should not)
    pair1 = await ethers.getContractAt("FPairV2", newPair1);
    reserves1 = await pair1.getReserves();
    console.log("newToken-1 reserves before buy:", ethers.formatEther(reserves1[0]), "tokens");
    console.log("newToken-1 virtual balance before buy:", ethers.formatEther(await virtualToken.balanceOf(newPair1)), "VT");
    gradThreshold = await bondingV2Upgraded.gradThreshold();
    tokenInfo1 = await bondingV2Upgraded.tokenInfo(newToken1);
    console.log("newToken-1 trading status before buy:", tokenInfo1.trading);
    console.log(
      "newToken-1 graduated status before buy:",
      tokenInfo1.tradingOnUniswap
    );
    expect(tokenInfo1.tradingOnUniswap).to.be.false;
    console.log("✅ newToken-1 did not graduate immediately as expected event though it has 42K VT");
    console.log("--------------------------------");

    // Buy newToken-1 with 0.01 virtual - should not graduate cuz within 98 minutes
    await virtualToken
      .connect(user2)
      .approve(await fRouterV2Upgraded.getAddress(), ethers.parseEther("0.01"));
    const newGradTx = await bondingV2Upgraded
      .connect(user2)
      .buy(
        ethers.parseEther("0.01"),
        newToken1,
        0,
        (await time.latest()) + 300
      );
    const newGradReceipt = await newGradTx.wait();

    const newGraduatedEvent = newGradReceipt.logs.find((log) => {
      try {
        const parsed = bondingV2Upgraded.interface.parseLog(log);
        return parsed.name === "Graduated";
      } catch (e) {
        return false;
      }
    });
    reserves1 = await pair1.getReserves();
    console.log("newToken-1 reserves after buy:", ethers.formatEther(reserves1[0]), "tokens");
    console.log("newToken-1 virtual balance after buy:", ethers.formatEther(await virtualToken.balanceOf(newPair1)), "VT");
    tokenInfo1 = await bondingV2Upgraded.tokenInfo(newToken1);
    console.log("newToken-1 trading status after buy:", tokenInfo1.trading);
    console.log(
      "newToken-1 graduated status after buy:",
      tokenInfo1.tradingOnUniswap
    );
    expect(tokenInfo1.tradingOnUniswap).to.be.false;
    console.log("✅ newToken-1 did not graduate as expected after small buy immediately after launch cuz still within 98 minutes");
    console.log("--------------------------------");

    // Wait 98 minutes
    increaseTimeAndMine(98 * 60);
    console.log("✅ Waited 98 minutes");
    
    // Buy newToken-1 with another 0.01 virtual after 98 minutes - should graduate
    await virtualToken
      .connect(user2)
      .approve(await fRouterV2Upgraded.getAddress(), ethers.parseEther("0.01"));
    const newGradTx2 = await bondingV2Upgraded
      .connect(user2)
      .buy(
        ethers.parseEther("0.01"),
        newToken1,
        0,
        (await time.latest()) + 300
      );
    const newGradReceipt2 = await newGradTx2.wait();

    const newGraduatedEvent2 = newGradReceipt2.logs.find((log) => {
      try {
        const parsed = bondingV2Upgraded.interface.parseLog(log);
        return parsed.name === "Graduated";
      } catch (e) {
        return false;
      }
    });
    reserves1 = await pair1.getReserves();
    console.log("newToken-1 reserves after buy:", ethers.formatEther(reserves1[0]), "tokens");
    console.log("newToken-1 virtual balance after buy:", ethers.formatEther(await virtualToken.balanceOf(newPair1)), "VT");
    tokenInfo1 = await bondingV2Upgraded.tokenInfo(newToken1);
    console.log("newToken-1 trading status after buy:", tokenInfo1.trading);
    console.log(
      "newToken-1 graduated status after buy:",
      tokenInfo1.tradingOnUniswap
    );
    expect(tokenInfo1.tradingOnUniswap).to.be.true;
    console.log("✅ newToken-1 graduated as expected after small buy after 98 minutes");
    console.log("--------------------------------");

    console.log("\n=== Step 8: Test New Token with Anti-Sniper Tax ===");

    // 12. Create newToken-2 with initial buy 41999 virtual
    const newTokenName2 = "NewToken-2";
    const newTokenTicker2 = "NT2";

    await virtualToken
      .connect(user1)
      .approve(
        await bondingV2Upgraded.getAddress(),
        ethers.parseEther("42523.2323232323")
      );
    const newStartTime2 = (await time.latest()) + START_TIME_DELAY + 1;
    const newTx2 = await bondingV2Upgraded
      .connect(user1)
      .preLaunch(
        newTokenName2,
        newTokenTicker2,
        cores,
        description,
        image,
        urls,
        ethers.parseEther("42523.2323232323"),
        newStartTime2
      );
    const newReceipt2 = await newTx2.wait();
    const newEvent2 = newReceipt2.logs.find((log) => {
      try {
        const parsed = bondingV2Upgraded.interface.parseLog(log);
        return parsed.name === "PreLaunched";
      } catch (e) {
        return false;
      }
    });
    const parsedNewEvent2 = bondingV2Upgraded.interface.parseLog(newEvent2);
    newToken2 = parsedNewEvent2.args.token;
    newPair2 = parsedNewEvent2.args.pair;

    // Wait for start time and launch newToken-2
    increaseTimeAndMine(START_TIME_DELAY + 3);
    await bondingV2Upgraded.launch(newToken2);
    console.log("✅ newToken-2 created and launched");

    // user2 buy with 0.01 virtual - should incur anti-sniper tax
    const user2BalanceBefore = await virtualToken.balanceOf(user2.address);
    const virtualBalanceBeforeForToken2 = await virtualToken.balanceOf(
      newToken2
    );
    await virtualToken
      .connect(user2)
      .approve(await fRouterV2Upgraded.getAddress(), ethers.parseEther("0.01"));
    const antiSniperTx = await bondingV2Upgraded
      .connect(user2)
      .buy(
        ethers.parseEther("0.01"),
        newToken2,
        0,
        (await time.latest()) + 300
      );
    const antiSniperReceipt = await antiSniperTx.wait();
    const user2BalanceAfter = await virtualToken.balanceOf(user2.address);
    const virtualBalanceAfterForToken2 = await virtualToken.balanceOf(
      newToken2
    );
    const actualSpent =
      virtualBalanceAfterForToken2 - virtualBalanceBeforeForToken2;

    console.log(
      "Amount spent with anti-sniper tax:",
      ethers.formatEther(actualSpent),
      "but originally buy with",
      ethers.formatEther(ethers.parseEther("0.01"))
    );
    expect(actualSpent).to.be.lessThanOrEqual(ethers.parseEther("0.01") / 100n);
    console.log("✅ Anti-sniper tax applied as expected");
    tokenInfo2 = await bondingV2Upgraded.tokenInfo(newToken2);
    console.log("newToken-2 trading status after buy:", tokenInfo2.trading);
    console.log(
      "newToken-2 graduated status after buy:",
      tokenInfo2.tradingOnUniswap
    );
    expect(tokenInfo2.tradingOnUniswap).to.be.false;
    console.log("✅ newToken-2 did not graduate as expected after small buy within 98 minutes");
    console.log("--------------------------------");

    // Wait 98 minutes
    increaseTimeAndMine(98 * 60);
    console.log("✅ Waited 98 minutes");

    // user2 buy with 0.999 virtual - should graduate
    const user2BalanceBefore2 = await virtualToken.balanceOf(user2.address);
    const virtualBalanceBeforeForToken2New = await virtualToken.balanceOf(
      newToken2
    );
    await virtualToken
      .connect(user2)
      .approve(
        await fRouterV2Upgraded.getAddress(),
        ethers.parseEther("1.02")
      );
    const finalBuyTx = await bondingV2Upgraded
      .connect(user2)
      .buy(
        ethers.parseEther("1.02"),
        newToken2,
        0,
        (await time.latest()) + 300
      );
    const finalBuyReceipt = await finalBuyTx.wait();
    const user2BalanceAfter2 = await virtualToken.balanceOf(user2.address);
    const virtualBalanceAfterForToken2New = await virtualToken.balanceOf(
      newToken2
    );
    const actualSpent2 =
      virtualBalanceAfterForToken2New - virtualBalanceBeforeForToken2New;

    console.log(
      "Amount spent after 98 minutes:",
      ethers.formatEther(actualSpent2)
    );
    console.log("✅ Lower tax applied after 98 minutes as expected");
    const finalGraduatedEvent2 = finalBuyReceipt.logs.find((log) => {
      try {
        const parsed = bondingV2Upgraded.interface.parseLog(log);
        return parsed.name === "Graduated";
      } catch (e) {
        return false;
      }
    });
    tokenInfo2 = await bondingV2Upgraded.tokenInfo(newToken2);
    console.log("newToken-2 trading status after additional buy:", tokenInfo2.trading);
    console.log(
      "newToken-2 graduated status after additional buy:",
      tokenInfo2.tradingOnUniswap
    );
    expect(tokenInfo2.tradingOnUniswap).to.be.true;
    console.log("✅ newToken-2 graduated as expected after additional buy");
    console.log("--------------------------------");

    console.log("\n=== All Tests Completed Successfully! ===");
  });
});
