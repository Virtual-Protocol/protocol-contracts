const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { setupNewLaunchpadTest } = require("../launchpadv2/setup");

describe("Project60days - Drain Liquidity", function () {
  let setup;
  let contracts;
  let accounts;
  let addresses;
  let bondingV2;
  let fRouterV2;
  let virtualToken;
  let agentNftV2;
  let agentFactoryV6;

  before(async function () {
    setup = await loadFixture(setupNewLaunchpadTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;

    bondingV2 = contracts.bondingV2;
    fRouterV2 = contracts.fRouterV2;
    virtualToken = contracts.virtualToken;
    agentNftV2 = contracts.agentNftV2;
    agentFactoryV6 = contracts.agentFactoryV6;

    // Set BondingV2 address in FRouterV2
    console.log("\n--- Setting BondingV2 in FRouterV2 ---");
    const ADMIN_ROLE = await fRouterV2.ADMIN_ROLE();
    await fRouterV2.connect(accounts.owner).grantRole(ADMIN_ROLE, accounts.owner.address);
    await fRouterV2.connect(accounts.owner).setBondingV2(await bondingV2.getAddress());
    console.log("BondingV2 address set in FRouterV2");

    // Grant EXECUTOR_ROLE to admin for testing drain functions
    const EXECUTOR_ROLE = await fRouterV2.EXECUTOR_ROLE();
    await fRouterV2.connect(accounts.owner).grantRole(EXECUTOR_ROLE, accounts.admin.address);
    console.log("EXECUTOR_ROLE granted to admin for drain tests");

    // Grant REMOVE_LIQUIDITY_ROLE to FRouterV2 for drainUniV2Pool
    const REMOVE_LIQUIDITY_ROLE = await agentFactoryV6.REMOVE_LIQUIDITY_ROLE();
    await agentFactoryV6.connect(accounts.owner).grantRole(REMOVE_LIQUIDITY_ROLE, await fRouterV2.getAddress());
    console.log("REMOVE_LIQUIDITY_ROLE granted to FRouterV2 for drainUniV2Pool");
  });

  describe("drainPrivatePool", function () {
    let tokenAddress;
    let pairAddress;

    beforeEach(async function () {
      const { user1 } = accounts;

      // Create a Project60days token
      const tokenName = "Drain Test Token";
      const tokenTicker = "DRN";
      const cores = [0, 1, 2];
      const description = "Drain test description";
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
      pairAddress = parsedEvent.args.pair;

      // Launch the token
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const pairStartTime = await pair.startTime();
      const currentTimeForLaunch = await time.latest();
      if (currentTimeForLaunch < pairStartTime) {
        const waitTime = BigInt(pairStartTime.toString()) - BigInt(currentTimeForLaunch.toString()) + 1n;
        await time.increase(waitTime);
      }
      await bondingV2.connect(user1).launch(tokenAddress);
    });

    it("Should drain private pool for Project60days token", async function () {
      const { admin } = accounts;
      const recipient = ethers.Wallet.createRandom().address;

      // Get initial balances
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const initialAssetBalance = await pair.assetBalance();
      const initialTokenBalance = await pair.balance();

      expect(initialAssetBalance).to.be.gt(0);
      expect(initialTokenBalance).to.be.gt(0);

      // Drain the pool
      const tx = await fRouterV2
        .connect(admin)
        .drainPrivatePool(tokenAddress, recipient);

      await expect(tx)
        .to.emit(fRouterV2, "PrivatePoolDrained")
        .withArgs(tokenAddress, recipient, initialAssetBalance, initialTokenBalance);

      // Verify balances are drained
      const finalAssetBalance = await pair.assetBalance();
      const finalTokenBalance = await pair.balance();

      expect(finalAssetBalance).to.equal(0);
      expect(finalTokenBalance).to.equal(0);

      // Verify recipient received the tokens
      const recipientAssetBalance = await virtualToken.balanceOf(recipient);
      expect(recipientAssetBalance).to.equal(initialAssetBalance);
    });

    it("Should revert buy and sell after private pool is drained", async function () {
      const { admin, user2, beOpsWallet } = accounts;
      // Use beOpsWallet as recipient (a real signer) so we can transfer tokens later
      const recipient = beOpsWallet;

      // Get pair contract
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const initialAssetBalance = await pair.assetBalance();
      const initialTokenBalance = await pair.balance();

      // Verify pool has liquidity before drain
      expect(initialAssetBalance).to.be.gt(0);
      expect(initialTokenBalance).to.be.gt(0);

      // Drain the pool - recipient receives the drained tokens
      await fRouterV2.connect(admin).drainPrivatePool(tokenAddress, recipient.address);

      // Verify pool is empty
      expect(await pair.assetBalance()).to.equal(0);
      expect(await pair.balance()).to.equal(0);

      // Give user2 some Virtual tokens for testing
      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(await bondingV2.getAddress(), buyAmount);

      // Try to buy - should revert (no tokens in pool to receive)
      const initialUser2VirtualBalance = await virtualToken.balanceOf(user2.address);
      console.log("Initial user2 Virtual balance:", initialUser2VirtualBalance);
      await expect(
        bondingV2.connect(user2).buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.reverted;
      const finalUser2VirtualBalance = await virtualToken.balanceOf(user2.address);
      console.log("Final user2 Virtual balance:", finalUser2VirtualBalance);
      // User2's Virtual balance should remain unchanged (tx reverted)
      expect(finalUser2VirtualBalance).to.equal(initialUser2VirtualBalance);

      // Get agent token contract and check user2's balance
      const agentTokenContract = await ethers.getContractAt("IERC20", tokenAddress);
      let user2AgentTokenBalance = await agentTokenContract.balanceOf(user2.address);

      // user2 doesn't have any agent tokens to sell, transfer some from recipient (who received drained tokens)
      if (user2AgentTokenBalance === 0n) {
        const transferAmount = ethers.parseEther("2000");
        // recipient is user3, a real signer who received drained tokens
        await agentTokenContract.connect(recipient).transfer(user2.address, transferAmount);
        user2AgentTokenBalance = await agentTokenContract.balanceOf(user2.address);
      }

      expect(user2AgentTokenBalance).to.be.gt(0);

      // Approve router for sell
      await agentTokenContract.connect(user2).approve(await fRouterV2.getAddress(), user2AgentTokenBalance);

      // Check balance before sell attempt
      const initialUser2AgentBalance = await agentTokenContract.balanceOf(user2.address);
      console.log("Initial user2 agent token balance:", initialUser2AgentBalance);

      // Try to sell - should revert (no asset tokens in pool to receive)
      await expect(
        bondingV2.connect(user2).sell(user2AgentTokenBalance, tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.reverted;

      // Verify user2's agent token balance is unchanged (tx reverted, tokens not lost)
      const finalUser2AgentBalance = await agentTokenContract.balanceOf(user2.address);
      console.log("Final user2 agent token balance:", finalUser2AgentBalance);
      expect(finalUser2AgentBalance).to.equal(initialUser2AgentBalance);
    });

    it("Should revert if token is not a Project60days token", async function () {
      const { admin, user1 } = accounts;
      const recipient = ethers.Wallet.createRandom().address;

      // Create a regular token (not Project60days)
      const tokenName = "Regular Token";
      const tokenTicker = "REG";
      const cores = [0, 1, 2];
      const description = "Regular description";
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

      const parsedEvent = bondingV2.interface.parseLog(event);
      const regularTokenAddress = parsedEvent.args.token;

      // Try to drain - should revert
      await expect(
        fRouterV2.connect(admin).drainPrivatePool(regularTokenAddress, recipient)
      ).to.be.revertedWith("agentToken does not allow liquidity drain");
    });

    it("Should revert if called without EXECUTOR_ROLE", async function () {
      const { user1 } = accounts;
      const recipient = ethers.Wallet.createRandom().address;

      await expect(
        fRouterV2.connect(user1).drainPrivatePool(tokenAddress, recipient)
      ).to.be.revertedWithCustomError(fRouterV2, "AccessControlUnauthorizedAccount");
    });

    it("Should revert if BondingV2 is not set", async function () {
      const { admin, owner } = accounts;

      // Deploy a new FRouterV2 without setting BondingV2
      const FRouterV2 = await ethers.getContractFactory("FRouterV2");
      const newFRouterV2 = await upgrades.deployProxy(
        FRouterV2,
        [await contracts.fFactoryV2.getAddress(), await virtualToken.getAddress()],
        { initializer: "initialize" }
      );
      await newFRouterV2.waitForDeployment();

      const EXECUTOR_ROLE = await newFRouterV2.EXECUTOR_ROLE();
      await newFRouterV2.grantRole(EXECUTOR_ROLE, admin.address);

      const recipient = ethers.Wallet.createRandom().address;

      await expect(
        newFRouterV2.connect(admin).drainPrivatePool(tokenAddress, recipient)
      ).to.be.revertedWith("BondingV2 not set");
    });

    it("Should revert with zero address recipient", async function () {
      const { admin } = accounts;

      await expect(
        fRouterV2.connect(admin).drainPrivatePool(tokenAddress, ethers.ZeroAddress)
      ).to.be.revertedWith("Zero addresses are not allowed.");
    });
  });

  describe("drainUniV2Pool", function () {
    let tokenAddress;
    let agentToken;
    let veToken;

    beforeEach(async function () {
      const { user1, user2 } = accounts;

      // Create a Project60days token
      const tokenName = "Graduate Drain Token";
      const tokenTicker = "GDT";
      const cores = [0, 1, 2];
      const description = "Graduate drain test";
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
      const pairAddress = parsedEvent.args.pair;

      // Launch the token
      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const pairStartTime = await pair.startTime();
      const currentTimeForLaunch = await time.latest();
      if (currentTimeForLaunch < pairStartTime) {
        const waitTime = BigInt(pairStartTime.toString()) - BigInt(currentTimeForLaunch.toString()) + 1n;
        await time.increase(waitTime);
      }
      await bondingV2.connect(user1).launch(tokenAddress);

      // Buy enough to graduate
      await time.increase(100 * 60); // Wait for anti-sniper tax to expire
      const buyAmount = ethers.parseEther("202020.2044906205");
      await virtualToken
        .connect(user2)
        .approve(addresses.fRouterV2, buyAmount);
      await bondingV2
        .connect(user2)
        .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);

      // Get agentToken from tokenInfo
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      agentToken = tokenInfo.agentToken;

      // Find the veToken from agentNft
      const nextVirtualId = await agentNftV2.nextVirtualId();
      for (let i = 1; i < nextVirtualId; i++) {
        try {
          const virtualInfo = await agentNftV2.virtualInfo(i);
          if (virtualInfo.token === agentToken) {
            const virtualLP = await agentNftV2.virtualLP(i);
            veToken = virtualLP.veToken;
            break;
          }
        } catch (e) {
          continue;
        }
      }
    });

    it("Should have graduated token with agentToken and veToken", async function () {
      expect(agentToken).to.not.equal(ethers.ZeroAddress);
      expect(veToken).to.not.be.undefined;
      expect(veToken).to.not.equal(ethers.ZeroAddress);

      // Verify token is graduated
      const tokenInfo = await bondingV2.tokenInfo(tokenAddress);
      expect(tokenInfo.tradingOnUniswap).to.be.true;
    });

    it("Should drain ALL UniV2 pool liquidity for Project60days token", async function () {
      const { admin } = accounts;
      const recipient = ethers.Wallet.createRandom().address;

      // Get veToken contract
      const veTokenContract = await ethers.getContractAt("AgentVeTokenV2", veToken);
      
      // Get founder and check their veToken balance
      const founder = await veTokenContract.founder();
      const founderVeTokenBalance = await veTokenContract.balanceOf(founder);
      console.log("Founder veToken balance before drain:", ethers.formatEther(founderVeTokenBalance));
      
      expect(founderVeTokenBalance).to.be.gt(0);

      const deadline = (await time.latest()) + 300;

      // Drain ALL liquidity from the UniV2 pool (no need to specify amount)
      const tx = await fRouterV2
        .connect(admin)
        .drainUniV2Pool(
          tokenAddress, // In single token model, tokenAddress == agentToken
          veToken,
          recipient,
          deadline
        );

      // Verify UniV2PoolDrained event - should drain the FULL balance
      await expect(tx)
        .to.emit(fRouterV2, "UniV2PoolDrained")
        .withArgs(tokenAddress, veToken, recipient, founderVeTokenBalance);

      // Verify LiquidityRemoved event from veToken
      const receipt = await tx.wait();
      const liquidityRemovedEvent = receipt.logs.find((log) => {
        try {
          const parsed = veTokenContract.interface.parseLog(log);
          return parsed && parsed.name === "LiquidityRemoved";
        } catch (e) {
          return false;
        }
      });

      expect(liquidityRemovedEvent).to.not.be.undefined;

      if (liquidityRemovedEvent) {
        const parsedEvent = veTokenContract.interface.parseLog(liquidityRemovedEvent);
        expect(parsedEvent.args.veTokenHolder).to.equal(founder);
        expect(parsedEvent.args.veTokenAmount).to.equal(founderVeTokenBalance);
        expect(parsedEvent.args.recipient).to.equal(recipient);

        console.log("✅ ALL UniV2 pool liquidity drained successfully:");
        console.log("- veTokenAmount (LP tokens):", ethers.formatEther(parsedEvent.args.veTokenAmount));
        console.log("- amountA (tokenA received):", ethers.formatEther(parsedEvent.args.amountA));
        console.log("- amountB (tokenB received):", ethers.formatEther(parsedEvent.args.amountB));
      }

      // Verify founder's veToken balance is now ZERO (all drained)
      const founderVeTokenBalanceAfter = await veTokenContract.balanceOf(founder);
      console.log("Founder veToken balance after drain:", ethers.formatEther(founderVeTokenBalanceAfter));
      expect(founderVeTokenBalanceAfter).to.equal(0);
    });

    it("Should revert drainUniV2Pool if token is not a Project60days token", async function () {
      const { admin, user1, user2 } = accounts;

      // Create and graduate a regular token
      const tokenName = "Regular Graduate";
      const tokenTicker = "RGD";
      const cores = [0, 1, 2];
      const description = "Regular description";
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

      const parsedEvent = bondingV2.interface.parseLog(event);
      const regularTokenAddress = parsedEvent.args.token;
      const regularPairAddress = parsedEvent.args.pair;

      // Launch and graduate
      const pair = await ethers.getContractAt("FPairV2", regularPairAddress);
      const pairStartTime = await pair.startTime();
      const currentTimeForLaunch = await time.latest();
      if (currentTimeForLaunch < pairStartTime) {
        const waitTime = BigInt(pairStartTime.toString()) - BigInt(currentTimeForLaunch.toString()) + 1n;
        await time.increase(waitTime);
      }
      await bondingV2.connect(user1).launch(regularTokenAddress);
      await time.increase(100 * 60);

      const buyAmount = ethers.parseEther("202020.2044906205");
      await virtualToken
        .connect(user2)
        .approve(addresses.fRouterV2, buyAmount);
      await bondingV2
        .connect(user2)
        .buy(buyAmount, regularTokenAddress, 0, (await time.latest()) + 300);

      const regularTokenInfo = await bondingV2.tokenInfo(regularTokenAddress);
      const regularAgentToken = regularTokenInfo.agentToken;

      // Find veToken
      let regularVeToken;
      const nextVirtualId = await agentNftV2.nextVirtualId();
      for (let i = 1; i < nextVirtualId; i++) {
        try {
          const virtualInfo = await agentNftV2.virtualInfo(i);
          if (virtualInfo.token === regularAgentToken) {
            const virtualLP = await agentNftV2.virtualLP(i);
            regularVeToken = virtualLP.veToken;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      const recipient = ethers.Wallet.createRandom().address;
      const deadline = (await time.latest()) + 300;

      // Try to drain - should revert
      await expect(
        fRouterV2
          .connect(admin)
          .drainUniV2Pool(
            regularTokenAddress,
            regularVeToken,
            recipient,
            deadline
          )
      ).to.be.revertedWith("agentToken does not allow liquidity drain");
    });

    it("Should revert if called without EXECUTOR_ROLE", async function () {
      const { user1 } = accounts;
      const recipient = ethers.Wallet.createRandom().address;
      const deadline = (await time.latest()) + 300;

      await expect(
        fRouterV2
          .connect(user1)
          .drainUniV2Pool(
            tokenAddress,
            veToken,
            recipient,
            deadline
          )
      ).to.be.revertedWithCustomError(fRouterV2, "AccessControlUnauthorizedAccount");
    });

    it("Should revert when token does not match veToken", async function () {
      const { admin } = accounts;
      const recipient = ethers.Wallet.createRandom().address;
      const deadline = (await time.latest()) + 300;

      // Use a wrong token address that doesn't match the veToken's LP pair
      const wrongToken = ethers.Wallet.createRandom().address;

      await expect(
        fRouterV2
          .connect(admin)
          .drainUniV2Pool(
            wrongToken,
            veToken,
            recipient,
            deadline
          )
      ).to.be.revertedWith("agentToken does not allow liquidity drain");
    });

    it("Should revert when there is no liquidity to drain (already drained)", async function () {
      const { admin } = accounts;
      const recipient = ethers.Wallet.createRandom().address;
      const deadline = (await time.latest()) + 300;

      // First drain - should succeed
      await fRouterV2
        .connect(admin)
        .drainUniV2Pool(
          tokenAddress,
          veToken,
          recipient,
          deadline
        );

      // Second drain - should revert because no liquidity left
      await expect(
        fRouterV2
          .connect(admin)
          .drainUniV2Pool(
            tokenAddress,
            veToken,
            recipient,
            (await time.latest()) + 300
          )
      ).to.be.revertedWith("No liquidity to drain");
    });
  });

  describe("setBondingV2", function () {
    it("Should set BondingV2 address", async function () {
      const newBondingV2Address = ethers.Wallet.createRandom().address;

      // Deploy a new FRouterV2 for this test
      const FRouterV2 = await ethers.getContractFactory("FRouterV2");
      const newFRouterV2 = await upgrades.deployProxy(
        FRouterV2,
        [await contracts.fFactoryV2.getAddress(), await virtualToken.getAddress()],
        { initializer: "initialize" }
      );
      await newFRouterV2.waitForDeployment();

      const ADMIN_ROLE = await newFRouterV2.ADMIN_ROLE();
      await newFRouterV2.grantRole(ADMIN_ROLE, accounts.owner.address);

      await newFRouterV2.connect(accounts.owner).setBondingV2(newBondingV2Address);

      expect(await newFRouterV2.bondingV2()).to.equal(newBondingV2Address);
    });

    it("Should revert if called without ADMIN_ROLE", async function () {
      const { user1 } = accounts;
      const newBondingV2Address = ethers.Wallet.createRandom().address;

      await expect(
        fRouterV2.connect(user1).setBondingV2(newBondingV2Address)
      ).to.be.revertedWithCustomError(fRouterV2, "AccessControlUnauthorizedAccount");
    });

    it("Should revert with zero address", async function () {
      const { owner } = accounts;

      await expect(
        fRouterV2.connect(owner).setBondingV2(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid BondingV2 address");
    });
  });
});
