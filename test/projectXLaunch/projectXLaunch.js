const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { setupNewLaunchpadTest } = require("../launchpadv2/setup");
const {
  START_TIME_DELAY,
  INITIAL_SUPPLY,
  TEAM_TOKEN_RESERVED_SUPPLY,
  TBA_SALT,
  TBA_IMPLEMENTATION,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,
  ASSET_RATE,
  MAX_TX,
  GRAD_THRESHOLD,
} = require("../launchpadv2/const");

describe("ProjectXLaunch - AgentTax Integration", function () {
  let setup;
  let contracts;
  let accounts;
  let addresses;
  let agentTax;
  let bondingV4;
  let virtualToken;
  let agentNftV2;

  before(async function () {
    setup = await loadFixture(setupNewLaunchpadTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;

    virtualToken = contracts.virtualToken;
    agentNftV2 = contracts.agentNftV2;

    // Deploy BondingV4 using the same setup contracts
    console.log("\n--- Deploying BondingV4 ---");
    const BondingV4 = await ethers.getContractFactory("BondingV4");
    bondingV4 = await upgrades.deployProxy(
      BondingV4,
      [
        addresses.fFactoryV2, // factory_
        addresses.fRouterV2, // router_
        accounts.owner.address, // feeTo_
        "100000", // fee_ (100 tokens)
        INITIAL_SUPPLY, // initialSupply_
        ASSET_RATE, // assetRate_
        MAX_TX, // maxTx_
        addresses.agentFactoryV6, // agentFactory_
        GRAD_THRESHOLD, // gradThreshold_
        START_TIME_DELAY, // startTimeDelay_
      ],
      { initializer: "initialize" }
    );
    await bondingV4.waitForDeployment();
    console.log("BondingV4 deployed at:", await bondingV4.getAddress());

    // Set DeployParams and LaunchParams for BondingV4
    console.log("\n--- Setting DeployParams for BondingV4 ---");
    const deployParams = {
      tbaSalt: TBA_SALT,
      tbaImplementation: TBA_IMPLEMENTATION,
      daoVotingPeriod: DAO_VOTING_PERIOD,
      daoThreshold: DAO_THRESHOLD,
    };
    await bondingV4.setDeployParams(deployParams);
    console.log("DeployParams set for BondingV4");

    console.log("\n--- Setting LaunchParams for BondingV4 ---");
    const launchParams = {
      startTimeDelay: START_TIME_DELAY,
      teamTokenReservedSupply: TEAM_TOKEN_RESERVED_SUPPLY,
      teamTokenReservedWallet: accounts.owner.address,
    };
    await bondingV4.setLaunchParams(launchParams);
    console.log("LaunchParams set for BondingV4");

    // Grant roles to BondingV4
    console.log("\n--- Granting roles to BondingV4 ---");
    const fRouterV2 = contracts.fRouterV2;
    const fFactoryV2 = contracts.fFactoryV2;
    const agentFactoryV6 = contracts.agentFactoryV6;

    await fRouterV2.grantRole(
      await fRouterV2.EXECUTOR_ROLE(),
      await bondingV4.getAddress()
    );
    console.log("EXECUTOR_ROLE granted to BondingV4 in FRouterV2");

    await agentFactoryV6.grantRole(
      await agentFactoryV6.BONDING_ROLE(),
      await bondingV4.getAddress()
    );
    console.log("BONDING_ROLE granted to BondingV4 in AgentFactoryV6");

    await fFactoryV2.grantRole(
      await fFactoryV2.CREATOR_ROLE(),
      await bondingV4.getAddress()
    );
    console.log("CREATOR_ROLE granted to BondingV4 in FFactoryV2");

    // Deploy CBBTC token (assetToken - token to swap to)
    console.log("\n--- Deploying MockERC20 for CBBTC ---");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const cbbtc = await MockERC20.deploy(
      "CBBTC",
      "CBBTC",
      accounts.owner.address,
      ethers.parseEther("10000000000")
    );
    await cbbtc.waitForDeployment();
    const cbbtcAddress = await cbbtc.getAddress();
    console.log("CBBTC deployed at:", cbbtcAddress);

    // Deploy AgentTax contract
    // assetToken is cbbtc (the token to swap to)
    // taxToken is virtualToken (the token collected as tax)
    console.log("\n--- Deploying AgentTax ---");
    const AgentTax = await ethers.getContractFactory("AgentTax");
    agentTax = await upgrades.deployProxy(
      AgentTax,
      [
        accounts.owner.address, // defaultAdmin_
        cbbtcAddress, // assetToken_ (CBBTC - token to swap to)
        await virtualToken.getAddress(), // taxToken_ (Virtual Token - tax collected)
        addresses.fRouterV2, // router_
        accounts.owner.address, // treasury_
        ethers.parseEther("100"), // minSwapThreshold_
        ethers.parseEther("10000"), // maxSwapThreshold_
        await agentNftV2.getAddress(), // nft_
      ],
      { initializer: "initialize" }
    );
    await agentTax.waitForDeployment();
    console.log("AgentTax deployed at:", await agentTax.getAddress());

    // Set BondingV4 address in AgentTax
    await agentTax.setBondingV4(await bondingV4.getAddress());
    console.log("BondingV4 address set in AgentTax");

    // Grant EXECUTOR_V2_ROLE to accounts.admin for testing
    const EXECUTOR_V2_ROLE = await agentTax.EXECUTOR_V2_ROLE();
    await agentTax.grantRole(EXECUTOR_V2_ROLE, accounts.admin.address);
    console.log("EXECUTOR_V2_ROLE granted to admin");
  });

  describe("preLaunchProjectXLaunch", function () {
    it("Should create a token with isProjectXLaunch set to true", async function () {
      const { user1 } = accounts;

      const tokenName = "ProjectXLaunch Token";
      const tokenTicker = "PXL";
      const cores = [0, 1, 2];
      const description = "ProjectXLaunch test token";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");
      
      // Verify cores array is not empty (required by _preLaunch)
      expect(cores.length).to.be.greaterThan(0);
      
      // Check fee and ensure purchaseAmount is sufficient
      const fee = await bondingV4.fee();
      expect(purchaseAmount).to.be.greaterThanOrEqual(fee);

      // Get launchParams.startTimeDelay from contract (not constant)
      const launchParams = await bondingV4.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      // Contract requires: startTime >= block.timestamp + launchParams.startTimeDelay
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;

      // Check user balance
      const userBalance = await virtualToken.balanceOf(user1.address);
      expect(userBalance).to.be.greaterThanOrEqual(purchaseAmount);

      // Approve virtual tokens (assetToken is virtualToken from router)
      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount);

      // Call preLaunchProjectXLaunch
      const tx = await bondingV4
        .connect(user1)
        .preLaunchProjectXLaunch(
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
          const parsed = bondingV4.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV4.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isProjectXLaunch is set to true
      const isProjectXLaunch = await bondingV4.isProjectXLaunch(tokenAddress);
      expect(isProjectXLaunch).to.be.true;

      // Verify token info
      const tokenInfo = await bondingV4.tokenInfo(tokenAddress);
      expect(tokenInfo.token).to.equal(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
    });

    it("Should emit PreLaunched event with correct parameters", async function () {
      const { user1 } = accounts;

      const tokenName = "ProjectXLaunch Token 2";
      const tokenTicker = "PXL2";
      const cores = [0, 1];
      const description = "ProjectXLaunch test token 2";
      const image = "https://example.com/image2.png";
      const urls = [
        "https://twitter.com/test2",
        "https://t.me/test2",
        "https://youtube.com/test2",
        "https://example2.com",
      ];
      const purchaseAmount = ethers.parseEther("2000");
      const launchParams = await bondingV4.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount);

      const tx = await bondingV4
        .connect(user1)
        .preLaunchProjectXLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
        );

      await expect(tx)
        .to.emit(bondingV4, "PreLaunched")
        .withArgs(
          (token) => token !== ethers.ZeroAddress,
          (pair) => pair !== ethers.ZeroAddress,
          (virtualId) => virtualId > 0n,
          (initialPurchase) => initialPurchase > 0n
        );
    });
  });

  describe("updateCreatorForProjectXLaunchAgents", function () {
    let tokenAddress;
    let agentId;

    beforeEach(async function () {
      const { user1 } = accounts;

      // Create a ProjectXLaunch token
      const tokenName = "Test ProjectXLaunch";
      const tokenTicker = "TPXL";
      const cores = [0, 1, 2];
      const description = "Test description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");
      const launchParamsData = await bondingV4.launchParams();
      const startTimeDelay = BigInt(launchParamsData.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount);

      const tx = await bondingV4
        .connect(user1)
        .preLaunchProjectXLaunch(
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
          const parsed = bondingV4.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV4.interface.parseLog(event);
      tokenAddress = parsedEvent.args.token;

      // Launch and graduate token to get agentId
      // Need to wait until pair.startTime() has passed
      const pair = await ethers.getContractAt("FPairV2", parsedEvent.args.pair);
      const pairStartTime = await pair.startTime();
      const currentTimeForLaunch = await time.latest();
      if (currentTimeForLaunch < pairStartTime) {
        const waitTime = BigInt(pairStartTime.toString()) - BigInt(currentTimeForLaunch.toString()) + 1n;
        await time.increase(waitTime);
      }
      await bondingV4.connect(user1).launch(tokenAddress);

      // Buy tokens to graduate
      await time.increase(100 * 60); // Wait for anti-sniper tax to expire
      const buyAmount = ethers.parseEther("202020.2044906205");
      // Need to approve fRouterV2, not bondingV4, because buy() calls router.buy()
      const fRouterV2Address = addresses.fRouterV2;
      await virtualToken
        .connect(accounts.user2)
        .approve(fRouterV2Address, buyAmount);
      await bondingV4
        .connect(accounts.user2)
        .buy(
          buyAmount,
          tokenAddress,
          0,
          (await time.latest()) + 300
        );

      // Find agentId from agentNft
      const nextVirtualId = await agentNftV2.nextVirtualId();
      for (let i = 1; i < nextVirtualId; i++) {
        try {
          const virtualInfo = await agentNftV2.virtualInfo(i);
          const tokenInfo = await bondingV4.tokenInfo(tokenAddress);
          if (virtualInfo.token === tokenInfo.agentToken) {
            agentId = BigInt(i);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      expect(agentId).to.not.be.undefined;
    });

    it("Should update tax recipient for ProjectXLaunch agent", async function () {
      const { admin } = accounts;
      const newTba = ethers.Wallet.createRandom().address;
      const newCreator = ethers.Wallet.createRandom().address;

      // Verify token allows tax recipient updates
      const isProjectXLaunch = await bondingV4.isProjectXLaunch(tokenAddress);
      expect(isProjectXLaunch).to.be.true;

      // Update tax recipient
      const tx = await agentTax
        .connect(admin)
        .updateCreatorForProjectXLaunchAgents(agentId, newTba, newCreator);

      // Get old creator before update (if exists)
      let oldCreator = ethers.ZeroAddress;
      try {
        const taxRecipient = await agentTax._agentRecipients(agentId);
        oldCreator = taxRecipient.creator;
      } catch (e) {
        // If recipient doesn't exist yet, oldCreator remains ZeroAddress
      }
      
      await expect(tx)
        .to.emit(agentTax, "CreatorUpdated")
        .withArgs(agentId, oldCreator, newCreator);
      console.log("Creator updated for agent", agentId, "from", oldCreator, "to", newCreator);
    });

    it("Should revert if token does not allow tax recipient updates", async function () {
      const { user1, admin } = accounts;

      // Create a regular token (not ProjectXLaunch)
      const tokenName = "Regular Token";
      const tokenTicker = "REG";
      const cores = [0, 1];
      const description = "Regular token";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");
      const launchParamsData2 = await bondingV4.launchParams();
      const startTimeDelayForToken2 = BigInt(launchParamsData2.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelayForToken2 + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount);

      const tx = await bondingV4
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
          const parsed = bondingV4.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV4.interface.parseLog(event);
      const regularTokenAddress = parsedEvent.args.token;

      // Verify regular token does NOT allow tax recipient updates
      const isProjectXLaunch = await bondingV4.isProjectXLaunch(
        regularTokenAddress
      );
      expect(isProjectXLaunch).to.be.false;

      // Launch and graduate to get agentId
      // Need to wait until pair.startTime() has passed
      const regularPair = await ethers.getContractAt("FPairV2", parsedEvent.args.pair);
      const regularPairStartTime = await regularPair.startTime();
      const currentTimeForRegularLaunch = await time.latest();
      if (currentTimeForRegularLaunch < regularPairStartTime) {
        const waitTime = BigInt(regularPairStartTime.toString()) - BigInt(currentTimeForRegularLaunch.toString()) + 1n;
        await time.increase(waitTime);
      }
      await bondingV4.connect(user1).launch(regularTokenAddress);
      await time.increase(100 * 60);
      const buyAmount = ethers.parseEther("202020.2044906205");
      // Need to approve fRouterV2, not bondingV4, because buy() calls router.buy()
      await virtualToken
        .connect(accounts.user2)
        .approve(addresses.fRouterV2, buyAmount);
      await bondingV4
        .connect(accounts.user2)
        .buy(
          buyAmount,
          regularTokenAddress,
          0,
          (await time.latest()) + 300
        );

      // Find agentId
      let regularAgentId;
      const nextVirtualId = await agentNftV2.nextVirtualId();
      for (let i = 1; i < nextVirtualId; i++) {
        try {
          const virtualInfo = await agentNftV2.virtualInfo(i);
          const tokenInfo = await bondingV4.tokenInfo(regularTokenAddress);
          if (virtualInfo.token === tokenInfo.agentToken) {
            regularAgentId = BigInt(i);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      expect(regularAgentId).to.not.be.undefined;
      console.log("regularAgentId", regularAgentId);

      // Try to update tax recipient - should revert
      const newTba = ethers.Wallet.createRandom().address;
      const newCreator = ethers.Wallet.createRandom().address;

      await expect(
        agentTax
          .connect(admin)
          .updateCreatorForProjectXLaunchAgents(
            regularAgentId,
            newTba,
            newCreator
          )
      ).to.be.revertedWith("Token is not a ProjectXLaunch token");
    });

    it("Should revert if called without EXECUTOR_V2_ROLE", async function () {
      const { user1 } = accounts;
      const newTba = ethers.Wallet.createRandom().address;
      const newCreator = ethers.Wallet.createRandom().address;

      await expect(
        agentTax
          .connect(user1)
          .updateCreatorForProjectXLaunchAgents(agentId, newTba, newCreator)
      ).to.be.revertedWithCustomError(
        agentTax,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should revert if BondingV4 is not set", async function () {
      const { admin } = accounts;

      // Create a new AgentTax without setting BondingV4
      // Need to use different tokens for assetToken and taxToken (contract requirement)
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const testAssetToken = await MockERC20.deploy(
        "Test Asset",
        "TASSET",
        accounts.owner.address,
        ethers.parseEther("10000000000")
      );
      await testAssetToken.waitForDeployment();
      
      const AgentTax = await ethers.getContractFactory("AgentTax");
      const newAgentTax = await upgrades.deployProxy(
        AgentTax,
        [
          accounts.owner.address,
          await testAssetToken.getAddress(), // assetToken_ (different from taxToken)
          await virtualToken.getAddress(), // taxToken_
          addresses.fRouterV2,
          accounts.owner.address,
          ethers.parseEther("100"),
          ethers.parseEther("10000"),
          await agentNftV2.getAddress(),
        ],
        { initializer: "initialize" }
      );
      await newAgentTax.waitForDeployment();

      const EXECUTOR_V2_ROLE = await newAgentTax.EXECUTOR_V2_ROLE();
      await newAgentTax.grantRole(EXECUTOR_V2_ROLE, admin.address);

      const newTba = ethers.Wallet.createRandom().address;
      const newCreator = ethers.Wallet.createRandom().address;

      await expect(
        newAgentTax
          .connect(admin)
          .updateCreatorForProjectXLaunchAgents(agentId, newTba, newCreator)
      ).to.be.revertedWith("BondingV4 not set");
    });

    it("Should revert with invalid TBA or creator address", async function () {
      const { admin } = accounts;

      await expect(
        agentTax
          .connect(admin)
          .updateCreatorForProjectXLaunchAgents(
            agentId,
            ethers.ZeroAddress,
            accounts.user1.address
          )
      ).to.be.revertedWith("Invalid TBA");

      await expect(
        agentTax
          .connect(admin)
          .updateCreatorForProjectXLaunchAgents(
            agentId,
            accounts.user1.address,
            ethers.ZeroAddress
          )
      ).to.be.revertedWith("Invalid creator");
    });
  });

  describe("Regression Tests - preLaunch backward compatibility", function () {
    it("Should create token with isProjectXLaunch set to false (backward compatible)", async function () {
      const { user1 } = accounts;

      const tokenName = "Regular Token";
      const tokenTicker = "REG";
      const cores = [0, 1, 2];
      const description = "Regular token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");
      const launchParamsData = await bondingV4.launchParams();
      const startTimeDelay = BigInt(launchParamsData.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount);

      const tx = await bondingV4
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
          const parsed = bondingV4.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV4.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isProjectXLaunch is set to false (backward compatible)
      const isProjectXLaunch = await bondingV4.isProjectXLaunch(tokenAddress);
      expect(isProjectXLaunch).to.be.false;

      // Verify token info
      const tokenInfo = await bondingV4.tokenInfo(tokenAddress);
      expect(tokenInfo.token).to.equal(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
    });

    it("Should maintain same function signature for preLaunch", async function () {
      // Verify that preLaunch function signature hasn't changed
      const preLaunchFragment = bondingV4.interface.getFunction("preLaunch");
      expect(preLaunchFragment.inputs.length).to.equal(8); // 8 parameters
      expect(preLaunchFragment.inputs[0].name).to.equal("_name");
      expect(preLaunchFragment.inputs[7].name).to.equal("startTime");
      // Should NOT have isProjectXLaunch_ parameter
      expect(
        preLaunchFragment.inputs.find(
          (input) => input.name === "isProjectXLaunch_"
        )
      ).to.be.undefined;
    });

    it("Should allow both preLaunch and preLaunchProjectXLaunch to coexist", async function () {
      const { user1 } = accounts;

      const purchaseAmount = ethers.parseEther("1000");
      const launchParamsData = await bondingV4.launchParams();
      const startTimeDelay = BigInt(launchParamsData.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount * 2n);

      // Create regular token
      const tx1 = await bondingV4
        .connect(user1)
        .preLaunch(
          "Regular Token",
          "REG",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime
        );

      // Create ProjectXLaunch token
      const tx2 = await bondingV4
        .connect(user1)
        .preLaunchProjectXLaunch(
          "ProjectXLaunch Token",
          "PXL",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime + 1n
        );

      await expect(tx1).to.emit(bondingV4, "PreLaunched");
      await expect(tx2).to.emit(bondingV4, "PreLaunched");

      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();

      const event1 = receipt1.logs.find((log) => {
        try {
          const parsed = bondingV4.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const event2 = receipt2.logs.find((log) => {
        try {
          const parsed = bondingV4.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent1 = bondingV4.interface.parseLog(event1);
      const parsedEvent2 = bondingV4.interface.parseLog(event2);

      const regularToken = parsedEvent1.args.token;
      const projectXLaunchToken = parsedEvent2.args.token;

      expect(await bondingV4.isProjectXLaunch(regularToken)).to.be.false;
      expect(
        await bondingV4.isProjectXLaunch(projectXLaunchToken)
      ).to.be.true;
    });
  });

  describe("ProjectXLaunch Launch Fee", function () {
    it("Should use projectXLaunchFee for ProjectXLaunch tokens", async function () {
      const { owner, user1 } = accounts;
      
      // Set a different fee for ProjectXLaunch
      const projectXLaunchFee = ethers.parseEther("2000"); // 2000 tokens
      await bondingV4.connect(owner).setProjectXLaunchFee(projectXLaunchFee);
      
      // Verify fee is set
      const setFee = await bondingV4.projectXLaunchFee();
      expect(setFee).to.equal(projectXLaunchFee);
      
      // Get regular fee for comparison
      const regularFee = await bondingV4.fee();
      expect(regularFee).to.not.equal(projectXLaunchFee);
      
      const tokenName = "ProjectXLaunch Fee Test";
      const tokenTicker = "PXLF";
      const cores = [0, 1, 2];
      const description = "Test fee";
      const image = "https://example.com/image.png";
      const urls = ["", "", "", ""];
      const purchaseAmount = ethers.parseEther("5000"); // Enough to cover both fees
      
      // Get launchParams.startTimeDelay from contract
      const launchParams = await bondingV4.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;
      
      // Check feeTo balance before
      const feeTo = await bondingV4.owner();
      const feeToBalanceBefore = await virtualToken.balanceOf(feeTo);
      
      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount);
      
      // Launch ProjectXLaunch token
      const tx = await bondingV4
        .connect(user1)
        .preLaunchProjectXLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
        );
      
      await tx.wait();
      
      // Verify feeTo received projectXLaunchFee, not regular fee
      const feeToBalanceAfter = await virtualToken.balanceOf(feeTo);
      const feeReceived = feeToBalanceAfter - feeToBalanceBefore;
      expect(feeReceived).to.equal(projectXLaunchFee);
      expect(feeReceived).to.not.equal(regularFee);
    });
    
    it("Should use regular fee for non-ProjectXLaunch tokens", async function () {
      const { owner, user1 } = accounts;
      
      // Set projectXLaunchFee
      const projectXLaunchFee = ethers.parseEther("2000");
      await bondingV4.connect(owner).setProjectXLaunchFee(projectXLaunchFee);
      
      // Get regular fee
      const regularFee = await bondingV4.fee();
      
      const tokenName = "Regular Token Fee Test";
      const tokenTicker = "REG";
      const cores = [0, 1, 2];
      const description = "Test fee";
      const image = "https://example.com/image.png";
      const urls = ["", "", "", ""];
      const purchaseAmount = ethers.parseEther("5000");
      
      // Get launchParams.startTimeDelay from contract
      const launchParams = await bondingV4.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;
      
      // Check feeTo balance before
      const feeTo = await bondingV4.owner();
      const feeToBalanceBefore = await virtualToken.balanceOf(feeTo);
      
      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount);
      
      // Launch regular token
      const tx = await bondingV4
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
      
      await tx.wait();
      
      // Verify feeTo received regular fee, not projectXLaunchFee
      const feeToBalanceAfter = await virtualToken.balanceOf(feeTo);
      const feeReceived = feeToBalanceAfter - feeToBalanceBefore;
      expect(feeReceived).to.equal(regularFee);
      expect(feeReceived).to.not.equal(projectXLaunchFee);
    });
    
    it("Should revert if purchaseAmount is less than projectXLaunchFee", async function () {
      const { owner, user1 } = accounts;
      
      // Set a high fee for ProjectXLaunch
      const projectXLaunchFee = ethers.parseEther("5000");
      await bondingV4.connect(owner).setProjectXLaunchFee(projectXLaunchFee);
      
      const tokenName = "ProjectXLaunch Insufficient Fee";
      const tokenTicker = "PXLIF";
      const cores = [0, 1, 2];
      const description = "Test";
      const image = "https://example.com/image.png";
      const urls = ["", "", "", ""];
      const purchaseAmount = ethers.parseEther("1000"); // Less than fee
      
      // Get launchParams.startTimeDelay from contract
      const launchParams = await bondingV4.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;
      
      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount);
      
      // Should revert with InvalidInput
      await expect(
        bondingV4
          .connect(user1)
          .preLaunchProjectXLaunch(
            tokenName,
            tokenTicker,
            cores,
            description,
            image,
            urls,
            purchaseAmount,
            startTime
          )
      ).to.be.revertedWithCustomError(bondingV4, "InvalidInput");
    });
    
    it("Should allow owner to set projectXLaunchFee", async function () {
      const { owner } = accounts;
      
      const newFee = ethers.parseEther("3000");
      await bondingV4.connect(owner).setProjectXLaunchFee(newFee);
      
      const setFee = await bondingV4.projectXLaunchFee();
      expect(setFee).to.equal(newFee);
    });
    
    it("Should revert if non-owner tries to set projectXLaunchFee", async function () {
      const { user1 } = accounts;
      
      const newFee = ethers.parseEther("3000");
      await expect(
        bondingV4.connect(user1).setProjectXLaunchFee(newFee)
      ).to.be.revertedWithCustomError(
        bondingV4,
        "OwnableUnauthorizedAccount"
      );
    });
    
    it("Should handle zero projectXLaunchFee (allows free launch)", async function () {
      const { owner, user1 } = accounts;
      
      // Set fee to 0
      await bondingV4.connect(owner).setProjectXLaunchFee(0);
      
      const tokenName = "Free ProjectXLaunch";
      const tokenTicker = "FREE";
      const cores = [0, 1, 2];
      const description = "Test";
      const image = "https://example.com/image.png";
      const urls = ["", "", "", ""];
      const purchaseAmount = ethers.parseEther("100"); // Small amount, but >= 0
      
      // Get launchParams.startTimeDelay from contract
      const launchParams = await bondingV4.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;
      
      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(await bondingV4.getAddress(), purchaseAmount);
      
      // Should succeed with zero fee
      const tx = await bondingV4
        .connect(user1)
        .preLaunchProjectXLaunch(
          tokenName,
          tokenTicker,
          cores,
          description,
          image,
          urls,
          purchaseAmount,
          startTime
        );
      
      await tx.wait();
      
      // Verify token was created
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = bondingV4.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
    });
  });

  describe("setBondingV4", function () {
    it("Should allow admin to set BondingV4 address", async function () {
      const { owner } = accounts;
      const newBondingV4Address = ethers.Wallet.createRandom().address;

      await agentTax.connect(owner).setBondingV4(newBondingV4Address);
      expect(await agentTax.bondingV4()).to.equal(newBondingV4Address);
    });

    it("Should revert if non-admin tries to set BondingV4", async function () {
      const { user1 } = accounts;
      const newBondingV4Address = ethers.Wallet.createRandom().address;

      await expect(
        agentTax.connect(user1).setBondingV4(newBondingV4Address)
      ).to.be.revertedWithCustomError(
        agentTax,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should revert if setting zero address", async function () {
      const { owner } = accounts;

      await expect(
        agentTax.connect(owner).setBondingV4(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid BondingV4 address");
    });
  });
});
