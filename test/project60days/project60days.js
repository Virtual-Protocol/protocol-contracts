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
} = require("../launchpadv2/const");

describe("Project60days - AgentTax Integration", function () {
  let setup;
  let contracts;
  let accounts;
  let addresses;
  let agentTax;
  let bondingV2;
  let virtualToken;
  let agentNftV2;

  before(async function () {
    setup = await loadFixture(setupNewLaunchpadTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;

    bondingV2 = contracts.bondingV2;
    virtualToken = contracts.virtualToken;
    agentNftV2 = contracts.agentNftV2;

    // Deploy CBBTC token (assetToken - token to swap to)
    // Note: cbbtc is deployed in setup but not exposed, so we deploy it here
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

    // Set BondingV2 address in AgentTax
    await agentTax.setBondingV2(await bondingV2.getAddress());
    console.log("BondingV2 address set in AgentTax");

    // Grant EXECUTOR_V2_ROLE to accounts.admin for testing
    const EXECUTOR_V2_ROLE = await agentTax.EXECUTOR_V2_ROLE();
    await agentTax.grantRole(EXECUTOR_V2_ROLE, accounts.admin.address);
    console.log("EXECUTOR_V2_ROLE granted to admin");
  });

  describe("preLaunchProject60days", function () {
    it("Should create a token with isProject60days set to true", async function () {
      const { user1 } = accounts;

      const tokenName = "Project60days Token";
      const tokenTicker = "P60";
      const cores = [0, 1, 2];
      const description = "Project60days test token";
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
      const fee = await bondingV2.fee();
      expect(purchaseAmount).to.be.greaterThanOrEqual(fee);

      // Get launchParams.startTimeDelay from contract (not constant)
      const launchParams = await bondingV2.launchParams();
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
        .approve(await bondingV2.getAddress(), purchaseAmount);

      // Call preLaunchProject60days
      const tx = await bondingV2
        .connect(user1)
        .preLaunchProject60days(
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
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isProject60days is set to true
      const isProject60days = await bondingV2.isProject60days(tokenAddress);
      expect(isProject60days).to.be.true;

      // Verify token info
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.token).to.equal(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
    });

    it("Should emit PreLaunched event with correct parameters", async function () {
      const { user1 } = accounts;

      const tokenName = "Project60days Token 2";
      const tokenTicker = "P602";
      const cores = [0, 1];
      const description = "Project60days test token 2";
      const image = "https://example.com/image2.png";
      const urls = [
        "https://twitter.com/test2",
        "https://t.me/test2",
        "https://youtube.com/test2",
        "https://example2.com",
      ];
      const purchaseAmount = ethers.parseEther("2000");
      const launchParams = await bondingV2.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV2.getAddress(), purchaseAmount);

      const tx = await bondingV2
        .connect(user1)
        .preLaunchProject60days(
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
        .to.emit(bondingV2, "PreLaunched")
        .withArgs(
          (token) => token !== ethers.ZeroAddress,
          (pair) => pair !== ethers.ZeroAddress,
          (virtualId) => virtualId > 0n,
          (initialPurchase) => initialPurchase > 0n
        );
    });
  });

  describe("updateCreatorForProject60daysAgents", function () {
    let tokenAddress;
    let agentId;

    beforeEach(async function () {
      const { user1 } = accounts;

      // Create a Project60days token
      const tokenName = "Test Project60days";
      const tokenTicker = "TP60";
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
      const launchParamsData = await bondingV2.launchParams();
      const startTimeDelay = BigInt(launchParamsData.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV2.getAddress(), purchaseAmount);

      const tx = await bondingV2
        .connect(user1)
        .preLaunchProject60days(
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
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV2.interface.parseLog(event);
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
      await bondingV2.connect(user1).launch(tokenAddress);

      // Buy tokens to graduate
      await time.increase(100 * 60); // Wait for anti-sniper tax to expire
      const buyAmount = ethers.parseEther("202020.2044906205");
      // Need to approve fRouterV2, not bondingV2, because buy() calls router.buy()
      const fRouterV2Address = addresses.fRouterV2;
      await virtualToken
        .connect(accounts.user2)
        .approve(fRouterV2Address, buyAmount);
      await bondingV2
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
          const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
          // console.log("virtualInfo", virtualInfo);
          // console.log("tokenInfo", tokenInfo);
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

    it("Should update tax recipient for Project60days agent", async function () {
      const { admin } = accounts;
      const newTba = ethers.Wallet.createRandom().address;
      const newCreator = ethers.Wallet.createRandom().address;

      // Verify token allows tax recipient updates
      const isProject60days = await bondingV2.isProject60days(tokenAddress);
      expect(isProject60days).to.be.true;

      // Update tax recipient
      const tx = await agentTax
        .connect(admin)
        .updateCreatorForProject60daysAgents(agentId, newTba, newCreator);

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

      // Create a regular token (not Project60days)
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
      const launchParamsData2 = await bondingV2.launchParams();
      const startTimeDelayForToken2 = BigInt(launchParamsData2.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelayForToken2 + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV2.getAddress(), purchaseAmount);

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
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = bondingV2.interface.parseLog(event);
      const regularTokenAddress = parsedEvent.args.token;

      // Verify regular token does NOT allow tax recipient updates
      const isProject60days = await bondingV2.isProject60days(
        regularTokenAddress
      );
      expect(isProject60days).to.be.false;

      // Launch and graduate to get agentId
      // Need to wait until pair.startTime() has passed
      const regularPair = await ethers.getContractAt("FPairV2", parsedEvent.args.pair);
      const regularPairStartTime = await regularPair.startTime();
      const currentTimeForRegularLaunch = await time.latest();
      if (currentTimeForRegularLaunch < regularPairStartTime) {
        const waitTime = BigInt(regularPairStartTime.toString()) - BigInt(currentTimeForRegularLaunch.toString()) + 1n;
        await time.increase(waitTime);
      }
      await bondingV2.connect(user1).launch(regularTokenAddress);
      await time.increase(100 * 60);
      const buyAmount = ethers.parseEther("202020.2044906205");
      // Need to approve fRouterV2, not bondingV2, because buy() calls router.buy()
      await virtualToken
        .connect(accounts.user2)
        .approve(addresses.fRouterV2, buyAmount);
      await bondingV2
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
          const tokenInfo = await bondingV2.tokenInfo(regularTokenAddress);
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
          .updateCreatorForProject60daysAgents(
            regularAgentId,
            newTba,
            newCreator
          )
      ).to.be.revertedWith("Token is not a Project60days token");
    });

    it("Should revert if called without EXECUTOR_V2_ROLE", async function () {
      const { user1 } = accounts;
      const newTba = ethers.Wallet.createRandom().address;
      const newCreator = ethers.Wallet.createRandom().address;

      await expect(
        agentTax
          .connect(user1)
          .updateCreatorForProject60daysAgents(agentId, newTba, newCreator)
      ).to.be.revertedWithCustomError(
        agentTax,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should revert if BondingV2 is not set", async function () {
      const { admin } = accounts;

      // Create a new AgentTax without setting BondingV2
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
          .updateCreatorForProject60daysAgents(agentId, newTba, newCreator)
      ).to.be.revertedWith("BondingV2 not set");
    });

    it("Should revert with invalid TBA or creator address", async function () {
      const { admin } = accounts;

      await expect(
        agentTax
          .connect(admin)
          .updateCreatorForProject60daysAgents(
            agentId,
            ethers.ZeroAddress,
            accounts.user1.address
          )
      ).to.be.revertedWith("Invalid TBA");

      await expect(
        agentTax
          .connect(admin)
          .updateCreatorForProject60daysAgents(
            agentId,
            accounts.user1.address,
            ethers.ZeroAddress
          )
      ).to.be.revertedWith("Invalid creator");
    });
  });

  describe("Regression Tests - preLaunch backward compatibility", function () {
    it("Should create token with isProject60days set to false (backward compatible)", async function () {
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
      const launchParamsData = await bondingV2.launchParams();
      const startTimeDelay = BigInt(launchParamsData.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV2.getAddress(), purchaseAmount);

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
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = bondingV2.interface.parseLog(event);
      const tokenAddress = parsedEvent.args.token;

      // Verify isProject60days is set to false (backward compatible)
      const isProject60days = await bondingV2.isProject60days(tokenAddress);
      expect(isProject60days).to.be.false;

      // Verify token info
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.token).to.equal(tokenAddress);
      expect(tokenInfo.creator).to.equal(user1.address);
    });

    it("Should maintain same function signature for preLaunch", async function () {
      // Verify that preLaunch function signature hasn't changed
      const preLaunchFragment = bondingV2.interface.getFunction("preLaunch");
      expect(preLaunchFragment.inputs.length).to.equal(8); // 8 parameters
      expect(preLaunchFragment.inputs[0].name).to.equal("_name");
      expect(preLaunchFragment.inputs[7].name).to.equal("startTime");
      // Should NOT have allowTaxRecipientUpdate_ parameter
      expect(
        preLaunchFragment.inputs.find(
          (input) => input.name === "isProject60days_"
        )
      ).to.be.undefined;
    });

    it("Should allow both preLaunch and preLaunchProject60days to coexist", async function () {
      const { user1 } = accounts;

      const purchaseAmount = ethers.parseEther("1000");
      const launchParamsData = await bondingV2.launchParams();
      const startTimeDelay = BigInt(launchParamsData.startTimeDelay.toString());
      // Add a larger buffer to account for block.timestamp potentially being ahead of time.latest()
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;

      await virtualToken
        .connect(user1)
        .approve(await bondingV2.getAddress(), purchaseAmount * 2n);

      // Create regular token
      const tx1 = await bondingV2
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

      // Create Project60days token
      const tx2 = await bondingV2
        .connect(user1)
        .preLaunchProject60days(
          "Project60days Token",
          "P60",
          [0, 1],
          "Description",
          "https://example.com/image.png",
          ["", "", "", ""],
          purchaseAmount,
          startTime + 1n
        );

      await expect(tx1).to.emit(bondingV2, "PreLaunched");
      await expect(tx2).to.emit(bondingV2, "PreLaunched");

      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();

      const event1 = receipt1.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const event2 = receipt2.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent1 = bondingV2.interface.parseLog(event1);
      const parsedEvent2 = bondingV2.interface.parseLog(event2);

      const regularToken = parsedEvent1.args.token;
      const project60daysToken = parsedEvent2.args.token;

      expect(await bondingV2.isProject60days(regularToken)).to.be.false;
      expect(
        await bondingV2.isProject60days(project60daysToken)
      ).to.be.true;
    });
  });

  describe("Project60days Launch Fee", function () {
    it("Should use project60daysLaunchFee for Project60days tokens", async function () {
      const { owner, user1 } = accounts;
      
      // Set a different fee for Project60days
      const project60daysFee = ethers.parseEther("2000"); // 2000 tokens
      await bondingV2.connect(owner).setProject60daysLaunchFee(project60daysFee);
      
      // Verify fee is set
      const setFee = await bondingV2.project60daysLaunchFee();
      expect(setFee).to.equal(project60daysFee);
      
      // Get regular fee for comparison
      const regularFee = await bondingV2.fee();
      expect(regularFee).to.not.equal(project60daysFee);
      
      const tokenName = "Project60days Fee Test";
      const tokenTicker = "P60F";
      const cores = [0, 1, 2];
      const description = "Test fee";
      const image = "https://example.com/image.png";
      const urls = ["", "", "", ""];
      const purchaseAmount = ethers.parseEther("5000"); // Enough to cover both fees
      
      // Get launchParams.startTimeDelay from contract
      const launchParams = await bondingV2.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;
      
      // Check feeTo balance before
      const feeTo = await bondingV2.owner();
      const feeToBalanceBefore = await virtualToken.balanceOf(feeTo);
      
      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(await bondingV2.getAddress(), purchaseAmount);
      
      // Launch Project60days token
      const tx = await bondingV2
        .connect(user1)
        .preLaunchProject60days(
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
      
      // Verify feeTo received project60daysLaunchFee, not regular fee
      const feeToBalanceAfter = await virtualToken.balanceOf(feeTo);
      const feeReceived = feeToBalanceAfter - feeToBalanceBefore;
      expect(feeReceived).to.equal(project60daysFee);
      expect(feeReceived).to.not.equal(regularFee);
    });
    
    it("Should use regular fee for non-Project60days tokens", async function () {
      const { owner, user1 } = accounts;
      
      // Set project60daysLaunchFee
      const project60daysFee = ethers.parseEther("2000");
      await bondingV2.connect(owner).setProject60daysLaunchFee(project60daysFee);
      
      // Get regular fee
      const regularFee = await bondingV2.fee();
      
      const tokenName = "Regular Token Fee Test";
      const tokenTicker = "REG";
      const cores = [0, 1, 2];
      const description = "Test fee";
      const image = "https://example.com/image.png";
      const urls = ["", "", "", ""];
      const purchaseAmount = ethers.parseEther("5000");
      
      // Get launchParams.startTimeDelay from contract
      const launchParams = await bondingV2.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;
      
      // Check feeTo balance before
      const feeTo = await bondingV2.owner();
      const feeToBalanceBefore = await virtualToken.balanceOf(feeTo);
      
      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(await bondingV2.getAddress(), purchaseAmount);
      
      // Launch regular token
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
      
      await tx.wait();
      
      // Verify feeTo received regular fee, not project60daysLaunchFee
      const feeToBalanceAfter = await virtualToken.balanceOf(feeTo);
      const feeReceived = feeToBalanceAfter - feeToBalanceBefore;
      expect(feeReceived).to.equal(regularFee);
      expect(feeReceived).to.not.equal(project60daysFee);
    });
    
    it("Should revert if purchaseAmount is less than project60daysLaunchFee", async function () {
      const { owner, user1 } = accounts;
      
      // Set a high fee for Project60days
      const project60daysFee = ethers.parseEther("5000");
      await bondingV2.connect(owner).setProject60daysLaunchFee(project60daysFee);
      
      const tokenName = "Project60days Insufficient Fee";
      const tokenTicker = "P60IF";
      const cores = [0, 1, 2];
      const description = "Test";
      const image = "https://example.com/image.png";
      const urls = ["", "", "", ""];
      const purchaseAmount = ethers.parseEther("1000"); // Less than fee
      
      // Get launchParams.startTimeDelay from contract
      const launchParams = await bondingV2.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;
      
      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(await bondingV2.getAddress(), purchaseAmount);
      
      // Should revert with InvalidInput
      await expect(
        bondingV2
          .connect(user1)
          .preLaunchProject60days(
            tokenName,
            tokenTicker,
            cores,
            description,
            image,
            urls,
            purchaseAmount,
            startTime
          )
      ).to.be.revertedWithCustomError(bondingV2, "InvalidInput");
    });
    
    it("Should allow owner to set project60daysLaunchFee", async function () {
      const { owner } = accounts;
      
      const newFee = ethers.parseEther("3000");
      await bondingV2.connect(owner).setProject60daysLaunchFee(newFee);
      
      const setFee = await bondingV2.project60daysLaunchFee();
      expect(setFee).to.equal(newFee);
    });
    
    it("Should revert if non-owner tries to set project60daysLaunchFee", async function () {
      const { user1 } = accounts;
      
      const newFee = ethers.parseEther("3000");
      await expect(
        bondingV2.connect(user1).setProject60daysLaunchFee(newFee)
      ).to.be.revertedWithCustomError(
        bondingV2,
        "OwnableUnauthorizedAccount"
      );
    });
    
    it("Should handle zero project60daysLaunchFee (allows free launch)", async function () {
      const { owner, user1 } = accounts;
      
      // Set fee to 0
      await bondingV2.connect(owner).setProject60daysLaunchFee(0);
      
      const tokenName = "Free Project60days";
      const tokenTicker = "FREE";
      const cores = [0, 1, 2];
      const description = "Test";
      const image = "https://example.com/image.png";
      const urls = ["", "", "", ""];
      const purchaseAmount = ethers.parseEther("100"); // Small amount, but >= 0
      
      // Get launchParams.startTimeDelay from contract
      const launchParams = await bondingV2.launchParams();
      const startTimeDelay = BigInt(launchParams.startTimeDelay.toString());
      const currentTime = BigInt((await time.latest()).toString());
      const startTime = currentTime + startTimeDelay + 100n;
      
      // Approve tokens
      await virtualToken
        .connect(user1)
        .approve(await bondingV2.getAddress(), purchaseAmount);
      
      // Should succeed with zero fee
      const tx = await bondingV2
        .connect(user1)
        .preLaunchProject60days(
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
          const parsed = bondingV2.interface.parseLog(log);
          return parsed && parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
    });
  });

  describe("setBondingV2", function () {
    it("Should allow admin to set BondingV2 address", async function () {
      const { owner } = accounts;
      const newBondingV2Address = ethers.Wallet.createRandom().address;

      await agentTax.connect(owner).setBondingV2(newBondingV2Address);
      expect(await agentTax.bondingV2()).to.equal(newBondingV2Address);
    });

    it("Should revert if non-admin tries to set BondingV2", async function () {
      const { user1 } = accounts;
      const newBondingV2Address = ethers.Wallet.createRandom().address;

      await expect(
        agentTax.connect(user1).setBondingV2(newBondingV2Address)
      ).to.be.revertedWithCustomError(
        agentTax,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should revert if setting zero address", async function () {
      const { owner } = accounts;

      await expect(
        agentTax.connect(owner).setBondingV2(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid BondingV2 address");
    });
  });
});
