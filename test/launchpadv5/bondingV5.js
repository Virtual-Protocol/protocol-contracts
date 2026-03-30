const { expect } = require("chai");
const { ethers, upgrades, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const {
  expectTokenBalanceEqual,
  expectApproximatelyEqual,
  increaseTimeByMinutes,
  increaseTimeAndMine,
  increaseTimeByDays,
} = require("../launchpadv2/util.js");

const {
  ERR_INVALID_TOKEN_STATUS,
  ERR_INVALID_INPUT,
  ERR_SLIPPAGE_TOO_HIGH,
  ERR_ZERO_ADDRESSES,
  ERR_AMOUNT_MUST_BE_GREATER_THAN_ZERO,
  START_TIME_DELAY,
  INITIAL_SUPPLY,
  ERR_INVALID_START_TIME,
  TBA_SALT,
  TBA_IMPLEMENTATION,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,
  BUY_TAX,
  SELL_TAX,
  ANTI_SNIPER_BUY_TAX_START_VALUE,
  FFactoryV2_ANTI_SNIPER_TAX_VAULT,
} = require("../launchpadv2/const.js");

// BondingV5 launch mode constants (only 3 modes now)
const LAUNCH_MODE_NORMAL = 0;
const LAUNCH_MODE_X_LAUNCH = 1;
const LAUNCH_MODE_ACP_SKILL = 2;

// Reserve supply parameters (in bips, 1 bip = 0.01%, e.g., 500 = 5.00%)
const MAX_AIRDROP_BIPS = 500;
const MAX_TOTAL_RESERVED_BIPS = 5500; // At least 45% must remain in bonding curve
const ACF_RESERVED_BIPS = 5000; // ACF operations reserve 50%

// Anti-sniper tax type constants
const ANTI_SNIPER_NONE = 0;
const ANTI_SNIPER_60S = 1;
const ANTI_SNIPER_98M = 2;

// Fee structure
const NORMAL_LAUNCH_FEE = ethers.parseEther("100"); // Fee for scheduled/marketing launches
const ACF_FEE = ethers.parseEther("10"); // Extra fee when needAcf = true (10 on base, 150 on eth)

// Bonding curve params
const FAKE_INITIAL_VIRTUAL_LIQ = ethers.parseEther("6300");
const TARGET_REAL_VIRTUAL = ethers.parseEther("42000");
const { setupBondingV5Test } = require("./bondingV5Fixture.js");

describe("BondingV5", function () {
  let setup;
  let contracts, accounts, addresses, params;

  before(async function () {
    setup = await loadFixture(setupBondingV5Test);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;
    params = setup.params;
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial parameters", async function () {
      const { owner } = accounts;
      const { bondingV5, bondingConfig } = contracts;

      expect(await bondingV5.owner()).to.equal(owner.address);
      expect(await bondingV5.agentFactory()).to.equal(addresses.agentFactoryV7);
      expect(await bondingV5.bondingConfig()).to.equal(addresses.bondingConfig);

      // Check bondingConfig params
      expect(await bondingConfig.initialSupply()).to.equal(
        params.initialSupply
      );
      expect(await bondingConfig.feeTo()).to.equal(owner.address);
    });

    it("Should have correct roles granted", async function () {
      const { bondingV5, fRouterV3, agentFactoryV7, fFactoryV3, agentTaxV2 } = contracts;

      expect(
        await fRouterV3.hasRole(
          await fRouterV3.EXECUTOR_ROLE(),
          addresses.bondingV5
        )
      ).to.be.true;

      expect(
        await agentFactoryV7.hasRole(
          await agentFactoryV7.BONDING_ROLE(),
          addresses.bondingV5
        )
      ).to.be.true;

      expect(
        await fFactoryV3.hasRole(
          await fFactoryV3.CREATOR_ROLE(),
          addresses.bondingV5
        )
      ).to.be.true;

      // V5 Suite: Check AgentTaxV2 REGISTER_ROLE granted to BondingV5
      expect(
        await agentTaxV2.hasRole(
          await agentTaxV2.REGISTER_ROLE(),
          addresses.bondingV5
        )
      ).to.be.true;
    });

    it("Should have correct bonding curve params configured", async function () {
      const { bondingConfig } = contracts;

      const bcParams = await bondingConfig.bondingCurveParams();
      expect(bcParams.fakeInitialVirtualLiq).to.equal(FAKE_INITIAL_VIRTUAL_LIQ);
      expect(bcParams.targetRealVirtual).to.equal(TARGET_REAL_VIRTUAL);
    });
  });

  // ============================================
  // LAUNCH_MODE_NORMAL Tests
  // ============================================
  describe("LAUNCH_MODE_NORMAL - preLaunch", function () {
    it("Should create a new token and application successfully", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const tokenName = "Test Token Normal";
      const tokenTicker = "TESTN";
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
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        tokenName,
        tokenTicker,
        cores,
        description,
        image,
        urls,
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL, // launchMode_
        0, // airdropBips_
        false, // needAcf_
        ANTI_SNIPER_60S, // antiSniperTaxType_
        false // isProject60days_
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;
      const pairAddress = parsedEvent.args.pair;

      expect(tokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(pairAddress).to.not.equal(ethers.ZeroAddress);

      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
      expect(tokenInfo.trading).to.be.true;
      expect(tokenInfo.tradingOnUniswap).to.be.false;

      // Verify tokenLaunchParams is stored correctly
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(0);
      expect(launchParams.needAcf).to.be.false;
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_60S);
      expect(launchParams.isProject60days).to.be.false;
    });

    it("Should fail with insufficient purchase amount", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      const purchaseAmount = ethers.parseEther("50"); // Less than fee
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Test Token",
            "TEST",
            [0, 1, 2],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_NORMAL,
            0,
            false,
            ANTI_SNIPER_60S,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, ERR_INVALID_INPUT);
    });

    it("Should fail with empty cores array", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Test Token",
          "TEST",
          [], // Empty cores
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, ERR_INVALID_INPUT);
    });

    it("Should create token with isProject60days flag", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Project60days Token",
        "P60",
        [0, 1, 2],
        "Project60days test token",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        0,
        false,
        ANTI_SNIPER_60S,
        true // isProject60days_ = true
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isProject60days returns true
      const isProject60days = await bondingV5.isProject60days(tokenAddress);
      expect(isProject60days).to.be.true;
    });
  });

  describe("LAUNCH_MODE_NORMAL - launch", function () {
    let tokenAddress;
    let pairAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Test Launch Token",
          "TLT",
          [0, 1, 2],
          "Test token description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;
      pairAddress = parsedEvent.args.pair;
    });

    it("Should launch token successfully", async function () {
      const { bondingV5 } = contracts;

      await time.increase(START_TIME_DELAY + 1);

      const tx = await bondingV5.launch(tokenAddress);
      const receipt = await tx.wait();

      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV5.interface.parseLog(event);
      expect(parsedEvent.args.token).to.equal(tokenAddress);
      expect(parsedEvent.args.pair).to.equal(pairAddress);
    });

    it("Should fail to launch if start time has not passed", async function () {
      const { bondingV5 } = contracts;

      await expect(
        bondingV5.launch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidInput");
    });
  });

  describe("LAUNCH_MODE_NORMAL - buy", function () {
    let tokenAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Test Buy Token",
          "TBT",
          [0, 1, 2],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;

      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);
    });

    it("Should allow buying tokens and bypass anti-sniper tax after 99 minutes", async function () {
      const { user2 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      await increaseTimeByMinutes(99);

      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.fRouterV3, buyAmount);

      const tx = await bondingV5
        .connect(user2)
        .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);

      expect(tx).to.not.be.undefined;

      const actualTokenContract = await ethers.getContractAt(
        "AgentTokenV3",
        tokenAddress
      );
      const user2AgentTokenBalance = await actualTokenContract.balanceOf(
        user2.address
      );
      expect(user2AgentTokenBalance).to.be.greaterThan(0);
    });
  });

  describe("LAUNCH_MODE_NORMAL - sell", function () {
    let tokenAddress;

    beforeEach(async function () {
      const { user1, user2 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Test Sell Token",
          "TST",
          [0, 1, 2],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;

      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);

      // Buy tokens first
      await increaseTimeByMinutes(99);
      const buyAmount = ethers.parseEther("1000");
      await virtualToken.connect(user2).approve(addresses.fRouterV3, buyAmount);
      await bondingV5
        .connect(user2)
        .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);
    });

    it("Should allow selling tokens", async function () {
      const { user2 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const actualTokenContract = await ethers.getContractAt(
        "AgentTokenV3",
        tokenAddress
      );
      const user2AgentTokenBalance = await actualTokenContract.balanceOf(
        user2.address
      );

      const sellAmount = user2AgentTokenBalance / 2n;
      await actualTokenContract
        .connect(user2)
        .approve(addresses.fRouterV3, sellAmount);

      const virtualBalanceBefore = await virtualToken.balanceOf(user2.address);

      const tx = await bondingV5
        .connect(user2)
        .sell(sellAmount, tokenAddress, 0, (await time.latest()) + 300);

      expect(tx).to.not.be.undefined;

      const virtualBalanceAfter = await virtualToken.balanceOf(user2.address);
      expect(virtualBalanceAfter).to.be.greaterThan(virtualBalanceBefore);
    });
  });

  // ============================================
  // LAUNCH_MODE_X_LAUNCH (Special Mode) Tests
  // ============================================
  describe("LAUNCH_MODE_X_LAUNCH (Special Mode)", function () {
    before(async function () {
      const { bondingConfig } = contracts;
      const { owner, user1 } = accounts;

      // Authorize user1 as XLauncher for X_LAUNCH mode
      await bondingConfig.connect(owner).setPrivilegedLauncher(user1.address, true);
      console.log("user1 authorized as privileged launcher for LAUNCH_MODE_X_LAUNCH");
    });

    it("Should create a token with isProjectXLaunch returning true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      // Special modes require immediate launch (startTime within 24h)
      const startTime = (await time.latest()) + 100;
      const tx = await bondingV5.connect(user1).preLaunch(
        "ProjectXLaunch Token",
        "PXL",
        [0, 1, 2],
        "ProjectXLaunch test token",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_X_LAUNCH,
        0, // airdropBips must be 0 for special modes
        false, // needAcf must be false for special modes
        ANTI_SNIPER_60S, // antiSniperTaxType must be 60S for special modes
        false // isProject60days must be false for special modes
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isProjectXLaunch returns true
      const isProjectXLaunch = await bondingV5.isProjectXLaunch(tokenAddress);
      expect(isProjectXLaunch).to.be.true;

      // Verify tokenLaunchParams
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_X_LAUNCH);
    });

    it("Should revert if non-authorized launcher tries to launch X_LAUNCH mode", async function () {
      const { user2 } = accounts;
      const { bondingV5, virtualToken, bondingConfig } = contracts;
      const { owner } = accounts;

      // Ensure user2 is NOT authorized
      await bondingConfig.connect(owner).setPrivilegedLauncher(user2.address, false);

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user2)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5
          .connect(user2)
          .preLaunch(
            "Unauthorized X_LAUNCH",
            "UXL",
            [0, 1, 2],
            "Test unauthorized",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_X_LAUNCH,
            0,
            false,
            ANTI_SNIPER_NONE,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "UnauthorizedLauncher");
    });

    it("Should revert if X_LAUNCH mode uses invalid params", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      // Should revert with non-zero airdropBips (special modes require 0)
      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid X Launch",
          "INV",
          [0, 1, 2],
          "Test invalid",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_X_LAUNCH,
          500, // airdropBips = 500 (5.00%, within maxAirdropBips but special modes require 0)
          false,
          ANTI_SNIPER_NONE,
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });
  });

  // ============================================
  // LAUNCH_MODE_ACP_SKILL (Special Mode) Tests
  // ============================================
  describe("LAUNCH_MODE_ACP_SKILL (Special Mode)", function () {
    before(async function () {
      const { bondingConfig } = contracts;
      const { owner, user1 } = accounts;

      // Authorize user1 as AcpSkillLauncher for ACP_SKILL mode
      await bondingConfig
        .connect(owner)
        .setPrivilegedLauncher(user1.address, true);
      console.log(
        "user1 authorized as privileged launcher for LAUNCH_MODE_ACP_SKILL"
      );
    });

    it("Should create a token with isAcpSkillLaunch returning true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "AcpSkillLaunch Token",
          "ACPS",
          [0, 1, 2],
          "AcpSkillLaunch test token",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_ACP_SKILL,
          0,
          false,
          ANTI_SNIPER_60S, // antiSniperTaxType must be 60S for special modes
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isAcpSkillLaunch returns true
      const isAcpSkillLaunch = await bondingV5.isAcpSkillLaunch(tokenAddress);
      expect(isAcpSkillLaunch).to.be.true;

      // Verify tokenLaunchParams
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_ACP_SKILL);
    });

    it("Should revert if non-authorized launcher tries to launch ACP_SKILL mode", async function () {
      const { user2 } = accounts;
      const { bondingV5, virtualToken, bondingConfig } = contracts;
      const { owner } = accounts;

      // Ensure user2 is NOT authorized
      await bondingConfig
        .connect(owner)
        .setPrivilegedLauncher(user2.address, false);

      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user2)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5
          .connect(user2)
          .preLaunch(
            "Unauthorized ACP_SKILL",
            "UACP",
            [0, 1, 2],
            "Test unauthorized",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_ACP_SKILL,
            0,
            false,
            ANTI_SNIPER_NONE,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "UnauthorizedLauncher");
    });
  });

  // ============================================
  // BondingConfig Admin Tests
  // ============================================
  describe("BondingConfig Admin Functions", function () {
    it("Should allow owner to update scheduled launch params", async function () {
      const { owner } = accounts;
      const { bondingConfig } = contracts;

      const newParams = {
        startTimeDelay: START_TIME_DELAY * 2,
        normalLaunchFee: ethers.parseEther("200"),
        acfFee: ethers.parseEther("50"),
      };

      await bondingConfig.connect(owner).setScheduledLaunchParams(newParams);

      const params = await bondingConfig.getScheduledLaunchParams();
      expect(params.normalLaunchFee).to.equal(newParams.normalLaunchFee);
      expect(params.acfFee).to.equal(newParams.acfFee);

      // Reset to original
      await bondingConfig.connect(owner).setScheduledLaunchParams({
        startTimeDelay: START_TIME_DELAY,
        normalLaunchFee: NORMAL_LAUNCH_FEE,
        acfFee: ACF_FEE,
      });
    });

    it("Should allow owner to update bonding curve params", async function () {
      const { owner } = accounts;
      const { bondingConfig } = contracts;

      const newParams = {
        fakeInitialVirtualLiq: ethers.parseEther("7000"),
        targetRealVirtual: ethers.parseEther("50000"),
      };

      await bondingConfig.connect(owner).setBondingCurveParams(newParams);

      const params = await bondingConfig.bondingCurveParams();
      expect(params.fakeInitialVirtualLiq).to.equal(
        newParams.fakeInitialVirtualLiq
      );
      expect(params.targetRealVirtual).to.equal(newParams.targetRealVirtual);

      // Reset to original
      await bondingConfig.connect(owner).setBondingCurveParams({
        fakeInitialVirtualLiq: FAKE_INITIAL_VIRTUAL_LIQ,
        targetRealVirtual: TARGET_REAL_VIRTUAL,
      });
    });

    it("Should revert if non-owner tries to update params", async function () {
      const { user1 } = accounts;
      const { bondingConfig } = contracts;

      const newParams = {
        startTimeDelay: START_TIME_DELAY * 2,
        normalLaunchFee: ethers.parseEther("200"),
        acfFee: ethers.parseEther("50"),
      };

      await expect(
        bondingConfig.connect(user1).setScheduledLaunchParams(newParams)
      ).to.be.revertedWithCustomError(
        bondingConfig,
        "OwnableUnauthorizedAccount"
      );
    });

    it("Should allow owner to set and revoke XLauncher", async function () {
      const { owner, user2 } = accounts;
      const { bondingConfig } = contracts;

      // Initially user2 should not be authorized
      expect(await bondingConfig.isPrivilegedLauncher(user2.address)).to.be.false;

      // Authorize user2
      await bondingConfig.connect(owner).setPrivilegedLauncher(user2.address, true);
      expect(await bondingConfig.isPrivilegedLauncher(user2.address)).to.be.true;

      // Revoke authorization
      await bondingConfig.connect(owner).setPrivilegedLauncher(user2.address, false);
      expect(await bondingConfig.isPrivilegedLauncher(user2.address)).to.be.false;
    });

    it("Should allow owner to set and revoke AcpSkillLauncher", async function () {
      const { owner, user2 } = accounts;
      const { bondingConfig } = contracts;

      // Initially user2 should not be authorized
      expect(await bondingConfig.isPrivilegedLauncher(user2.address)).to.be.false;

      // Authorize user2
      await bondingConfig
        .connect(owner)
        .setPrivilegedLauncher(user2.address, true);
      expect(await bondingConfig.isPrivilegedLauncher(user2.address)).to.be.true;

      // Revoke authorization
      await bondingConfig
        .connect(owner)
        .setPrivilegedLauncher(user2.address, false);
      expect(await bondingConfig.isPrivilegedLauncher(user2.address)).to.be.false;
    });
  });

  // ============================================
  // Anti-Sniper Tax Type Tests
  // ============================================
  describe("Anti-Sniper Tax Types", function () {
    it("Should validate anti-sniper tax types correctly", async function () {
      const { bondingConfig } = contracts;

      expect(await bondingConfig.isValidAntiSniperType(ANTI_SNIPER_NONE)).to.be
        .true;
      expect(await bondingConfig.isValidAntiSniperType(ANTI_SNIPER_60S)).to.be
        .true;
      expect(await bondingConfig.isValidAntiSniperType(ANTI_SNIPER_98M)).to.be
        .true;
      expect(await bondingConfig.isValidAntiSniperType(3)).to.be.false;
    });

    it("Should return correct durations for anti-sniper types", async function () {
      const { bondingConfig } = contracts;

      expect(
        await bondingConfig.getAntiSniperDuration(ANTI_SNIPER_NONE)
      ).to.equal(0);
      expect(
        await bondingConfig.getAntiSniperDuration(ANTI_SNIPER_60S)
      ).to.equal(60);
      expect(
        await bondingConfig.getAntiSniperDuration(ANTI_SNIPER_98M)
      ).to.equal(98 * 60);
    });

    it("Should revert preLaunch with invalid anti-sniper type", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid Anti Sniper",
          "IAS",
          [0, 1, 2],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          5, // Invalid anti-sniper type
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidAntiSniperType");
    });
  });

  // ============================================
  // Comprehensive Permutation Tests for New Configurable Options
  // ============================================
  describe("Configurable Options Permutations", function () {
    describe("airdropBips Variations", function () {
      it("Should create token with 0% airdrop", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5
          .connect(user1)
          .preLaunch(
            "Zero Airdrop Token",
            "ZAT",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_NORMAL,
            0,
            false,
            ANTI_SNIPER_60S,
            false
          );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.airdropBips).to.equal(0);
      });

      it("Should create token with max airdrop (5%)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "Max Airdrop Token",
          "T5",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          500,
          false,
          ANTI_SNIPER_60S,
          false // MAX_AIRDROP_BIPS = 500 (5.00%)
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.airdropBips).to.equal(500);
      });

      it("Should create token with 3% airdrop", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "3% Airdrop Token",
          "T3",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          300,
          false,
          ANTI_SNIPER_60S,
          false // 300 = 3.00%
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.airdropBips).to.equal(300);
      });

      it("Should revert with airdropBips exceeding MAX_AIRDROP_BIPS (6% > 5%)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken, bondingConfig } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;

        await expect(
          bondingV5.connect(user1).preLaunch(
            "Exceed Airdrop",
            "EXC",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_NORMAL,
            600,
            false,
            ANTI_SNIPER_60S,
            false // 600 (6.00%) > MAX_AIRDROP_BIPS (500 = 5.00%)
          )
        ).to.be.revertedWithCustomError(bondingConfig, "AirdropBipsExceedsMax");
      });
    });

    describe("needAcf Variations", function () {
      it("Should create token with needAcf = true and charge fee", async function () {
        const { user1, owner } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

        // Immediate launch with needAcf = true should charge fee
        const startTime = (await time.latest()) + 100;
        const tx = await bondingV5.connect(user1).preLaunch(
          "ACF Token",
          "ACF",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          true,
          ANTI_SNIPER_60S,
          false // needAcf = true
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.needAcf).to.be.true;

        // Fee should be charged
        const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
        expect(feeToBalanceAfter).to.be.greaterThan(feeToBalanceBefore);
      });

      it("Should create token with needAcf = false and not charge fee for immediate launch", async function () {
        const { user1, owner } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

        // Immediate launch without ACF should not charge fee
        const startTime = (await time.latest()) + 100;
        const tx = await bondingV5.connect(user1).preLaunch(
          "No ACF Token",
          "NACF",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false // needAcf = false
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.needAcf).to.be.false;

        // Fee should NOT be charged for immediate launch without ACF
        const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
        expect(feeToBalanceAfter).to.equal(feeToBalanceBefore);
      });

      it("Should allow needAcf = true at exact MAX_TOTAL_RESERVED_BIPS boundary (55%)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;

        // needAcf = true adds 5000 (50%) reserve, so total = 500 + 5000 = 5500 = MAX_TOTAL_RESERVED_BIPS (55%)
        // This should succeed (at exact limit, not over)
        const tx = await bondingV5.connect(user1).preLaunch(
          "ACF At Limit",
          "ACFL",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          500,
          true,
          ANTI_SNIPER_60S,
          false // 500 (5.00%) + 5000 (50%) = 5500 (55%)
        );

        const receipt = await tx.wait();
        expect(receipt).to.not.be.undefined;
      });

      it("Should allow needAcf = true with airdropBips = 400 (total 54%)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;

        // needAcf = true adds 5000 (50%) reserve, so total = 400 + 5000 = 5400 < 5500 OK
        const tx = await bondingV5.connect(user1).preLaunch(
          "ACF With Airdrop",
          "ACFA",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          400,
          true,
          ANTI_SNIPER_60S,
          false // 400 (4.00%) + 5000 (50%) = 5400 (54%)
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        expect(event).to.not.be.undefined;
      });
    });

    describe("Anti-Sniper Tax Type Variations", function () {
      it("Should create token with ANTI_SNIPER_NONE (0s duration)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5
          .connect(user1)
          .preLaunch(
            "No Anti-Sniper",
            "NOAS",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_NORMAL,
            0,
            false,
            ANTI_SNIPER_NONE,
            false
          );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        expect(await bondingV5.tokenAntiSniperType(tokenAddress)).to.equal(
          ANTI_SNIPER_NONE
        );
      });

      it("Should create token with ANTI_SNIPER_60S (60s duration)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5
          .connect(user1)
          .preLaunch(
            "60s Anti-Sniper",
            "AS60",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_NORMAL,
            0,
            false,
            ANTI_SNIPER_60S,
            false
          );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        expect(await bondingV5.tokenAntiSniperType(tokenAddress)).to.equal(
          ANTI_SNIPER_60S
        );
      });

      it("Should create token with ANTI_SNIPER_98M (98 minutes duration)", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5
          .connect(user1)
          .preLaunch(
            "98m Anti-Sniper",
            "AS98",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_NORMAL,
            0,
            false,
            ANTI_SNIPER_98M,
            false
          );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        expect(await bondingV5.tokenAntiSniperType(tokenAddress)).to.equal(
          ANTI_SNIPER_98M
        );
      });
    });

    describe("isProject60days Variations", function () {
      it("Should create token with isProject60days = true", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "Project 60days",
          "P60D",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          true // isProject60days = true
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        expect(await bondingV5.isProject60days(tokenAddress)).to.be.true;
      });

      it("Should create token with isProject60days = false", async function () {
        const { user1 } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5.connect(user1).preLaunch(
          "Regular Project",
          "REG",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false // isProject60days = false
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;

        expect(await bondingV5.isProject60days(tokenAddress)).to.be.false;
      });
    });

    describe("Scheduled vs Immediate Launch", function () {
      it("Should charge fee for scheduled launch (startTime >= now + 24h)", async function () {
        const { user1, owner } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

        // Scheduled launch (startTime > now + 24h)
        const startTime = (await time.latest()) + START_TIME_DELAY + 1;
        const tx = await bondingV5
          .connect(user1)
          .preLaunch(
            "Scheduled Token",
            "SCHD",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_NORMAL,
            0,
            false,
            ANTI_SNIPER_60S,
            false
          );

        const receipt = await tx.wait();
        expect(receipt).to.not.be.undefined;

        // Fee should be charged for scheduled launch
        const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
        expect(feeToBalanceAfter).to.be.greaterThan(feeToBalanceBefore);
      });

      it("Should NOT charge fee for immediate launch without ACF", async function () {
        const { user1, owner } = accounts;
        const { bondingV5, virtualToken } = contracts;

        const purchaseAmount = ethers.parseEther("1000");
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);

        const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

        // Immediate launch (startTime < now + 24h)
        const startTime = (await time.latest()) + 100;
        const tx = await bondingV5
          .connect(user1)
          .preLaunch(
            "Immediate Token",
            "IMMD",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_NORMAL,
            0,
            false,
            ANTI_SNIPER_60S,
            false
          );

        const receipt = await tx.wait();
        expect(receipt).to.not.be.undefined;

        // Fee should NOT be charged for immediate launch without ACF
        const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
        expect(feeToBalanceAfter).to.equal(feeToBalanceBefore);
      });
    });
  });

  // ============================================
  // Special Mode Strict Validation Tests (X_LAUNCH and ACP_SKILL)
  // ============================================
  describe("Special Mode Strict Validation (X_LAUNCH and ACP_SKILL)", function () {
    before(async function () {
      const { bondingConfig } = contracts;
      const { owner, user1 } = accounts;

      await bondingConfig.connect(owner).setPrivilegedLauncher(user1.address, true);
    });

    it("Should revert X_LAUNCH with non-zero airdropBips", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Invalid X_LAUNCH",
            "INV",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_X_LAUNCH,
            5,
            false,
            ANTI_SNIPER_NONE,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert X_LAUNCH with needAcf = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Invalid X_LAUNCH ACF",
            "INVA",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_X_LAUNCH,
            0,
            true,
            ANTI_SNIPER_NONE,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert X_LAUNCH with non-60S anti-sniper type (NONE)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      // Special modes require ANTI_SNIPER_60S, using ANTI_SNIPER_NONE should revert
      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Invalid X_LAUNCH AS",
            "INAS",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_X_LAUNCH,
            0,
            false,
            ANTI_SNIPER_NONE, // Should revert: special modes require ANTI_SNIPER_60S
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert X_LAUNCH with isProject60days = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Invalid X_LAUNCH 60D",
            "IN60",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_X_LAUNCH,
            0,
            false,
            ANTI_SNIPER_NONE,
            true
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert X_LAUNCH with scheduled launch (not immediate)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      // Scheduled launch (startTime >= now + 24h)
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Scheduled X_LAUNCH",
            "SCHP",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_X_LAUNCH,
            0,
            false,
            ANTI_SNIPER_NONE,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with non-zero airdropBips", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Invalid ACP_SKILL",
            "IACP",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_ACP_SKILL,
            5,
            false,
            ANTI_SNIPER_NONE,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with needAcf = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Invalid ACP_SKILL ACF",
            "IACF",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_ACP_SKILL,
            0,
            true,
            ANTI_SNIPER_NONE,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with non-NONE anti-sniper type", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Invalid ACP_SKILL AS",
            "IAAS",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_ACP_SKILL,
            0,
            false,
            ANTI_SNIPER_98M,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with isProject60days = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + 100;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Invalid ACP_SKILL 60D",
            "IA60",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_ACP_SKILL,
            0,
            false,
            ANTI_SNIPER_NONE,
            true
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });

    it("Should revert ACP_SKILL with scheduled launch (not immediate)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      // Scheduled launch (startTime >= now + 24h)
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5
          .connect(user1)
          .preLaunch(
            "Scheduled ACP_SKILL",
            "SACP",
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_ACP_SKILL,
            0,
            false,
            ANTI_SNIPER_NONE,
            false
          )
      ).to.be.revertedWithCustomError(bondingV5, "InvalidSpecialLaunchParams");
    });
  });

  // ============================================
  // Event Data Verification Tests
  // ============================================
  describe("Event Data Verification", function () {
    it("Should emit PreLaunched event with correct LaunchParams struct", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Event Test Token",
        "EVT",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        500,
        false,
        ANTI_SNIPER_98M,
        true // 500 = 5.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);

      // Verify LaunchParams in event
      const launchParams = parsedEvent.args.launchParams;
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(500);
      expect(launchParams.needAcf).to.equal(false);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_98M);
      expect(launchParams.isProject60days).to.equal(true);
    });

    it("Should emit Launched event with correct LaunchParams struct", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      let tx = await bondingV5.connect(user1).preLaunch(
        "Launch Event Token",
        "LET",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        500,
        false,
        ANTI_SNIPER_60S,
        false // 500 = 5.00%
      );

      let receipt = await tx.wait();
      let event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Wait and launch
      await time.increase(START_TIME_DELAY + 1);
      tx = await bondingV5.launch(tokenAddress);
      receipt = await tx.wait();

      event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);

      // Verify LaunchParams in Launched event
      const launchParams = parsedEvent.args.launchParams;
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(500);
      expect(launchParams.needAcf).to.equal(false);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_60S);
      expect(launchParams.isProject60days).to.equal(false);
    });
  });

  // ============================================
  // Token Graduation Threshold Tests
  // ============================================
  describe("Token Graduation Threshold Calculation", function () {
    it("Should calculate different gradThreshold for different airdropBips", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      // Token 1: 0% airdrop
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);
      let startTime = (await time.latest()) + START_TIME_DELAY + 1;
      let tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "0% Airdrop Grad",
          "G0",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );
      let receipt = await tx.wait();
      let event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const token1 = bondingV5.interface.parseLog(event).args.token;
      const gradThreshold1 = await bondingV5.tokenGradThreshold(token1);

      // Token 2: 5% airdrop (MAX_AIRDROP_BIPS = 500)
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);
      startTime = (await time.latest()) + START_TIME_DELAY + 1;
      tx = await bondingV5.connect(user1).preLaunch(
        "5% Airdrop Grad",
        "G5",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        500,
        false,
        ANTI_SNIPER_60S,
        false // 500 = 5.00%
      );
      receipt = await tx.wait();
      event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const token2 = bondingV5.interface.parseLog(event).args.token;
      const gradThreshold2 = await bondingV5.tokenGradThreshold(token2);

      // Different airdrop should result in different graduation thresholds
      expect(gradThreshold1).to.not.equal(gradThreshold2);
      // Higher airdrop means less bonding curve supply, so lower gradThreshold
      expect(gradThreshold2).to.be.lessThan(gradThreshold1);
    });

    it("Should calculate gradThreshold with needAcf = true", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");

      // Token with ACF (adds 50% reserve) and 0% airdrop
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "ACF Token Grad",
          "GACF",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          true,
          ANTI_SNIPER_60S,
          false
        );
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      const gradThreshold = await bondingV5.tokenGradThreshold(tokenAddress);
      expect(gradThreshold).to.be.greaterThan(0);
    });
  });

  // ============================================
  // Edge Cases and Boundary Tests
  // ============================================
  describe("Edge Cases and Boundary Tests", function () {
    it("Should revert with invalid launch mode (mode = 3)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      await expect(
        bondingV5.connect(user1).preLaunch(
          "Invalid Mode",
          "INV",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          3, // Invalid launch mode
          0,
          false,
          ANTI_SNIPER_60S,
          false
        )
      ).to.be.revertedWithCustomError(bondingV5, "LaunchModeNotEnabled");
    });

    it("Should allow exact boundary of MAX_TOTAL_RESERVED_BIPS (needAcf + 4% = 54%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // needAcf (5000 = 50%) + 400 (4%) = 5400 (54%) should work (just under 5500 = 55% limit)
      const tx = await bondingV5.connect(user1).preLaunch(
        "Boundary Test",
        "BNDY",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        400,
        true,
        ANTI_SNIPER_60S,
        false // 400 = 4.00%
      );

      const receipt = await tx.wait();
      expect(receipt).to.not.be.undefined;
    });

    it("Should allow exact MAX_TOTAL_RESERVED_BIPS (needAcf + 5% = 55%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // needAcf (5000 = 50%) + 500 (5%) = 5500 (55%) should succeed (at exact limit)
      const tx = await bondingV5.connect(user1).preLaunch(
        "At Limit",
        "ATLIM",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        500,
        true,
        ANTI_SNIPER_60S,
        false // 500 = 5.00%
      );

      const receipt = await tx.wait();
      expect(receipt).to.not.be.undefined;
    });

    it("Should allow needAcf = true with 0% airdrop (total 50%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "ACF Only",
          "ACFO",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          true,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.needAcf).to.be.true;
      expect(launchParams.airdropBips).to.equal(0);
    });

    it("Should allow exactly 4% airdrop + ACF (total 54%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // 400 (4%) + 5000 (50% ACF) = 5400 (54%) < 5500 (55%) limit
      const tx = await bondingV5.connect(user1).preLaunch(
        "Max ACF Combo",
        "MXAC",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        400,
        true,
        ANTI_SNIPER_60S,
        false // 400 = 4.00%
      );

      const receipt = await tx.wait();
      expect(receipt).to.not.be.undefined;
    });

    it("Should allow 5% airdrop + ACF at exact boundary (total 55%)", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // 500 (5%) + 5000 (50% ACF) = 5500 (55%) = 5500 (55%) limit - should be allowed at exact boundary
      const tx = await bondingV5.connect(user1).preLaunch(
        "At ACF Combo Limit",
        "ATLM",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        500,
        true,
        ANTI_SNIPER_60S,
        false // 500 = 5.00%
      );

      const receipt = await tx.wait();
      expect(receipt).to.not.be.undefined;
    });

    it("Should revert when airdropBips exceeds MAX_AIRDROP_BIPS", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken, bondingConfig } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;

      // 600 (6%) > 500 (5%) maxAirdropBips - should revert with AirdropBipsExceedsMax
      await expect(
        bondingV5.connect(user1).preLaunch(
          "Over Airdrop",
          "OVAD",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          600,
          false,
          ANTI_SNIPER_60S,
          false // 600 = 6.00% > 5% max
        )
      ).to.be.revertedWithCustomError(bondingConfig, "AirdropBipsExceedsMax");
    });
  });

  // ============================================
  // Full Parameter Combination Tests
  // ============================================
  describe("Full Parameter Combination Tests", function () {
    it("Should create token with all parameters at default values", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Default Params",
          "DFLT",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_NONE,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(0);
      expect(launchParams.needAcf).to.equal(false);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_NONE);
      expect(launchParams.isProject60days).to.equal(false);
    });

    it("Should create token with maximum allowed parameters", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Max Params",
        "MAXP",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        500,
        false,
        ANTI_SNIPER_98M,
        true // MAX_AIRDROP_BIPS = 500 (5.00%)
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.airdropBips).to.equal(500);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_98M);
      expect(launchParams.isProject60days).to.equal(true);
    });

    it("Should handle multiple tokens with different parameter combinations", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      const tokens = [];

      // Test matrix of parameter combinations (airdrop values <= MAX_AIRDROP_BIPS = 500)
      const testCases = [
        {
          airdrop: 0,
          needAcf: false,
          antiSniper: ANTI_SNIPER_NONE,
          is60days: false,
        },
        {
          airdrop: 300,
          needAcf: false,
          antiSniper: ANTI_SNIPER_60S,
          is60days: true,
        }, // 300 = 3.00%
        {
          airdrop: 500,
          needAcf: false,
          antiSniper: ANTI_SNIPER_98M,
          is60days: false,
        }, // 500 = 5.00%
        {
          airdrop: 0,
          needAcf: true,
          antiSniper: ANTI_SNIPER_60S,
          is60days: false,
        },
        {
          airdrop: 400,
          needAcf: true,
          antiSniper: ANTI_SNIPER_98M,
          is60days: true,
        }, // 400 = 4.00%
      ];

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        await virtualToken
          .connect(user1)
          .approve(addresses.bondingV5, purchaseAmount);
        const startTime = (await time.latest()) + START_TIME_DELAY + 1;

        const tx = await bondingV5
          .connect(user1)
          .preLaunch(
            `Combo Token ${i}`,
            `CMB${i}`,
            [0, 1],
            "Description",
            "https://example.com/image.png",
            ["", "", "", ""],
            purchaseAmount,
            startTime,
            LAUNCH_MODE_NORMAL,
            tc.airdrop,
            tc.needAcf,
            tc.antiSniper,
            tc.is60days
          );

        const receipt = await tx.wait();
        const event = receipt.logs.find((log) => {
          try {
            return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
          } catch (e) {
            return false;
          }
        });
        const tokenAddress = bondingV5.interface.parseLog(event).args.token;
        tokens.push(tokenAddress);

        // Verify stored parameters
        const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
        expect(launchParams.airdropBips).to.equal(tc.airdrop);
        expect(launchParams.needAcf).to.equal(tc.needAcf);
        expect(launchParams.antiSniperTaxType).to.equal(tc.antiSniper);
        expect(launchParams.isProject60days).to.equal(tc.is60days);
      }

      // Verify all tokens were created with unique addresses
      expect(new Set(tokens).size).to.equal(testCases.length);
    });
  });

  // ============================================
  // Regression Tests
  // ============================================
  describe("Regression Tests", function () {
    it("Should maintain token info after preLaunch", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Regression Token",
        "REGT",
        [0, 1, 2],
        "A regression test token",
        "https://example.com/image.png",
        ["url1", "url2", "url3", "url4"],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        500,
        false,
        ANTI_SNIPER_60S,
        true // 500 = 5.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Verify token info from BondingV5
      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
      expect(tokenInfo.description).to.equal("A regression test token");
      expect(tokenInfo.image).to.equal("https://example.com/image.png");
      expect(tokenInfo.trading).to.be.true; // Bonding curve trading is active after preLaunch
      expect(tokenInfo.launchExecuted).to.be.false; // Launch() not yet called
    });

    it("Should correctly transition from preLaunch to launch", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Transition Token",
          "TRAN",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Check state after preLaunch (before launch() call)
      let tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.trading).to.be.true; // Bonding curve trading active
      expect(tokenInfo.launchExecuted).to.be.false; // launch() not yet called

      // Wait and call launch()
      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);

      // Check state after launch()
      tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.trading).to.be.true; // Still trading on bonding curve
      expect(tokenInfo.launchExecuted).to.be.true; // Launch executed
    });

    it("Should revert launch for Project60days if caller is not privileged launcher", async function () {
      const { user1, user2, owner } = accounts;
      const { bondingV5, virtualToken, bondingConfig } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "P60 Gate Token",
        "P60G",
        [0, 1, 2],
        "Project60days launch gate",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        0,
        false,
        ANTI_SNIPER_60S,
        true // isProject60days
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddr = bondingV5.interface.parseLog(event).args.token;

      await time.increase(START_TIME_DELAY + 1);

      await bondingConfig.connect(owner).setPrivilegedLauncher(user2.address, false);
      await expect(
        bondingV5.connect(user2).launch(tokenAddr)
      ).to.be.revertedWithCustomError(bondingV5, "UnauthorizedLauncher");

      await bondingV5.connect(owner).launch(tokenAddr);
      const info = await bondingV5.tokenInfo(tokenAddr);
      expect(info.launchExecuted).to.be.true;
    });

    it("Should preserve launch params after launch", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Preserve Token",
        "PRSV",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        500,
        false,
        ANTI_SNIPER_98M,
        true // 500 = 5.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Wait and launch
      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);

      // Verify launch params are still correct after launch
      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);
      expect(launchParams.airdropBips).to.equal(500);
      expect(launchParams.needAcf).to.equal(false);
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_98M);
      expect(launchParams.isProject60days).to.equal(true);
    });
  });

  // ============================================
  // cancelLaunch Tests
  // ============================================
  describe("cancelLaunch", function () {
    let tokenAddress;
    let pairAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Cancel Test Token",
          "CTT",
          [0, 1, 2],
          "Test token for cancel",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV5.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;
      pairAddress = parsedEvent.args.pair;
    });

    it("Should allow creator to cancel launch before launch() is called", async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const balanceBefore = await virtualToken.balanceOf(user1.address);

      const tx = await bondingV5.connect(user1).cancelLaunch(tokenAddress);
      const receipt = await tx.wait();

      // Verify CancelledLaunch event
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "CancelledLaunch";
        } catch (e) {
          return false;
        }
      });
      expect(event).to.not.be.undefined;

      // Verify initialPurchase is returned to creator
      const balanceAfter = await virtualToken.balanceOf(user1.address);
      expect(balanceAfter).to.be.greaterThan(balanceBefore);

      // Verify token status is updated
      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.launchExecuted).to.be.true;
      expect(tokenInfo.initialPurchase).to.equal(0);
    });

    it("Should revert if non-creator tries to cancel", async function () {
      const { user2 } = accounts;
      const { bondingV5 } = contracts;

      await expect(
        bondingV5.connect(user2).cancelLaunch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidInput");
    });

    it("Should revert if trying to cancel after launch() is called", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      // Wait and launch first
      await time.increase(START_TIME_DELAY + 1);
      await bondingV5.launch(tokenAddress);

      // Then try to cancel
      await expect(
        bondingV5.connect(user1).cancelLaunch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidTokenStatus");
    });

    it("Should revert if trying to cancel twice", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      // First cancel
      await bondingV5.connect(user1).cancelLaunch(tokenAddress);

      // Second cancel should fail
      await expect(
        bondingV5.connect(user1).cancelLaunch(tokenAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidTokenStatus");
    });

    it("Should revert when cancelling non-existent token", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      await expect(
        bondingV5.connect(user1).cancelLaunch(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidInput");
    });

    it("Cancelled token should NOT be buyable after startTime (security regression)", async function () {
      const { user1, user2 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      // Create a scheduled launch
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Security Test Token",
          "SEC",
          [0, 1, 2],
          "Test for cancelled launch security",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Cancel the launch
      await bondingV5.connect(user1).cancelLaunch(tokenAddress);

      // Verify trading is disabled
      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      // expect(tokenInfo.trading).to.be.false;

      // Wait until startTime passes
      await time.increase(START_TIME_DELAY + 10);

      // Attempt to buy - should revert because trading is disabled
      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.fRouterV3, buyAmount);

      await expect(
        bondingV5
          .connect(user2)
          .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidTokenStatus");
    });

    it("Cancelled token with decayed anti-sniper window should still block trading (security regression)", async function () {
      const { user1, user2 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      // Create a scheduled launch with 60s anti-sniper
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5
        .connect(user1)
        .preLaunch(
          "Anti Sniper Bypass Token",
          "BYPASS",
          [0, 1, 2],
          "Test for anti-sniper bypass prevention",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const parsedEvent = bondingV5.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Cancel the launch
      await bondingV5.connect(user1).cancelLaunch(tokenAddress);

      // Wait until startTime + full anti-sniper period (60s+) passes
      // This simulates an attacker waiting for anti-sniper to decay
      await time.increase(START_TIME_DELAY + 120);

      // Attempt to buy - should still revert even after anti-sniper would have decayed
      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.fRouterV3, buyAmount);

      await expect(
        bondingV5
          .connect(user2)
          .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidTokenStatus");
    });
  });

  // ============================================
  // BondingV5 Admin Functions Tests
  // ============================================
  describe("BondingV5 Admin Functions", function () {
    it("Should allow owner to update BondingConfig", async function () {
      const { owner } = accounts;
      const { bondingV5, bondingConfig } = contracts;

      // Deploy a new BondingConfig for testing
      const BondingConfig = await ethers.getContractFactory("BondingConfig");
      const newBondingConfig = await upgrades.deployProxy(
        BondingConfig,
        [
          INITIAL_SUPPLY,
          owner.address,
          owner.address,
          {
            maxAirdropBips: MAX_AIRDROP_BIPS,
            maxTotalReservedBips: MAX_TOTAL_RESERVED_BIPS,
            acfReservedBips: ACF_RESERVED_BIPS,
          },
          {
            startTimeDelay: START_TIME_DELAY,
            normalLaunchFee: NORMAL_LAUNCH_FEE,
            acfFee: ACF_FEE,
          },
          {
            tbaSalt: TBA_SALT,
            tbaImplementation: TBA_IMPLEMENTATION,
            daoVotingPeriod: DAO_VOTING_PERIOD,
            daoThreshold: DAO_THRESHOLD,
          },
          {
            fakeInitialVirtualLiq: FAKE_INITIAL_VIRTUAL_LIQ,
            targetRealVirtual: TARGET_REAL_VIRTUAL,
          },
        ],
        { initializer: "initialize" }
      );
      await newBondingConfig.waitForDeployment();

      // Update BondingConfig
      await bondingV5
        .connect(owner)
        .setBondingConfig(await newBondingConfig.getAddress());

      // Verify the update
      expect(await bondingV5.bondingConfig()).to.equal(
        await newBondingConfig.getAddress()
      );

      // Reset to original
      await bondingV5
        .connect(owner)
        .setBondingConfig(await bondingConfig.getAddress());
    });

    it("Should revert if non-owner tries to update BondingConfig", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      await expect(
        bondingV5.connect(user1).setBondingConfig(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(bondingV5, "OwnableUnauthorizedAccount");
    });
  });

  // ============================================
  // View Functions Tests
  // ============================================
  describe("View Functions", function () {
    let tokenAddress;

    beforeEach(async function () {
      const { user1 } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "View Test Token",
        "VTT",
        [0, 1, 2],
        "Test token for view functions",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        300, // 300 = 3.00%
        true,
        ANTI_SNIPER_98M,
        true
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV5.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      tokenAddress = bondingV5.interface.parseLog(event).args.token;
    });

    it("Should return correct isProject60days value", async function () {
      const { bondingV5 } = contracts;
      expect(await bondingV5.isProject60days(tokenAddress)).to.be.true;
    });

    it("Should return correct isProjectXLaunch value (false for NORMAL mode)", async function () {
      const { bondingV5 } = contracts;
      expect(await bondingV5.isProjectXLaunch(tokenAddress)).to.be.false;
    });

    it("Should return correct isAcpSkillLaunch value (false for NORMAL mode)", async function () {
      const { bondingV5 } = contracts;
      expect(await bondingV5.isAcpSkillLaunch(tokenAddress)).to.be.false;
    });

    it("Should return correct tokenAntiSniperType value", async function () {
      const { bondingV5 } = contracts;
      expect(await bondingV5.tokenAntiSniperType(tokenAddress)).to.equal(
        ANTI_SNIPER_98M
      );
    });

    it("Should revert tokenAntiSniperType for non-BondingV5 token", async function () {
      const { bondingV5 } = contracts;

      // Use a random address that doesn't exist as a token
      const randomAddress = ethers.Wallet.createRandom().address;

      await expect(
        bondingV5.tokenAntiSniperType(randomAddress)
      ).to.be.revertedWithCustomError(bondingV5, "InvalidTokenStatus");
    });

    it("Should return correct tokenGradThreshold value", async function () {
      const { bondingV5 } = contracts;
      const gradThreshold = await bondingV5.tokenGradThreshold(tokenAddress);
      expect(gradThreshold).to.be.greaterThan(0);
    });

    it("Should return correct tokenInfo values", async function () {
      const { user1 } = accounts;
      const { bondingV5 } = contracts;

      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);

      expect(tokenInfo.creator).to.equal(user1.address);
      expect(tokenInfo.token).to.equal(tokenAddress);
      expect(tokenInfo.pair).to.not.equal(ethers.ZeroAddress);
      expect(tokenInfo.trading).to.be.true;
      expect(tokenInfo.tradingOnUniswap).to.be.false;
      expect(tokenInfo.launchExecuted).to.be.false;
    });

    it("Should return correct tokenLaunchParams values", async function () {
      const { bondingV5 } = contracts;

      const launchParams = await bondingV5.tokenLaunchParams(tokenAddress);

      expect(launchParams.launchMode).to.equal(LAUNCH_MODE_NORMAL);
      expect(launchParams.airdropBips).to.equal(300); // 300 = 3.00%
      expect(launchParams.needAcf).to.be.true;
      expect(launchParams.antiSniperTaxType).to.equal(ANTI_SNIPER_98M);
      expect(launchParams.isProject60days).to.be.true;
    });
  });

  // ============================================
  // BondingConfig Additional Tests
  // ============================================
  describe("BondingConfig Additional Functions", function () {
    it("Should correctly calculate bonding curve supply for various scenarios", async function () {
      const { bondingConfig } = contracts;

      const initialSupply = BigInt(INITIAL_SUPPLY);

      // 0% airdrop, no ACF: 100% bonding curve
      const supply100 = await bondingConfig.calculateBondingCurveSupply(
        0,
        false
      );
      expect(supply100).to.equal(initialSupply);

      // 5% airdrop (500), no ACF: 95% bonding curve (9500/10000)
      const supply95 = await bondingConfig.calculateBondingCurveSupply(
        500,
        false
      );
      expect(supply95).to.equal((initialSupply * 9500n) / 10000n);

      // 0% airdrop, with ACF (5000 = 50%): 50% bonding curve (5000/10000)
      const supply50 = await bondingConfig.calculateBondingCurveSupply(0, true);
      expect(supply50).to.equal((initialSupply * 5000n) / 10000n);

      // 4% airdrop (400), with ACF (5000): 46% bonding curve (4600/10000)
      const supply46 = await bondingConfig.calculateBondingCurveSupply(
        400,
        true
      );
      expect(supply46).to.equal((initialSupply * 4600n) / 10000n);
    });

    it("Should return correct fakeInitialVirtualLiq", async function () {
      const { bondingConfig } = contracts;
      expect(await bondingConfig.getFakeInitialVirtualLiq()).to.equal(
        FAKE_INITIAL_VIRTUAL_LIQ
      );
    });

    it("Should return correct targetRealVirtual", async function () {
      const { bondingConfig } = contracts;
      expect(await bondingConfig.getTargetRealVirtual()).to.equal(
        TARGET_REAL_VIRTUAL
      );
    });

    it("Should correctly calculate launch fee for different scenarios", async function () {
      const { bondingConfig } = contracts;

      // Immediate launch, no ACF: 0
      expect(await bondingConfig.calculateLaunchFee(false, false)).to.equal(0);

      // Immediate launch, with ACF: acfFee
      expect(await bondingConfig.calculateLaunchFee(false, true)).to.equal(
        ACF_FEE
      );

      // Scheduled launch, no ACF: normalLaunchFee
      expect(await bondingConfig.calculateLaunchFee(true, false)).to.equal(
        NORMAL_LAUNCH_FEE
      );

      // Scheduled launch, with ACF: normalLaunchFee + acfFee
      expect(await bondingConfig.calculateLaunchFee(true, true)).to.equal(
        NORMAL_LAUNCH_FEE + ACF_FEE
      );
    });

    it("Should allow owner to set deploy params", async function () {
      const { owner } = accounts;
      const { bondingConfig } = contracts;

      const newDeployParams = {
        tbaSalt: ethers.keccak256(ethers.toUtf8Bytes("new_salt")),
        tbaImplementation: ethers.Wallet.createRandom().address,
        daoVotingPeriod: 7200,
        daoThreshold: ethers.parseEther("200"),
      };

      await bondingConfig.connect(owner).setDeployParams(newDeployParams);

      const deployParams = await bondingConfig.getDeployParams();
      expect(deployParams.tbaSalt).to.equal(newDeployParams.tbaSalt);
      expect(deployParams.tbaImplementation).to.equal(
        newDeployParams.tbaImplementation
      );
      expect(deployParams.daoVotingPeriod).to.equal(
        newDeployParams.daoVotingPeriod
      );
      expect(deployParams.daoThreshold).to.equal(newDeployParams.daoThreshold);

      // Reset to original
      await bondingConfig.connect(owner).setDeployParams({
        tbaSalt: TBA_SALT,
        tbaImplementation: TBA_IMPLEMENTATION,
        daoVotingPeriod: DAO_VOTING_PERIOD,
        daoThreshold: DAO_THRESHOLD,
      });
    });

    it("Should allow owner to set common params", async function () {
      const { owner } = accounts;
      const { bondingConfig } = contracts;

      const newSupply = ethers.parseUnits("2000000000", 0); // 2B base units
      const newFeeTo = ethers.Wallet.createRandom().address;

      await bondingConfig.connect(owner).setCommonParams(newSupply, newFeeTo);

      expect(await bondingConfig.initialSupply()).to.equal(newSupply);
      expect(await bondingConfig.feeTo()).to.equal(newFeeTo);

      // Reset to original
      await bondingConfig
        .connect(owner)
        .setCommonParams(INITIAL_SUPPLY, owner.address);
    });

    it("Should allow owner to set team token reserved wallet", async function () {
      const { owner, user2 } = accounts;
      const { bondingConfig } = contracts;

      const originalWallet = await bondingConfig.teamTokenReservedWallet();

      await bondingConfig
        .connect(owner)
        .setTeamTokenReservedWallet(user2.address);
      expect(await bondingConfig.teamTokenReservedWallet()).to.equal(
        user2.address
      );

      // Reset to original
      await bondingConfig
        .connect(owner)
        .setTeamTokenReservedWallet(originalWallet);
    });
  });

  // ============================================
  // Fee Collection Tests
  // ============================================
  describe("Fee Collection", function () {
    it("Should collect correct fee for scheduled launch with ACF", async function () {
      const { user1, owner } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

      // Scheduled launch with ACF
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      await bondingV5
        .connect(user1)
        .preLaunch(
          "Fee Test Token",
          "FTT",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          true,
          ANTI_SNIPER_60S,
          false
        );

      const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
      const feeCollected = feeToBalanceAfter - feeToBalanceBefore;

      // Expected fee: normalLaunchFee + acfFee
      expect(feeCollected).to.equal(NORMAL_LAUNCH_FEE + ACF_FEE);
    });

    it("Should not collect fee for immediate launch without ACF", async function () {
      const { user1, owner } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const feeToBalanceBefore = await virtualToken.balanceOf(owner.address);

      // Immediate launch without ACF
      const startTime = (await time.latest()) + 100;
      await bondingV5
        .connect(user1)
        .preLaunch(
          "No Fee Token",
          "NFT",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime,
          LAUNCH_MODE_NORMAL,
          0,
          false,
          ANTI_SNIPER_60S,
          false
        );

      const feeToBalanceAfter = await virtualToken.balanceOf(owner.address);
      const feeCollected = feeToBalanceAfter - feeToBalanceBefore;

      expect(feeCollected).to.equal(0);
    });
  });

  // ============================================
  // Token Reserved Transfer Tests
  // ============================================
  describe("Token Reserved Transfer", function () {
    it("Should transfer reserved tokens to teamTokenReservedWallet", async function () {
      const { user1, beOpsWallet } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      const reservedWalletBalanceBefore = await ethers.provider.getBalance(
        beOpsWallet.address
      );

      // Create token with 5% airdrop (500 = 5.00%, should transfer 5% to reserved wallet)
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Reserved Test Token",
        "RTT",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        500,
        false,
        ANTI_SNIPER_60S,
        false // 500 = 5.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Check that reserved tokens were transferred to teamTokenReservedWallet
      const actualTokenContract = await ethers.getContractAt(
        "AgentTokenV3",
        tokenAddress
      );
      const reservedWalletTokenBalance = await actualTokenContract.balanceOf(
        beOpsWallet.address
      );

      // 5% of 1B = 50M tokens (with 18 decimals)
      const expectedReserved = ethers.parseEther("50000000");
      expect(reservedWalletTokenBalance).to.equal(expectedReserved);
    });

    it("Should transfer 50% + airdrop tokens when needAcf is true", async function () {
      const { user1, beOpsWallet } = accounts;
      const { bondingV5, virtualToken } = contracts;

      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV5, purchaseAmount);

      // Create token with 4% airdrop (400) and needAcf = true (5400 = 54% total reserved)
      const startTime = (await time.latest()) + START_TIME_DELAY + 1;
      const tx = await bondingV5.connect(user1).preLaunch(
        "ACF Reserved Test",
        "ART",
        [0, 1],
        "Description",
        "https://example.com/image.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        400,
        true,
        ANTI_SNIPER_60S,
        false // 400 = 4.00%
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      const tokenAddress = bondingV5.interface.parseLog(event).args.token;

      // Check reserved tokens (54% = 4% airdrop + 50% ACF)
      const actualTokenContract = await ethers.getContractAt(
        "AgentTokenV3",
        tokenAddress
      );
      const reservedWalletTokenBalance = await actualTokenContract.balanceOf(
        beOpsWallet.address
      );

      // 54% of 1B = 540M tokens (with 18 decimals)
      const expectedReserved = ethers.parseEther("540000000");
      expect(reservedWalletTokenBalance).to.equal(expectedReserved);
    });
  });
});
