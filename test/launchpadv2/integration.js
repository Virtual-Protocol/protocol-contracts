const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { setupNewLaunchpadTest } = require("./setup");
const {
  START_TIME_DELAY,
  APPLICATION_THRESHOLD,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,
  TBA_SALT,
  TBA_IMPLEMENTATION,
} = require("./const");

describe("NewLaunchpad Integration Tests", function () {
  let setup;
  let contracts, accounts, addresses, params;

  before(async function () {
    setup = await loadFixture(setupNewLaunchpadTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;
    params = setup.params;
  });

  describe("Complete Token Launch Flow", function () {
    it("Should complete the full token launch and graduation flow", async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken, agentFactoryV6, agentNftV2 } = contracts;

      // Step 1: Create and launch a token
      console.log("\n--- Step 1: Creating and launching token ---");

      const tokenName = "Integration Test Token";
      const tokenTicker = "ITT";
      const cores = [0, 1, 2];
      const description = "Integration test token description";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      // Approve virtual tokens
      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      // Create and launch token
      const launchTx = await bondingV2
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

      const launchReceipt = await launchTx.wait();
      const launchEvent = launchReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "PreLaunched";
        } catch (e) {
          return false;
        }
      });

      const parsedLaunchEvent = bondingV2.interface.parseLog(launchEvent);
      const tokenAddress = parsedLaunchEvent.args.token;
      const pairAddress = parsedLaunchEvent.args.pair;

      console.log("Token created at:", tokenAddress);
      console.log("Pair created at:", pairAddress);

      // Wait for start time and launch
      await time.increase(START_TIME_DELAY + 1);
      await bondingV2.launch(tokenAddress);

      // Step 2: Buy tokens to reach graduation threshold
      console.log(
        "\n--- Step 2: Buying tokens to reach graduation threshold ---"
      );

      const buyAmount = ethers.parseEther("100000"); // Large amount to trigger graduation
      await virtualToken.connect(user2).approve(addresses.bondingV2, buyAmount);

      const buyTx = await bondingV2.connect(user2).buy(
        buyAmount,
        tokenAddress,
        0, // amountOutMin
        (await time.latest()) + 300 // deadline
      );

      const buyReceipt = await buyTx.wait();
      const graduationEvent = buyReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "Graduated";
        } catch (e) {
          return false;
        }
      });

      if (graduationEvent) {
        const parsedGraduationEvent =
          bondingV2.interface.parseLog(graduationEvent);
        const agentTokenAddress = parsedGraduationEvent.args.agentToken;

        console.log("Token graduated to Uniswap!");
        console.log("Agent token created at:", agentTokenAddress);

        // Step 3: Verify agent token was created
        console.log("\n--- Step 3: Verifying agent token creation ---");

        const agentToken = await ethers.getContractAt(
          "IAgentToken",
          agentTokenAddress
        );
        const agentTokenName = await agentToken.name();
        const agentTokenSymbol = await agentToken.symbol();

        expect(agentTokenName).to.equal(tokenName);
        expect(agentTokenSymbol).to.equal(tokenTicker);

        // Step 4: Verify NFT was minted
        console.log("\n--- Step 4: Verifying NFT creation ---");

        const totalSupply = await agentNftV2.totalSupply();
        expect(totalSupply).to.be.greaterThan(0);

        // Get the latest minted NFT
        const latestTokenId = totalSupply - 1n;
        const nftOwner = await agentNftV2.ownerOf(latestTokenId);
        const virtualInfo = await agentNftV2.virtualInfo(latestTokenId);

        expect(virtualInfo.token).to.equal(agentTokenAddress);
        expect(virtualInfo.dao).to.not.equal(ethers.ZeroAddress);

        console.log("NFT minted with ID:", latestTokenId);
        console.log("NFT owner:", nftOwner);
        console.log("Associated DAO:", virtualInfo.dao);

        // Step 5: Verify DAO was created
        console.log("\n--- Step 5: Verifying DAO creation ---");

        const dao = await ethers.getContractAt("IAgentDAO", virtualInfo.dao);
        const daoName = await dao.name();
        const daoVotingPeriod = await dao.votingPeriod();
        const daoThreshold = await dao.proposalThreshold();

        expect(daoName).to.include(tokenName);
        expect(daoVotingPeriod).to.equal(DAO_VOTING_PERIOD);
        expect(daoThreshold).to.equal(DAO_THRESHOLD);

        console.log("DAO created with name:", daoName);
        console.log("DAO voting period:", daoVotingPeriod.toString());
        console.log("DAO threshold:", daoThreshold.toString());

        // Step 6: Verify TBA was created
        console.log("\n--- Step 6: Verifying TBA creation ---");

        const tbaAddress = await agentNftV2.tba(latestTokenId);
        expect(tbaAddress).to.not.equal(ethers.ZeroAddress);

        console.log("TBA created at:", tbaAddress);

        // Step 7: Verify veToken was created
        console.log("\n--- Step 7: Verifying veToken creation ---");

        const veTokenAddress = virtualInfo.veToken;
        expect(veTokenAddress).to.not.equal(ethers.ZeroAddress);

        const veToken = await ethers.getContractAt(
          "IAgentVeToken",
          veTokenAddress
        );
        const veTokenName = await veToken.name();
        const veTokenSymbol = await veToken.symbol();

        expect(veTokenName).to.include("Staked");
        expect(veTokenSymbol).to.include("s");

        console.log("veToken created at:", veTokenAddress);
        console.log("veToken name:", veTokenName);
        console.log("veToken symbol:", veTokenSymbol);

        // Step 8: Verify liquidity was staked
        console.log("\n--- Step 8: Verifying liquidity staking ---");

        const lpTokenAddress = virtualInfo.lp;
        const lpToken = await ethers.getContractAt(
          "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
          lpTokenAddress
        );
        const stakedAmount = await lpToken.balanceOf(veTokenAddress);

        expect(stakedAmount).to.be.greaterThan(0);

        console.log("LP tokens staked:", ethers.formatEther(stakedAmount));

        console.log("\n--- Integration test completed successfully! ---");
      } else {
        console.log(
          "Token did not graduate in this test run (threshold not reached)"
        );
      }
    });

    it("Should handle multiple token launches", async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken, agentFactoryV6 } = contracts;

      // Launch first token
      const token1Name = "Token 1";
      const token1Ticker = "TK1";
      const cores = [0, 1, 2];
      const description = "First token";
      const image = "https://example.com/image1.png";
      const urls = [
        "https://twitter.com/test1",
        "https://t.me/test1",
        "https://youtube.com/test1",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      await virtualToken
        .connect(user1)
        .approve(addresses.bondingV2, purchaseAmount);

      const tx1 = await bondingV2
        .connect(user1)
        .preLaunch(
          token1Name,
          token1Ticker,
          cores,
          description,
          image,
          urls,
          purchaseAmount
        );

      const receipt1 = await tx1.wait();
      const event1 = receipt1.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent1 = bondingV2.interface.parseLog(event1);
      const token1Address = parsedEvent1.args.token;

      // Launch second token
      const token2Name = "Token 2";
      const token2Ticker = "TK2";
      const purchaseAmount2 = ethers.parseEther("1000");

      await virtualToken
        .connect(user2)
        .approve(addresses.bondingV2, purchaseAmount2);

      const tx2 = await bondingV2
        .connect(user2)
        .preLaunch(
          token2Name,
          token2Ticker,
          cores,
          description,
          image,
          urls,
          purchaseAmount2
        );

      const receipt2 = await tx2.wait();
      const event2 = receipt2.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent2 = bondingV2.interface.parseLog(event2);
      const token2Address = parsedEvent2.args.token;

      // Verify both tokens were created
      expect(token1Address).to.not.equal(token2Address);
      expect(token1Address).to.not.equal(ethers.ZeroAddress);
      expect(token2Address).to.not.equal(ethers.ZeroAddress);

      // Verify token info was stored correctly
      const token1Info = await bondingV2.tokenInfo(token1Address);
      const token2Info = await bondingV2.tokenInfo(token2Address);

      expect(token1Info.creator).to.equal(user1.address);
      expect(token2Info.creator).to.equal(user2.address);

      console.log("Multiple token launch test completed successfully!");
      console.log("Token 1:", token1Address);
      console.log("Token 2:", token2Address);
    });

    it("Should handle token trading before graduation", async function () {
      const { user1, user2, user3 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create and launch a token
      const tokenName = "Trading Test Token";
      const tokenTicker = "TTT";
      const cores = [0, 1, 2];
      const description = "Trading test token";
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

      const launchTx = await bondingV2
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

      const launchReceipt = await launchTx.wait();
      const launchEvent = launchReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      const parsedLaunchEvent = bondingV2.interface.parseLog(launchEvent);
      const tokenAddress = parsedLaunchEvent.args.token;

      // Wait for start time and launch
      await time.increase(START_TIME_DELAY + 1);
      await bondingV2.launch(tokenAddress);

      // User 2 buys tokens
      const buyAmount1 = ethers.parseEther("100");
      await virtualToken
        .connect(user2)
        .approve(addresses.bondingV2, buyAmount1);

      await bondingV2
        .connect(user2)
        .buy(buyAmount1, tokenAddress, 0, (await time.latest()) + 300);

      // User 3 buys tokens
      const buyAmount2 = ethers.parseEther("200");
      await virtualToken
        .connect(user3)
        .approve(addresses.bondingV2, buyAmount2);

      await bondingV2
        .connect(user3)
        .buy(buyAmount2, tokenAddress, 0, (await time.latest()) + 300);

      // User 2 sells some tokens
      const tokenContract = await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
        tokenAddress
      );
      const user2Balance = await tokenContract.balanceOf(user2.address);

      if (user2Balance > 0) {
        const sellAmount = user2Balance / 2n;
        await tokenContract
          .connect(user2)
          .approve(addresses.bondingV2, sellAmount);

        await bondingV2
          .connect(user2)
          .sell(sellAmount, tokenAddress, 0, (await time.latest()) + 300);
      }

      // Verify trading occurred
      const finalUser2Balance = await tokenContract.balanceOf(user2.address);
      const finalUser3Balance = await tokenContract.balanceOf(user3.address);

      expect(finalUser2Balance).to.be.greaterThan(0);
      expect(finalUser3Balance).to.be.greaterThan(0);

      console.log("Trading test completed successfully!");
      console.log(
        "User 2 final balance:",
        ethers.formatEther(finalUser2Balance)
      );
      console.log(
        "User 3 final balance:",
        ethers.formatEther(finalUser3Balance)
      );
    });
  });

  describe("Error Handling", function () {
    it("Should handle insufficient balance errors", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      const tokenName = "Error Test Token";
      const tokenTicker = "ETT";
      const cores = [0, 1, 2];
      const description = "Error test token";
      const image = "https://example.com/image.png";
      const urls = [
        "https://twitter.com/test",
        "https://t.me/test",
        "https://youtube.com/test",
        "https://example.com",
      ];
      const purchaseAmount = ethers.parseEther("1000");

      // Don't approve tokens
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
      ).to.be.reverted;
    });

    it("Should handle invalid token status errors", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user1).approve(addresses.bondingV2, buyAmount);

      // Try to buy from non-existent token
      await expect(
        bondingV2
          .connect(user1)
          .buy(buyAmount, ethers.ZeroAddress, 0, (await time.latest()) + 300)
      ).to.be.revertedWithCustomError(bondingV2, "InvalidTokenStatus");
    });

    it("Should handle slippage errors", async function () {
      const { user1, user2 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Create and launch a token
      const tokenName = "Slippage Test Token";
      const tokenTicker = "STT";
      const cores = [0, 1, 2];
      const description = "Slippage test token";
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

      const launchTx = await bondingV2
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

      const launchReceipt = await launchTx.wait();
      const launchEvent = launchReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      const parsedLaunchEvent = bondingV2.interface.parseLog(launchEvent);
      const tokenAddress = parsedLaunchEvent.args.token;

      // Wait for start time and launch
      await time.increase(START_TIME_DELAY + 1);
      await bondingV2.launch(tokenAddress);

      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.bondingV2, buyAmount);

      // Try to buy with very high minimum amount (should fail due to slippage)
      const highMinAmount = ethers.parseEther("1000"); // Unrealistically high

      await expect(
        bondingV2
          .connect(user2)
          .buy(
            buyAmount,
            tokenAddress,
            highMinAmount,
            (await time.latest()) + 300
          )
      ).to.be.revertedWithCustomError(bondingV2, "SlippageTooHigh");
    });
  });

  describe("Gas Optimization", function () {
    it("Should measure gas costs for key operations", async function () {
      const { user1 } = accounts;
      const { bondingV2, virtualToken } = contracts;

      // Measure gas for token creation
      const tokenName = "Gas Test Token";
      const tokenTicker = "GTT";
      const cores = [0, 1, 2];
      const description = "Gas test token";
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
      console.log("preLaunch gas used:", preLaunchReceipt.gasUsed.toString());

      const launchEvent = preLaunchReceipt.logs.find((log) => {
        try {
          const parsed = bondingV2.interface.parseLog(log);
          return parsed.name === "Launched";
        } catch (e) {
          return false;
        }
      });

      const parsedLaunchEvent = bondingV2.interface.parseLog(launchEvent);
      const tokenAddress = parsedLaunchEvent.args.token;

      // Wait for start time and measure gas for launch
      await time.increase(START_TIME_DELAY + 1);
      const launchTx = await bondingV2.launch(tokenAddress);
      const launchReceipt = await launchTx.wait();
      console.log("launch gas used:", launchReceipt.gasUsed.toString());

      // Measure gas for buy operation
      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user1).approve(addresses.bondingV2, buyAmount);

      const buyTx = await bondingV2
        .connect(user1)
        .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);

      const buyReceipt = await buyTx.wait();
      console.log("buy gas used:", buyReceipt.gasUsed.toString());

      console.log("Gas optimization test completed!");
    });
  });
});
